/**
 * Dynamics 365 connector core (T2.2, hardened in v1.1.0).
 *
 * Implements the DOO connector pattern (skill doc §2.2) over the shared
 * contracts in `./types`:
 *  - `listActions()`    -> returns the five registered actions (definition
 *                          merged with the T1.2 JSON Schemas registry).
 *  - `execute()`        -> routes a request to the matching action handler by
 *                          action id; unknown ids yield a normalized
 *                          `UNKNOWN_ACTION` error.
 *  - `testConnection()` -> validates the credential shape, then runs a real
 *                          `WhoAmI()` probe whenever a token source is
 *                          provided (result reported in `details.probe`).
 *
 * OAuth (v1.1.0): the core acquires and refreshes tokens itself via
 * `src/auth` when the caller supplies the client fields
 * (`tenantId`/`clientId`/`clientSecret` + `code` or `refreshToken`), caches
 * them in memory with a skew-safe expiry, and falls back to a caller-supplied
 * `accessToken`. Tokens are never logged or persisted.
 *
 * Action handlers (T2.3-T2.7) register via `registerHandler()` once the
 * client exposes get/post/patch.
 */
import {
  ConnectorAction,
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorManifest,
  ConnectionTestResult,
  DooConnector,
} from './types';
import { Dynamics365Client } from './client';
import { ConnectorError } from './errors';
import { actionSchemas } from './schemas';
import { acquireTokenResponse, refreshAccessToken, DEFAULT_SCOPE } from './auth';
import type { OAuthConfig } from './auth';
import { createHash } from 'node:crypto';
import { jsonSchemaToZod } from './schema-validation';
import { secureEqual, validateOrgUrl, validateTokenUrl } from './security';
import { searchContactAction, searchContactHandler } from './actions/search-contact';
import { createContactAction, executeCreateContact } from './actions/create-contact';
import { updateContactAction, executeUpdateContact } from './actions/update-contact';
import { createLeadAction, executeCreateLead } from './actions/create-lead';
import { createTaskAction, executeCreateTask } from './actions/create-task';

/** Handler signature for a registered connector action. */
export type ActionHandler = (
  client: Dynamics365Client,
  input: unknown,
  credentials?: unknown,
) => Promise<ConnectorExecutionResult>;

export interface Dynamics365ConnectorOptions {
  approvalToken?: string;
  allowLocalhost?: boolean;
}

/** Cached token with a conservative expiry window (skew-safe). */
interface TokenCacheEntry {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const ACTION_DEFINITIONS: ConnectorAction[] = [
  searchContactAction,
  createContactAction,
  updateContactAction,
  createLeadAction,
  createTaskAction,
];

/** Enriches an action definition with its T1.2 input/output schemas. */
function withSchemas(def: ConnectorAction): ConnectorAction {
  const schemas = actionSchemas[def.id];
  return schemas ? { ...def, inputSchema: schemas.input, outputSchema: schemas.output } : def;
}

export class Dynamics365Connector implements DooConnector {
  manifest: ConnectorManifest;
  private actions: Map<string, ConnectorAction>;
  private handlers: Map<string, ActionHandler>;
  private tokenCache = new Map<string, TokenCacheEntry>();
  private readonly approvalToken?: string;
  private readonly allowLocalhost: boolean;

  constructor(options: Dynamics365ConnectorOptions = {}) {
    this.approvalToken = options.approvalToken ?? process.env.D365_WRITE_APPROVAL_TOKEN;
    this.allowLocalhost = options.allowLocalhost ?? process.env.NODE_ENV === 'test';
    this.actions = new Map(ACTION_DEFINITIONS.map((def) => [def.id, withSchemas(def)]));
    this.handlers = new Map();
    // Wire all implemented action handlers (T2.3-T2.7).
    this.handlers.set(searchContactAction.id, searchContactHandler);
    this.handlers.set(createContactAction.id, executeCreateContact);
    this.handlers.set(updateContactAction.id, executeUpdateContact);
    this.handlers.set(createLeadAction.id, executeCreateLead);
    this.handlers.set(createTaskAction.id, executeCreateTask);
    this.manifest = {
      name: 'dynamics365-connector',
      version: '1.1.0',
      description: 'Microsoft Dynamics 365 connector for DOO',
      provider: {
        name: 'Microsoft Dynamics 365',
        version: 'v9.2',
        type: 'Enterprise CRM',
      },
      auth: {
        type: 'oauth2',
        grantTypes: ['authorization_code', 'refresh_token'],
        scopes: [
          'Dynamics CRM.UserBasic',
          'Dynamics CRM.Organization.Read',
          'Dynamics CRM.Organization.Write',
        ],
      },
      actions: [...this.actions.values()],
      capabilities: { pagination: true, rateLimiting: true, retry: true },
      risks: [
        'Write actions modify production data',
        'OAuth tokens expire and need refresh',
        'Rate limits may affect batch operations',
      ],
    };
  }

  /** Registers a handler for an action id (wired by T2.3-T2.7). */
  registerHandler(actionId: string, handler: ActionHandler): void {
    this.handlers.set(actionId, handler);
  }

  /** Reads a credential field as a trimmed string (undefined when absent/empty). */
  private static asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  /** Whether a usable token source exists for these credentials. */
  private static hasTokenSource(cred: Record<string, unknown>): boolean {
    return (
      Dynamics365Connector.asString(cred.accessToken) !== undefined ||
      Dynamics365Connector.asString(cred.refreshToken) !== undefined ||
      Dynamics365Connector.asString(cred.code) !== undefined
    );
  }

  /**
   * Builds a token provider that uses the OAuth 2.0 flow (src/auth) when the
   * caller supplies the client fields, otherwise falls back to a caller
   * supplied `accessToken`. Tokens are cached per instance and refreshed
   * before expiry; the rotated refresh token is kept in the cache.
   */
  private buildTokenProvider(cred: Record<string, unknown>): () => Promise<string> {
    const accessToken = Dynamics365Connector.asString(cred.accessToken);
    if (accessToken !== undefined) {
      return async () => accessToken;
    }

    const orgUrl = Dynamics365Connector.asString(cred.orgUrl);
    const tenantId = Dynamics365Connector.asString(cred.tenantId);
    const clientId = Dynamics365Connector.asString(cred.clientId);
    const clientSecret = Dynamics365Connector.asString(cred.clientSecret);
    const redirectUri = Dynamics365Connector.asString(cred.redirectUri);
    const scope =
      Dynamics365Connector.asString(cred.scope) ??
      (orgUrl !== undefined ? DEFAULT_SCOPE(orgUrl) : undefined);

    if (tenantId === undefined || clientId === undefined || clientSecret === undefined) {
      throw new ConnectorError(
        'Missing OAuth client fields (tenantId, clientId, clientSecret) or an accessToken in credentials',
        'MISSING_CREDENTIALS',
        undefined,
        false,
      );
    }

    const base: OAuthConfig = {
      tenantId,
      clientId,
      clientSecret,
      scope: scope ?? '',
      redirectUri: redirectUri ?? '',
      allowLocalhost: this.allowLocalhost,
      ...(Dynamics365Connector.asString(cred.tokenUrl) !== undefined
        ? { tokenUrl: Dynamics365Connector.asString(cred.tokenUrl) as string }
        : {}),
    };
    const cacheKey = this.credentialCacheKey(cred);

    return async () => {
      const cached = this.tokenCache.get(cacheKey);
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        return cached.accessToken;
      }
      const refreshToken = cached?.refreshToken ?? cred.refreshToken;
      const response =
        typeof refreshToken === 'string' && refreshToken.length > 0
          ? await refreshAccessToken({ ...base, refreshToken })
          : await acquireTokenResponse({
              ...base,
              code: Dynamics365Connector.asString(cred.code),
            });
      if (this.tokenCache.size >= 100 && !this.tokenCache.has(cacheKey)) {
        const oldestKey = this.tokenCache.keys().next().value as string | undefined;
        if (oldestKey) this.tokenCache.delete(oldestKey);
      }
      this.tokenCache.set(cacheKey, {
        accessToken: response.accessToken,
        refreshToken:
          response.refreshToken ?? (typeof refreshToken === 'string' ? refreshToken : undefined),
        expiresAt: Date.now() + Math.max(0, (response.expiresIn ?? 3600) - 60) * 1000,
      });
      return response.accessToken;
    };
  }

  /** Keys OAuth cache entries by organization, tenant, principal, and credential identity. */
  private credentialCacheKey(cred: Record<string, unknown>): string {
    const identity = [
      'orgUrl',
      'tenantId',
      'clientId',
      'clientSecret',
      'scope',
      'tokenUrl',
      'refreshToken',
      'code',
    ].map((key) => [key, Dynamics365Connector.asString(cred[key]) ?? '']);
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  }

  /**
   * Lazily builds the Web API client from the request credentials. The client
   * is only constructed once a registered handler actually needs it; the
   * access token is supplied by the caller (or acquired via OAuth from the
   * client fields in `src/auth`).
   */
  private getClient(credentials?: unknown): Dynamics365Client {
    const cred = (credentials ?? {}) as Record<string, unknown>;
    if (typeof cred.orgUrl !== 'string' || cred.orgUrl.trim().length === 0) {
      throw new ConnectorError(
        'Missing orgUrl in credentials',
        'MISSING_ORG_URL',
        undefined,
        false,
      );
    }
    return new Dynamics365Client({
      orgUrl: validateOrgUrl(cred.orgUrl, this.allowLocalhost),
      getAccessToken: this.buildTokenProvider(cred),
      allowLocalhost: this.allowLocalhost,
    });
  }

  listActions(): ConnectorAction[] {
    return [...this.actions.values()];
  }

  async testConnection(credentials: unknown): Promise<ConnectionTestResult> {
    if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return { success: false, message: 'Invalid credentials: expected an object' };
    }
    const cred = credentials as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof cred.orgUrl !== 'string' || cred.orgUrl.trim().length === 0) {
      missing.push('orgUrl');
    }
    const hasAccessToken = typeof cred.accessToken === 'string' && cred.accessToken.length > 0;
    if (!hasAccessToken) {
      for (const key of ['tenantId', 'clientId', 'clientSecret'] as const) {
        if (typeof cred[key] !== 'string' || (cred[key] as string).trim().length === 0) {
          missing.push(key);
        }
      }
    }
    if (missing.length > 0) {
      return {
        success: false,
        message: `Missing required credential(s): ${missing.join(', ')}`,
        details: { missing },
      };
    }
    if (!Dynamics365Connector.hasTokenSource(cred)) {
      return {
        success: false,
        message:
          'Missing usable token source: provide accessToken, refreshToken, or authorization code',
        details: { missing: ['accessToken|refreshToken|code'], probe: { status: 'not_run' } },
      };
    }
    try {
      validateOrgUrl(cred.orgUrl as string, this.allowLocalhost);
      const tokenUrl = Dynamics365Connector.asString(cred.tokenUrl);
      if (tokenUrl) validateTokenUrl(tokenUrl, this.allowLocalhost);
    } catch (error) {
      const normalized = error as ConnectorError;
      return { success: false, message: normalized.message, details: { code: normalized.code } };
    }
    return this.probeConnection(cred);
  }

  /**
   * Verifies the credentials against the live Web API via the `WhoAmI()`
   * function (side-effect free) whenever a token source is available. The
   * probe result is reported in `details.probe` and never throws — a failed
   * probe is a diagnostic, not a credential-shape failure.
   */
  private async probeConnection(cred: Record<string, unknown>): Promise<ConnectionTestResult> {
    try {
      const who = await this.getClient(cred).whoAmI();
      return {
        success: true,
        message: 'Credential shape is valid; WhoAmI probe succeeded',
        details: {
          probe: { status: 'ok', userId: who.UserId, organizationId: who.OrganizationId },
        },
      };
    } catch (error) {
      const normalized =
        error instanceof ConnectorError ? error : new ConnectorError(String(error), 'PROBE_FAILED');
      return {
        success: false,
        message: `WhoAmI probe failed: ${normalized.message}`,
        details: {
          probe: { status: 'error', code: normalized.code, requestId: normalized.requestId },
        },
      };
    }
  }

  async execute(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult> {
    const action = this.actions.get(request.actionId);
    if (!action) {
      return {
        success: false,
        error: new ConnectorError(
          `Unknown action: ${request.actionId}`,
          'UNKNOWN_ACTION',
          undefined,
          false,
        ),
      };
    }
    const handler = this.handlers.get(request.actionId);
    if (!handler) {
      return {
        success: false,
        error: new ConnectorError(
          `Action ${request.actionId} not implemented yet`,
          'NOT_IMPLEMENTED',
          undefined,
          false,
        ),
      };
    }
    try {
      if (action.type === 'write') {
        const suppliedToken =
          typeof request.metadata?.approvalToken === 'string'
            ? request.metadata.approvalToken
            : undefined;
        if (!secureEqual(suppliedToken, this.approvalToken)) {
          throw new ConnectorError(
            `Approval is required for write action ${request.actionId}`,
            'APPROVAL_REQUIRED',
            undefined,
            false,
          );
        }
      }
      const parsed = jsonSchemaToZod(action.inputSchema).safeParse(request.input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ConnectorError(
          `Invalid input${issue?.path.length ? ` at ${issue.path.join('.')}` : ''}: ${issue?.message ?? 'schema validation failed'}`,
          'VALIDATION_ERROR',
        );
      }
      return await handler(this.getClient(request.credentials), parsed.data, request.credentials);
    } catch (error) {
      // The DooConnector contract: execute() resolves with a normalized result
      // even when the handler throws (e.g. a ConnectorError from the client).
      return { success: false, error };
    }
  }
}
