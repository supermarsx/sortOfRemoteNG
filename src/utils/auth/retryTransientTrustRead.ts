import { isTransientTrustStoreError } from "./trustStore";

const RETRY_DELAYS_MS = [1_000, 2_000] as const;

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Trust verification cancelled", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Trust verification cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Read-only verification only: never replay consent or an uncertain write. */
export async function retryTransientTrustRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
  assertCurrent: (attempt: number) => void,
): Promise<T> {
  const assertActive = (attempt: number) => {
    if (signal.aborted)
      throw new DOMException("Trust verification cancelled", "AbortError");
    assertCurrent(attempt);
  };
  for (let attempt = 0; ; attempt += 1) {
    assertActive(attempt);
    try {
      const result = await read();
      assertActive(attempt);
      return result;
    } catch (error) {
      assertActive(attempt);
      if (
        !isTransientTrustStoreError(error) ||
        attempt >= RETRY_DELAYS_MS.length
      )
        throw error;
      assertActive(attempt + 1);
      await waitForRetry(RETRY_DELAYS_MS[attempt], signal);
      assertActive(attempt + 1);
    }
  }
}
