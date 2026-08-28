import {
  Archive,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  Save,
  Upload,
} from "lucide-react";

import { defineIcon } from "./types";

export const FILES_ICONS = [
  defineIcon("folder", "Folder", "files", Folder, ["group", "directory"]),
  defineIcon("folder-open", "Open folder", "files", FolderOpen, [
    "directory",
    "browse",
  ]),
  defineIcon("file", "File", "files", File, ["document"]),
  defineIcon("file-text", "Text file", "files", FileText, [
    "document",
    "notes",
  ]),
  defineIcon("archive", "Archive", "files", Archive, ["backup", "compressed"]),
  defineIcon("save", "Saved data", "files", Save, ["disk", "persist"]),
  defineIcon("upload", "Upload", "files", Upload, ["transfer", "send"]),
  defineIcon("download", "Download", "files", Download, [
    "transfer",
    "receive",
  ]),
] as const;
