/**
 * Unit tests for src/errors/index.ts — normalized error handling (T3.2 S3.2.4).
 *
 * Covers:
 *  - ConnectorError: extends Error, exposes code/requestId/retryable/providerError
 *    with sensible defaults
 *  - normalizeDynamicsError: HTTP status mapping (429/401/403/404/400/5xx),
 *    response-less network failures, timeouts, unknown errors, and
 *    x-ms-request-id extraction (case-insensitive)
 *  - sanitizeMessage: secret redaction (Bearer/client_secret/access_token/
 *    refresh_token) with a generic fallback
 *  - isRetryable: retry classification predicate
 *
 * Pure logic — no mocks, no network. Reuses the OData error fixture from
 * tests/fixtures/responses.ts.
 */
import {
  ConnectorError,
  normalizeDynamicsError,
  isRetryable,
  sanitizeMessage,
} from '../src/errors';
import { mockODataError } from './fixtures/responses';

describe('ConnectorError (S2.8.1)', () => {
  it('extends Error and exposes code/requestId/retryable/providerError', () => {
    const err = new ConnectorError('boom', 'TEST_CODE', 'req-1', true, { detail: 1 });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.name).toBe('ConnectorError');
    expect(err.message).toBe('boom');
    expect(err.code).toBe('TEST_CODE');
    expect(err.requestId).toBe('req-1');
    expect(err.retryable).toBe(true);
    expect(err.providerError).toEqual({ detail: 1 });
  });

  it('defaults retryable to false and leaves requestId/providerError undefined', () => {
    const err = new ConnectorError('boom', 'TEST_CODE');
    expect(err.retryable).toBe(false);
    expect(err.requestId).toBeUndefined();
    expect(err.providerError).toBeUndefined();
  });
});

describe('normalizeDynamicsError (S2.8.2)', () => {
  it('maps 429 to RATE_LIMIT_EXCEEDED, retryable, keeping the provider payload', () => {
    const err = normalizeDynamicsError({ response: { status: 429, data: mockODataError } });

    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.providerError).toEqual(mockODataError);
  });

  it('maps 401 to AUTH_FAILED, not retryable', () => {
    const err = normalizeDynamicsError({ response: { status: 401 } });
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('maps 403 to FORBIDDEN, not retryable', () => {
    const err = normalizeDynamicsError({ response: { status: 403 } });
    expect(err.code).toBe('FORBIDDEN');
    expect(err.retryable).toBe(false);
  });

  it('maps 404 to NOT_FOUND, not retryable', () => {
    const err = normalizeDynamicsError({ response: { status: 404 } });
    expect(err.code).toBe('NOT_FOUND');
    expect(err.retryable).toBe(false);
  });

  it('maps 400 to INVALID_REQUEST, not retryable', () => {
    const err = normalizeDynamicsError({ response: { status: 400 } });
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.retryable).toBe(false);
  });

  it('maps 5xx to PROVIDER_ERROR, retryable', () => {
    for (const status of [500, 502, 503]) {
      const err = normalizeDynamicsError({ response: { status } });
      expect(err.code).toBe('PROVIDER_ERROR');
      expect(err.retryable).toBe(true);
    }
  });

  it('maps an unhandled status to UNKNOWN_ERROR, not retryable', () => {
    const err = normalizeDynamicsError({ response: { status: 418 } });
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('maps a response-less axios failure to NETWORK_ERROR, retryable', () => {
    const err = normalizeDynamicsError({ isAxiosError: true, message: 'Network Error' });
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('maps an ECONNABORTED timeout to NETWORK_ERROR, retryable', () => {
    const err = normalizeDynamicsError({
      code: 'ECONNABORTED',
      message: 'timeout of 30000ms exceeded',
    });
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('maps an unknown thrown value to UNKNOWN_ERROR with a sanitized message', () => {
    const err = normalizeDynamicsError(new Error('something weird'));
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('something weird');
  });

  it('maps a non-object input to UNKNOWN_ERROR with a generic message', () => {
    const err = normalizeDynamicsError('just a string');
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.message).toBe('Unknown error');
  });
});

describe('x-ms-request-id extraction (case-insensitive)', () => {
  it('extracts the request id from lowercase headers', () => {
    const err = normalizeDynamicsError({
      response: { status: 429, headers: { 'x-ms-request-id': 'req-lower' } },
    });
    expect(err.requestId).toBe('req-lower');
  });

  it('extracts the request id from uppercase/mixed-case headers', () => {
    const err = normalizeDynamicsError({
      response: { status: 429, headers: { 'X-MS-REQUEST-ID': 'req-mixed' } },
    });
    expect(err.requestId).toBe('req-mixed');
  });

  it('leaves requestId undefined when no header is present', () => {
    const err = normalizeDynamicsError({ response: { status: 401, headers: {} } });
    expect(err.requestId).toBeUndefined();
  });
});

describe('sanitizeMessage (secret redaction)', () => {
  it('redacts Bearer tokens', () => {
    expect(sanitizeMessage('Authorization: Bearer abc123 token')).toBe(
      'Authorization: Bearer [REDACTED] token',
    );
  });

  it('redacts client_secret, access_token, and refresh_token values', () => {
    expect(sanitizeMessage('client_secret=super-secret&scope=x')).toBe(
      'client_secret=[REDACTED]&scope=x',
    );
    expect(sanitizeMessage('access_token=abc&refresh_token=def')).toBe(
      'access_token=[REDACTED]&refresh_token=[REDACTED]',
    );
  });

  it('falls back to a generic message for non-string input', () => {
    expect(sanitizeMessage(undefined)).toBe('Unknown error');
    expect(sanitizeMessage('')).toBe('Unknown error');
  });
});

describe('isRetryable (S2.8.3)', () => {
  it('returns true for retryable errors', () => {
    const err = normalizeDynamicsError({ response: { status: 429 } });
    expect(isRetryable(err)).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    const err = normalizeDynamicsError({ response: { status: 401 } });
    expect(isRetryable(err)).toBe(false);
  });
});
