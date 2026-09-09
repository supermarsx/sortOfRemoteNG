import { defaultScripts } from "../../data/defaultScripts";
import { defaultScriptCatalog } from "../../data/defaultScriptCatalog";
import {
  managedScriptsStore,
  assertManagedScriptsAreSecretFree,
  type PersistedManagedScripts,
} from "./managedScriptPersistence";

/** A reviewed exact snapshot is deliberately required; never infer an empty store after a read error. */
export async function applyDefaultScriptSelection(
  ids: string[],
  expected: PersistedManagedScripts | null,
  overwrite: boolean,
) {
  const keys = [...new Set(ids)];
  if (
    !keys.length ||
    keys.some((id) => !defaultScriptCatalog.some((item) => item.id === id))
  )
    throw new Error("Select valid default scripts.");
  const reviewed = structuredClone(expected);
  const templates = keys.map((id) =>
    defaultScriptCatalog.find((item) => item.id === id)!,
  );
  const builtInIds = new Set(defaultScripts.map((item) => item.id));
  const copies = templates
    .filter((item) => !builtInIds.has(item.id))
    .map((item) => ({ ...item, id: crypto.randomUUID() }));
  assertManagedScriptsAreSecretFree(templates);
  return managedScriptsStore.update((current) => {
    if (JSON.stringify(current) !== JSON.stringify(reviewed))
      throw new Error(
        "The script library changed. Reload and review the selection again.",
      );
    const base = current ?? {
      customScripts: [],
      modifiedDefaults: [],
      deletedDefaultIds: [],
    };
    const restore = new Set(keys.filter((id) => builtInIds.has(id)));
    if (
      !overwrite &&
      base.modifiedDefaults.some((item) => restore.has(item.id))
    )
      throw new Error(
        "Review replacement of the selected modified defaults before restoring.",
      );
    return {
      customScripts: [...base.customScripts, ...copies],
      modifiedDefaults: base.modifiedDefaults.filter(
        (item) => !restore.has(item.id),
      ),
      deletedDefaultIds: base.deletedDefaultIds.filter(
        (id) => !restore.has(id),
      ),
    };
  });
}
