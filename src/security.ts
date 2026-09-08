/** Security validation shared by the connector and OAuth client. */
import { timingSafeEqual } from 'node:crypto';
import { ConnectorError } from './errors';

const DYNAMICS_HOST_SUFFIXES = ['.dynamics.com', '.microsoftdynamics.us', '.dynamics.cn'];

const MICROSOFT_LOGIN_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoftonline.us',
  'login.partner.microsoftonline.cn',
]);

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseEndpoint(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConnectorError(`${label} must be a valid absolute URL`, 'INVALID_ENDPOINT');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new ConnectorError(
      `${label} must not contain credentials or a fragment`,
      'INVALID_ENDPOINT',
    );
  }
  return parsed;
}

/**
 * Restricts provider traffic to HTTPS Dynamics hosts. Loopback HTTP is only
 * accepted when explicitly enabled by a test harness.
 */
export function validateOrgUrl(value: string, allowLocalhost = false): string {
  const parsed = parseEndpoint(value.trim(), 'orgUrl');
  const hostname = parsed.hostname.toLowerCase();
  const localAllowed = allowLocalhost && isLoopback(hostname);
  const dynamicsHost = DYNAMICS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if ((!localAllowed && parsed.protocol !== 'https:') || (!localAllowed && !dynamicsHost)) {
    throw new ConnectorError(
      'orgUrl must use HTTPS and target a Microsoft Dynamics 365 host',
      'INVALID_ORG_URL',
    );
  }
  if (parsed.search || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new ConnectorError(
      'orgUrl must be the organization origin without a path or query',
      'INVALID_ORG_URL',
    );
  }
  return parsed.origin;
}

/** Restricts OAuth traffic to Microsoft identity hosts (or an explicit test loopback). */
export function validateTokenUrl(value: string, allowLocalhost = false): string {
  const parsed = parseEndpoint(value.trim(), 'tokenUrl');
  const hostname = parsed.hostname.toLowerCase();
  const localAllowed = allowLocalhost && isLoopback(hostname);
  if (
    (!localAllowed && parsed.protocol !== 'https:') ||
    (!localAllowed && !MICROSOFT_LOGIN_HOSTS.has(hostname))
  ) {
    throw new ConnectorError(
      'tokenUrl must use HTTPS and target a Microsoft identity platform host',
      'INVALID_TOKEN_URL',
    );
  }
  return parsed.toString();
}

/** Constant-time comparison for API keys and approval tokens. */
export function secureEqual(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
