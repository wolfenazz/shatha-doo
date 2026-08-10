/**
 * Normalized error handling for the Dynamics 365 connector.
 *
 * Implements the DOO error handling pattern (skill doc §2.5):
 *  - `ConnectorError`: normalized error with `code`, optional `requestId`,
 *    a `retryable` flag and the raw `providerError` payload.
 *  - `normalizeDynamicsError`: maps raw axios/provider failures (HTTP status,
 *    network/timeout, unknown) onto `ConnectorError`, always extracting
 *    `x-ms-request-id` (case-insensitive) when present.
 *  - `isRetryable`: convenience predicate for retry classification.
 *
 * Messages are generic per status code and sanitized for unknown errors so
 * tokens/secrets are never leaked into the surface message. Raw provider
 * payloads (which may contain details) are kept off-message in
 * `providerError` for diagnostics.
 */

/** Raw shape of an axios-like failure passed to `normalizeDynamicsError`. */
interface ErrorLike {
  message?: unknown;
  code?: unknown;
  isAxiosError?: unknown;
  response?: {
    status?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
  };
}

/** Error codes that indicate a network/connectivity failure (no HTTP response). */
const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ERR_NETWORK',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ERR_EMPTY_RESPONSE',
]);

/** Common credential patterns redacted from surfaced error messages. */
const SECRET_PATTERNS: RegExp[] = [
  /(client_secret=)[^&\s]+/gi,
  /(client_secret\s*[:=]\s*)[^\s,;&'"]+/gi,
  /(access_token=)[^&\s]+/gi,
  /(refresh_token=)[^&\s]+/gi,
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,
];

/**
 * Normalized connector error carrying provider-agnostic classification.
 *
 * @param message      Human-readable, secret-safe description.
 * @param code         Machine-readable error code (e.g. 'RATE_LIMIT_EXCEEDED').
 * @param requestId    Dynamics `x-ms-request-id` from the failed request.
 * @param retryable    Whether the caller may retry the request safely.
 * @param providerError Raw provider payload (e.g. OData error body) for diagnostics.
 */
export class ConnectorError extends Error {
  code: string;
  requestId?: string;
  retryable: boolean;
  providerError?: unknown;
  /** Server-requested wait before retrying (ms), from the `Retry-After` header. */
  retryAfterMs?: number;

  constructor(
    message: string,
    code: string,
    requestId?: string,
    retryable = false,
    providerError?: unknown,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
    this.providerError = providerError;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Returns the `retryable` classification of a normalized error. */
export function isRetryable(error: ConnectorError): boolean {
  return error.retryable;
}

/**
 * Redacts credential patterns from a raw message so secrets never surface.
 * Falls back to a generic message when the input is not a usable string.
 */
export function sanitizeMessage(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Unknown error';
  }
  let safe = value;
  for (const pattern of SECRET_PATTERNS) {
    safe = safe.replace(pattern, '$1[REDACTED]');
  }
  return safe;
}

function asErrorLike(error: unknown): ErrorLike | undefined {
  return error !== null && typeof error === 'object' ? (error as ErrorLike) : undefined;
}

function extractStatus(error: ErrorLike | undefined): number | undefined {
  const status = error?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function extractRequestId(error: ErrorLike | undefined): string | undefined {
  const headers = error?.response?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-ms-request-id') {
      const value = headers[key];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** Extracts the `Retry-After` header as milliseconds (seconds when numeric). */
function extractRetryAfterMs(error: ErrorLike | undefined): number | undefined {
  const headers = error?.response?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'retry-after') {
      const value = headers[key];
      if (typeof value !== 'string' || value.length === 0) {
        return undefined;
      }
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
      }
      const httpDate = Date.parse(value);
      if (Number.isFinite(httpDate)) {
        return Math.max(0, httpDate - Date.now());
      }
      return undefined;
    }
  }
  return undefined;
}

function extractProviderData(error: ErrorLike | undefined): unknown {
  return error?.response?.data;
}

function isNetworkError(error: ErrorLike | undefined): boolean {
  if (!error) {
    return false;
  }
  if (typeof error.code === 'string' && NETWORK_ERROR_CODES.has(error.code)) {
    return true;
  }
  if (error.isAxiosError === true && !error.response) {
    return true;
  }
  if (
    typeof error.message === 'string' &&
    /network error|timeout of \d+|socket hang up|connect (?:etimedout|refused)/i.test(error.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Maps any thrown value (axios error, network failure, unknown) onto a
 * normalized `ConnectorError`.
 *
 * | HTTP status / cause        | code                | retryable |
 * |----------------------------|---------------------|-----------|
 * | 429                        | RATE_LIMIT_EXCEEDED | true      |
 * | 401                        | AUTH_FAILED         | false     |
 * | 403                        | FORBIDDEN           | false     |
 * | 404                        | NOT_FOUND           | false     |
 * | 400                        | INVALID_REQUEST     | false     |
 * | 5xx                        | PROVIDER_ERROR      | true      |
 * | network / timeout          | NETWORK_ERROR       | true      |
 * | anything else              | UNKNOWN_ERROR       | false     |
 */
export function normalizeDynamicsError(error: unknown): ConnectorError {
  const err = asErrorLike(error);
  const requestId = extractRequestId(err);
  const status = extractStatus(err);
  const providerError = extractProviderData(err);
  const retryAfterMs = extractRetryAfterMs(err);

  if (typeof status === 'number') {
    if (status === 429) {
      return new ConnectorError(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        requestId,
        true,
        providerError,
        retryAfterMs,
      );
    }
    if (status === 401) {
      return new ConnectorError(
        'Authentication failed',
        'AUTH_FAILED',
        requestId,
        false,
        providerError,
      );
    }
    if (status === 403) {
      return new ConnectorError('Access forbidden', 'FORBIDDEN', requestId, false, providerError);
    }
    if (status === 404) {
      return new ConnectorError('Resource not found', 'NOT_FOUND', requestId, false, providerError);
    }
    if (status === 400) {
      return new ConnectorError(
        'Invalid request',
        'INVALID_REQUEST',
        requestId,
        false,
        providerError,
      );
    }
    if (status >= 500) {
      return new ConnectorError(
        'Provider error',
        'PROVIDER_ERROR',
        requestId,
        true,
        providerError,
        retryAfterMs,
      );
    }
    return new ConnectorError('Unknown error', 'UNKNOWN_ERROR', requestId, false, providerError);
  }

  if (isNetworkError(err)) {
    return new ConnectorError('Network error', 'NETWORK_ERROR', requestId, true, error);
  }

  return new ConnectorError(
    sanitizeMessage(err?.message),
    'UNKNOWN_ERROR',
    requestId,
    false,
    error,
  );
}
