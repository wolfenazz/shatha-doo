/**
 * Unit tests for src/auth/index.ts — OAuth 2.0 token acquisition (v1.1.0).
 *
 * Covers:
 *  - authorization_code grant (code + redirect_uri in the form body)
 *  - refresh_token grant and refreshAccessToken()
 *  - acquireTokenResponse(): full normalized TokenResponse for caching
 *  - tokenUrl override (mock-sandbox / test support)
 *  - security: HTTP failures surface status-only messages, never token data
 *  - DEFAULT_SCOPE / TOKEN_URL / AUTHORIZE_URL helpers
 *
 * OFFLINE: axios.post is mocked — no real token endpoint is contacted.
 */
import axios from 'axios';
import {
  acquireToken,
  acquireTokenResponse,
  refreshAccessToken,
  AUTHORIZE_URL,
  DEFAULT_SCOPE,
  TOKEN_URL,
} from '../src/auth';

jest.mock('axios', () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      isAxiosError: jest.fn(
        (error: unknown) =>
          error !== null && typeof error === 'object' && 'isAxiosError' in (error as object),
      ),
    },
  };
});

const mockPost = axios.post as jest.Mock;

const BASE_CONFIG = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  redirectUri: 'http://localhost:3000/callback',
  scope: 'https://contoso.api.crm.dynamics.com/.default',
};

describe('src/auth — OAuth 2.0 (S2.1.2/S2.1.3)', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  describe('authorization_code grant', () => {
    it('posts grant_type=authorization_code with code + redirect_uri and returns the access token', async () => {
      mockPost.mockResolvedValue({
        data: {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const token = await acquireToken({ ...BASE_CONFIG, code: 'auth-code-123' });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url, body, options] = mockPost.mock.calls[0];
      expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain('code=auth-code-123');
      expect(body).toContain(`redirect_uri=${encodeURIComponent(BASE_CONFIG.redirectUri)}`);
      expect(body).toContain('client_id=client-1');
      expect(body).toContain('client_secret=secret-1');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(token).toBe('access-1');
    });
  });

  describe('refresh_token grant', () => {
    it('posts grant_type=refresh_token and returns the fresh access token', async () => {
      mockPost.mockResolvedValue({ data: { access_token: 'access-2', expires_in: 3600 } });

      const token = await acquireToken({ ...BASE_CONFIG, refreshToken: 'refresh-old' });

      const [url, body] = mockPost.mock.calls[0];
      expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
      expect(body).toContain('grant_type=refresh_token');
      expect(body).toContain('refresh_token=refresh-old');
      expect(token).toBe('access-2');
    });

    it('refreshAccessToken throws when no refreshToken is configured', async () => {
      await expect(refreshAccessToken(BASE_CONFIG)).rejects.toThrow(/refreshToken/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('refreshAccessToken returns the rotated refresh token when the endpoint rotates it', async () => {
      mockPost.mockResolvedValue({
        data: { access_token: 'access-3', refresh_token: 'refresh-new', expires_in: 3600 },
      });

      const response = await refreshAccessToken({ ...BASE_CONFIG, refreshToken: 'refresh-old' });

      expect(response).toEqual({
        accessToken: 'access-3',
        refreshToken: 'refresh-new',
        expiresIn: 3600,
      });
    });
  });

  describe('acquireTokenResponse', () => {
    it('returns the full normalized TokenResponse (cache-ready)', async () => {
      mockPost.mockResolvedValue({
        data: { access_token: 'access-4', refresh_token: 'refresh-4', expires_in: 1800 },
      });

      const response = await acquireTokenResponse({ ...BASE_CONFIG, code: 'code-1' });

      expect(response).toEqual({
        accessToken: 'access-4',
        refreshToken: 'refresh-4',
        expiresIn: 1800,
      });
    });

    it('throws when the response omits access_token', async () => {
      mockPost.mockResolvedValue({ data: { refresh_token: 'refresh-5' } });

      await expect(acquireToken({ ...BASE_CONFIG, code: 'code-1' })).rejects.toThrow(
        /did not include an access_token/,
      );
    });
  });

  describe('tokenUrl override', () => {
    it('posts to config.tokenUrl instead of the Microsoft endpoint when provided', async () => {
      mockPost.mockResolvedValue({ data: { access_token: 'access-6', expires_in: 3600 } });

      await acquireToken({
        ...BASE_CONFIG,
        refreshToken: 'refresh-6',
        tokenUrl: 'http://127.0.0.1:9999/oauth2/v2.0/token',
      });

      expect(mockPost.mock.calls[0][0]).toBe('http://127.0.0.1:9999/oauth2/v2.0/token');
    });
  });

  describe('security — status-only errors', () => {
    it('throws a status-only message on an HTTP error (never token data or bodies)', async () => {
      mockPost.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'invalid_grant', error_description: 'bad secret' },
        },
      });

      await expect(acquireToken({ ...BASE_CONFIG, code: 'code-x' })).rejects.toThrow(
        'OAuth token request failed: HTTP 400',
      );
    });

    it('distinguishes a missing response from an HTTP error', async () => {
      mockPost.mockRejectedValue({ isAxiosError: true, response: undefined });

      await expect(acquireToken({ ...BASE_CONFIG, code: 'code-x' })).rejects.toThrow(
        /no response from the token endpoint/,
      );
    });

    it('fails fast when neither code nor refreshToken is present', async () => {
      await expect(acquireToken(BASE_CONFIG)).rejects.toThrow(/must provide either/);
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('URL + scope helpers', () => {
    it('TOKEN_URL / AUTHORIZE_URL point at the v2.0 endpoints for the tenant', () => {
      expect(TOKEN_URL('tenant-1')).toBe(
        'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      );
      expect(AUTHORIZE_URL('tenant-1')).toBe(
        'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize',
      );
    });

    it('DEFAULT_SCOPE tolerates schemes and trailing slashes', () => {
      expect(DEFAULT_SCOPE('https://contoso.api.crm.dynamics.com')).toBe(
        'https://contoso.api.crm.dynamics.com/.default',
      );
      expect(DEFAULT_SCOPE('contoso.api.crm.dynamics.com/')).toBe(
        'https://contoso.api.crm.dynamics.com/.default',
      );
    });
  });
});
