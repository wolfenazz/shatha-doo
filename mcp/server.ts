/**
 * Thin MCP adapter for the Dynamics 365 connector (T3.1).
 *
 * Maps the five connector actions to MCP tools WITHOUT duplicating provider
 * calls or business logic (requirements.md Step 4 — MCP is an adapter layer
 * only):
 *  - `registerAllTools` iterates `connector.listActions()` and registers each
 *    action as a tool (name = action id — dotted ids are valid per MCP
 *    SEP-986 — description + JSON-Schema-derived input shape).
 *  - Tool execution forwards straight to `connector.execute()` (the shared
 *    core); results are serialized as text content, failures as `isError`
 *    with the normalized `ConnectorError` code/message.
 *
 * Schema mapping: the connector's JSON Schema (2020-12) `properties` are
 * converted to a Zod input shape for the MCP SDK — a pure type translation
 * (no validation logic duplicated here; the connector core validates).
 *
 * Exports:
 *  - `server`            — shared server instance bound to the connector core
 *  - `start()`           — connects the stdio transport (npm run mcp)
 *  - `createMcpServer()` — testable factory with dependency injection
 *  - `registerAllTools` / `jsonSchemaToZodShape` — registration helpers
 *
 * Run (stdio): `node dist/mcp/server.js` after `npm run build`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Dynamics365Connector } from '../src/connector';
import { ConnectorError } from '../src/errors';
import { jsonSchemaToZod } from '../src/schema-validation';
import type { DooConnector } from '../src/types';

/**
 * Maps `D365_*` environment variables onto connector credentials. Returns
 * `undefined` when no `D365_ORG_URL` is configured so tool calls keep the
 * normalized `MISSING_ORG_URL` error instead of silently misbehaving.
 */
export function credentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const orgUrl = env.D365_ORG_URL;
  if (typeof orgUrl !== 'string' || orgUrl.trim().length === 0) {
    return undefined;
  }
  const fieldMap: Record<string, string | undefined> = {
    accessToken: env.D365_ACCESS_TOKEN,
    tenantId: env.D365_TENANT_ID,
    clientId: env.D365_CLIENT_ID,
    clientSecret: env.D365_CLIENT_SECRET,
    redirectUri: env.D365_REDIRECT_URI,
    tokenUrl: env.D365_TOKEN_URL,
    code: env.D365_AUTH_CODE,
    refreshToken: env.D365_REFRESH_TOKEN,
    scope: env.D365_SCOPE,
  };
  const credentials: Record<string, string> = { orgUrl: orgUrl.trim() };
  for (const [key, value] of Object.entries(fieldMap)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      credentials[key] = value.trim();
    }
  }
  return credentials;
}

/**
 * Converts a JSON Schema (2020-12) object's `properties` into a Zod raw shape
 * accepted by `McpServer.registerTool`. Non-`required` fields become optional.
 * Returns `{}` when no usable properties exist.
 */
export function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  if (schema === null || typeof schema !== 'object') {
    return {};
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== 'object') {
    return {};
  }
  const required = new Set<string>(
    ((schema as { required?: unknown }).required as string[] | undefined) ?? [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const converted = jsonSchemaToZod(prop, schema);
    shape[key] = required.has(key) ? converted : converted.optional();
  }
  return shape;
}

function mcpInputSchema(action: ReturnType<DooConnector['listActions']>[number]): z.ZodTypeAny {
  if (action.type !== 'write') return jsonSchemaToZod(action.inputSchema);
  const schema = action.inputSchema as Record<string, unknown>;
  return jsonSchemaToZod({
    ...schema,
    properties: {
      ...((schema.properties as Record<string, unknown> | undefined) ?? {}),
      _approvalToken: {
        type: 'string',
        minLength: 1,
        description: 'One-time approval token issued by the trusted connector host.',
      },
    },
    required: [...((schema.required as string[] | undefined) ?? []), '_approvalToken'],
  });
}

/** Formats a failure as `[code] message` so the ConnectorError is visible to MCP clients. */
function formatError(error: unknown): string {
  if (error instanceof ConnectorError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Registers every connector action as an MCP tool on `server`. */
export function registerAllTools(server: McpServer, connector: DooConnector): void {
  for (const action of connector.listActions()) {
    const inputSchema = mcpInputSchema(action);
    const outputSchema =
      action.outputSchema === undefined ? undefined : jsonSchemaToZod(action.outputSchema);
    server.registerTool(
      action.id,
      {
        description: action.description,
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        annotations: {
          readOnlyHint: action.type === 'read',
          destructiveHint: action.type === 'write',
          idempotentHint: action.id === 'dynamics.update_contact',
        },
      },
      async (args) => {
        try {
          const rawArgs = (args ?? {}) as Record<string, unknown>;
          const { _approvalToken, ...input } = rawArgs;
          const result = await connector.execute({
            actionId: action.id,
            input,
            credentials: credentialsFromEnv(),
            ...(action.type === 'write' ? { metadata: { approvalToken: _approvalToken } } : {}),
          });
          if (result.success) {
            const structuredContent =
              result.data !== null && typeof result.data === 'object' && !Array.isArray(result.data)
                ? (result.data as Record<string, unknown>)
                : undefined;
            return {
              content: [{ type: 'text', text: JSON.stringify(result.data ?? null) }],
              ...(structuredContent ? { structuredContent } : {}),
            };
          }
          return { content: [{ type: 'text', text: formatError(result.error) }], isError: true };
        } catch (error) {
          return { content: [{ type: 'text', text: formatError(error) }], isError: true };
        }
      },
    );
  }
}

/** Builds the MCP server with all connector tools registered. */
export function createMcpServer(connector: DooConnector = new Dynamics365Connector()): McpServer {
  const server = new McpServer({
    name: connector.manifest.name,
    version: connector.manifest.version,
  });
  registerAllTools(server, connector);
  return server;
}

/** The shared server instance over the default connector core. */
export const server: McpServer = createMcpServer();

/** Connects the shared server over the standard stdio transport. */
export async function start(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start only when run directly (node dist/mcp/server.js).
if (require.main === module) {
  start().catch((error: unknown) => {
    process.stderr.write(`MCP server failed: ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
