/**
 * Every IPC handler returns a Result rather than throwing across the process
 * boundary, where stack traces and error subclasses do not survive structured
 * cloning intact. See `.kiro/steering/architecture.md`.
 */

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'CYCLE',
  'DB_ERROR',
  'IO_ERROR',
  'BLOCKED',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorShape {
  code: ErrorCode;
  /** Safe to show a user. */
  message: string;
  /** Diagnostic context; may be shown in a details disclosure. */
  detail?: string;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorShape };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = (
  code: ErrorCode,
  message: string,
  detail?: string,
): Result<never> => ({
  ok: false,
  error: detail === undefined ? { code, message } : { code, message, detail },
});

/**
 * Unwraps a Result or throws. Used in the renderer, where a failed call is
 * exceptional and handled by an error boundary or a toast.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(shape: AppErrorShape) {
    super(shape.message);
    this.name = 'AppError';
    this.code = shape.code;
    this.detail = shape.detail;
  }
}

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new AppError(result.error);
}
