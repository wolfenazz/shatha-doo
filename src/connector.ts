/**
 * Dynamics 365 connector core (T2.2).
 *
 * Implements the DOO connector pattern (skill doc §2.2) over the shared
 * contracts in `./types`:
 *  - `listActions()`    -> returns the five registered actions (definition
 *                          merged with the T1.2 JSON Schemas registry).
 *  - `execute()`        -> routes a request to the matching action handler by
 *                          action id; unknown ids yield a normalized
 *                          `UNKNOWN_ACTION` error.
 *  - `testConnection()` -> validates the credential shape (org URL + either an
 *                          access token or the OAuth client fields) WITHOUT
 *                          side effects; the real WhoAmI probe lands with T2.1.
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
  private client: Dynamics365Client | null = null;
  private actions: Map<string, ConnectorAction>;
  private handlers: Map<string, ActionHandler>;

  constructor() {
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
      version: '1.0.0',
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

  /**
   * Lazily builds the Web API client from the request credentials. The client
   * is only constructed once a registered handler actually needs it; the
   * access token is supplied by the caller (or the auth flow in later tasks).
   */
  private getClient(credentials?: unknown): Dynamics365Client {
    if (this.client) {
      return this.client;
    }
    const cred = (credentials ?? {}) as Record<string, unknown>;
    if (typeof cred.orgUrl !== 'string' || cred.orgUrl.trim().length === 0) {
      throw new ConnectorError(
        'Missing orgUrl in credentials',
        'MISSING_ORG_URL',
        undefined,
        false,
      );
    }
    this.client = new Dynamics365Client({
      orgUrl: cred.orgUrl,
      getAccessToken: async () => {
        const token = typeof cred.accessToken === 'string' ? cred.accessToken : '';
        if (token.length === 0) {
          throw new ConnectorError(
            'No access token available - authenticate first',
            'NO_ACCESS_TOKEN',
            undefined,
            false,
          );
        }
        return token;
      },
    });
    return this.client;
  }

  listActions(): ConnectorAction[] {
    return [...this.actions.values()];
  }

  async testConnection(credentials: unknown): Promise<ConnectionTestResult> {
    // TODO(T2.1+): probe the Web API (WhoAmI) via the client for full verification.
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
    return { success: true, message: 'Credential shape is valid' };
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
      return await handler(this.getClient(request.credentials), request.input, request.credentials);
    } catch (error) {
      // The DooConnector contract: execute() resolves with a normalized result
      // even when the handler throws (e.g. a ConnectorError from the client).
      return { success: false, error };
    }
  }
}
