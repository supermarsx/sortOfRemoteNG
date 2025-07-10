export function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): { promise: Promise<T>; timer: ReturnType<typeof setTimeout> } {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error('Operation timed out'));
    }, timeoutMs);
  });

  const raced = Promise.race([promise, timeoutPromise]) as Promise<T>;
  raced.finally(() => clearTimeout(timer));
  return { promise: raced, timer };
}
