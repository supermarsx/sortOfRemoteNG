import { defaultScriptCatalog } from "./defaultScriptCatalog";
import { defaultBulkScripts } from "./defaultBulkScripts";
import type { SavedBulkScript } from "./bulkScriptDefinition";
import type {
  ManagedScript,
  OSTag,
} from "../components/recording/scriptManager/shared";
import { isDestructiveBulkScript } from "../hooks/ssh/bulkScriptLibrary";

export interface BundledScriptEntry {
  /** Source-qualified browse identity. Never overwrite either original ID. */
  key: string;
  source: "managed" | "bulk";
  payload: ManagedScript | SavedBulkScript;
  platforms: readonly OSTag[];
  language: ManagedScript["language"] | "terminal-input";
  context: "script" | "interactive-shell" | "device-cli";
  risk: "review" | "changes-state";
}

// Reviewed platform metadata, keyed by canonical shipped ID. These annotations
// never alter command content or infer compatibility from arbitrary user code.
const windows = new Set([
  "default-package-update-choco",
  "default-package-update-winget",
  "default-network-diagnostics-windows",
  "default-network-interface-reset-windows",
  "default-reboot-windows",
  "default-service-discovery-windows",
  "default-service-restart-windows",
  "default-windows11-debloat-audit",
  "default-windows11-remove-optional-app",
  "default-dns-diagnostics-windows",
  "default-vpn-inventory-windows",
  "default-virtualization-windows",
]);
const macos = new Set([
  "default-package-update-brew",
  "default-macos-debloat-audit",
  "default-macos-trash-app",
  "default-virtualization-macos",
]);
const linux = new Set([
  "default-package-update-linux",
  "default-postfix-queue-reset",
  "default-mail-stack-health",
  "default-fail2ban-status",
  "default-letsencrypt-audit",
  "default-proxy-config-validation",
  "default-openvpn-restart",
  "default-virtualization-linux",
]);
const posix = new Set([
  "default-1",
  "default-2",
  "default-3",
  "default-4",
  "default-5",
  "default-6",
  "default-traceroute-cloudflare-posix",
  "default-remove-tree-posix",
  "default-broken-symlinks",
  "default-duplicate-files",
  "default-empty-files",
  "default-sha256-check",
  "default-image-resize",
  "default-archive-extract",
  "default-network-diagnostics-posix",
  "default-network-interface-reset-posix",
  "default-reboot-posix",
  "default-audio-extract",
  "default-audio-search",
  "default-log-discovery-posix",
  "default-git-repository-audit",
  "default-service-discovery-posix",
  "default-service-restart-posix",
  "default-dns-diagnostics-posix",
  "default-vpn-inventory-posix",
]);
function bulkPlatforms(id: string): readonly OSTag[] {
  if (id.startsWith("default-arista-eos-")) return ["arista-eos"];
  if (id.startsWith("default-cisco-ios-")) return ["cisco-ios"];
  if (id.startsWith("default-hpe-comware-")) return ["hpe-comware"];
  if (id.startsWith("default-hpe-aruba-cx-")) return ["aruba-cx"];
  if (id.startsWith("default-android-")) return ["android"];
  if (windows.has(id)) return ["windows"];
  if (macos.has(id)) return ["macos"];
  if (linux.has(id)) return ["linux"];
  if (posix.has(id)) return ["linux", "macos"];
  // A future unannotated entry remains visible without inventing OS support.
  return [];
}
export const bundledScriptCatalog: readonly BundledScriptEntry[] = [
  ...defaultScriptCatalog.map((payload): BundledScriptEntry => ({
    key: `managed:${payload.id}`,
    source: "managed",
    payload,
    platforms: payload.osTags,
    language: payload.language,
    context: "script",
    risk: isDestructiveBulkScript(payload.script) ? "changes-state" : "review",
  })),
  ...defaultBulkScripts.map((payload): BundledScriptEntry => {
    const platforms = bulkPlatforms(payload.id);
    return {
      key: `bulk:${payload.id}`,
      source: "bulk",
      payload,
      platforms,
      // CLI command streams are not Bash programs, even when they enter a shell.
      language: "terminal-input",
      context: platforms.some((platform) =>
        ["arista-eos", "cisco-ios", "hpe-comware", "aruba-cx"].includes(
          platform,
        ),
      )
        ? "device-cli"
        : "interactive-shell",
      risk: isDestructiveBulkScript(payload.script)
        ? "changes-state"
        : "review",
    };
  }),
];
export const BUNDLED_SCRIPT_CONTEXT_LABELS = {
  script: "Script interpreter",
  "interactive-shell": "Existing terminal shell",
  "device-cli": "Network device CLI",
} as const;
