/**
 * HTTP MCP adapter for the Dynamics 365 connector (deployment entry point).
 *
 * Serves the same McpServer instance over the MCP Streamable HTTP transport
 * (the stdio transport is available via `npm run mcp`). Reuses
 * `createMcpServer()` from `./server`, so no tool logic is duplicated here:
 *  - GET  → endpoint discovery / SSE stream (Streamable HTTP)
 *  - POST → JSON-RPC messages (initialize, tools/list, tools/call, ...)
 *  - DELETE → session termination
 *  - OPTIONS → CORS preflight for browser-based MCP clients
 *
 * Run (HTTP): `node dist/mcp/http-server.js` after `npm run build`.
 * Port: `process.env.PORT` (Railway default) or 3000 locally.
 */
import { randomUUID, webcrypto } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';

// The SDK references the global `crypto` object (Web Crypto) directly; on some
// Node 18 runtimes that bare reference fails with ReferenceError even though
// `globalThis.crypto` exists. Expose it as a plain data property up front.
try {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
} catch {
  // The runtime already exposes a non-configurable global; leave it as-is.
}

const PORT = Number(process.env.PORT ?? 3000);

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Mcp-Session-Id, Accept',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  await transport.handleRequest(req, res);
}

const server = createMcpServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

async function bootstrap(): Promise<void> {
  await server.connect(transport);
  const httpServer = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  httpServer.listen(PORT, () => {
    process.stderr.write(`MCP HTTP server listening on port ${PORT}\n`);
  });
  const shutdown = (): void => {
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`MCP HTTP server failed: ${String(error)}\n`);
  process.exitCode = 1;
});
