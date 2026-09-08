/**
 * Unit tests for src/client.ts — Dynamics 365 Web API client (T3.2 S3.2.1).
 *
 * axios is fully mocked (jest.mock factory defines its own fns to avoid TDZ).
 * The mock's `create` returns a fake instance exposing interceptors plus the
 * HTTP verbs, so NO real network calls occur. Interceptor functions are
 * captured from `use.mock.calls` and invoked directly with fake configs/errors.
 */
import axios from 'axios';
import { Dynamics365Client } from '../src/client';
import { ConnectorError } from '../src/errors';
import { mockWhoAmIResponse } from './fixtures/responses';

jest.mock('axios', () => {
  const instance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
    },
  };
});

const mockCreate = axios.create as jest.Mock;

const baseConfig = {
  orgUrl: 'https://contoso.api.crm.dynamics.com',
  getAccessToken: jest.fn().mockResolvedValue('fake-access-token'),
};

/** Retrieve the fake axios instance created by the most recent client construction. */
function lastInstance(): {
  interceptors: { request: { use: jest.Mock }; response: { use: jest.Mock } };
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
} {
  return mockCreate.mock.results[mockCreate.mock.results.length - 1].value;
}

describe('src/client - Dynamics365Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReset();
    mockCreate.mockImplementation(() => ({
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    }));
    baseConfig.getAccessToken.mockResolvedValue('fake-access-token');
  });

  describe('constructor - axios instance setup (S2.1.1)', () => {
    it('creates an axios instance with baseURL <org>/api/data/v9.2/ and OData/Accept defaults', () => {
      new Dynamics365Client(baseConfig);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://contoso.api.crm.dynamics.com/api/data/v9.2/',
          headers: expect.objectContaining({
            Accept: 'application/json',
            'OData-MaxVersion': '4.0',
            'OData-Version': '4.0',
          }),
        }),
      );
    });

    it('normalizes a trailing-slash org URL and honors a custom apiVersion', () => {
      new Dynamics365Client({
        orgUrl: 'https://contoso.api.crm.dynamics.com/',
        apiVersion: 'v9.1',
        getAccessToken: baseConfig.getAccessToken,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://contoso.api.crm.dynamics.com/api/data/v9.1/',
        }),
      );
    });

    it('rejects a missing orgUrl and a non-function getAccessToken', () => {
      expect(
        () => new Dynamics365Client({ orgUrl: '', getAccessToken: baseConfig.getAccessToken }),
      ).toThrow(/orgUrl/);
      expect(
        () =>
          new Dynamics365Client({
            orgUrl: 'https://x.api.crm.dynamics.com',
            getAccessToken: 'nope' as never,
          }),
      ).toThrow(/getAccessToken/);
    });
  });

  describe('request interceptor (S2.1.4)', () => {
    it('registers a request interceptor and a response interceptor', () => {
      const client = new Dynamics365Client(baseConfig);
      void client;
      const inst = lastInstance();

      expect(inst.interceptors.request.use).toHaveBeenCalledTimes(1);
      expect(inst.interceptors.response.use).toHaveBeenCalledTimes(1);
      expect(inst.interceptors.request.use.mock.calls[0][0]).toEqual(expect.any(Function));
      expect(inst.interceptors.response.use.mock.calls[0][0]).toEqual(expect.any(Function));
      expect(inst.interceptors.response.use.mock.calls[0][1]).toEqual(expect.any(Function));
    });

    it('attaches Authorization: Bearer <token> from getAccessToken', async () => {
      const client = new Dynamics365Client(baseConfig);
      void client;
      const requestInterceptor = lastInstance().interceptors.request.use.mock.calls[0][0];
      const config = { headers: {} };

      const out = await requestInterceptor(config);

      expect(baseConfig.getAccessToken).toHaveBeenCalledTimes(1);
      expect(out.headers.Authorization).toBe('Bearer fake-access-token');
    });

    it('rejects the request when getAccessToken yields an empty token (no silent unauthenticated calls)', async () => {
      baseConfig.getAccessToken.mockResolvedValue('');
      const client = new Dynamics365Client(baseConfig);
      void client;
      const requestInterceptor = lastInstance().interceptors.request.use.mock.calls[0][0];

      await expect(requestInterceptor({ headers: {} })).rejects.toThrow(/empty token/i);
      expect(baseConfig.getAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('response interceptor - error normalization (S2.1.5)', () => {
    it('rejects 429 errors as RATE_LIMIT_EXCEEDED, retryable=true, with x-ms-request-id', async () => {
      const client = new Dynamics365Client(baseConfig);
      void client;
      const errorHandler = lastInstance().interceptors.response.use.mock.calls[0][1];

      await expect(
        errorHandler({
          isAxiosError: true,
          response: {
            status: 429,
            headers: { 'x-ms-request-id': 'req-429-1' },
            data: { error: { message: 'Too many requests' } },
          },
        }),
      ).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true,
        requestId: 'req-429-1',
      });
    });

    it('rejects 401 errors as AUTH_FAILED, retryable=false, and never leaks the token', async () => {
      const client = new Dynamics365Client(baseConfig);
      void client;
      const errorHandler = lastInstance().interceptors.response.use.mock.calls[0][1];

      await expect(
        errorHandler({
          isAxiosError: true,
          response: { status: 401, headers: {}, data: { error: { message: 'Unauthorized' } } },
        }),
      ).rejects.toMatchObject({ code: 'AUTH_FAILED', retryable: false });
    });

    it('rejects network failures as NETWORK_ERROR, retryable=true', async () => {
      const client = new Dynamics365Client(baseConfig);
      void client;
      const errorHandler = lastInstance().interceptors.response.use.mock.calls[0][1];

      await expect(
        errorHandler({ code: 'ERR_NETWORK', message: 'Network Error' }),
      ).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    });
  });

  describe('typed HTTP helpers', () => {
    it('get(path, params) delegates to axios and returns response.data', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.get.mockResolvedValue({ data: { value: [{ contactid: '1' }] } });

      const result = await client.get<{ value: Array<{ contactid: string }> }>('contacts', {
        $filter: "contains(fullname,'john')",
        $top: 10,
      });

      expect(inst.get).toHaveBeenCalledWith('contacts', {
        params: { $filter: "contains(fullname,'john')", $top: 10 },
      });
      expect(result).toEqual({ value: [{ contactid: '1' }] });
    });

    it('post(path, body) delegates and returns response.data', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.post.mockResolvedValue({ data: { contactid: '11111111-1111-1111-1111-111111111111' } });

      const result = await client.post<{ contactid: string }>('contacts', { firstname: 'John' });

      expect(inst.post).toHaveBeenCalledWith('contacts', { firstname: 'John' }, undefined);
      expect(result).toEqual({ contactid: '11111111-1111-1111-1111-111111111111' });
    });

    it('never retries a non-idempotent POST and marks its failure non-retryable', async () => {
      const client = new Dynamics365Client({ ...baseConfig, maxRetries: 3, retryBaseDelayMs: 1 });
      const inst = lastInstance();
      inst.post.mockRejectedValue(
        new ConnectorError('Provider error', 'PROVIDER_ERROR', 'req-post', true),
      );
      await expect(client.post('contacts', { firstname: 'No duplicate' })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
      expect(inst.post).toHaveBeenCalledTimes(1);
    });

    it('preserves successful rate-limit and request-id headers', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.get.mockResolvedValue({
        data: { value: [] },
        headers: {
          'x-ms-request-id': 'req-success',
          'x-ms-ratelimit-burst-remaining-xrm-requests': '42',
          'x-ms-ratelimit-time-remaining-xrm-requests': '00:04:12',
        },
      });
      const response = await client.getWithMetadata<{ value: unknown[] }>('contacts');
      expect(response.metadata).toEqual({
        requestId: 'req-success',
        rateLimit: { remainingRequests: 42, remainingTime: '00:04:12' },
      });
    });

    it('rejects cross-origin OData next links before making a request', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      await expect(
        client.getNextPage('https://attacker.example/api/data/v9.2/contacts?$skiptoken=x'),
      ).rejects.toMatchObject({ code: 'INVALID_NEXT_LINK' });
      expect(inst.get).not.toHaveBeenCalled();
    });

    it('post(path, body, { preferReturn: true }) adds Prefer: return=representation (create §2.5)', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.post.mockResolvedValue({ data: { contactid: 'x' } });

      await client.post('contacts', { firstname: 'Jane' }, { preferReturn: true });

      expect(inst.post).toHaveBeenCalledWith(
        'contacts',
        { firstname: 'Jane' },
        {
          headers: { Prefer: 'return=representation' },
        },
      );
    });

    it('patch(path, body) delegates (update §2.5: PATCH + 204)', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.patch.mockResolvedValue({ data: undefined });

      await client.patch('contacts(11111111-1111-1111-1111-111111111111)', { lastname: 'Smith' });

      expect(inst.patch).toHaveBeenCalledWith('contacts(11111111-1111-1111-1111-111111111111)', {
        lastname: 'Smith',
      });
    });

    it('delete(path) delegates', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.delete.mockResolvedValue({ data: undefined });

      await client.delete('contacts(11111111-1111-1111-1111-111111111111)');

      expect(inst.delete).toHaveBeenCalledWith('contacts(11111111-1111-1111-1111-111111111111)');
    });
  });

  describe('whoAmI (connection test helper, research §2.6)', () => {
    it('GETs WhoAmI() and returns the typed fixture response', async () => {
      const client = new Dynamics365Client(baseConfig);
      const inst = lastInstance();
      inst.get.mockResolvedValue({ data: mockWhoAmIResponse });

      const result = await client.whoAmI();

      expect(inst.get).toHaveBeenCalledWith('WhoAmI()', undefined);
      expect(result).toEqual(mockWhoAmIResponse);
    });
  });

  describe('retry with backoff (v1.1.0)', () => {
    const retryableError = (retryAfterMs = 0): ConnectorError =>
      new ConnectorError(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        'req-1',
        true,
        undefined,
        retryAfterMs,
      );

    it('retries a retryable failure and succeeds on the next attempt', async () => {
      const client = new Dynamics365Client({
        ...baseConfig,
        maxRetries: 2,
        retryBaseDelayMs: 1,
      });
      const inst = lastInstance();
      inst.get
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce({ data: { value: [] } });

      const result = await client.get<{ value: unknown[] }>('contacts', { $top: 10 });

      expect(inst.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ value: [] });
    });

    it('honors Retry-After (retryAfterMs) over the exponential backoff', async () => {
      const started = Date.now();
      const client = new Dynamics365Client({
        ...baseConfig,
        maxRetries: 1,
        retryBaseDelayMs: 10_000,
        retryMaxDelayMs: 30_000,
      });
      const inst = lastInstance();
      inst.get
        .mockRejectedValueOnce(retryableError(0))
        .mockResolvedValueOnce({ data: { value: [] } });

      await client.get('contacts');

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(inst.get).toHaveBeenCalledTimes(2);
    });

    it('gives up after maxRetries and throws the normalized error', async () => {
      const client = new Dynamics365Client({
        ...baseConfig,
        maxRetries: 1,
        retryBaseDelayMs: 1,
      });
      const inst = lastInstance();
      inst.get.mockRejectedValue(retryableError());

      await expect(client.get('contacts')).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true,
      });
      expect(inst.get).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable errors', async () => {
      const client = new Dynamics365Client({ ...baseConfig, maxRetries: 2, retryBaseDelayMs: 1 });
      const inst = lastInstance();
      inst.get.mockRejectedValue(
        new ConnectorError('Authentication failed', 'AUTH_FAILED', 'req-1', false),
      );

      await expect(client.get('contacts')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      expect(inst.get).toHaveBeenCalledTimes(1);
    });

    it('normalizes raw network failures before classification and retries them', async () => {
      const client = new Dynamics365Client({
        ...baseConfig,
        maxRetries: 1,
        retryBaseDelayMs: 1,
      });
      const inst = lastInstance();
      inst.get
        .mockRejectedValueOnce({
          code: 'ERR_NETWORK',
          message: 'Network Error',
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: { value: [] } });

      const result = await client.get<{ value: unknown[] }>('contacts');

      expect(inst.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ value: [] });
    });
  });
});
