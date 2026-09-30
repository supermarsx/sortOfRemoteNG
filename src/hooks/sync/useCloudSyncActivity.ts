import { useSyncExternalStore } from "react";
import {
  getCloudSyncActivity,
  getServerCloudSyncActivity,
  subscribeCloudSyncActivity,
} from "../../utils/services/cloudSyncActivity";

export function useCloudSyncActivity() {
  return useSyncExternalStore(
    subscribeCloudSyncActivity,
    getCloudSyncActivity,
    getServerCloudSyncActivity,
  );
}
