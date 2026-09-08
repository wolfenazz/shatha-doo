/**
 * HTTP MCP adapter for the Dynamics 365 connector (deployment entry point).
 *
 * Serves the McpServer over the MCP Streamable HTTP transport (the stdio
 * transport is available via `npm run mcp`). Reuses `createMcpServer()` from
 * `./server`, so no tool logic is duplicated here:
 *  - GET  → endpoint discovery / SSE stream (Streamable HTTP)
 *  - POST → JSON-RPC messages (initialize, tools/list, tools/call, ...)
 *  - DELETE → session termination
 *  - OPTIONS → CORS preflight for browser-based MCP clients
 *
 * Each HTTP request gets a fresh stateless server + transport, so any client
 * (or validation run) can initialize independently — a single shared stateful
 * transport would reject a second `initialize` with "Server already
 * initialized" for the lifetime of the container.
 *
 * Run (HTTP): `node dist/mcp/http-server.js` after `npm run build`.
 * Port: `process.env.PORT` (Railway default) or 3000 locally.
 */
import { webcrypto } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { secureEqual } from '../src/security';

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
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 120);
const requestWindows = new Map<string, { startedAt: number; count: number }>();

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function setCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins().has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

export function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.MCP_API_KEY;
  const header = req.headers.authorization;
  const actual =
    typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  return secureEqual(actual, expected);
}

export function withinRateLimit(req: IncomingMessage): boolean {
  const key = req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Mcp-Session-Id, Accept',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (!setCors(req, res)) {
    res.writeHead(403);
    res.end('Origin not allowed');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!isAuthorized(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.writeHead(401);
    res.end('Unauthorized');
    return;
  }
  if (!withinRateLimit(req)) {
    res.setHeader('Retry-After', '60');
    res.writeHead(429);
    res.end('Too many requests');
    return;
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export async function bootstrap(): Promise<void> {
  const httpServer = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal server error');
      }
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

if (require.main === module) {
  bootstrap().catch(() => {
    process.stderr.write('MCP HTTP server failed\n');
    process.exitCode = 1;
  });
}
