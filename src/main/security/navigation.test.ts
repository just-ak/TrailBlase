import { describe, expect, it, vi } from 'vitest';

// The module imports `electron` for `shell`; stub it so the pure URL checking
// can be tested without an Electron runtime.
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

const { checkExternalUrl } = await import('./navigation');

describe('checkExternalUrl', () => {
  it('allows https links to allowlisted hosts', () => {
    expect(checkExternalUrl('https://github.com/trailrt/trailrt').allowed).toBe(true);
    expect(checkExternalUrl('https://www.openstreetmap.org/copyright').allowed).toBe(true);
    expect(checkExternalUrl('https://www.gnu.org/licenses/gpl-3.0.html').allowed).toBe(true);
  });

  it('rejects http, even to an allowlisted host', () => {
    const check = checkExternalUrl('http://github.com/trailrt');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/https/i);
  });

  it('rejects dangerous schemes', () => {
    expect(checkExternalUrl('javascript:alert(1)').allowed).toBe(false);
    expect(checkExternalUrl('file:///etc/passwd').allowed).toBe(false);
    expect(checkExternalUrl('data:text/html,<script>x</script>').allowed).toBe(false);
  });

  it('rejects hosts that are not allowlisted', () => {
    expect(checkExternalUrl('https://evil.example.com').allowed).toBe(false);
  });

  it('is not fooled by a subdomain or suffix resembling an allowed host', () => {
    expect(checkExternalUrl('https://github.com.evil.example').allowed).toBe(false);
    expect(checkExternalUrl('https://notgithub.com').allowed).toBe(false);
    expect(checkExternalUrl('https://evil.github.com.co').allowed).toBe(false);
  });

  it('is not fooled by userinfo pointing at an allowed host', () => {
    // The host here is evil.example, not github.com.
    expect(checkExternalUrl('https://github.com@evil.example/').allowed).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(checkExternalUrl('not a url').allowed).toBe(false);
    expect(checkExternalUrl('').allowed).toBe(false);
  });
});
