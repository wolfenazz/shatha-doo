/**
 * Dynamics 365 mock sandbox (v1.1.0).
 *
 * An in-process HTTP server that simulates the Microsoft Dynamics 365
 * (Dataverse) Web API v9.2 + the Microsoft identity platform v2.0 OAuth token
 * endpoint, so the REAL connector stack (OAuth -> client -> connector ->
 * MCP) can be exercised end-to-end offline — no Microsoft 365 tenant or
 * Azure AD environment required.
 *
 * Simulated surface:
 *  - POST /oauth2/v2.0/token       authorization_code + refresh_token grants
 *  - GET  /api/data/v9.2/WhoAmI()  connection probe (testConnection)
 *  - GET/POST /contacts /leads /tasks   OData list ops (contains filter,
 *    $top/$skip/$select, @odata.nextLink pagination) + create (Prefer
 *    return=representation -> 201 body, otherwise 204)
 *  - PATCH /contacts(<guid>)        update -> 204
 *  - Provider realism: x-ms-request-id, x-ms-ratelimit-* headers,
 *    OData-shaped error bodies, 401 for invalid tokens, 404 for unknown
 *    records, and failure injection (`__fail_status` + `__fail_attempts`)
 *    to exercise the connector's retry-with-backoff path.
 *
 * NOT a test double inside the connector: it is a real HTTP server the
 * production code talks to over real sockets (see tests/integration.test.ts
 * and scripts/demo.ts).
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mockContacts, type Contact } from '../fixtures/contacts';

/** Sandbox options (defaults are fine for most uses). */
export interface SandboxOptions {
  /** Client ID accepted by the token endpoint (default `sandbox-client`). */
  clientId?: string;
  /** Client secret accepted by the token endpoint (default `sandbox-secret`). */
  clientSecret?: string;
  /** Authorization code accepted by the token endpoint (default `sandbox-code`). */
  code?: string;
  /** Web API base path, defaults to `/api/data/v9.2`. */
  basePath?: string;
}

/** A running sandbox: its base URL and a close() to shut the server down. */
export interface SandboxServer {
  url: string;
  close: () => Promise<void>;
}

/** Token considered invalid by the Web API (simulates a bad/expired token). */
const INVALID_TOKEN = 'invalid-token';

/** Generic record store keyed by primary-key field name per entity. */
type Store = { idField: string; records: Map<string, Record<string, unknown>> };

function newStore(idField: string, seed: Record<string, unknown>[]): Store {
  return { idField, records: new Map(seed.map((r) => [r[idField] as string, r])) };
}

function fullName(record: Record<string, unknown>): string {
  const first = typeof record.firstname === 'string' ? record.firstname : '';
  const last = typeof record.lastname === 'string' ? record.lastname : '';
  return [first, last].filter(Boolean).join(' ');
}

/** Applies a single OData filter expression to a record. */
function matchesFilter(record: Record<string, unknown>, expression: string): boolean {
  const contains = /^\s*contains\(\s*([A-Za-z0-9_]+)\s*,\s*'([^']*)'\s*\)\s*$/i.exec(expression);
  if (contains) {
    const [, field, literal] = contains;
    const value = field === 'fullname' ? fullName(record) : record[field];
    return typeof value === 'string' && value.toLowerCase().includes(literal.toLowerCase());
  }
  const eq = /^\s*([A-Za-z0-9_]+)\s+eq\s+'([^']*)'\s*$/i.exec(expression);
  if (eq) {
    const [, field, literal] = eq;
    const value = field === 'fullname' ? fullName(record) : record[field];
    return value === literal;
  }
  const neNull = /^\s*([A-Za-z0-9_]+)\s+ne\s+null\s*$/i.exec(expression);
  if (neNull) {
    const field = neNull[1];
    const value = field === 'fullname' ? fullName(record) : record[field];
    return value !== undefined && value !== null;
  }
  return true;
}

/** Splits an OData $filter into AND-ed parts and matches them all. */
function matchesFilters(record: Record<string, unknown>, filter: string | null): boolean {
  if (!filter || filter.trim().length === 0) {
    return true;
  }
  const parts = filter.split(' and ');
  return parts.every((part) => matchesFilter(record, part));
}

/** Reads the request body as text. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Writes a JSON response with the provider-realistic header set. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'x-ms-request-id': randomUUID(),
    'x-ms-ratelimit-burst-remaining': '120',
    'x-ms-ratelimit-concurrency-remaining': '2',
    'x-ms-ratelimit-time-remaining': '60',
    'OData-Version': '4.0',
  });
  res.end(JSON.stringify(body));
}

/** OData-shaped error body (matches the real Web API error envelope). */
function odataError(code: string, message: string): unknown {
  return { error: { code, message } };
}

/**
 * Starts the sandbox on 127.0.0.1 with an ephemeral port.
 * Resolves once the server is listening; call `close()` when done.
 */
export async function startSandbox(options: SandboxOptions = {}): Promise<SandboxServer> {
  const clientId = options.clientId ?? 'sandbox-client';
  const clientSecret = options.clientSecret ?? 'sandbox-secret';
  const code = options.code ?? 'sandbox-code';
  const basePath = (options.basePath ?? '/api/data/v9.2').replace(/\/+$/, '');

  const stores: Record<string, Store> = {
    contacts: newStore(
      'contactid',
      mockContacts.map((c: Contact) => ({ ...c, fullname: `${c.firstname} ${c.lastname}` })),
    ),
    leads: newStore('leadid', []),
    tasks: newStore('activityid', []),
  };

  /** Per-route failure budget for `__fail_status` / `__fail_attempts`. */
  const failBudgets = new Map<
    string,
    { status: number; attempts: number; withRetryAfter: boolean }
  >();
  /** Paths that already armed a failure budget (retried requests must not re-arm). */
  const armedFailurePaths = new Set<string>();

  /** Keys a failure budget by path + fail parameters (distinct sims stay independent). */
  function failureKey(path: string, url: URL): string {
    return `${path}|${url.searchParams.get('__fail_status') ?? ''}|${
      url.searchParams.get('__fail_attempts') ?? ''
    }`;
  }

  function registerFailures(path: string, url: URL): void {
    const key = failureKey(path, url);
    if (armedFailurePaths.has(key)) {
      return;
    }
    const status = Number(url.searchParams.get('__fail_status'));
    const attempts = Number(url.searchParams.get('__fail_attempts'));
    if (Number.isInteger(status) && status >= 400 && Number.isInteger(attempts) && attempts > 0) {
      armedFailurePaths.add(key);
      failBudgets.set(key, {
        status,
        attempts,
        withRetryAfter: url.searchParams.get('__fail_retry_after') === '1',
      });
    }
  }

  function consumeFailure(
    path: string,
    url: URL,
  ): { status: number; withRetryAfter: boolean } | null {
    const budget = failBudgets.get(failureKey(path, url));
    if (!budget) {
      return null;
    }
    budget.attempts -= 1;
    if (budget.attempts <= 0) {
      failBudgets.delete(failureKey(path, url));
    }
    return { status: budget.status, withRetryAfter: budget.withRetryAfter };
  }

  async function handleOAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = new URLSearchParams(await readBody(req));
    const grantType = body.get('grant_type');
    if (body.get('client_id') !== clientId || body.get('client_secret') !== clientSecret) {
      sendJson(res, 401, odataError('invalid_client', 'The client credentials are invalid'));
      return;
    }
    if (grantType === 'authorization_code' && body.get('code') !== code) {
      sendJson(res, 400, odataError('invalid_grant', 'The authorization code is invalid'));
      return;
    }
    if (grantType === 'refresh_token' && !body.get('refresh_token')) {
      sendJson(res, 400, odataError('invalid_grant', 'A refresh token is required'));
      return;
    }
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      sendJson(
        res,
        400,
        odataError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`),
      );
      return;
    }
    sendJson(res, 200, {
      token_type: 'Bearer',
      expires_in: 3600,
      ext_expires_in: 3600,
      access_token: `sandbox-access-${randomUUID()}`,
      refresh_token: `sandbox-refresh-${randomUUID()}`,
    });
  }

  function handleWhoAmI(res: ServerResponse): void {
    sendJson(res, 200, {
      '@odata.context': `${basePath}/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse`,
      BusinessUnitId: '00000000-0000-0000-0000-000000000001',
      UserId: '00000000-0000-0000-0000-000000000002',
      OrganizationId: '00000000-0000-0000-0000-000000000003',
    });
  }

  function handleList(entity: string, url: URL, res: ServerResponse): void {
    const store = stores[entity];
    if (!store) {
      sendJson(res, 404, odataError('ResourceNotFound', `Entity set '${entity}' not found`));
      return;
    }
    const filter = url.searchParams.get('$filter');
    const top = Math.max(1, Math.min(5000, Number(url.searchParams.get('$top')) || 10));
    const skip = Math.max(0, Number(url.searchParams.get('$skip')) || 0);
    const select = url.searchParams.get('$select');

    const matching = [...store.records.values()].filter((r) => matchesFilters(r, filter));
    const page = matching.slice(skip, skip + top);
    const hasMore = skip + page.length < matching.length;

    const project = (record: Record<string, unknown>): Record<string, unknown> => {
      if (!select) {
        return record;
      }
      const fields = select
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      const projected: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in record) {
          projected[field] = record[field];
        }
      }
      return projected;
    };

    const response: Record<string, unknown> = { value: page.map(project) };
    if (hasMore) {
      url.searchParams.set('$skip', String(skip + top));
      response['@odata.nextLink'] = `${basePath}/contacts?${url.searchParams.toString()}`;
    }
    sendJson(res, 200, response);
  }

  async function handleCreate(
    entity: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const store = stores[entity];
    if (!store) {
      sendJson(res, 404, odataError('ResourceNotFound', `Entity set '${entity}' not found`));
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, odataError('InvalidPayload', 'Request body must be valid JSON'));
      return;
    }
    const id = randomUUID();
    const record = { ...body, [store.idField]: id };
    if (entity === 'contacts') {
      record.fullname = fullName(record);
    }
    store.records.set(id, record);

    if (req.headers.prefer === 'return=representation') {
      res.writeHead(201, {
        'Content-Type': 'application/json',
        'x-ms-request-id': randomUUID(),
        'OData-EntityId': `${basePath}/${entity}(${id})`,
      });
      res.end(JSON.stringify(record));
      return;
    }
    res.writeHead(204, { 'x-ms-request-id': randomUUID() });
    res.end();
  }

  async function handleUpdate(
    entity: string,
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const store = stores[entity];
    const existing = store?.records.get(id);
    if (!store || !existing) {
      sendJson(res, 404, odataError('ResourceNotFound', `Record ${id} not found`));
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, odataError('InvalidPayload', 'Request body must be valid JSON'));
      return;
    }
    const merged = { ...existing, ...body };
    if (entity === 'contacts') {
      merged.fullname = fullName(merged);
    }
    store.records.set(id, merged);
    res.writeHead(204, { 'x-ms-request-id': randomUUID() });
    res.end();
  }

  async function handleWebApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://sandbox.local');
    const path = url.pathname.replace(basePath, '').replace(/^\/+/, '');

    const authorization = req.headers.authorization ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token || token === INVALID_TOKEN) {
      sendJson(res, 401, odataError('Unauthorized', 'Invalid or missing access token'));
      return;
    }

    registerFailures(path, url);
    const failure = consumeFailure(path, url);
    if (failure) {
      res.writeHead(failure.status, {
        'Content-Type': 'application/json',
        'x-ms-request-id': randomUUID(),
        ...(failure.withRetryAfter ? { 'Retry-After': '0' } : {}),
      });
      res.end(
        JSON.stringify(
          odataError(
            failure.status === 429 ? 'RateLimitExceeded' : 'ProviderError',
            'Simulated provider failure',
          ),
        ),
      );
      return;
    }

    if (path === 'WhoAmI()') {
      handleWhoAmI(res);
      return;
    }

    const entityMatch = /^(contacts|leads|tasks)$/i.exec(path);
    if (entityMatch) {
      const entity = entityMatch[1].toLowerCase();
      if (req.method === 'GET') {
        handleList(entity, url, res);
        return;
      }
      if (req.method === 'POST') {
        await handleCreate(entity, req, res);
        return;
      }
      sendJson(res, 405, odataError('MethodNotAllowed', `Method ${req.method} not allowed`));
      return;
    }

    const patchMatch = /^(contacts|leads|tasks)\(([0-9a-fA-F-]{36})\)$/i.exec(path);
    if (patchMatch && req.method === 'PATCH') {
      await handleUpdate(patchMatch[1].toLowerCase(), patchMatch[2], req, res);
      return;
    }

    sendJson(res, 404, odataError('ResourceNotFound', `No route matches '${path}'`));
  }

  function route(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://sandbox.local');
    if (url.pathname === '/oauth2/v2.0/token' && req.method === 'POST') {
      handleOAuth(req, res).catch((error: unknown) => {
        sendJson(res, 500, odataError('InternalServerError', String(error)));
      });
      return;
    }
    if (url.pathname.startsWith(basePath)) {
      handleWebApi(req, res).catch((error: unknown) => {
        sendJson(res, 500, odataError('InternalServerError', String(error)));
      });
      return;
    }
    sendJson(res, 404, odataError('ResourceNotFound', `No route matches '${url.pathname}'`));
  }

  const server: Server = createServer((req, res) => {
    route(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Sandbox failed to bind a port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
