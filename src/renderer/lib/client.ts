import { AppError, unwrap, type Result } from '@shared/ipc/result';

/**
 * Thin wrapper over the preload bridge.
 *
 * Unwraps `Result` so callers write ordinary async code, and converts a failure
 * into an `AppError` that the nearest handler or error boundary deals with.
 * Keeping this in one place means no component has to remember to check `ok`.
 */

export const api = (): Window['trailrt'] => window.trailrt;

export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  return unwrap(await promise);
}

/**
 * For call sites where a failure is survivable and the UI prefers a fallback
 * over an exception, such as a background refresh.
 */
export async function callOr<T>(
  promise: Promise<Result<T>>,
  fallback: T,
): Promise<T> {
  try {
    return unwrap(await promise);
  } catch (cause) {
    console.error('[ipc] call failed:', cause);
    return fallback;
  }
}

export function describeError(cause: unknown): string {
  if (cause instanceof AppError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong.';
}

export { AppError };
