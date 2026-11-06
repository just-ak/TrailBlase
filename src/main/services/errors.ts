import type { AppErrorShape, ErrorCode } from '@shared/ipc/result';

/**
 * Services throw these; the IPC layer converts them to a Result. Keeping the
 * error code in the domain layer means handlers stay free of business
 * judgement about what kind of failure something is.
 */
export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.detail = detail;
  }

  toShape(): AppErrorShape {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

export const notFound = (what: string): ServiceError =>
  new ServiceError('NOT_FOUND', `${what} could not be found.`);

export const cycle = (message: string): ServiceError =>
  new ServiceError('CYCLE', message);

/**
 * Maps an unknown thrown value to a user-safe shape. SQLite constraint
 * failures are translated rather than leaked, because their text mentions
 * internal column names.
 */
export function toErrorShape(cause: unknown): AppErrorShape {
  if (cause instanceof ServiceError) return cause.toShape();

  if (cause instanceof Error) {
    const msg = cause.message;
    if (/FOREIGN KEY constraint failed/i.test(msg)) {
      return {
        code: 'CONFLICT',
        message: 'That change would leave a reference to something that no longer exists.',
        detail: msg,
      };
    }
    if (/UNIQUE constraint failed/i.test(msg)) {
      return {
        code: 'CONFLICT',
        message: 'That change conflicts with an existing record.',
        detail: msg,
      };
    }
    if (/CHECK constraint failed/i.test(msg)) {
      return {
        code: 'INVALID_REQUEST',
        message: 'That value is not allowed.',
        detail: msg,
      };
    }
    if (/SQLITE_/i.test(msg)) {
      return { code: 'DB_ERROR', message: 'The database rejected that operation.', detail: msg };
    }
    return { code: 'UNKNOWN', message: 'Something went wrong.', detail: msg };
  }

  return { code: 'UNKNOWN', message: 'Something went wrong.', detail: String(cause) };
}
