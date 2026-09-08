import {
  createLucideIcon,
  FileArchive,
  FileAudio,
  FileChartColumn,
  FileClock,
  FileCode,
  FileCog,
  FileDigit,
  FileImage,
  FileJson,
  FileKey,
  FileSpreadsheet,
  FileStack,
  FileVideo,
} from "lucide-react";
import { defineIcon } from "./types";

const PdfFile = createLucideIcon("PdfFile", [
  [
    "path",
    {
      d: "M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-7-7Zm0 0v7h7",
      key: "file-outline",
    },
  ],
  [
    "path",
    {
      d: "M6 18v-5h2a1.5 1.5 0 0 1 0 3H6M11 18v-5h1a2.5 2.5 0 0 1 0 5h-1ZM16 18v-5h3M16 15.5h2",
      key: "pdf-vector-letters",
    },
  ],
]);
const CsvFile = createLucideIcon("CsvFile", [
  [
    "path",
    {
      d: "M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-7-7Zm0 0v7h7",
      key: "file-outline",
    },
  ],
  [
    "path",
    {
      d: "M6 12h3M12 12h3M18 12h.01M6 16h3M12 16h3M18 16h.01M10 13l-1 2M16 13l-1 2M10 17l-1 2M16 17l-1 2",
      key: "comma-separated-rows",
    },
  ],
]);
const DatabaseFile = createLucideIcon("DatabaseFile", [
  [
    "path",
    {
      d: "M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-7-7Zm0 0v7h7",
      key: "file-outline",
    },
  ],
  ["ellipse", { cx: "12", cy: "12", rx: "5", ry: "2", key: "database-top" }],
  [
    "path",
    {
      d: "M7 12v6c0 1.1 2.2 2 5 2s5-.9 5-2v-6M7 15c0 1.1 2.2 2 5 2s5-.9 5-2",
      key: "database-records",
    },
  ],
]);

/** Generic document formats: vector symbols, not office-suite vendor marks. */
export const FILE_TYPE_ICONS = [
  defineIcon("file-pdf", "PDF file", "files", PdfFile, [
    "file pdf",
    "pdf",
    "portable document",
    "document",
  ]),
  defineIcon("file-image", "Image file", "files", FileImage, [
    "file image",
    "image",
    "images",
    "photo",
    "picture",
    "png",
    "jpg",
    "jpeg",
    "svg",
    "multimedia",
  ]),
  defineIcon("file-audio", "Audio file", "files", FileAudio, [
    "file audio",
    "audio",
    "music",
    "sound",
    "mp3",
    "wav",
    "flac",
    "multimedia",
  ]),
  defineIcon("file-video", "Video file", "files", FileVideo, [
    "file video",
    "video",
    "movie",
    "mp4",
    "webm",
    "mkv",
    "multimedia",
  ]),
  defineIcon("file-json", "JSON file", "files", FileJson, [
    "file json",
    "json",
    "structured data",
    "configuration",
  ]),
  defineIcon("file-xml", "XML file", "files", FileCode, [
    "file xml",
    "xml",
    "markup",
    "html",
    "structured document",
  ]),
  defineIcon("file-csv", "CSV file", "files", CsvFile, [
    "file csv",
    "csv",
    "comma separated values",
    "tabular data",
    "export",
  ]),
  defineIcon("file-spreadsheet", "Spreadsheet file", "files", FileSpreadsheet, [
    "file spreadsheet",
    "spreadsheet",
    "spreadsheets",
    "xls",
    "xlsx",
    "ods",
    "workbook",
  ]),
  defineIcon(
    "file-presentation",
    "Presentation file",
    "files",
    FileChartColumn,
    [
      "file presentation",
      "presentation",
      "slides",
      "ppt",
      "pptx",
      "odp",
      "slideshow",
    ],
  ),
  defineIcon("file-document", "Document files", "files", FileStack, [
    "file document",
    "documents",
    "doc",
    "docx",
    "odt",
    "word processing",
  ]),
  defineIcon("file-config", "Configuration file", "files", FileCog, [
    "file config",
    "config",
    "configuration",
    "ini",
    "yaml",
    "toml",
    "settings file",
  ]),
  defineIcon("file-log", "Log file", "files", FileClock, [
    "file log",
    "log",
    "logs",
    "audit",
    "events",
    "history",
  ]),
  defineIcon("file-backup", "Backup file", "files", FileArchive, [
    "file backup",
    "backup",
    "compressed file",
    "zip",
    "tar",
    "7z",
    "archive file",
  ]),
  defineIcon("file-certificate", "Certificate file", "files", FileKey, [
    "file certificate",
    "certificate",
    "pem",
    "crt",
    "pfx",
    "key file",
    "tls",
  ]),
  defineIcon("file-database", "Database file", "files", DatabaseFile, [
    "file database",
    "database file",
    "sql dump",
    "sqlite file",
    "db",
    "backup database",
  ]),
  defineIcon("file-binary", "Binary file", "files", FileDigit, [
    "file binary",
    "binary",
    "bin",
    "executable",
    "exe",
    "dll",
    "firmware",
  ]),
] as const;
