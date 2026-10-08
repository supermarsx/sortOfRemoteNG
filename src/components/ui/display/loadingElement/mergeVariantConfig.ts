import type { VariantConfig } from "./types";

/**
 * Merge defaults, stored settings, then per-call overrides without mutation.
 * Keep this helper separate so non-component consumers do not invalidate the
 * LoadingElement Fast Refresh boundary. The casts accommodate its config union.
 */
export function mergeVariantConfig(
  defaultConfig: VariantConfig,
  stored: VariantConfig | undefined,
  over: Partial<VariantConfig> | undefined,
): VariantConfig {
  const seed = defaultConfig as unknown as Record<string, unknown>;
  const s = (stored ?? {}) as unknown as Record<string, unknown>;
  const o = (over ?? {}) as unknown as Record<string, unknown>;
  return { ...seed, ...s, ...o } as unknown as VariantConfig;
}
