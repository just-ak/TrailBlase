import { describe, expect, it, vi } from 'vitest';

// `csp.ts` imports `electron` for `session`, which does not exist in a plain
// vitest process. Only `buildCsp` is under test here and it touches none of it,
// so the module is stubbed rather than the test being pushed into e2e.
vi.mock('electron', () => ({ session: { defaultSession: {} } }));

const { buildCsp } = await import('./csp');

/** Pulls one directive out of the policy string. */
function directive(policy: string, name: string): string {
  const found = policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('buildCsp', () => {
  it('keeps script-src at self in production', () => {
    expect(directive(buildCsp(false), 'script-src')).toBe("script-src 'self'");
  });

  it('allows inline scripts only in development', () => {
    expect(directive(buildCsp(true), 'script-src')).toContain(
      "'unsafe-inline'",
    );
  });

  it('never includes the dev server in a production policy', () => {
    const policy = buildCsp(false);
    expect(policy).not.toContain('localhost');
    expect(policy).not.toContain('ws://');
  });

  describe('img-src', () => {
    it('lists the registered tile hosts', () => {
      const imgSrc = directive(buildCsp(false), 'img-src');
      expect(imgSrc).toContain('https://tile.openstreetmap.org');
      // Every OpenTopoMap subdomain is declared, not just the template.
      expect(imgSrc).toContain('https://a.tile.opentopomap.org');
      expect(imgSrc).toContain('https://b.tile.opentopomap.org');
      expect(imgSrc).toContain('https://c.tile.opentopomap.org');
    });

    it('adds the origin of a user-supplied tile template', () => {
      const policy = buildCsp(false, {
        customTileUrl: 'https://tiles.internal.example/{z}/{x}/{y}.png',
      });
      expect(directive(policy, 'img-src')).toContain(
        'https://tiles.internal.example',
      );
    });

    it('adds a custom overlay origin independently of the base layer', () => {
      const policy = buildCsp(false, {
        customOverlayUrl: 'https://overlay.example/{z}/{x}/{y}.png',
      });
      expect(directive(policy, 'img-src')).toContain('https://overlay.example');
    });

    it('ignores a template with no resolvable origin', () => {
      // A file:// or relative template needs no img-src entry; 'self' covers
      // it, and emitting a bad token would invalidate the whole directive.
      const policy = buildCsp(false, {
        customTileUrl: 'file:///Users/me/tiles/{z}/{x}/{y}.png',
      });
      expect(directive(policy, 'img-src')).not.toContain('file:');
    });
  });

  describe('connect-src', () => {
    it('is self only when no routing endpoint is configured', () => {
      expect(directive(buildCsp(false), 'connect-src')).toBe(
        "connect-src 'self'",
      );
      expect(
        directive(buildCsp(false, { routingEndpoint: '' }), 'connect-src'),
      ).toBe("connect-src 'self'");
    });

    it('adds exactly the configured routing origin', () => {
      const policy = buildCsp(false, {
        routingEndpoint: 'https://routing.example.org/valhalla/v1',
      });
      // The origin, not the path, and nothing else.
      expect(directive(policy, 'connect-src')).toBe(
        "connect-src 'self' https://routing.example.org",
      );
    });

    it('allows a loopback endpoint over plaintext, for self-hosting', () => {
      const policy = buildCsp(false, {
        routingEndpoint: 'http://localhost:8002',
      });
      expect(directive(policy, 'connect-src')).toContain(
        'http://localhost:8002',
      );
    });

    // The endpoint is user input. An endpoint that fails the origin policy must
    // contribute nothing rather than being passed through into a header.
    it('ignores an endpoint the origin policy refuses', () => {
      for (const endpoint of [
        'http://routing.example.org',
        'https://user:pass@example.org',
        'not a url',
        'file:///tmp/x',
      ]) {
        const policy = buildCsp(false, { routingEndpoint: endpoint });
        expect(directive(policy, 'connect-src'), endpoint).toBe(
          "connect-src 'self'",
        );
      }
    });

    it('never emits a wildcard', () => {
      const policy = buildCsp(false, {
        routingEndpoint: 'https://routing.example.org',
        customTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      });
      expect(policy).not.toContain('*');
    });
  });

  it('keeps the restrictive directives that were never relaxed', () => {
    const policy = buildCsp(false, {
      routingEndpoint: 'https://routing.example.org',
    });
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("media-src 'none'");
  });
});
