/**
 * Backward-compat re-export shim.
 *
 * The hook moved to ./useDatabaseSelector.ts as part of the collection
 * → database rename. The hook function is still exported under its
 * original name from there; this stub lets existing imports continue
 * to resolve until they're migrated and the file is removed in a
 * future cleanup pass.
 */

export {
  useCollectionSelector,
  useCollectionSelector as useDatabaseSelector,
} from "./useDatabaseSelector";
export type {
  NewCollectionForm,
  NewCollectionForm as NewDatabaseForm,
  EditPasswordForm,
} from "./useDatabaseSelector";
