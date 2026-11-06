import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import type { AppSettings } from '@shared/domain/types';
import { settingsSetRequest } from '@shared/ipc/schemas';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { ServiceError } from './errors';
import * as providerService from './providerService';
import * as settingsService from './settingsService';

let dir: string;
let handle: DbHandle;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-provider-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const settings = (overrides: Partial<AppSettings>): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

describe('resolveFrom', () => {
  // The default state. Not an error, and the message has to say so, because a
  // user who never wanted a routing service should not be told anything is
  // wrong.
  it('reports no provider configured on a fresh install', () => {
    const resolution = providerService.resolveFrom(DEFAULT_SETTINGS);

    expect(resolution.available).toBe(false);
    expect(resolution.status.reason).toBe('not-configured');
    expect(resolution.status.message).toMatch(/straight lines/);
    expect(resolution.status.origin).toBeNull();
  });

  it('distinguishes an invalid endpoint from an unconfigured one', () => {
    const resolution = providerService.resolveFrom(
      settings({ routingEndpoint: 'http://routing.example.org' }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.status.reason).toBe('invalid-endpoint');
    // The origin policy's own wording, not a generic failure.
    expect(resolution.status.message).toMatch(/Plaintext http/);
  });

  it('withholds the provider until consent is given, naming the host', () => {
    const resolution = providerService.resolveFrom(
      settings({
        routingEndpoint: 'https://routing.example.org/valhalla',
        routingConsentAccepted: false,
      }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.status.reason).toBe('consent-required');
    expect(resolution.status.message).toContain('https://routing.example.org');
  });

  it('returns a provider once the endpoint is valid and consent is given', () => {
    const resolution = providerService.resolveFrom(
      settings({
        routingEndpoint: 'http://localhost:8002',
        routingConsentAccepted: true,
        transportMode: 'motorcycle',
      }),
    );

    expect(resolution.available).toBe(true);
    if (!resolution.available) return;

    expect(resolution.provider.id).toBe('valhalla');
    expect(resolution.status.origin).toBe('http://localhost:8002');
    expect(resolution.status.mode).toBe('motorcycle');
    expect(resolution.status.attribution).toMatch(/OpenStreetMap/);
  });

  // Claiming more verification than has happened would be the dishonesty the
  // architecture rules forbid.
  it('never claims verification against a live instance', () => {
    const resolution = providerService.resolveFrom(
      settings({
        routingEndpoint: 'https://routing.example.org',
        routingConsentAccepted: true,
      }),
    );

    expect(resolution.status.verifiedAgainstLiveInstance).toBe(false);
  });
});

describe('requireProvider', () => {
  it('refuses with CONSENT_REQUIRED when consent is outstanding', () => {
    settingsService.set(db, 'routingEndpoint', 'https://routing.example.org');

    try {
      providerService.requireProvider(db);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('CONSENT_REQUIRED');
    }
  });

  it('refuses with PROVIDER_UNAVAILABLE when nothing is configured', () => {
    try {
      providerService.requireProvider(db);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ServiceError).code).toBe('PROVIDER_UNAVAILABLE');
    }
  });

  it('refuses with INVALID_REQUEST for a bad endpoint', () => {
    // Written through the repository-backed service, which is the path the IPC
    // handler takes; the schema refusal is tested separately.
    settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'http://192.0.2.10:8002' },
      { key: 'routingConsentAccepted', value: true },
    ]);

    try {
      providerService.requireProvider(db);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ServiceError).code).toBe('INVALID_REQUEST');
    }
  });

  it('hands back the provider and the configured mode when allowed', () => {
    settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'http://127.0.0.1:8002' },
      { key: 'routingConsentAccepted', value: true },
      { key: 'transportMode', value: 'bicycle' },
    ]);

    const { provider, mode } = providerService.requireProvider(db);

    expect(provider.id).toBe('valhalla');
    expect(mode).toBe('bicycle');
  });
});

describe('consentNotice', () => {
  it('names the host and states what is and is not transmitted', () => {
    const notice = providerService.consentNotice('https://routing.example.org/x');

    expect(notice).not.toBeNull();
    expect(notice?.origin).toBe('https://routing.example.org');
    expect(notice?.transmits.join(' ')).toMatch(/coordinates/i);
    // Names and notes are the thing a user would most object to sending.
    expect(notice?.withholds.join(' ')).toMatch(/names/i);
  });

  it('has nothing to say about an endpoint that would be refused anyway', () => {
    expect(providerService.consentNotice('http://example.org')).toBeNull();
    expect(providerService.consentNotice('')).toBeNull();
  });
});

describe('consent is per host', () => {
  it('withdraws consent when the endpoint moves to a different origin', () => {
    settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'http://localhost:8002' },
      { key: 'routingConsentAccepted', value: true },
    ]);
    expect(settingsService.all(db).routingConsentAccepted).toBe(true);

    const after = settingsService.set(
      db,
      'routingEndpoint',
      'https://someone-elses-server.example.org',
    );

    expect(after.routingConsentAccepted).toBe(false);
    expect(providerService.status(db).reason).toBe('consent-required');
  });

  it('keeps consent when the edit does not change the origin', () => {
    settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'https://routing.example.org' },
      { key: 'routingConsentAccepted', value: true },
    ]);

    // Adding a path, which the CSP ignores: the host being trusted is the same.
    const after = settingsService.set(
      db,
      'routingEndpoint',
      'https://routing.example.org/valhalla',
    );

    expect(after.routingConsentAccepted).toBe(true);
  });

  it('lets a batch set the endpoint and accept it in one go', () => {
    const after = settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'https://routing.example.org' },
      { key: 'routingConsentAccepted', value: true },
    ]);

    expect(after.routingConsentAccepted).toBe(true);
  });

  it('withdraws consent when routing is switched off entirely', () => {
    settingsService.setMany(db, [
      { key: 'routingEndpoint', value: 'https://routing.example.org' },
      { key: 'routingConsentAccepted', value: true },
    ]);

    const after = settingsService.set(db, 'routingEndpoint', '');

    expect(after.routingConsentAccepted).toBe(false);
  });
});

describe('settingsSetRequest: routingEndpoint', () => {
  it('accepts an empty string as "no routing service"', () => {
    const parsed = settingsSetRequest.safeParse({
      key: 'routingEndpoint',
      value: '',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts https and loopback http', () => {
    for (const value of [
      'https://routing.example.org',
      'http://localhost:8002',
      'http://127.0.0.1:8002',
    ]) {
      expect(
        settingsSetRequest.safeParse({ key: 'routingEndpoint', value }).success,
        value,
      ).toBe(true);
    }
  });

  // The schema is the first of three gates. It exists so the renderer can show
  // the reason in the field rather than after a round trip.
  it('rejects a bad endpoint and carries the policy message', () => {
    const parsed = settingsSetRequest.safeParse({
      key: 'routingEndpoint',
      value: 'http://routing.example.org',
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/Plaintext http/);
  });

  it('rejects credentials and a missing scheme', () => {
    for (const value of [
      'https://user:secret@example.org',
      'routing.example.org:8002',
      'ftp://example.org',
    ]) {
      expect(
        settingsSetRequest.safeParse({ key: 'routingEndpoint', value }).success,
        value,
      ).toBe(false);
    }
  });
});
