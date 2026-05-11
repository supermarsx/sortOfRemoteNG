/**
 * useDatabaseSelector — alias re-export of useCollectionSelector.
 *
 * Part of the staged collection → database rename. New call sites
 * should import this name so the legacy file can be deleted in a
 * later cleanup pass.
 */

export { useCollectionSelector as useDatabaseSelector } from "./useCollectionSelector";
export type {
  NewCollectionForm as NewDatabaseForm,
  EditPasswordForm,
} from "./useCollectionSelector";
