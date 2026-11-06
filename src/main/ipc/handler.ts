import { ipcMain } from 'electron';
import type { ZodType } from 'zod';
import type { Result } from '@shared/ipc/result';
import { toErrorShape } from '../services/errors';

/**
 * The only place `ipcMain.handle` is called.
 *
 * Every channel validates its payload with zod before any service runs, and
 * every failure becomes a Result rather than an exception crossing the process
 * boundary. Centralising this means a new channel cannot forget either half.
 */

export function handle<Req, Res>(
  channel: string,
  schema: ZodType<Req>,
  fn: (req: Req) => Promise<Res> | Res,
): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<Res>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'That request was not valid.',
          // Field paths help during development and are harmless to a user;
          // no payload values are echoed back.
          detail: parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
        },
      };
    }

    try {
      return { ok: true, data: await fn(parsed.data) };
    } catch (cause) {
      return { ok: false, error: toErrorShape(cause) };
    }
  });
}

/** For channels that genuinely take no arguments. */
export function handleNoArgs<Res>(
  channel: string,
  fn: () => Promise<Res> | Res,
): void {
  ipcMain.handle(channel, async (): Promise<Result<Res>> => {
    try {
      return { ok: true, data: await fn() };
    } catch (cause) {
      return { ok: false, error: toErrorShape(cause) };
    }
  });
}
