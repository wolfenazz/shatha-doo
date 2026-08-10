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

/** Strips a trailing slash so `baseURL` never ends with a double slash. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class Dynamics365Client {
  private readonly http: AxiosInstance;
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
    const baseURL = `${trimTrailingSlash(config.orgUrl)}/api/data/${apiVersion}/`;

    this.http = axios.create({
      baseURL,
      timeout: config.timeoutMs ?? 30_000,
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
  private async withRetry<T>(fn: () => Promise<AxiosResponse<T>>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        const { data } = await fn();
        return data;
      } catch (error) {
        const normalized = error instanceof ConnectorError ? error : normalizeDynamicsError(error);
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
    return this.withRetry(() => this.http.get<T>(path, params ? { params } : undefined));
  }

  /** POST a new entity; use `preferReturn` to receive the created record body. */
  async post<T>(path: string, body?: unknown, options?: PostOptions): Promise<T> {
    const requestConfig: AxiosRequestConfig | undefined = options?.preferReturn
      ? { headers: { Prefer: 'return=representation' } }
      : undefined;
    return this.withRetry(() => this.http.post<T>(path, body, requestConfig));
  }

  /** PATCH an existing entity (`contacts(<contactid>)`); returns 204 by default. */
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.withRetry(() => this.http.patch<T>(path, body));
  }

  /** DELETE an entity. */
  async delete(path: string): Promise<void> {
    await this.withRetry(() => this.http.delete(path));
  }

  /** Lightweight, side-effect-free connection check (research §2.6). */
  async whoAmI(): Promise<WhoAmIResponse> {
    return this.get<WhoAmIResponse>('WhoAmI()');
  }
}
