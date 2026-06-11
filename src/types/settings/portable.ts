// Portable Mode types

export type PortableMode = "installed" | "portable";

export interface PortableStatus {
  mode: PortableMode;
  data_dir: string;
  total_size_bytes: number;
  free_space_bytes: number;
  file_count: number;
  is_removable_drive: boolean;
  drive_label: string | null;
}

export interface PortablePaths {
  base_dir: string;
  data_dir: string;
  settings_dir: string;
  collections_dir: string;
  backups_dir: string;
  recordings_dir: string;
  extensions_dir: string;
  logs_dir: string;
  temp_dir: string;
  cache_dir: string;
}

export interface PortableConfig {
  mode: PortableMode;
  data_directory: string;
  relative_data_dir: string;
  portable_marker_file: string;
  store_settings_alongside: boolean;
  store_recordings_alongside: boolean;
  store_backups_alongside: boolean;
  store_extensions_alongside: boolean;
  max_portable_size_mb: number | null;
}

export interface DriveInfo {
  label: string;
  total_bytes: number;
  free_bytes: number;
  is_removable: boolean;
  filesystem_type: string;
}

export interface MigrationResult {
  success: boolean;
  itemsMigrated: number;
  totalSizeBytes: number;
  durationMs: number;
  errors: string[];
  warnings: string[];
}

export interface PortableValidation {
  valid: boolean;
  markerFound: boolean;
  dataIntegrity: boolean;
  writablePermissions: boolean;
  sufficientSpace: boolean;
  issues: string[];
}
