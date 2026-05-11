/**
 * databaseManager — typed alias re-export for the legacy CollectionManager.
 *
 * Part of the staged collection → database rename. Consumers should
 * gradually migrate to these names so the actual implementation file
 * can be renamed in a later cleanup pass without further churn.
 *
 * No runtime change: this module re-exports the existing singleton.
 */

export {
  CollectionManager as DatabaseManager,
} from "./collectionManager";

export { proxyCollectionManager as proxyDatabaseManager } from "./proxyCollectionManager";

import type { ConnectionCollection } from "../../types/connection/connection";

/** Alias for {@link ConnectionCollection}. Prefer this in new code. */
export type ConnectionDatabase = ConnectionCollection;

import type { StorageData } from "../storage/storage";

/** Alias for {@link StorageData}. Prefer this in new code. */
export type DatabaseStorageData = StorageData;
