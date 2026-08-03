import type { ManagedScript } from "../../components/recording/ScriptManager";
import {
  AppDataJsonStore,
  containsLikelySecretText,
  type SanitizedValue,
} from "../storage/appDataJsonStore";

export interface PersistedManagedScripts {
  customScripts: ManagedScript[];
  modifiedDefaults: ManagedScript[];
  deletedDefaultIds: string[];
}

const isManagedScript = (value: unknown): value is ManagedScript => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.script === "string" &&
    typeof record.language === "string" &&
    typeof record.category === "string"
  );
};

const sanitizeScriptArray = (
  value: unknown,
  label: string,
): SanitizedValue<ManagedScript[]> => {
  if (!Array.isArray(value)) {
    throw new Error(
      `Stored managed scripts are corrupted: ${label} is not an array`,
    );
  }
  const scripts: ManagedScript[] = [];
  let changed = false;
  for (const script of value) {
    if (!isManagedScript(script)) {
      throw new Error(
        `Stored managed scripts are corrupted: invalid ${label} entry`,
      );
    }
    if (containsLikelySecretText(script.script)) {
      changed = true;
      continue;
    }
    scripts.push(script);
  }
  return { value: scripts, changed };
};

const sanitizeManagedScripts = (
  value: unknown,
): SanitizedValue<PersistedManagedScripts> => {
  if (Array.isArray(value)) {
    const customScripts = sanitizeScriptArray(value, "legacy script list");
    return {
      value: {
        customScripts: customScripts.value,
        modifiedDefaults: [],
        deletedDefaultIds: [],
      },
      changed: true,
    };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Stored managed scripts are corrupted: expected an object");
  }
  const record = value as Record<string, unknown>;
  const customScripts = sanitizeScriptArray(
    record.customScripts ?? [],
    "custom scripts",
  );
  const modifiedDefaults = sanitizeScriptArray(
    record.modifiedDefaults ?? [],
    "modified defaults",
  );
  const rawDeletedDefaultIds = record.deletedDefaultIds ?? [];
  if (!Array.isArray(rawDeletedDefaultIds)) {
    throw new Error(
      "Stored managed scripts are corrupted: deleted default ids are invalid",
    );
  }
  if (
    !rawDeletedDefaultIds.every(
      (id: unknown): id is string => typeof id === "string",
    )
  ) {
    throw new Error(
      "Stored managed scripts are corrupted: deleted default ids are invalid",
    );
  }
  const deletedDefaultIds = rawDeletedDefaultIds as string[];
  return {
    value: {
      customScripts: customScripts.value,
      modifiedDefaults: modifiedDefaults.value,
      deletedDefaultIds: [...deletedDefaultIds],
    },
    changed:
      customScripts.changed ||
      modifiedDefaults.changed ||
      !("customScripts" in record) ||
      !("modifiedDefaults" in record) ||
      !("deletedDefaultIds" in record),
  };
};

export const managedScriptsStore =
  new AppDataJsonStore<PersistedManagedScripts>({
    key: "recording.managed-scripts",
    legacyLocalStorageKey: "managedScripts",
    sanitize: sanitizeManagedScripts,
  });

export const assertManagedScriptsAreSecretFree = (
  scripts: ManagedScript[],
): void => {
  const unsafe = scripts.find((script) =>
    containsLikelySecretText(script.script),
  );
  if (unsafe) {
    throw new Error(
      `Script "${unsafe.name}" appears to contain a password, private key, token, or other literal credential and was not persisted`,
    );
  }
};

export const resolveManagedScripts = (
  defaults: ManagedScript[],
  persisted: PersistedManagedScripts | null,
): ManagedScript[] => {
  if (!persisted) return defaults;
  const activeDefaults = defaults
    .filter((script) => !persisted.deletedDefaultIds.includes(script.id))
    .map(
      (script) =>
        persisted.modifiedDefaults.find(
          (modified) => modified.id === script.id,
        ) ?? script,
    );
  return [...activeDefaults, ...persisted.customScripts];
};

export const buildManagedScriptsSnapshot = (
  scripts: ManagedScript[],
  defaults: ManagedScript[],
): PersistedManagedScripts => {
  assertManagedScriptsAreSecretFree(scripts);
  const defaultIds = defaults.map((script) => script.id);
  const remainingDefaultIds = scripts
    .filter((script) => script.id.startsWith("default-"))
    .map((script) => script.id);
  return {
    customScripts: scripts.filter(
      (script) => !script.id.startsWith("default-"),
    ),
    modifiedDefaults: scripts.filter((script) =>
      script.id.startsWith("default-"),
    ),
    deletedDefaultIds: defaultIds.filter(
      (id) => !remainingDefaultIds.includes(id),
    ),
  };
};
