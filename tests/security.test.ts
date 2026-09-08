import { validateOrgUrl, validateTokenUrl, secureEqual } from '../src/security';

describe('endpoint and secret security', () => {
  it('accepts only expected HTTPS Dynamics organization hosts', () => {
    expect(validateOrgUrl('https://contoso.api.crm.dynamics.com/')).toBe(
      'https://contoso.api.crm.dynamics.com',
    );
    for (const url of [
      'http://contoso.api.crm.dynamics.com',
      'https://127.0.0.1',
      'https://169.254.169.254/latest/meta-data',
      'https://dynamics.com.attacker.example',
      'https://user:password@contoso.api.crm.dynamics.com',
    ]) {
      expect(() => validateOrgUrl(url)).toThrow();
    }
  });

  it('accepts Microsoft identity token endpoints and blocks SSRF targets', () => {
    expect(
      validateTokenUrl('https://login.microsoftonline.com/tenant/oauth2/v2.0/token'),
    ).toContain('login.microsoftonline.com');
    expect(() => validateTokenUrl('http://login.microsoftonline.com/token')).toThrow();
    expect(() => validateTokenUrl('https://localhost/token')).toThrow();
    expect(() => validateTokenUrl('https://login.microsoftonline.com.evil.test/token')).toThrow();
  });

  it('compares configured secrets without accepting absent or different values', () => {
    expect(secureEqual('same', 'same')).toBe(true);
    expect(secureEqual('wrong', 'right')).toBe(false);
    expect(secureEqual(undefined, 'right')).toBe(false);
  });
});
