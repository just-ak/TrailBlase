import type { AppSettings } from '@shared/domain/types';
import { checkRoutingOrigin } from '@shared/net/origin';
import {
  DEFAULT_TRANSPORT_MODE,
  type RoutingProvider,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import type {
  ConsentNotice,
  RoutingStatus,
} from '@shared/routing/results';
import type { Db } from '../db/client';
import {
  createValhallaProvider,
  VALHALLA_PROVIDER_ID,
} from '../routing/valhalla';
import { ServiceError } from './errors';
import * as settingsService from './settingsService';

/**
 * Resolves the configured routing provider, or explains why there isn't one.
 *
 * This is the single place that turns settings into a `RoutingProvider`, and
 * the single place that enforces consent. Every outbound routing call in the
 * application goes through here, so "is the user's geometry allowed to leave
 * this machine" is answered once rather than at each call site.
 *
 * ## Three ways there is no provider, and they are different answers
 *
 * - **Not configured.** The default. The application is fully usable: routes
 *   are drawn as straight lines exactly as they were in Phases 1–3. This is
 *   not an error and must not be presented as one.
 * - **Invalid endpoint.** Something is configured but fails the origin policy.
 *   The user needs to fix a specific thing, so the policy's own message is
 *   carried through rather than flattened.
 * - **Consent not given.** Configured and valid, but the user has not yet
 *   agreed to send geometry to that host. The UI can offer the consent prompt;
 *   anything else would be asking for forgiveness instead of permission.
 *
 * Collapsing these into "routing unavailable" would leave the user with no idea
 * which of three quite different things to do about it.
 */

export type { ConsentNotice, RoutingStatus } from '@shared/routing/results';

export type RoutingResolution =
  | { available: true; provider: RoutingProvider; status: RoutingStatus }
  | { available: false; status: RoutingStatus };

/**
 * What the consent prompt has to say.
 *
 * Built here rather than written into the renderer so the host in the message
 * is always the host that will actually be contacted — a consent notice naming
 * a stale endpoint would be worse than none.
 */
export function consentNotice(endpoint: string): ConsentNotice | null {
  const check = checkRoutingOrigin(endpoint);
  if (!check.ok || check.origin === null) return null;

  return {
    origin: check.origin,
    transmits: [
      'The coordinates of the points you are snapping or matching, and nothing else about the route.',
      'Your chosen transport mode.',
    ],
    withholds: [
      'Route, track and waypoint names, descriptions and notes.',
      'Any account identifier — no account is used and no credentials are sent.',
      'Anything at all until you start a snap or road-attribute lookup.',
    ],
  };
}

function statusFor(
  settings: AppSettings,
  reason: RoutingStatus['reason'],
  origin: string | null,
  message: string | null,
  attribution: string | null,
): RoutingStatus {
  return {
    available: reason === 'available',
    providerId: reason === 'available' ? VALHALLA_PROVIDER_ID : null,
    origin,
    reason,
    message,
    attribution,
    mode: settings.transportMode,
    verifiedAgainstLiveInstance: false,
  };
}

/**
 * Resolves from an already-loaded settings object.
 *
 * Split from the db-reading entry point so it can be unit tested without a
 * database, and so a caller that already has settings in hand does not read
 * them twice.
 */
export function resolveFrom(settings: AppSettings): RoutingResolution {
  const endpoint = settings.routingEndpoint.trim();

  if (endpoint.length === 0) {
    return {
      available: false,
      status: statusFor(
        settings,
        'not-configured',
        null,
        'No routing service is configured. Routes are drawn as straight lines between the points you place.',
        null,
      ),
    };
  }

  const check = checkRoutingOrigin(endpoint);

  if (!check.ok || check.origin === null) {
    return {
      available: false,
      status: statusFor(settings, 'invalid-endpoint', null, check.message, null),
    };
  }

  if (!settings.routingConsentAccepted) {
    return {
      available: false,
      status: statusFor(
        settings,
        'consent-required',
        check.origin,
        `Snapping and road attributes send coordinates to ${check.origin}. Accept that in Settings before TrailRT will contact it.`,
        null,
      ),
    };
  }

  const provider = createValhallaProvider({ endpoint });

  return {
    available: true,
    provider,
    status: statusFor(
      settings,
      'available',
      check.origin,
      null,
      provider.attribution,
    ),
  };
}

export function resolve(db: Db): RoutingResolution {
  return resolveFrom(settingsService.all(db));
}

export function status(db: Db): RoutingStatus {
  return resolve(db).status;
}

/**
 * The provider, or a `ServiceError` naming which of the three states blocked
 * the call.
 *
 * The error codes are distinguishable on purpose: the renderer offers a consent
 * prompt for `CONSENT_REQUIRED` and a settings link for the others, and it
 * cannot do that if every refusal arrives as the same code.
 */
export function requireProvider(db: Db): {
  provider: RoutingProvider;
  mode: TransportMode;
} {
  const settings = settingsService.all(db);
  const resolution = resolveFrom(settings);

  if (!resolution.available) {
    const { reason, message } = resolution.status;
    throw new ServiceError(
      reason === 'consent-required'
        ? 'CONSENT_REQUIRED'
        : reason === 'invalid-endpoint'
          ? 'INVALID_REQUEST'
          : 'PROVIDER_UNAVAILABLE',
      message ?? 'No routing service is available.',
    );
  }

  return {
    provider: resolution.provider,
    mode: settings.transportMode ?? DEFAULT_TRANSPORT_MODE,
  };
}
