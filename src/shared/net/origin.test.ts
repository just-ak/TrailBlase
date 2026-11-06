import { describe, expect, it } from 'vitest';
import { checkRoutingOrigin, routingConnectOrigin } from './origin';

describe('checkRoutingOrigin', () => {
  it('accepts https anywhere and returns the bare origin', () => {
    const result = checkRoutingOrigin('https://routing.example.org/valhalla');
    expect(result.ok).toBe(true);
    // Origin only: the path is not part of what the CSP allows.
    expect(result.origin).toBe('https://routing.example.org');
  });

  it('keeps an explicit non-default port', () => {
    expect(checkRoutingOrigin('https://example.org:8443').origin).toBe(
      'https://example.org:8443',
    );
  });

  it('drops a default port, matching how a browser reports an origin', () => {
    expect(checkRoutingOrigin('https://example.org:443').origin).toBe(
      'https://example.org',
    );
  });

  // Self-hosting is the configuration the no-cloud policy most wants to
  // support, and demanding a certificate for a service on the same machine
  // would make it impractical.
  describe('plaintext http', () => {
    it.each([
      'http://localhost:8002',
      'http://127.0.0.1:8002',
      'http://127.1.2.3:8002',
      'http://[::1]:8002',
      'http://valhalla.localhost',
    ])('is allowed for loopback host %s', (endpoint) => {
      const result = checkRoutingOrigin(endpoint);
      expect(result.ok, endpoint).toBe(true);
    });

    it.each([
      'http://routing.example.org',
      'http://192.168.1.50:8002',
      'http://10.0.0.5',
      'http://127.0.0.1.evil.example.org',
    ])('is refused for non-loopback host %s', (endpoint) => {
      const result = checkRoutingOrigin(endpoint);
      expect(result.ok, endpoint).toBe(false);
      expect(result.reason).toBe('plaintext-not-loopback');
      expect(result.message).toMatch(/where you plan to be/);
    });
  });

  it('refuses a scheme that is not http or https', () => {
    for (const endpoint of [
      'file:///tmp/valhalla',
      'ftp://example.org',
      'javascript:alert(1)',
      'data:text/plain,x',
    ]) {
      const result = checkRoutingOrigin(endpoint);
      expect(result.ok, endpoint).toBe(false);
      expect(['unsupported-scheme', 'malformed']).toContain(result.reason);
    }
  });

  // Credentials would be written into the CSP header and into any log line
  // that printed the configured endpoint.
  it('refuses credentials in the URL, naming the reason', () => {
    const result = checkRoutingOrigin('https://user:secret@example.org');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('has-credentials');
    expect(result.message).toMatch(/username or password/);
  });

  it('treats an empty or whitespace endpoint as no provider, not an error shape', () => {
    for (const endpoint of ['', '   ']) {
      const result = checkRoutingOrigin(endpoint);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('empty');
      expect(result.origin).toBeNull();
    }
  });

  it('refuses a malformed URL with a usable hint', () => {
    const result = checkRoutingOrigin('routing.example.org:8002');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Include the scheme/);
  });

  it('trims surrounding whitespace rather than rejecting a pasted value', () => {
    expect(checkRoutingOrigin('  https://example.org  ').origin).toBe(
      'https://example.org',
    );
  });
});

describe('routingConnectOrigin', () => {
  it('returns the origin for a valid endpoint', () => {
    expect(routingConnectOrigin('https://example.org/route')).toBe(
      'https://example.org',
    );
  });

  it('returns null for anything the policy refuses', () => {
    for (const endpoint of [
      '',
      'nonsense',
      'http://example.org',
      'https://u:p@example.org',
    ]) {
      expect(routingConnectOrigin(endpoint), endpoint).toBeNull();
    }
  });
});
