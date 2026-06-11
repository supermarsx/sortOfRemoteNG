import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type {
  PortableStatus,
  PortablePaths,
  PortableConfig,
  DriveInfo,
  MigrationResult,
  PortableValidation,
} from "../../types/settings/portable";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export const PortableSettings: React.FC = () => {
  const { t } = useTranslation();

  const [status, setStatus] = useState<PortableStatus | null>(null);
  const [paths, setPaths] = useState<PortablePaths | null>(null);
  const [config, setConfig] = useState<PortableConfig | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [validation, setValidation] = useState<PortableValidation | null>(null);
  const [migration, setMigration] = useState<MigrationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<Record<string, number>>({});

  /* ── data fetching ── */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, c, d] = await Promise.all([
        invoke<PortableStatus>("portable_get_status"),
        invoke<PortablePaths>("portable_get_paths"),
        invoke<PortableConfig>("portable_get_config"),
        invoke<DriveInfo | null>("portable_get_drive_info"),
      ]);
      setStatus(s);
      setPaths(p);
      setConfig(c);
      setDrive(d);
      setStorageUsage({
        data: s.total_size_bytes,
        config: 0,
        cache: 0,
        logs: 0,
        extensions: 0,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* ── config helpers ── */
  const updateConfig = useCallback(
    async (patch: Partial<PortableConfig>) => {
      if (!config) return;
      const next = { ...config, ...patch };
      try {
        await invoke("portable_update_config", {
          config: next,
          exeDir: paths?.base_dir ?? "",
        });
        setConfig(next);
      } catch (e) {
        setError(String(e));
      }
    },
    [config, paths?.base_dir],
  );

  /* ── actions ── */
  const handleValidate = useCallback(async () => {
    setLoading(true);
    try {
      const issues = await invoke<string[]>("portable_validate");
      setValidation({
        valid: issues.length === 0,
        markerFound: issues.length === 0,
        dataIntegrity: issues.length === 0,
        writablePermissions: issues.length === 0,
        sufficientSpace: issues.length === 0,
        issues,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMigrate = useCallback(
    async (target: "portable" | "installed") => {
      setLoading(true);
      setMigration(null);
      try {
        if (target === "portable") {
          await invoke("portable_migrate_to_portable", {
            exeDir: paths?.base_dir ?? "",
          });
        } else {
          await invoke("portable_migrate_to_installed", {
            exeDir: paths?.base_dir ?? "",
            dataDir: config?.data_directory ?? paths?.data_dir ?? "",
          });
        }
        const r: MigrationResult = {
          success: true,
          itemsMigrated: 0,
          totalSizeBytes: status?.total_size_bytes ?? 0,
          durationMs: 0,
          errors: [],
          warnings: [],
        };
        setMigration(r);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [
      config?.data_directory,
      paths?.base_dir,
      paths?.data_dir,
      refresh,
      status?.total_size_bytes,
    ],
  );

  const handleCreateMarker = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("portable_create_marker");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  /* ================================================================ */
  /*  Status Card                                                     */
  /* ================================================================ */
  const renderStatusCard = () => (
    <section className="sor-portable-card">
      <h3 className="sor-portable-card-title">
        {t("portable.status", "Portable Status")}
      </h3>
      {status ? (
        <dl className="sor-portable-dl">
          <dt>{t("portable.mode", "Mode")}</dt>
          <dd className="sor-portable-mode-badge" data-mode={status.mode}>
            {status.mode}
          </dd>
          <dt>{t("portable.dataPath", "Data Path")}</dt>
          <dd className="sor-portable-mono">{status.data_dir}</dd>
          <dt>{t("portable.files", "Files")}</dt>
          <dd>{status.file_count}</dd>
          <dt>{t("portable.removable", "Removable Drive")}</dt>
          <dd>{status.is_removable_drive ? "Yes" : "No"}</dd>
        </dl>
      ) : (
        <p className="sor-portable-muted">
          {t("portable.loading", "Loading…")}
        </p>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Drive Info                                                      */
  /* ================================================================ */
  const renderDriveInfo = () => {
    if (!drive) return null;
    const usedBytes = drive.total_bytes - drive.free_bytes;
    const usedPct = pct(usedBytes, drive.total_bytes);
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">
          {t("portable.driveInfo", "Drive Info")}
        </h3>
        <dl className="sor-portable-dl">
          <dt>{t("portable.driveLabel", "Label")}</dt>
          <dd>{drive.label || "—"}</dd>
          <dt>{t("portable.driveType", "Type")}</dt>
          <dd>{drive.is_removable ? "removable" : "fixed"}</dd>
          <dt>{t("portable.fileSystem", "File System")}</dt>
          <dd>{drive.filesystem_type}</dd>
        </dl>
        <div className="sor-portable-space">
          <div className="sor-portable-space-bar">
            <div
              className="sor-portable-space-used"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <span className="sor-portable-space-label">
            {formatBytes(usedBytes)} / {formatBytes(drive.total_bytes)} (
            {usedPct}%)
          </span>
        </div>
      </section>
    );
  };

  /* ================================================================ */
  /*  Paths Table                                                     */
  /* ================================================================ */
  const PATH_KEYS: (keyof PortablePaths)[] = [
    "data_dir",
    "settings_dir",
    "cache_dir",
    "logs_dir",
    "extensions_dir",
    "backups_dir",
    "recordings_dir",
    "temp_dir",
  ];

  const renderPaths = () => {
    if (!paths) return null;
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">
          {t("portable.paths", "Paths")}
        </h3>
        <table className="sor-portable-table">
          <thead>
            <tr>
              <th>{t("portable.pathLabel", "Label")}</th>
              <th>{t("portable.pathValue", "Path")}</th>
            </tr>
          </thead>
          <tbody>
            {PATH_KEYS.map((k) => (
              <tr key={k}>
                <td className="sor-portable-path-label">
                  {t(`portable.path.${k}`, k)}
                </td>
                <td className="sor-portable-mono">{paths[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  /* ================================================================ */
  /*  Configuration                                                   */
  /* ================================================================ */
  const toggle = (key: keyof PortableConfig) => () =>
    updateConfig({ [key]: !config?.[key] });

  const renderConfig = () => {
    if (!config) return null;
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">
          {t("portable.configuration", "Configuration")}
        </h3>
        <div className="sor-portable-toggles">
          {(
            [
              [
                "store_settings_alongside",
                t("portable.storeSettings", "Store settings alongside app"),
              ],
              [
                "store_recordings_alongside",
                t("portable.storeRecordings", "Store recordings alongside app"),
              ],
              [
                "store_backups_alongside",
                t("portable.storeBackups", "Store backups alongside app"),
              ],
              [
                "store_extensions_alongside",
                t("portable.storeExtensions", "Store extensions alongside app"),
              ],
            ] as [keyof PortableConfig, string][]
          ).map(([key, label]) => (
            <label key={key} className="sor-portable-toggle-row">
              <input
                type="checkbox"
                checked={!!config[key]}
                onChange={toggle(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="sor-portable-sliders">
          <label className="sor-portable-slider-row">
            <span>{t("portable.maxCache", "Max cache size (MB)")}</span>
            <input
              type="range"
              min={50}
              max={4096}
              step={50}
              value={config.max_portable_size_mb ?? 1024}
              onChange={(e) =>
                updateConfig({ max_portable_size_mb: Number(e.target.value) })
              }
            />
            <span className="sor-portable-slider-value">
              {config.max_portable_size_mb ?? 1024}
            </span>
          </label>
        </div>
      </section>
    );
  };

  /* ================================================================ */
  /*  Actions                                                         */
  /* ================================================================ */
  const renderActions = () => (
    <section className="sor-portable-card">
      <h3 className="sor-portable-card-title">
        {t("portable.actions", "Actions")}
      </h3>
      <div className="sor-portable-actions">
        <button
          className="sor-portable-btn sor-portable-btn--primary"
          disabled={loading}
          onClick={handleValidate}
        >
          {t("portable.validate", "Validate Portable Setup")}
        </button>
        <button
          className="sor-portable-btn"
          disabled={loading}
          onClick={() => handleMigrate("portable")}
        >
          {t("portable.migrateToPortable", "Migrate to Portable")}
        </button>
        <button
          className="sor-portable-btn"
          disabled={loading}
          onClick={() => handleMigrate("installed")}
        >
          {t("portable.migrateToInstalled", "Migrate to Installed")}
        </button>
        <button
          className="sor-portable-btn"
          disabled={loading}
          onClick={handleCreateMarker}
        >
          {t("portable.createMarker", "Create Portable Marker")}
        </button>
      </div>

      {validation && (
        <div className="sor-portable-validation">
          <h4>{t("portable.validationResults", "Validation Results")}</h4>
          <ul className="sor-portable-validation-list">
            <li data-ok={validation.markerFound}>
              {t("portable.markerFound", "Marker found")}:{" "}
              {validation.markerFound ? "✓" : "✗"}
            </li>
            <li data-ok={validation.dataIntegrity}>
              {t("portable.dataIntegrity", "Data integrity")}:{" "}
              {validation.dataIntegrity ? "✓" : "✗"}
            </li>
            <li data-ok={validation.writablePermissions}>
              {t("portable.permissions", "Permissions")}:{" "}
              {validation.writablePermissions ? "✓" : "✗"}
            </li>
            <li data-ok={validation.sufficientSpace}>
              {t("portable.space", "Space")}:{" "}
              {validation.sufficientSpace ? "✓" : "✗"}
            </li>
          </ul>
          {validation.issues.length > 0 && (
            <ul className="sor-portable-issues">
              {validation.issues.map((issue, i) => (
                <li key={`issue-${issue.slice(0, 50)}-${i}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {migration && (
        <div className="sor-portable-migration">
          <h4>
            {migration.success
              ? t("portable.migrationSuccess", "Migration Succeeded")
              : t("portable.migrationFailed", "Migration Failed")}
          </h4>
          <dl className="sor-portable-dl">
            <dt>{t("portable.itemsMigrated", "Items")}</dt>
            <dd>{migration.itemsMigrated}</dd>
            <dt>{t("portable.totalSize", "Size")}</dt>
            <dd>{formatBytes(migration.totalSizeBytes)}</dd>
            <dt>{t("portable.duration", "Duration")}</dt>
            <dd>{(migration.durationMs / 1000).toFixed(1)}s</dd>
          </dl>
          {migration.errors.length > 0 && (
            <ul className="sor-portable-issues">
              {migration.errors.map((e, i) => (
                <li
                  key={`err-${e.slice(0, 50)}-${i}`}
                  className="sor-portable-error"
                >
                  {e}
                </li>
              ))}
            </ul>
          )}
          {migration.warnings.length > 0 && (
            <ul className="sor-portable-issues">
              {migration.warnings.map((w, i) => (
                <li
                  key={`warn-${w.slice(0, 50)}-${i}`}
                  className="sor-portable-warning"
                >
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Storage Usage Visualization                                     */
  /* ================================================================ */
  const STORAGE_KEYS = [
    "data",
    "config",
    "cache",
    "logs",
    "extensions",
  ] as const;

  const renderStorageUsage = () => {
    const max = Math.max(...STORAGE_KEYS.map((k) => storageUsage[k] ?? 0), 1);
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">
          {t("portable.storageUsage", "Storage Usage")}
        </h3>
        <div className="sor-portable-bar-chart">
          {STORAGE_KEYS.map((k) => {
            const val = storageUsage[k] ?? 0;
            const w = pct(val, max);
            return (
              <div key={k} className="sor-portable-bar-row">
                <span className="sor-portable-bar-label">
                  {t(`portable.path.${k}`, k)}
                </span>
                <div className="sor-portable-bar-track">
                  <div
                    className="sor-portable-bar-fill"
                    data-key={k}
                    style={{ width: `${w}%` }}
                  />
                </div>
                <span className="sor-portable-bar-value">
                  {formatBytes(val)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  /* ================================================================ */
  /*  Root render                                                     */
  /* ================================================================ */
  return (
    <div className="sor-portable-panel">
      <h2 className="sor-portable-heading">
        {t("portable.title", "Portable Mode Settings")}
      </h2>

      {error && <p className="sor-portable-error-banner">{error}</p>}

      {renderStatusCard()}
      {renderDriveInfo()}
      {renderPaths()}
      {renderConfig()}
      {renderActions()}
      {renderStorageUsage()}
    </div>
  );
};

export default PortableSettings;
