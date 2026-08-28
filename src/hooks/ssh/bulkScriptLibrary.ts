import type { SavedBulkScript } from "../../data/defaultBulkScripts";
import {
  AppDataJsonStore,
  containsLikelySecretText,
  type SanitizedValue,
} from "../../utils/storage/appDataJsonStore";

export type BulkScriptType =
  | "shell"
  | "system"
  | "network"
  | "package"
  | "service"
  | "filesystem"
  | "security"
  | "cisco-ios"
  | "hpe"
  | "arista"
  | "android";

export type BulkScriptRisk = "standard" | "destructive";

export interface BulkScript extends SavedBulkScript {
  type: BulkScriptType;
  risk: BulkScriptRisk;
  deletedAt?: string;
}

export type BulkScriptRunConfirmation = "destructive-only" | "always" | "never";

export type BulkScriptDeleteConfirmation =
  "permanent-only" | "always" | "never";

export interface BulkScriptLibraryConfig {
  runConfirmation: BulkScriptRunConfirmation;
  deleteConfirmation: BulkScriptDeleteConfirmation;
}

export interface BulkScriptLibrarySnapshot {
  version: 2;
  active: BulkScript[];
  trash: BulkScript[];
  config: BulkScriptLibraryConfig;
}

export const DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG: BulkScriptLibraryConfig = {
  runConfirmation: "destructive-only",
  deleteConfirmation: "permanent-only",
};

export const BULK_SCRIPT_TYPE_OPTIONS: ReadonlyArray<{
  value: BulkScriptType;
  label: string;
}> = [
  { value: "shell", label: "Shell" },
  { value: "system", label: "System" },
  { value: "network", label: "Network" },
  { value: "package", label: "Packages" },
  { value: "service", label: "Services" },
  { value: "filesystem", label: "Files" },
  { value: "security", label: "Security" },
  { value: "cisco-ios", label: "Cisco IOS" },
  { value: "hpe", label: "HPE" },
  { value: "arista", label: "Arista" },
  { value: "android", label: "Android" },
];

const SCRIPT_TYPES = new Set<BulkScriptType>(
  BULK_SCRIPT_TYPE_OPTIONS.map((option) => option.value),
);
const RUN_CONFIRMATIONS = new Set<BulkScriptRunConfirmation>([
  "destructive-only",
  "always",
  "never",
]);
const DELETE_CONFIRMATIONS = new Set<BulkScriptDeleteConfirmation>([
  "permanent-only",
  "always",
  "never",
]);
const ISO_EPOCH = new Date(0).toISOString();
export const MAX_BULK_SCRIPT_BYTES = 256 * 1024;
export const MAX_BULK_SCRIPT_NAME_LENGTH = 200;
export const MAX_BULK_SCRIPT_DESCRIPTION_LENGTH = 2_000;
export const MAX_BULK_SCRIPT_CATEGORY_LENGTH = 100;

const destructivePatterns = [
  /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*[rf][^\s]*\s+|--recursive\b|--force\b)/im,
  /(?:^|[;&|]\s*)(?:mkfs(?:\.[a-z0-9]+)?|wipefs|fdisk|parted)\b/im,
  /(?:^|[;&|]\s*)dd\b[^\n]*\bof=\/dev\//im,
  /(?:^|[;&|]\s*)(?:shutdown|reboot|poweroff|halt)\b/im,
  // Reboot-class commands still count when the verb sits behind a privilege
  // prefix (`sudo reboot`), a shell keyword (`...; then sudo shutdown -r now`),
  // or a network-CLI comment marker in a template that ships disabled.
  /(?:^|\n|[;&|]|\bthen\b|\belse\b|\bdo\b)\s*(?:[!#]\s*)?(?:(?:sudo|doas)(?:\s+-\S+)*\s+)?(?:(?:reboot|poweroff|halt)\b|shutdown\s+-[rhH]\b)/im,
  /(?:^|[;&|]\s*)systemctl\s+(?:stop|restart|disable|mask)\b/im,
  /(?:^|[;&|]\s*)(?:apt(?:-get)?|dnf|yum|pacman|zypper)\s+[^\n]*(?:remove|purge|autoremove|erase|-R\b)/im,
  /(?:^|[;&|]\s*)(?:userdel|groupdel|deluser|delgroup)\b/im,
  /(?:^|[;&|]\s*)(?:iptables|ip6tables)\s+(?:-[FX]|--flush|--delete-chain)\b/im,
  /(?:^|[;&|]\s*)ufw\s+(?:reset|delete|disable)\b/im,
  /(?:^|[;&|]\s*)(?:truncate|shred)\b/im,
  /(?:^|[;&|]\s*)(?:kill\s+-9|pkill|killall)\b/im,
  /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
  /(?:^|\n)\s*[!#]?\s*(?:configure\s+terminal|conf\s+t|system-view)\s*$/im,
  /(?:^|\n)\s*[!#]?\s*(?:write\s+memory|wr\s+mem|copy\s+running-config\s+startup-config|save(?:\s+(?:force|safely))?|commit(?:\s+confirmed)?)\s*$/im,
  /(?:^|\n)\s*[!#]?\s*(?:erase\s+startup-config|reset\s+saved-configuration|reload)\b/im,
  // Network-CLI `clear` commands mutate live switch state (forwarding tables,
  // counters) without entering configuration mode, so nothing else here would
  // catch them and they must not be grouped with the read-only `show` scripts.
  /(?:^|\n)\s*[!#]?\s*clear\s+(?:mac\s+address-table|counters|arp|logging|ip\s+route|ip\s+bgp)\b/im,
  // Network-CLI `copy` between a config and a file writes flash or rewrites the
  // running configuration. Only the running-config -> startup-config form was
  // matched above; snapshot and restore against flash: are equally mutating.
  /(?:^|\n)\s*[!#]?\s*copy\s+[^\n]*\b(?:running-config|startup-config|flash:|bootflash:)/im,
  /\b(?:adb\s+shell\s+)?(?:pm|cmd\s+package)\s+(?:uninstall|disable-user|clear|trim-caches)\b/im,
  /\badb\s+shell\s+(?:rm|reboot\s+(?:bootloader|recovery))\b/im,
  /\bfastboot\s+(?:erase|wipe|delete|format)\b/im,
  /(?:^|[;&|]\s*)(?:pkg|apt(?:-get)?|dnf|yum|pacman|zypper|apk)\s+(?:install|upgrade|update|dist-upgrade|full-upgrade)\b/im,
  /(?:^|[;&|]\s*)brew\s+(?:install|uninstall|remove|update|upgrade|cleanup)\b/im,
  /(?:^|[;&|]\s*)(?:choco|chocolatey|winget)\s+(?:install|uninstall|remove|update|upgrade)\b/im,
  /\b(?:Restart-Computer|Restart-Service|Restart-NetAdapter|Disable-NetAdapter|Enable-NetAdapter|Stop-Service|Remove-AppxPackage|Remove-AppxProvisionedPackage|Remove-Item|Uninstall-Package|Disable-WindowsOptionalFeature|Set-ItemProperty)\b/i,
];

export const isDestructiveBulkScript = (script: string): boolean =>
  destructivePatterns.some((pattern) => pattern.test(script));

export const inferBulkScriptType = (
  category: string,
  script: string,
): BulkScriptType => {
  const normalizedCategory = category.trim().toLowerCase();
  if (/cisco|ios(?:-xe)?/.test(normalizedCategory)) return "cisco-ios";
  if (/\bhpe?\b|hewlett|aruba|procurve|comware/.test(normalizedCategory)) {
    return "hpe";
  }
  if (/arista|\beos\b/.test(normalizedCategory)) return "arista";
  if (/android|\badb\b|fastboot/.test(normalizedCategory)) return "android";
  if (/security|firewall|access|auth/.test(normalizedCategory))
    return "security";
  if (/network|dns|route|connect/.test(normalizedCategory)) return "network";
  if (/package|software|update/.test(normalizedCategory)) return "package";
  if (/service|daemon/.test(normalizedCategory)) return "service";
  if (/file|disk|storage|backup/.test(normalizedCategory)) return "filesystem";
  if (/system|process|resource/.test(normalizedCategory)) return "system";

  if (/\b(?:adb|fastboot|getprop|dumpsys|logcat)\b/i.test(script)) {
    return "android";
  }
  if (
    /\b(?:display\s+current-configuration|system-view|save\s+force)\b/i.test(
      script,
    )
  ) {
    return "hpe";
  }
  if (
    /\b(?:configure\s+terminal|show\s+running-config|write\s+memory)\b/i.test(
      script,
    )
  ) {
    return "cisco-ios";
  }
  if (/\b(?:iptables|ip6tables|ufw|firewall-cmd|sudoers)\b/i.test(script)) {
    return "security";
  }
  if (
    /\b(?:ip|ss|netstat|ping|traceroute|dig|nslookup|curl|wget)\b/i.test(script)
  ) {
    return "network";
  }
  if (/\b(?:apt|apt-get|dnf|yum|pacman|zypper|apk)\b/i.test(script)) {
    return "package";
  }
  if (/\b(?:systemctl|service|journalctl)\b/i.test(script)) return "service";
  if (
    /\b(?:df|du|lsblk|mount|umount|find|rsync|tar|rm|cp|mv)\b/i.test(script)
  ) {
    return "filesystem";
  }
  if (/\b(?:uname|uptime|free|vmstat|ps|top|hostnamectl)\b/i.test(script)) {
    return "system";
  }
  return "shell";
};

export const decorateBulkScript = (script: SavedBulkScript): BulkScript => ({
  ...script,
  type: inferBulkScriptType(script.category, script.script),
  risk: isDestructiveBulkScript(script.script) ? "destructive" : "standard",
});

const normalizeIsoDate = (value: unknown): string => {
  if (typeof value !== "string") return ISO_EPOCH;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : ISO_EPOCH;
};

const hasOnlyScriptKeys = (record: Record<string, unknown>): boolean => {
  const allowed = new Set([
    "id",
    "name",
    "description",
    "script",
    "category",
    "createdAt",
    "updatedAt",
    "type",
    "risk",
    "deletedAt",
  ]);
  return Object.keys(record).every((key) => allowed.has(key));
};

const sanitizeScriptArray = (
  value: unknown,
  location: "active" | "trash",
  seenIds: Set<string>,
): SanitizedValue<BulkScript[]> => {
  if (!Array.isArray(value)) return { value: [], changed: true };

  let changed = false;
  const scripts: BulkScript[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      changed = true;
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const script =
      typeof record.script === "string" ? record.script.trim() : "";
    const category =
      typeof record.category === "string" ? record.category.trim() : "Custom";

    if (
      !id ||
      id.startsWith("default-") ||
      id.length > MAX_BULK_SCRIPT_NAME_LENGTH ||
      seenIds.has(id) ||
      !name ||
      name.length > MAX_BULK_SCRIPT_NAME_LENGTH ||
      description.length > MAX_BULK_SCRIPT_DESCRIPTION_LENGTH ||
      !script ||
      new TextEncoder().encode(script).length > MAX_BULK_SCRIPT_BYTES ||
      !category ||
      category.length > MAX_BULK_SCRIPT_CATEGORY_LENGTH ||
      containsLikelySecretText(script) ||
      containsLikelySecretText(name) ||
      containsLikelySecretText(description) ||
      containsLikelySecretText(category)
    ) {
      changed = true;
      continue;
    }

    const inferredType = inferBulkScriptType(category, script);
    const inferredRisk = isDestructiveBulkScript(script)
      ? "destructive"
      : "standard";
    const type = SCRIPT_TYPES.has(record.type as BulkScriptType)
      ? (record.type as BulkScriptType)
      : inferredType;
    // A persisted "standard" label may never override destructive content.
    const risk =
      record.risk === "destructive" || inferredRisk === "destructive"
        ? "destructive"
        : "standard";
    const createdAt = normalizeIsoDate(record.createdAt);
    const updatedAt = normalizeIsoDate(record.updatedAt);
    const deletedAt =
      location === "trash" ? normalizeIsoDate(record.deletedAt) : undefined;
    const normalized: BulkScript = {
      id,
      name,
      description,
      script,
      category,
      createdAt,
      updatedAt,
      type,
      risk,
      ...(deletedAt ? { deletedAt } : {}),
    };

    const sourceComparable = {
      id: record.id,
      name: record.name,
      description: record.description,
      script: record.script,
      category: record.category,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      type: record.type,
      risk: record.risk,
      ...(location === "trash" ? { deletedAt: record.deletedAt } : {}),
    };
    if (
      !hasOnlyScriptKeys(record) ||
      JSON.stringify(sourceComparable) !== JSON.stringify(normalized)
    ) {
      changed = true;
    }
    seenIds.add(id);
    scripts.push(normalized);
  }
  return { value: scripts, changed };
};

const sanitizeConfig = (
  value: unknown,
): SanitizedValue<BulkScriptLibraryConfig> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: { ...DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG }, changed: true };
  }
  const record = value as Record<string, unknown>;
  const runConfirmation = RUN_CONFIRMATIONS.has(
    record.runConfirmation as BulkScriptRunConfirmation,
  )
    ? (record.runConfirmation as BulkScriptRunConfirmation)
    : DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG.runConfirmation;
  const deleteConfirmation = DELETE_CONFIRMATIONS.has(
    record.deleteConfirmation as BulkScriptDeleteConfirmation,
  )
    ? (record.deleteConfirmation as BulkScriptDeleteConfirmation)
    : DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG.deleteConfirmation;
  return {
    value: { runConfirmation, deleteConfirmation },
    changed:
      Object.keys(record).length !== 2 ||
      record.runConfirmation !== runConfirmation ||
      record.deleteConfirmation !== deleteConfirmation,
  };
};

export const sanitizeBulkScriptLibrary = (
  value: unknown,
): SanitizedValue<BulkScriptLibrarySnapshot> => {
  const legacy = Array.isArray(value);
  const record =
    !legacy && value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const seenIds = new Set<string>();
  const active = sanitizeScriptArray(
    legacy ? value : record?.active,
    "active",
    seenIds,
  );
  const trash = sanitizeScriptArray(
    legacy ? [] : record?.trash,
    "trash",
    seenIds,
  );
  const config = sanitizeConfig(legacy ? null : record?.config);
  const snapshot: BulkScriptLibrarySnapshot = {
    version: 2,
    active: active.value,
    trash: trash.value,
    config: config.value,
  };
  return {
    value: snapshot,
    changed:
      legacy ||
      !record ||
      record.version !== 2 ||
      Object.keys(record).some(
        (key) => !["version", "active", "trash", "config"].includes(key),
      ) ||
      active.changed ||
      trash.changed ||
      config.changed,
  };
};

export const bulkScriptsStore = new AppDataJsonStore<BulkScriptLibrarySnapshot>(
  {
    key: "ssh.bulk-scripts",
    legacyLocalStorageKey: "bulkSshScripts",
    sanitize: sanitizeBulkScriptLibrary,
  },
);

export type BulkScriptLibraryMutation = (
  current: BulkScriptLibrarySnapshot,
) => BulkScriptLibrarySnapshot;

let bulkScriptLibraryMutationQueue: Promise<void> = Promise.resolve();

/**
 * Rebase each mutation on the latest durable generation before saving it.
 * AppDataJsonStore serializes its individual reads and CAS writes; this queue
 * keeps the read-transform-save transaction atomic across hook instances in
 * the current webview so a stale React snapshot cannot overwrite a sibling
 * change.
 */
export const updateBulkScriptLibrary = (
  mutation: BulkScriptLibraryMutation,
): Promise<BulkScriptLibrarySnapshot> => {
  const operation = bulkScriptLibraryMutationQueue
    .catch(() => undefined)
    .then(async () => {
      const loaded = await bulkScriptsStore.load();
      const current = loaded.value ?? createEmptyBulkScriptLibrary();
      const next = mutation(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      const saved = await bulkScriptsStore.save(next);
      if (saved.changed) {
        throw new Error(
          "Bulk SSH script library mutation was rejected during sanitization.",
        );
      }
      return saved.value;
    });

  bulkScriptLibraryMutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
};

export const createEmptyBulkScriptLibrary = (): BulkScriptLibrarySnapshot => ({
  version: 2,
  active: [],
  trash: [],
  config: { ...DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG },
});

export const shouldConfirmBulkScriptRun = (
  policy: BulkScriptRunConfirmation,
  risk: BulkScriptRisk,
): boolean =>
  policy === "always" ||
  (policy === "destructive-only" && risk === "destructive");

export const shouldConfirmBulkScriptDelete = (
  policy: BulkScriptDeleteConfirmation,
  permanent: boolean,
): boolean => policy === "always" || (policy === "permanent-only" && permanent);
