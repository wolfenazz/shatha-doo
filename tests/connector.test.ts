/**
 * Unit tests for src/connector.ts — Dynamics 365 connector core (T3.2 S3.2.2).
 *
 * Covers:
 *  - manifest: name/provider/auth per connector.yaml (oauth2, 5 actions)
 *  - listActions(): exactly the 5 required ids; write actions carry
 *    `approval: required`; T1.2 input/output schemas attached
 *  - execute(): UNKNOWN_ACTION for unknown ids; routes every known id to its
 *    registered handler with `(client, input, credentials)`; normalizes a
 *    throwing handler and a failed lazy-client build into failed results
 *  - testConnection(): credential-shape validation + real WhoAmI probe
 *  - OAuth wiring (v1.1.0): token acquisition via authorization_code or
 *    refresh_token with in-memory caching; accessToken fast path
 *
 * OFFLINE: axios.create is mocked so the lazily-built Web API client never
 * performs I/O; routing is verified with registered spy handlers and the
 * OAuth token functions (src/auth) are mocked.
 */
import axios from 'axios';
import { Dynamics365Connector } from '../src/connector';
import { Dynamics365Client } from '../src/client';
import { ConnectorError } from '../src/errors';
import { acquireTokenResponse, refreshAccessToken } from '../src/auth';
import { ConnectorExecutionResult } from '../src/types';

jest.mock('axios', () => {
  const instance = {
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) } };
});

jest.mock('../src/auth', () => {
  const actual = jest.requireActual('../src/auth');
  return {
    ...actual,
    acquireTokenResponse: jest.fn(),
    refreshAccessToken: jest.fn(),
  };
});

/** The five required action ids (connector.yaml / .opencode/context.md). */
const REQUIRED_IDS = [
  'dynamics.search_contact',
  'dynamics.create_contact',
  'dynamics.update_contact',
  'dynamics.create_lead',
  'dynamics.create_task',
];

/** Credentials that pass testConnection AND let the lazy client build. */
const VALID_CREDENTIALS = {
  orgUrl: 'https://contoso.api.crm.dynamics.com',
  accessToken: 'test-access-token',
};
const APPROVAL_TOKEN = 'unit-test-approval-token';
const APPROVAL_METADATA = { approvalToken: APPROVAL_TOKEN };

describe('Dynamics365Connector (S3.2.2)', () => {
  let connector: Dynamics365Connector;

  beforeEach(() => {
    connector = new Dynamics365Connector({ approvalToken: APPROVAL_TOKEN });
    (acquireTokenResponse as jest.Mock).mockReset();
    (refreshAccessToken as jest.Mock).mockReset();
    (acquireTokenResponse as jest.Mock).mockResolvedValue({
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh-new',
      expiresIn: 3600,
    });
    (refreshAccessToken as jest.Mock).mockResolvedValue({
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh-new',
      expiresIn: 3600,
    });
  });

  describe('manifest', () => {
    it('exposes name/provider/auth per connector.yaml', () => {
      expect(connector.manifest.name).toBe('dynamics365-connector');
      expect(connector.manifest.version).toBe('1.1.0');
      expect(connector.manifest.provider.name).toBe('Microsoft Dynamics 365');
      expect(connector.manifest.provider.version).toBe('v9.2');
      expect(connector.manifest.provider.type).toBe('Enterprise CRM');
      expect(connector.manifest.auth.type).toBe('oauth2');
      expect(connector.manifest.auth.grantTypes).toEqual(['authorization_code', 'refresh_token']);
      expect(connector.manifest.auth.scopes).toEqual(
        expect.arrayContaining([
          'Dynamics CRM.UserBasic',
          'Dynamics CRM.Organization.Read',
          'Dynamics CRM.Organization.Write',
        ]),
      );
    });

    it('registers all 5 actions in the manifest', () => {
      expect(connector.manifest.actions).toHaveLength(5);
    });
  });

  describe('listActions (S2.2.3)', () => {
    it('returns exactly the 5 required action ids', () => {
      const ids = connector.listActions().map((a) => a.id);
      expect(ids).toHaveLength(5);
      expect(ids).toEqual(expect.arrayContaining(REQUIRED_IDS));
    });

    it('marks the four write actions as approval required and search as read', () => {
      const byId = new Map(connector.listActions().map((a) => [a.id, a]));
      expect(byId.get('dynamics.search_contact')?.type).toBe('read');
      for (const id of [
        'dynamics.create_contact',
        'dynamics.update_contact',
        'dynamics.create_lead',
        'dynamics.create_task',
      ]) {
        expect(byId.get(id)?.type).toBe('write');
        expect(byId.get(id)?.approval).toBe('required');
      }
    });

    it('attaches T1.2 input/output schemas from the registry', () => {
      const search = connector.listActions().find((a) => a.id === 'dynamics.search_contact');
      expect(search?.inputSchema).toBeDefined();
      expect(search?.outputSchema).toBeDefined();
    });
  });

  describe('execute routing (S2.2.4)', () => {
    it('returns a normalized UNKNOWN_ACTION error for unknown ids', async () => {
      const result = await connector.execute({ actionId: 'dynamics.nope', input: {} });
      expect(result.success).toBe(false);
      expect(result.error as ConnectorError).toMatchObject({
        code: 'UNKNOWN_ACTION',
        retryable: false,
      });
    });

    it('routes each known action id to its registered handler', async () => {
      const inputs: Record<string, unknown> = {
        'dynamics.search_contact': { query: 'John' },
        'dynamics.create_contact': { firstname: 'John' },
        'dynamics.update_contact': {
          contactid: '11111111-1111-1111-1111-111111111111',
          firstname: 'Jane',
        },
        'dynamics.create_lead': { companyname: 'Example Corp' },
        'dynamics.create_task': { subject: 'Follow up' },
      };
      for (const id of REQUIRED_IDS) {
        const spy = jest.fn(async () => ({ success: true, data: { actionId: id } }));
        connector.registerHandler(id, spy);

        const result = await connector.execute({
          actionId: id,
          input: inputs[id],
          credentials: VALID_CREDENTIALS,
          ...(id === 'dynamics.search_contact' ? {} : { metadata: APPROVAL_METADATA }),
        });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ actionId: id });
      }
    });

    it('passes the lazily-built client, input, and credentials to the handler', async () => {
      const spy = jest.fn<Promise<ConnectorExecutionResult>, [Dynamics365Client, unknown, unknown]>(
        async () => ({ success: true, data: {} }),
      );
      connector.registerHandler('dynamics.create_contact', spy);
      const input = { firstname: 'Jane' };

      await connector.execute({
        actionId: 'dynamics.create_contact',
        input,
        credentials: VALID_CREDENTIALS,
        metadata: APPROVAL_METADATA,
      });

      const [client, handlerInput, handlerCredentials] = spy.mock.calls[0] as unknown as [
        Dynamics365Client,
        unknown,
        unknown,
      ];
      expect(client).toBeInstanceOf(Dynamics365Client);
      expect(handlerInput).toEqual(input);
      expect(handlerCredentials).toBe(VALID_CREDENTIALS);
    });

    it('normalizes a throwing handler into a failed result', async () => {
      const spy = jest.fn(async () => {
        throw new ConnectorError('provider boom', 'PROVIDER_ERROR', 'req-1', true);
      });
      connector.registerHandler('dynamics.create_task', spy);

      const result = await connector.execute({
        actionId: 'dynamics.create_task',
        input: { subject: 'x' },
        credentials: VALID_CREDENTIALS,
        metadata: APPROVAL_METADATA,
      });

      expect(result.success).toBe(false);
      expect(result.error as ConnectorError).toMatchObject({
        code: 'PROVIDER_ERROR',
        requestId: 'req-1',
        retryable: true,
      });
    });

    it('normalizes a missing-orgUrl lazy client build into a failed result', async () => {
      const result = await connector.execute({
        actionId: 'dynamics.search_contact',
        input: { query: 'John' },
        credentials: { accessToken: 'token' },
      });

      expect(result.success).toBe(false);
      expect(result.error as ConnectorError).toMatchObject({ code: 'MISSING_ORG_URL' });
    });

    it('blocks write handlers before provider access when approval is absent or forged', async () => {
      const spy = jest.fn(async () => ({ success: true, data: {} }));
      connector.registerHandler('dynamics.create_contact', spy);

      for (const metadata of [undefined, {}, { approvalToken: true }, { approvalToken: 'wrong' }]) {
        const result = await connector.execute({
          actionId: 'dynamics.create_contact',
          input: { firstname: 'Blocked' },
          credentials: VALID_CREDENTIALS,
          metadata: metadata as Record<string, unknown> | undefined,
        });
        expect(result.success).toBe(false);
        expect(result.error as ConnectorError).toMatchObject({
          code: 'APPROVAL_REQUIRED',
          retryable: false,
        });
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it('enforces the published schema before a provider handler runs', async () => {
      const spy = jest.fn(async () => ({ success: true, data: {} }));
      connector.registerHandler('dynamics.create_task', spy);
      const result = await connector.execute({
        actionId: 'dynamics.create_task',
        input: { subject: 'Task', scheduledstart: 'not-a-date', unexpected: true },
        credentials: VALID_CREDENTIALS,
        metadata: APPROVAL_METADATA,
      });
      expect(result.success).toBe(false);
      expect(result.error as ConnectorError).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('creates a request-scoped client for each credential set', async () => {
      const clients: Dynamics365Client[] = [];
      connector.registerHandler('dynamics.search_contact', async (client) => {
        clients.push(client);
        return { success: true, data: { contacts: [], count: 0 } };
      });
      await connector.execute({
        actionId: 'dynamics.search_contact',
        input: { query: 'A' },
        credentials: VALID_CREDENTIALS,
      });
      await connector.execute({
        actionId: 'dynamics.search_contact',
        input: { query: 'B' },
        credentials: {
          orgUrl: 'https://fabrikam.api.crm.dynamics.com',
          accessToken: 'other-token',
        },
      });
      expect(clients).toHaveLength(2);
      expect(clients[0]).not.toBe(clients[1]);
      expect(axios.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseURL: 'https://fabrikam.api.crm.dynamics.com/api/data/v9.2/',
        }),
      );
    });
  });

  describe('testConnection (S2.2.2)', () => {
    it('passes when orgUrl + accessToken are present', async () => {
      const result = await connector.testConnection(VALID_CREDENTIALS);
      expect(result.success).toBe(true);
    });

    it('fails when OAuth client fields have no usable token source', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://org.api.crm.dynamics.com',
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'http://localhost:3000/callback',
      });
      expect(result.success).toBe(false);
      expect(result.details).toMatchObject({ probe: { status: 'not_run' } });
    });

    it('fails for non-object credentials', async () => {
      const result = await connector.testConnection('not-an-object');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid credentials');
    });

    it('fails and lists the missing orgUrl', async () => {
      const result = await connector.testConnection({
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('orgUrl');
      expect(result.details).toMatchObject({ missing: expect.arrayContaining(['orgUrl']) });
    });

    it('fails and lists the missing OAuth fields when no accessToken is present', async () => {
      const result = await connector.testConnection({ orgUrl: 'https://org.api.crm.dynamics.com' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('tenantId');
      expect(result.message).toContain('clientId');
      expect(result.message).toContain('clientSecret');
      expect(result.details).toEqual({ missing: ['tenantId', 'clientId', 'clientSecret'] });
    });

    it('runs a WhoAmI probe when a token source is provided (v1.1.0)', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://contoso.api.crm.dynamics.com',
        accessToken: 'test-token',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('WhoAmI probe succeeded');
      expect(result.details).toMatchObject({ probe: { status: 'ok' } });
    });

    it('does not claim success when no token source exists', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://org.api.crm.dynamics.com',
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      });
      expect(result.success).toBe(false);
      expect(result.details).toMatchObject({ probe: { status: 'not_run' } });
    });

    it('reports a failed WhoAmI probe as diagnostics without throwing (v1.1.0)', async () => {
      const instance = (axios.create as jest.Mock).mock.results[
        (axios.create as jest.Mock).mock.results.length - 1
      ].value;
      instance.get.mockRejectedValueOnce(
        new ConnectorError('Authentication failed', 'AUTH_FAILED', 'req-1', false),
      );

      const result = await connector.testConnection({
        orgUrl: 'https://contoso.api.crm.dynamics.com',
        accessToken: 'test-token',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('WhoAmI probe failed');
      expect(result.details).toMatchObject({
        probe: { status: 'error', code: 'AUTH_FAILED', requestId: 'req-1' },
      });
    });
  });

  describe('OAuth credential wiring (v1.1.0)', () => {
    const OAUTH_CREDENTIALS = {
      orgUrl: 'https://contoso.api.crm.dynamics.com',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'http://localhost:3000/callback',
      refreshToken: 'refresh-old',
    };

    /**
     * Executes an action whose handler drives the lazily-built client's
     * REQUEST INTERCEPTOR (the mocked axios instance never runs interceptors
     * itself), proving the token provider output reaches the Authorization
     * header. Returns the handler's recorded Authorization value.
     */
    async function runWithCredentials(
      credentials: unknown,
    ): Promise<{ result: ConnectorExecutionResult; authorization: string | undefined }> {
      let authorization: string | undefined;
      const spy = jest.fn(async () => {
        const instance = (axios.create as jest.Mock).mock.results[
          (axios.create as jest.Mock).mock.results.length - 1
        ].value;
        const registrations = instance.interceptors.request.use.mock.calls;
        const interceptor = registrations[registrations.length - 1][0];
        const out = await interceptor({ headers: {} });
        authorization = out.headers.Authorization;
        return { success: true, data: {} };
      });
      connector.registerHandler('dynamics.create_contact', spy);

      const result = await connector.execute({
        actionId: 'dynamics.create_contact',
        input: { firstname: 'Jane' },
        credentials,
        metadata: APPROVAL_METADATA,
      });
      return { result, authorization };
    }

    it('acquires a token via refresh_token and attaches it to the Authorization header', async () => {
      const { result, authorization } = await runWithCredentials(OAUTH_CREDENTIALS);

      expect(result.success).toBe(true);
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect((refreshAccessToken as jest.Mock).mock.calls[0][0]).toMatchObject({
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'http://localhost:3000/callback',
        refreshToken: 'refresh-old',
        scope: 'https://contoso.api.crm.dynamics.com/.default',
      });
      expect(authorization).toBe('Bearer oauth-access');
    });

    it('uses the authorization_code grant when a code is supplied', async () => {
      await runWithCredentials({
        ...OAUTH_CREDENTIALS,
        code: 'auth-code-1',
        refreshToken: undefined,
      });

      expect(acquireTokenResponse).toHaveBeenCalledTimes(1);
      expect((acquireTokenResponse as jest.Mock).mock.calls[0][0].code).toBe('auth-code-1');
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('caches the acquired token across executions on the same connector', async () => {
      await runWithCredentials(OAUTH_CREDENTIALS);
      const second = await runWithCredentials(OAUTH_CREDENTIALS);

      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(second.authorization).toBe('Bearer oauth-access');
    });

    it('does not share cached OAuth tokens across principals', async () => {
      await runWithCredentials(OAUTH_CREDENTIALS);
      await runWithCredentials({ ...OAUTH_CREDENTIALS, clientId: 'client-2' });
      expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it('prefers a caller-supplied accessToken and never calls the token endpoint', async () => {
      const { authorization } = await runWithCredentials({
        ...OAUTH_CREDENTIALS,
        accessToken: 'caller-token',
      });

      expect(acquireTokenResponse).not.toHaveBeenCalled();
      expect(refreshAccessToken).not.toHaveBeenCalled();
      expect(authorization).toBe('Bearer caller-token');
    });

    it('passes tokenUrl through to the auth config when provided', async () => {
      await runWithCredentials({
        ...OAUTH_CREDENTIALS,
        tokenUrl: 'http://127.0.0.1:9999/oauth2/v2.0/token',
      });

      expect((refreshAccessToken as jest.Mock).mock.calls[0][0].tokenUrl).toBe(
        'http://127.0.0.1:9999/oauth2/v2.0/token',
      );
    });

    it('normalizes missing OAuth fields when no token source exists', async () => {
      const result = await connector.execute({
        actionId: 'dynamics.search_contact',
        input: { query: 'John' },
        credentials: { orgUrl: 'https://contoso.api.crm.dynamics.com' },
      });

      expect(result.success).toBe(false);
      expect(result.error as ConnectorError).toMatchObject({ code: 'MISSING_CREDENTIALS' });
    });
  });
});
