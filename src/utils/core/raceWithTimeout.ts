export function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): { promise: Promise<T>; timer: ReturnType<typeof setTimeout> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error("Operation timed out"));
    }, timeoutMs);
  });

  const raced = Promise.race([promise, timeoutPromise]) as Promise<T>;
  // Handle both branches directly. Calling `finally()` without retaining its
  // returned promise creates a second rejected promise when the timeout wins,
  // which surfaces as an unhandled rejection even if callers catch `raced`.
  void raced.then(
    () => {
      if (timer) clearTimeout(timer);
    },
    () => {
      if (timer) clearTimeout(timer);
    },
  );
  return { promise: raced, timer: timer! };
}
