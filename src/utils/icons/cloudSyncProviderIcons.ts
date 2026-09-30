import {
  Cloud,
  CloudOff,
  Server,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { googledrive, nextcloud } from "./brand/generatedBrandIcons";
import type { CloudSyncProvider } from "../../types/settings/cloudSyncSettings";

/** Existing theme-aware SVG marks; never platform-dependent emoji. */
export const CLOUD_SYNC_PROVIDER_ICONS: Record<CloudSyncProvider, LucideIcon> =
  {
    none: CloudOff,
    googleDrive: googledrive,
    oneDrive: Cloud,
    nextcloud,
    webdav: Server,
    sftp: Terminal,
  };
