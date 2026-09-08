/**
 * INTEGRATION tests (v1.1.0) — the REAL connector stack against the bundled
 * Dynamics 365 mock sandbox over real HTTP sockets.
 *
 * Unlike the unit suites (axios mocked), these tests exercise the genuine
 * production path end-to-end:
 *   OAuth (authorization_code + refresh_token) -> Dynamics365Client ->
 *   connector.execute -> actions -> MCP tools
 *
 * The sandbox (tests/sandbox/dynamics-sandbox.ts) simulates the Dataverse
 * Web API v9.2 + the Microsoft identity v2.0 token endpoint, so no Microsoft
 * 365 tenant or Azure AD environment is required to prove the whole stack.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startSandbox, type SandboxServer } from './sandbox/dynamics-sandbox';
import { Dynamics365Connector } from '../src/connector';
import { Dynamics365Client } from '../src/client';
import { createMcpServer } from '../mcp/server';

describe('integration — real connector vs mock sandbox (v1.1.0)', () => {
  let sandbox: SandboxServer;
  const approvalToken = 'integration-approval-token';
  const approval = { approvalToken };

  beforeAll(async () => {
    sandbox = await startSandbox();
  });

  afterAll(async () => {
    await sandbox.close();
  });

  const oauthCredentials = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    orgUrl: sandbox.url,
    tokenUrl: `${sandbox.url}/oauth2/v2.0/token`,
    tenantId: 'sandbox-tenant',
    clientId: 'sandbox-client',
    clientSecret: 'sandbox-secret',
    redirectUri: 'http://localhost:3000/callback',
    ...overrides,
  });

  it('authenticates via the OAuth authorization_code grant and creates a contact', async () => {
    const connector = new Dynamics365Connector({ approvalToken });
    const result = await connector.execute({
      actionId: 'dynamics.create_contact',
      input: { firstname: 'OAuth', lastname: 'Flow', emailaddress1: 'oauth.flow@example.com' },
      credentials: oauthCredentials({ code: 'sandbox-code' }),
      metadata: approval,
    });

    expect(result.success).toBe(true);
    const created = result.data as { contactid?: string };
    expect(created.contactid).toBeDefined();
    expect(typeof created.contactid).toBe('string');
  });

  it('refreshes tokens via the refresh_token grant', async () => {
    const connector = new Dynamics365Connector({ approvalToken });
    const result = await connector.execute({
      actionId: 'dynamics.create_lead',
      input: { companyname: 'Refresh Co', firstname: 'Refresh' },
      credentials: oauthCredentials({ refreshToken: 'sandbox-refresh-old' }),
      metadata: approval,
    });

    expect(result.success).toBe(true);
    expect((result.data as { leadid?: string }).leadid).toBeDefined();
  });

  it('testConnection probes WhoAmI() and reports the user identity', async () => {
    const connector = new Dynamics365Connector({ approvalToken });
    const result = await connector.testConnection({
      orgUrl: sandbox.url,
      accessToken: 'sandbox-direct-token',
    });

    expect(result.success).toBe(true);
    expect(result.details).toMatchObject({
      probe: {
        status: 'ok',
        userId: '00000000-0000-0000-0000-000000000002',
        organizationId: '00000000-0000-0000-0000-000000000003',
      },
    });
  });

  it('runs all five actions end-to-end', async () => {
    const connector = new Dynamics365Connector({ approvalToken });

    const created = await connector.execute({
      actionId: 'dynamics.create_contact',
      input: {
        firstname: 'E2E',
        lastname: 'Contact',
        emailaddress1: 'e2e.contact@example.com',
        telephone1: '+1-555-0100',
      },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
      metadata: approval,
    });
    expect(created.success).toBe(true);
    const contactid = (created.data as { contactid: string }).contactid;

    const search = await connector.execute({
      actionId: 'dynamics.search_contact',
      input: { query: 'E2E', top: 5 },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
      metadata: approval,
    });
    expect(search.success).toBe(true);
    const searchData = search.data as { contacts: Array<{ contactid: string }>; count: number };
    expect(searchData.count).toBeGreaterThan(0);
    expect(searchData.contacts.map((c) => c.contactid)).toContain(contactid);

    const updated = await connector.execute({
      actionId: 'dynamics.update_contact',
      input: { contactid, telephone1: '+1-555-0999' },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
      metadata: approval,
    });
    expect(updated.success).toBe(true);

    const lead = await connector.execute({
      actionId: 'dynamics.create_lead',
      input: { companyname: 'E2E Corp', firstname: 'Lead', subject: 'Integration lead' },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
      metadata: approval,
    });
    expect(lead.success).toBe(true);
    expect((lead.data as { leadid?: string }).leadid).toBeDefined();

    const task = await connector.execute({
      actionId: 'dynamics.create_task',
      input: { subject: 'Follow up on E2E contact', regardingobjectid: contactid },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
      metadata: approval,
    });
    expect(task.success).toBe(true);
    expect((task.data as { activityid?: string }).activityid).toBeDefined();

    const verify = await connector.execute({
      actionId: 'dynamics.search_contact',
      input: { query: 'E2E', select: ['contactid', 'telephone1'], top: 10 },
      credentials: oauthCredentials({ accessToken: 'sandbox-e2e-token' }),
    });
    const verifyData = verify.data as {
      contacts: Array<{ contactid: string; telephone1: string }>;
    };
    expect(verifyData.contacts.find((c) => c.contactid === contactid)?.telephone1).toBe(
      '+1-555-0999',
    );
  });

  it('returns pagination metadata with an @odata.nextLink', async () => {
    const connector = new Dynamics365Connector({ approvalToken });
    for (let i = 0; i < 5; i += 1) {
      const result = await connector.execute({
        actionId: 'dynamics.create_contact',
        input: { firstname: `Bulk${i}`, lastname: 'Page' },
        credentials: oauthCredentials({ accessToken: 'sandbox-bulk-token' }),
        metadata: approval,
      });
      expect(result.success).toBe(true);
    }

    const search = await connector.execute({
      actionId: 'dynamics.search_contact',
      input: { query: 'Bulk', top: 2 },
      credentials: oauthCredentials({ accessToken: 'sandbox-bulk-token' }),
    });

    expect(search.success).toBe(true);
    const data = search.data as {
      contacts: unknown[];
      count: number;
      nextLink?: string;
    };
    expect(data.count).toBe(2);
    expect(typeof data.nextLink).toBe('string');
    expect(
      (search.metadata as { pagination: { hasNextPage: boolean } }).pagination.hasNextPage,
    ).toBe(true);

    const nextPage = await connector.execute({
      actionId: 'dynamics.search_contact',
      input: { nextLink: data.nextLink },
      credentials: oauthCredentials({ accessToken: 'sandbox-bulk-token' }),
    });
    if (!nextPage.success) throw nextPage.error;
    expect(nextPage).toMatchObject({ success: true });
    expect((nextPage.data as { contacts: unknown[] }).contacts.length).toBeGreaterThan(0);
  });

  it('retries 429 responses (honoring Retry-After) and succeeds', async () => {
    const client = new Dynamics365Client({
      orgUrl: sandbox.url,
      getAccessToken: () => 'sandbox-retry-token',
      maxRetries: 3,
      retryBaseDelayMs: 1,
    });

    const result = await client.get<{ value: unknown[] }>('contacts', {
      $top: 10,
      __fail_status: 429,
      __fail_attempts: 2,
      __fail_retry_after: 1,
    });

    expect(result.value).toBeDefined();
  });

  it('gives up after maxRetries and surfaces the normalized RATE_LIMIT_EXCEEDED', async () => {
    const client = new Dynamics365Client({
      orgUrl: sandbox.url,
      getAccessToken: () => 'sandbox-retry-token',
      maxRetries: 1,
      retryBaseDelayMs: 1,
    });

    await expect(
      client.get('contacts', { __fail_status: 429, __fail_attempts: 5 }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', retryable: true });
  });

  it('normalizes 401 for an invalid token and 404 for a missing record', async () => {
    const badTokenClient = new Dynamics365Client({
      orgUrl: sandbox.url,
      getAccessToken: () => 'invalid-token',
    });
    await expect(badTokenClient.whoAmI()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      retryable: false,
    });

    const client = new Dynamics365Client({
      orgUrl: sandbox.url,
      getAccessToken: () => 'sandbox-token',
    });
    await expect(
      client.patch('contacts(00000000-0000-0000-0000-000000000999)', { firstname: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('exposes the five tools over the real MCP protocol and executes create_contact', async () => {
    process.env.D365_ORG_URL = sandbox.url;
    process.env.D365_ACCESS_TOKEN = 'sandbox-mcp-token';
    process.env.D365_WRITE_APPROVAL_TOKEN = approvalToken;
    try {
      const server = createMcpServer();
      const client = new Client({ name: 'integration-client', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'dynamics.search_contact',
          'dynamics.create_contact',
          'dynamics.update_contact',
          'dynamics.create_lead',
          'dynamics.create_task',
        ]),
      );

      const call = await client.callTool({
        name: 'dynamics.create_contact',
        arguments: {
          firstname: 'Mcp',
          lastname: 'User',
          emailaddress1: 'mcp.user@example.com',
          _approvalToken: approvalToken,
        },
      });
      expect(call.isError).not.toBe(true);
      const text =
        'content' in call && Array.isArray(call.content)
          ? call.content
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('')
          : '';
      expect(text).toContain('contactid');

      await client.close();
      await server.close();
    } finally {
      delete process.env.D365_ORG_URL;
      delete process.env.D365_ACCESS_TOKEN;
      delete process.env.D365_WRITE_APPROVAL_TOKEN;
    }
  });
});
