/**
 * OAuth 2.0 authentication for Dynamics 365.
 *
 * Implements the authorization_code + refresh_token grants against the
 * Microsoft identity platform v2.0 token endpoint (see
 * docs/research/api-endpoints-auth.md §3):
 *
 *   Authorize: https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
 *   Token:     https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
 *   Scope:     https://<org>.api.crm.dynamics.com/.default
 *
 * SECURITY RULES (per research §3.5):
 * - Never log tokens (access_token, refresh_token) or client secrets.
 * - On HTTP error, the thrown Error contains only the HTTP status — never
 *   token data or response bodies.
 */
import axios from 'axios';

/** OAuth 2.0 client configuration for the Dynamics 365 / Dataverse Web API. */
export interface OAuthConfig {
  /** Azure Active Directory (Microsoft Entra ID) tenant ID. */
  tenantId: string;
  /** Application (client) ID from the Azure app registration. */
  clientId: string;
  /** Client secret from the Azure app registration. Never commit or log it. */
  clientSecret: string;
  /** Redirect URI registered on the app (authorization_code grant only). */
  redirectUri: string;
  /** Scope string, e.g. https://<org>.api.crm.dynamics.com/.default. */
  scope: string;
  /**
   * Token endpoint override (defaults to the Microsoft identity platform v2.0
   * endpoint for `tenantId`). Used by tests and the offline mock sandbox to
   * point OAuth traffic at a local token server.
   */
  tokenUrl?: string;
  /** Authorization code from the authorize endpoint (authorization_code grant). */
  code?: string;
  /** Refresh token (refresh_token grant). Treat like a password. */
  refreshToken?: string;
}

/** Normalized token response returned to callers. */
export interface TokenResponse {
  /** Access token for `Authorization: Bearer <accessToken>`. */
  accessToken: string;
  /** New refresh token, when the token endpoint rotates it. */
  refreshToken?: string;
  /** Access token lifetime in seconds (typically 3600). */
  expiresIn?: number;
}

/** Raw shape of the Microsoft identity platform v2.0 token endpoint response. */
interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** v2.0 token endpoint for a tenant. */
export const TOKEN_URL = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

/** v2.0 authorize endpoint for a tenant. */
export const AUTHORIZE_URL = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;

/**
 * Default resource scope for a confidential client:
 * `https://<org>.api.crm.dynamics.com/.default`.
 *
 * Tolerates an org URL with a scheme, a trailing slash, or neither.
 */
export const DEFAULT_SCOPE = (orgUrl: string): string => {
  const host = orgUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${host}/.default`;
};

/**
 * Acquire an access token using whichever grant the config provides:
 * - `config.code`         → grant_type=authorization_code
 * - `config.refreshToken` → grant_type=refresh_token
 *
 * @throws Error if neither `code` nor `refreshToken` is present, or if the
 *   token endpoint responds with an HTTP error (status only, no token data).
 */
export async function acquireToken(config: OAuthConfig): Promise<string> {
  const token = await fetchToken(config);
  return token.accessToken;
}

/**
 * Acquire a token and return the full normalized `TokenResponse` (access
 * token, rotated refresh token, and lifetime) so callers can cache it.
 */
export async function acquireTokenResponse(config: OAuthConfig): Promise<TokenResponse> {
  return fetchToken(config);
}

/**
 * Exchange a refresh token for a fresh TokenResponse
 * (grant_type=refresh_token).
 *
 * @throws Error if `config.refreshToken` is missing, or on HTTP error
 *   (status only, no token data).
 */
export async function refreshAccessToken(config: OAuthConfig): Promise<TokenResponse> {
  if (!config.refreshToken) {
    throw new Error('refreshAccessToken requires config.refreshToken (refresh_token grant).');
  }
  return requestToken(config, {
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
  });
}

/** Route the config to the correct grant at the token endpoint. */
async function fetchToken(config: OAuthConfig): Promise<TokenResponse> {
  if (config.code) {
    return requestToken(config, {
      grant_type: 'authorization_code',
      code: config.code,
      redirect_uri: config.redirectUri,
    });
  }
  if (config.refreshToken) {
    return requestToken(config, {
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
    });
  }
  throw new Error(
    'OAuthConfig must provide either a `code` (authorization_code grant) or a `refreshToken` (refresh_token grant).',
  );
}

/**
 * POST an OAuth grant to the v2.0 token endpoint with an
 * application/x-www-form-urlencoded body and map the response.
 */
async function requestToken(
  config: OAuthConfig,
  grant: Record<string, string>,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...grant,
  });

  let response;
  try {
    response = await axios.post<TokenEndpointResponse>(
      config.tokenUrl ?? TOKEN_URL(config.tenantId),
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
  } catch (error) {
    const status = httpStatus(error);
    throw new Error(
      status !== undefined
        ? `OAuth token request failed: HTTP ${status}`
        : 'OAuth token request failed: no response from the token endpoint',
    );
  }

  const {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
  } = response.data;

  if (!accessToken) {
    throw new Error('OAuth token response did not include an access_token.');
  }

  return { accessToken, refreshToken, expiresIn };
}

/** Extract the HTTP status from an axios error, if present. */
function httpStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  return undefined;
}
