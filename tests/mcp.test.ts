/**
 * PERMANENT unit tests for mcp/server.ts — the thin MCP adapter (T3.1 / T3.5.2).
 *
 * The connector core is REPLACED by a fake DooConnector (dependency injection
 * through createMcpServer) whose execute() is a jest.fn — NO network/axios
 * calls occur. The MCP client<->server handshake runs over the SDK's
 * in-memory transport, so tools/list and tools/call are exercised through the
 * REAL protocol without any I/O.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectorError } from '../src/errors';
import type {
  ConnectorAction,
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  DooConnector,
} from '../src/types';
import {
  createMcpServer,
  jsonSchemaToZodShape,
  server as sharedServer,
  start as startShared,
} from '../mcp/server';

/** The exact connector action ids (mirrors connector.yaml). */
const ACTION_IDS = [
  'dynamics.search_contact',
  'dynamics.create_contact',
  'dynamics.update_contact',
  'dynamics.create_lead',
  'dynamics.create_task',
] as const;

/** Shared JSON Schema input for every fake action (query + top survive Zod translation). */
const INPUT_SCHEMA: unknown = {
  type: 'object',
  properties: { query: { type: 'string' }, top: { type: 'integer' } },
  required: ['query'],
};

function fakeActions(): ConnectorAction[] {
  return ACTION_IDS.map((id, index) => ({
    id,
    name: id,
    description: `Dynamics 365 ${id}`,
    type: index === 0 ? 'read' : 'write',
    approval: index === 0 ? undefined : 'required',
    inputSchema: INPUT_SCHEMA,
    examples: [{ query: 'John', top: 10 }],
  }));
}

/** Fake connector: same shape as Dynamics365Connector but execute is a mock. */
function fakeConnector(execute: DooConnector['execute']): DooConnector {
  return {
    manifest: {
      name: 'dynamics365-connector',
      version: '1.0.0',
      provider: { name: 'Microsoft Dynamics 365', version: 'v9.2', type: 'Enterprise CRM' },
      auth: { type: 'oauth2', grantTypes: ['authorization_code', 'refresh_token'], scopes: [] },
      actions: fakeActions(),
    },
    testConnection: async () => ({ success: true, message: 'fake connector (permanent suite)' }),
    listActions: fakeActions,
    execute,
  };
}

/** The tool-call result shape returned by the SDK Client (content or task variants). */
type CallToolResponse = Awaited<ReturnType<Client['callTool']>>;

/** Extracts the first text content from a tool call result. */
function textOf(result: CallToolResponse): string {
  if (!('content' in result) || !Array.isArray(result.content)) {
    return '';
  }
  for (const item of result.content) {
    if (item.type === 'text') {
      return item.text;
    }
  }
  return '';
}

describe('mcp/server.ts — thin MCP adapter (T3.1)', () => {
  let connector: DooConnector;
  let server: McpServer;
  let client: Client;
  let execute: jest.Mock<Promise<ConnectorExecutionResult>, [ConnectorExecutionRequest]>;

  beforeEach(async () => {
    execute = jest.fn<Promise<ConnectorExecutionResult>, [ConnectorExecutionRequest]>();
    connector = fakeConnector(execute);
    server = createMcpServer(connector);
    client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Connect BOTH ends concurrently — sequential connect deadlocks the
    // initialize handshake (client awaits a response the server can only
    // produce once it is connected).
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('S3.1.2: tools/list returns exactly the 5 connector action ids', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    expect(
      tools
        .map((tool) => tool.name)
        .sort()
        .join(','),
    ).toBe([...ACTION_IDS].sort().join(','));
  });

  it('S3.1.3: tools/call routes to connector.execute with the exact actionId + input', async () => {
    execute.mockResolvedValue({
      success: true,
      data: { contacts: [{ fullname: 'John Doe', emailaddress1: 'john@example.com' }], count: 1 },
    });

    const result = await client.callTool({
      name: 'dynamics.search_contact',
      arguments: { query: 'John', top: 5 },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({
      actionId: 'dynamics.search_contact',
      input: { query: 'John', top: 5 },
      credentials: undefined,
    });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('John Doe');
  });

  it('S3.1.4: failed execution surfaces the ConnectorError code + message as isError', async () => {
    execute.mockResolvedValue({
      success: false,
      error: new ConnectorError(
        'No access token available - authenticate first',
        'NO_ACCESS_TOKEN',
      ),
    });

    const result = await client.callTool({
      name: 'dynamics.search_contact',
      arguments: { query: 'John' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[NO_ACCESS_TOKEN]');
    expect(textOf(result)).toContain('No access token available');
  });

  it('S3.1.4: tools/call for an unknown tool returns an error result', async () => {
    const result = await client.callTool({ name: 'dynamics.nope', arguments: {} });
    // The SDK RESOLVES (does not reject) unknown tools with an isError result.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
  });

  it('S3.1.1: exports the shared server instance and a start() entrypoint', () => {
    expect(sharedServer).toBeDefined();
    expect(typeof startShared).toBe('function');
  });

  it('S3.1.1: createMcpServer is named/versioned from the connector manifest', async () => {
    // The SDK client receives the server implementation info during the
    // initialize handshake — asserted through the REAL protocol.
    const info = client.getServerVersion();
    expect(info).toBeDefined();
    expect(info?.name).toBe('dynamics365-connector');
    expect(info?.version).toBe('1.0.0');
  });

  it('S3.1.1: jsonSchemaToZodShape maps required vs optional JSON Schema properties', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: { query: { type: 'string' }, top: { type: 'integer' } },
      required: ['query'],
    });
    // Required property rejects undefined; optional property accepts it.
    expect(shape.query.safeParse(undefined).success).toBe(false);
    expect(shape.top.safeParse(undefined).success).toBe(true);
    // Non-schema input degrades to an empty shape.
    expect(jsonSchemaToZodShape(null)).toEqual({});
    expect(jsonSchemaToZodShape({ type: 'string' })).toEqual({});
  });
});
