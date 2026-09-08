import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAuthorized, setCors, withinRateLimit } from '../mcp/http-server';

describe('HTTP MCP security boundary', () => {
  afterEach(() => {
    delete process.env.MCP_API_KEY;
    delete process.env.MCP_ALLOWED_ORIGINS;
  });

  it('fails closed when the API key is absent and validates Bearer credentials', () => {
    const request = (authorization?: string): IncomingMessage =>
      ({ headers: authorization ? { authorization } : {} }) as IncomingMessage;
    expect(isAuthorized(request('Bearer anything'))).toBe(false);
    process.env.MCP_API_KEY = 'server-key';
    expect(isAuthorized(request())).toBe(false);
    expect(isAuthorized(request('Basic server-key'))).toBe(false);
    expect(isAuthorized(request('Bearer wrong'))).toBe(false);
    expect(isAuthorized(request('Bearer server-key'))).toBe(true);
  });

  it('emits CORS only for explicitly configured origins', () => {
    process.env.MCP_ALLOWED_ORIGINS = 'https://trusted.example, https://other.example';
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    } as unknown as ServerResponse;
    expect(
      setCors({ headers: { origin: 'https://evil.example' } } as IncomingMessage, response),
    ).toBe(false);
    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(
      setCors({ headers: { origin: 'https://trusted.example' } } as IncomingMessage, response),
    ).toBe(true);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://trusted.example');
  });

  it('rate-limits repeated requests from one remote address', () => {
    const request = { socket: { remoteAddress: 'test-rate-client' } } as IncomingMessage;
    for (let index = 0; index < 120; index += 1) expect(withinRateLimit(request)).toBe(true);
    expect(withinRateLimit(request)).toBe(false);
  });
});
