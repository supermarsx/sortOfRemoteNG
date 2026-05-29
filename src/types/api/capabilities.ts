/**
 * REST API capability catalog (TypeScript mirror of
 * `src-tauri/src/api_capability.rs`).
 *
 * The catalog itself is loaded at runtime from the
 * `get_api_capabilities` Tauri command — Rust is the source of truth.
 * The types below describe the shape of what comes back.
 *
 * ## Semantics
 *
 * - The user-facing knob lives in `settings.restApi.disabledCapabilities`
 *   as a list of kebab-case IDs. An empty list means everything is on.
 * - {@link ApiCapability.mandatory} capabilities cannot be disabled —
 *   the UI renders them as read-only rows.
 */

/** Visual grouping rendered as a `SectionHeader` in Settings → API. */
export type ApiCapabilityGroup =
  | "core-api"
  | "protocols"
  | "cloud"
  | "infrastructure"
  | "network";

/** A single enable/disable knob in Settings → API. */
export interface ApiCapability {
  /** Stable kebab-case ID. Matches what goes into `disabledCapabilities`. */
  id: string;
  /** Short human-readable label for the toggle row. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** Visual group the row is rendered under. */
  group: ApiCapabilityGroup;
  /** Path prefix matched against the request path by the Rust middleware. */
  prefix: string;
  /** All endpoints behind this prefix (cosmetic — used by the row tooltip). */
  endpoints: string[];
  /** `true` for capabilities that cannot be disabled (health, auth). */
  mandatory: boolean;
}

/** Display label for a capability group. Kept on the frontend because
 *  the Rust catalog has no notion of display strings — it only knows the
 *  kebab-case discriminant. */
export const CAPABILITY_GROUP_LABELS: Record<ApiCapabilityGroup, string> = {
  "core-api": "Core API",
  protocols: "Protocols",
  cloud: "Cloud providers",
  infrastructure: "Infrastructure",
  network: "Network utilities",
};

/** Short blurb shown under each group's section header. */
export const CAPABILITY_GROUP_DESCRIPTIONS: Record<ApiCapabilityGroup, string> =
  {
    "core-api":
      "Health and authentication. Always on — required for the rest of the API to function.",
    protocols:
      "Interactive remote-session protocols (SSH, FTP, database, RustDesk).",
    cloud: "Cloud provider integrations (AWS, Vercel, Cloudflare).",
    infrastructure:
      "Remote management and automation tooling (WMI, RPC, MeshCentral, Agent, Commander).",
    network:
      "Diagnostics and one-shot utilities (ping, security tokens, QR codes, Wake-on-LAN).",
  };

/**
 * Stable order in which capability groups appear in the UI.
 * Matches the order capabilities are declared in the Rust catalog.
 */
export const CAPABILITY_GROUP_ORDER: ApiCapabilityGroup[] = [
  "core-api",
  "protocols",
  "cloud",
  "infrastructure",
  "network",
];

/**
 * Decide whether a capability is currently enabled given the user's
 * disabled-list. Mandatory capabilities are always considered enabled —
 * even if their ID accidentally ended up in `disabledCapabilities` (e.g.
 * via direct settings.json edit), the middleware ignores those entries.
 */
export function isCapabilityEnabled(
  cap: ApiCapability,
  disabledCapabilities: readonly string[] | undefined,
): boolean {
  if (cap.mandatory) return true;
  if (!disabledCapabilities || disabledCapabilities.length === 0) return true;
  return !disabledCapabilities.includes(cap.id);
}

/**
 * Count of non-mandatory capabilities currently disabled. Mandatory IDs
 * accidentally present in the list are not counted (they're ignored at
 * runtime).
 */
export function countDisabledCapabilities(
  catalog: readonly ApiCapability[],
  disabledCapabilities: readonly string[] | undefined,
): number {
  if (!disabledCapabilities || disabledCapabilities.length === 0) return 0;
  return catalog.filter(
    (c) => !c.mandatory && disabledCapabilities.includes(c.id),
  ).length;
}
