/**
 * Backward-compat re-export shim.
 *
 * The implementation moved to ./databaseManager.ts as part of the
 * collection → database rename. New imports should target that file
 * directly; this stub keeps existing consumers compiling until they're
 * migrated and will be removed in a future cleanup pass.
 */

export {
  DatabaseManager,
  DatabaseManager as CollectionManager,
} from "./databaseManager";
