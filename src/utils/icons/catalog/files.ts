import {
  Archive,
  Download,
  File,
  FileText,
  ReceiptText,
  Save,
  Upload,
} from "lucide-react";

import { defineIcon } from "./types";

export const FILES_ICONS = [
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
  defineIcon("invoice", "Invoice", "files", ReceiptText, [
    "invoice",
    "invoices",
    "receipt",
    "billing",
    "bill",
    "accounting",
    "fatura",
  ]),
] as const;
