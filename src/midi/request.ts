import type { MidiTransport } from './transport';

export class RequestTimeout extends Error {}

/**
 * Sends `msg` and resolves with the first incoming message that `match` accepts.
 * Listens before sending, so a fast reply can't be missed.
 */
export function request<T>(
  transport: MidiTransport,
  msg: Uint8Array,
  match: (reply: Uint8Array) => T | null | undefined,
  timeoutMs: number,
): Promise<{ value: T; reply: Uint8Array; ms: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const unsubscribe = transport.onMessage((reply) => {
      const value = match(reply);
      if (done || value === null || value === undefined) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve({ value, reply, ms: Date.now() - started });
    });
    transport.send(msg).then(
      () => {
        if (done) return;
        timer = setTimeout(() => {
          done = true;
          unsubscribe();
          reject(new RequestTimeout(`no reply within ${timeoutMs} ms`));
        }, timeoutMs);
      },
      (err: unknown) => {
        unsubscribe();
        reject(err);
      },
    );
  });
}

/** Collects every incoming message accepted by `match` for `ms` milliseconds after sending. */
export async function collect<T>(
  transport: MidiTransport,
  msg: Uint8Array,
  match: (reply: Uint8Array) => T | null | undefined,
  ms: number,
): Promise<T[]> {
  const found: T[] = [];
  const unsubscribe = transport.onMessage((reply) => {
    const value = match(reply);
    if (value !== null && value !== undefined) found.push(value);
  });
  try {
    await transport.send(msg);
    await new Promise((resolve) => setTimeout(resolve, ms));
  } finally {
    unsubscribe();
  }
  return found;
}
