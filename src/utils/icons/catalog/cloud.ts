import {
  Cloud,
  CloudCog,
  CloudDownload,
  CloudLightning,
  CloudUpload,
} from "lucide-react";

import { defineIcon } from "./types";

export const CLOUD_ICONS = [
  defineIcon("cloud", "Cloud", "cloud", Cloud, ["azure", "gcp", "provider"]),
  defineIcon("cloud-cog", "Managed cloud", "cloud", CloudCog, [
    "cloud admin",
    "service",
  ]),
  defineIcon("cloud-upload", "Cloud upload", "cloud", CloudUpload, [
    "upload",
    "sync",
  ]),
  defineIcon("cloud-download", "Cloud download", "cloud", CloudDownload, [
    "download",
    "sync",
  ]),
  defineIcon("cloud-lightning", "Cloud compute", "cloud", CloudLightning, [
    "compute",
    "serverless",
  ]),
] as const;
