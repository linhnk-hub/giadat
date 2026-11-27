/**
 * Pure single-flight verification coordinator for Admin session checks.
 *
 * Security invariants:
 * 1. NEVER caches completed authorization results (in-flight slot is always cleared in finally).
 * 2. Deduplicates ONLY concurrent identical in-flight requests for the same (uid, forceRefresh).
 * 3. A stronger request (forceRefresh=true) or different UID supersedes any older in-flight check.
 * 4. Monotonic sequence numbers ensure stale responses or pre-logout responses can NEVER apply.
 */
export interface VerificationResult<T> {
  applied: boolean;
  value: T;
}

export interface VerificationCoordinator<T> {
  run: (
    uid: string,
    forceRefresh: boolean,
    executor: () => Promise<T>
  ) => Promise<VerificationResult<T>>;
  invalidate: () => void;
  getCurrentSequence: () => number;
}

export function createVerificationCoordinator<T>(): VerificationCoordinator<T> {
  let sequence = 0;
  let inFlight: {
    uid: string;
    forceRefresh: boolean;
    seq: number;
    promise: Promise<VerificationResult<T>>;
  } | null = null;

  const invalidate = () => {
    sequence += 1;
    inFlight = null;
  };

  const run = (
    uid: string,
    forceRefresh: boolean,
    executor: () => Promise<T>
  ): Promise<VerificationResult<T>> => {
    // Coalesce ONLY when an identical or stronger (forceRefresh=true covers false)
    // verification for the exact same UID is currently in-flight.
    if (
      inFlight &&
      inFlight.uid === uid &&
      (!forceRefresh || inFlight.forceRefresh)
    ) {
      return inFlight.promise;
    }

    const requestSeq = ++sequence;
    const currentPromise = (async (): Promise<VerificationResult<T>> => {
      try {
        const value = await executor();
        return {
          applied: requestSeq === sequence,
          value,
        };
      } finally {
        if (inFlight && inFlight.seq === requestSeq) {
          inFlight = null;
        }
      }
    })();

    inFlight = {
      uid,
      forceRefresh,
      seq: requestSeq,
      promise: currentPromise,
    };

    return currentPromise;
  };

  return {
    run,
    invalidate,
    getCurrentSequence: () => sequence,
  };
}
