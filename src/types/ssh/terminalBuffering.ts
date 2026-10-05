/** Global native replay-history policy, independent of xterm scrollback lines. */
export interface TerminalBufferingSettings {
  mode: "adaptive" | "fixed";
  minMiB: number;
  maxMiB: number;
  fixedMiB: number;
  totalMiB: number;
}

export const defaultTerminalBufferingSettings: TerminalBufferingSettings = {
  mode: "adaptive",
  minMiB: 1,
  maxMiB: 100,
  fixedMiB: 50,
  totalMiB: 256,
};

const boundedMiB = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.trunc(value)))
    : fallback;

/**
 * Accept old, partial, or malformed persisted settings without numeric coercion.
 * Limits are whole MiB; an inverted adaptive range keeps its upper ceiling.
 * These are retention targets, not memory reservations. Runtime pressure and the
 * shared budget may reduce retention below a per-session target or minimum.
 */
export function normalizeTerminalBufferingSettings(
  value?: unknown,
): TerminalBufferingSettings {
  const input =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const defaults = defaultTerminalBufferingSettings;
  const minMiB = boundedMiB(input.minMiB, defaults.minMiB, 1, 100);
  const maxMiB = boundedMiB(input.maxMiB, defaults.maxMiB, 1, 100);

  return {
    mode: input.mode === "fixed" ? "fixed" : "adaptive",
    minMiB: Math.min(minMiB, maxMiB),
    maxMiB,
    fixedMiB: boundedMiB(input.fixedMiB, defaults.fixedMiB, 1, 100),
    totalMiB: boundedMiB(input.totalMiB, defaults.totalMiB, 16, 1024),
  };
}
