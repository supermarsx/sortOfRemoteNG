/** Legacy per-connection overrides are tri-state: undefined inherits globally. */
export const resolveConnectionRetryAttempts = (
  connectionValue: number | undefined,
  fallback: number,
): number => connectionValue ?? fallback;

export const resolveConnectionRetryDelay = (
  connectionValue: number | undefined,
  fallback: number,
): number => connectionValue ?? fallback;

export const resolveConnectionWarnOnClose = (
  connectionValue: boolean | undefined,
  fallback: boolean,
): boolean => connectionValue ?? fallback;
