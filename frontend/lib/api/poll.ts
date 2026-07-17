// Generic poll-until-done helper with exponential backoff.
//
// Kept transport-agnostic so it can be tested without a server: `fetchOnce` is any
// async function, `isDone` any predicate.

export interface PollOptions {
  /** Ceiling on attempts. Exhausting them throws PollTimeoutError. */
  maxAttempts?: number;
  /** First wait, in ms. Doubles each attempt up to maxDelayMs. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Ran out of attempts while the work was still in progress.
 *
 * Distinct from a failure on purpose: the job may well still be running and
 * succeed later, so a caller can keep waiting or re-poll. Treating this as
 * "failed" would report a false negative on a slow-but-healthy eval.
 */
export class PollTimeoutError extends Error {
  constructor(
    message: string,
    public attempts: number,
    /** The last value seen, so a caller can report how far it got. */
    public lastValue: unknown
  ) {
    super(message);
    this.name = "PollTimeoutError";
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(newAbortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(newAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const newAbortError = () => new DOMException("Aborted", "AbortError");

/**
 * Call `fetchOnce` until `isDone` passes, backing off exponentially.
 *
 * Polls immediately first — a job that is already finished should cost one request
 * and no delay.
 */
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: PollOptions = {}
): Promise<T> {
  const {
    maxAttempts = 12,
    initialDelayMs = 500,
    maxDelayMs = 8000,
    signal,
  } = options;

  let delay = initialDelayMs;
  let last: T | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw newAbortError();

    last = await fetchOnce();
    if (isDone(last)) return last;

    // Don't sleep after the final attempt — nothing would observe it.
    if (attempt < maxAttempts) {
      await sleep(delay, signal);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw new PollTimeoutError(
    `Still pending after ${maxAttempts} attempts.`,
    maxAttempts,
    last
  );
}
