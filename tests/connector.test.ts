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
 *  - testConnection(): credential-shape validation with missing-key listing
 *
 * OFFLINE: axios.create is mocked so the lazily-built Web API client never
 * performs I/O; routing is verified with registered spy handlers.
 */
import { Dynamics365Connector } from '../src/connector';
import { Dynamics365Client } from '../src/client';
import { ConnectorError } from '../src/errors';
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

describe('Dynamics365Connector (S3.2.2)', () => {
  let connector: Dynamics365Connector;

  beforeEach(() => {
    connector = new Dynamics365Connector();
  });

  describe('manifest', () => {
    it('exposes name/provider/auth per connector.yaml', () => {
      expect(connector.manifest.name).toBe('dynamics365-connector');
      expect(connector.manifest.version).toBe('1.0.0');
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
      for (const id of REQUIRED_IDS) {
        const spy = jest.fn(async () => ({ success: true, data: { actionId: id } }));
        connector.registerHandler(id, spy);

        const result = await connector.execute({
          actionId: id,
          input: {},
          credentials: VALID_CREDENTIALS,
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
  });

  describe('testConnection (S2.2.2)', () => {
    it('passes when orgUrl + accessToken are present', async () => {
      const result = await connector.testConnection(VALID_CREDENTIALS);
      expect(result.success).toBe(true);
    });

    it('passes when orgUrl + OAuth client fields are present', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://org.api.crm.dynamics.com',
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'http://localhost:3000/callback',
      });
      expect(result.success).toBe(true);
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
  });
});
