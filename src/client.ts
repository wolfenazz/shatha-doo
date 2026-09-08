/**
 * Dynamics 365 Web API client.
 *
 * Wraps axios with the Web API conventions documented in
 * docs/research/api-endpoints-auth.md:
 *  - base URL  `https://<org>.api.crm.dynamics.com/api/data/<version>/`
 *  - OData headers (`OData-MaxVersion: 4.0`, `OData-Version: 4.0`, §2.4)
 *  - `Accept: application/json`
 *  - `Authorization: Bearer <access_token>` attached by the request
 *    interceptor using the injected token provider (S2.1.4)
 *  - every failure normalized via `normalizeDynamicsError` by the response
 *    interceptor (S2.1.5) so callers always receive a `ConnectorError`
 *  - typed generic helpers (`get`/`post`/`patch`/`delete`) and a `whoAmI()`
 *    helper for `testConnection` (research §2.6)
 *
 * SECURITY RULES:
 * - Never log tokens. The token provider result is used only for the
 *   Authorization header and is never stored on the instance.
 * - If the token provider returns an empty value the request is rejected
 *   rather than silently sending an unauthenticated request.
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ConnectorError, normalizeDynamicsError } from './errors';
import { validateOrgUrl } from './security';

/** Configuration for the Dynamics 365 Web API client. */
export interface Dynamics365ClientConfig {
  /** Organization URL, e.g. `https://contoso.api.crm.dynamics.com`. */
  orgUrl: string;
  /** Web API version, defaults to `v9.2`. */
  apiVersion?: string;
  /** Supplies the OAuth access token for `Authorization: Bearer <token>`. */
  getAccessToken: () => Promise<string> | string;
  /** Request timeout in milliseconds, defaults to 30_000. */
  timeoutMs?: number;
  /**
   * Automatic retries for retryable failures (429 / 5xx / network), defaults
   * to 2. Set to 0 to disable retrying (callers then handle `retryable`
   * errors themselves).
   */
  maxRetries?: number;
  /** Base exponential-backoff delay in ms, defaults to 250. */
  retryBaseDelayMs?: number;
  /** Cap on the backoff delay in ms, defaults to 4_000. */
  retryMaxDelayMs?: number;
  /** Test-only escape hatch for a loopback mock organization. */
  allowLocalhost?: boolean;
}

/** `WhoAmI()` function response (research §2.6) — proves a valid scoped token. */
export interface WhoAmIResponse {
  '@odata.context'?: string;
  BusinessUnitId: string;
  UserId: string;
  OrganizationId: string;
}

/** Request options for write helpers. */
export interface PostOptions {
  /** Add `Prefer: return=representation` to receive the created record body (§2.5). */
  preferReturn?: boolean;
}

export interface ResponseMetadata {
  requestId?: string;
  retryAfterMs?: number;
  rateLimit?: {
    remainingRequests?: number;
    remainingTime?: string;
  };
}

export interface ClientResponse<T> {
  data: T;
  metadata: ResponseMetadata;
}

/** Strips a trailing slash so `baseURL` never ends with a double slash. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class Dynamics365Client {
  private readonly http: AxiosInstance;
  private readonly baseOrigin: string;
  private readonly apiPathPrefix: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(config: Dynamics365ClientConfig) {
    if (!config || typeof config.orgUrl !== 'string' || config.orgUrl.trim() === '') {
      throw new Error('Dynamics365Client requires an orgUrl (https://<org>.api.crm.dynamics.com).');
    }
    if (typeof config.getAccessToken !== 'function') {
      throw new Error('Dynamics365Client requires a getAccessToken() function.');
    }

    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 250;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 4_000;

    const apiVersion = config.apiVersion ?? 'v9.2';
    const orgUrl = validateOrgUrl(
      config.orgUrl,
      config.allowLocalhost === true || process.env.NODE_ENV === 'test',
    );
    const baseURL = `${trimTrailingSlash(orgUrl)}/api/data/${apiVersion}/`;
    this.baseOrigin = new URL(baseURL).origin;
    this.apiPathPrefix = `/api/data/${apiVersion}/`;

    this.http = axios.create({
      baseURL,
      timeout: config.timeoutMs ?? 30_000,
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
    } satisfies AxiosRequestConfig);

    // S2.1.4 request interceptor: attach the Bearer token on every call.
    this.http.interceptors.request.use(async (requestConfig) => {
      const token = await config.getAccessToken();
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Dynamics365Client: getAccessToken() returned an empty token.');
      }
      const headers = (requestConfig.headers ?? {}) as Record<string, string>;
      headers.Authorization = `Bearer ${token}`;
      return requestConfig;
    });

    // S2.1.5 response interceptor: normalize every failure to ConnectorError.
    this.http.interceptors.response.use(
      (response) => response,
      (error: unknown) => Promise.reject(normalizeDynamicsError(error)),
    );
  }

  /**
   * Runs an HTTP call with exponential backoff for retryable failures.
   * `Retry-After` (when present on the error) is honored and capped at
   * `retryMaxDelayMs`; otherwise the backoff is `base * 2^attempt`. Retried
   * calls are jitter-free by design (deterministic tests, predictable load).
   */
  private async withRetry<T>(
    fn: () => Promise<AxiosResponse<T>>,
    retryAllowed: boolean,
  ): Promise<AxiosResponse<T>> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        const normalized = error instanceof ConnectorError ? error : normalizeDynamicsError(error);
        if (!retryAllowed) {
          if (normalized.retryable) {
            throw new ConnectorError(
              normalized.message,
              normalized.code,
              normalized.requestId,
              false,
              normalized.providerError,
              normalized.retryAfterMs,
            );
          }
          throw normalized;
        }
        if (!normalized.retryable || attempt >= this.maxRetries) {
          throw normalized;
        }
        const backoff = Math.min(
          normalized.retryAfterMs ?? this.retryBaseDelayMs * Math.pow(2, attempt),
          this.retryMaxDelayMs,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        attempt += 1;
      }
    }
  }

  /** GET a resource; `params` carries OData query options ($filter/$select/$top/...). */
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return (await this.getWithMetadata<T>(path, params)).data;
  }

  /** GET a resource and preserve provider request/rate-limit response headers. */
  async getWithMetadata<T>(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<ClientResponse<T>> {
    const response = await this.withRetry(
      () => this.http.get<T>(path, params ? { params } : undefined),
      true,
    );
    return { data: response.data, metadata: this.responseMetadata(response) };
  }

  /** Follow an OData nextLink only when it remains on this client's API origin/version. */
  async getNextPage<T>(nextLink: string): Promise<ClientResponse<T>> {
    let parsed: URL;
    try {
      parsed = new URL(nextLink, this.baseOrigin);
    } catch {
      throw new ConnectorError('nextLink must be a valid URL reference', 'INVALID_NEXT_LINK');
    }
    if (parsed.origin !== this.baseOrigin || !parsed.pathname.startsWith(this.apiPathPrefix)) {
      throw new ConnectorError(
        'nextLink must target the configured Dynamics organization and API version',
        'INVALID_NEXT_LINK',
      );
    }
    return this.getWithMetadata<T>(parsed.toString());
  }

  /** POST a new entity; use `preferReturn` to receive the created record body. */
  async post<T>(path: string, body?: unknown, options?: PostOptions): Promise<T> {
    const requestConfig: AxiosRequestConfig | undefined = options?.preferReturn
      ? { headers: { Prefer: 'return=representation' } }
      : undefined;
    const response = await this.withRetry(
      () => this.http.post<T>(path, body, requestConfig),
      false,
    );
    return response.data;
  }

  /** PATCH an existing entity (`contacts(<contactid>)`); returns 204 by default. */
  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await this.withRetry(() => this.http.patch<T>(path, body), true);
    return response.data;
  }

  /** DELETE an entity. */
  async delete(path: string): Promise<void> {
    await this.withRetry(() => this.http.delete(path), false);
  }

  /** Lightweight, side-effect-free connection check (research §2.6). */
  async whoAmI(): Promise<WhoAmIResponse> {
    return this.get<WhoAmIResponse>('WhoAmI()');
  }

  private responseMetadata(response: AxiosResponse<unknown>): ResponseMetadata {
    const readHeader = (name: string): string | undefined => {
      const headers = response.headers as unknown as
        (Record<string, unknown> & { get?: (key: string) => unknown }) | undefined;
      if (!headers) return undefined;
      const value =
        (typeof headers.get === 'function' ? headers.get(name) : undefined) ??
        Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
      return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    };
    const remaining = Number(readHeader('x-ms-ratelimit-burst-remaining-xrm-requests'));
    const retryAfter = Number(readHeader('retry-after'));
    const remainingTime = readHeader('x-ms-ratelimit-time-remaining-xrm-requests');
    const requestId = readHeader('x-ms-request-id');
    return {
      ...(requestId ? { requestId } : {}),
      ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}),
      ...(Number.isFinite(remaining) || remainingTime
        ? {
            rateLimit: {
              ...(Number.isFinite(remaining) ? { remainingRequests: remaining } : {}),
              ...(remainingTime ? { remainingTime } : {}),
            },
          }
        : {}),
    };
  }
}
