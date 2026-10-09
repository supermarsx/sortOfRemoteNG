/** Read-only log reader; IDs are issued by native fixed-root enumeration. */
export type ApplicationLogSource = "application" | "browser";

export interface ApplicationLogFile {
  id: string;
  name: string;
  modifiedUnixMs: number;
  sizeBytes: number;
  encrypted: boolean;
}

export interface ApplicationLogListing {
  files: ApplicationLogFile[];
  truncated: boolean;
}

export interface ApplicationLogContent {
  text: string;
  truncated: boolean;
}
