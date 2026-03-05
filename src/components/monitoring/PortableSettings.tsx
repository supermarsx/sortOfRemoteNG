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
} from "../../types/portable";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
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
      const [s, p, c, d, u] = await Promise.all([
        invoke<PortableStatus>("plugin:portable|get_status"),
        invoke<PortablePaths>("plugin:portable|get_paths"),
        invoke<PortableConfig>("plugin:portable|get_config"),
        invoke<DriveInfo>("plugin:portable|get_drive_info"),
        invoke<Record<string, number>>("plugin:portable|get_storage_usage"),
      ]);
      setStatus(s);
      setPaths(p);
      setConfig(c);
      setDrive(d);
      setStorageUsage(u);
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
        await invoke("plugin:portable|set_config", { config: next });
        setConfig(next);
      } catch (e) {
        setError(String(e));
      }
    },
    [config],
  );

  /* ── actions ── */
  const handleValidate = useCallback(async () => {
    setLoading(true);
    try {
      const v = await invoke<PortableValidation>("plugin:portable|validate");
      setValidation(v);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMigrate = useCallback(async (target: "portable" | "installed") => {
    setLoading(true);
    setMigration(null);
    try {
      const r = await invoke<MigrationResult>("plugin:portable|migrate", { target });
      setMigration(r);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const handleCreateMarker = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("plugin:portable|create_marker");
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
      <h3 className="sor-portable-card-title">{t("portable.status", "Portable Status")}</h3>
      {status ? (
        <dl className="sor-portable-dl">
          <dt>{t("portable.mode", "Mode")}</dt>
          <dd className="sor-portable-mode-badge" data-mode={status.mode}>{status.mode}</dd>
          <dt>{t("portable.dataPath", "Data Path")}</dt>
          <dd className="sor-portable-mono">{status.dataPath}</dd>
          <dt>{t("portable.configPath", "Config Path")}</dt>
          <dd className="sor-portable-mono">{status.configPath}</dd>
          <dt>{t("portable.writable", "Writable")}</dt>
          <dd>{status.isWritable ? "✓" : "✗"}</dd>
        </dl>
      ) : (
        <p className="sor-portable-muted">{t("portable.loading", "Loading…")}</p>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Drive Info                                                      */
  /* ================================================================ */
  const renderDriveInfo = () => {
    if (!drive) return null;
    const usedBytes = drive.totalBytes - drive.freeBytes;
    const usedPct = pct(usedBytes, drive.totalBytes);
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">{t("portable.driveInfo", "Drive Info")}</h3>
        <dl className="sor-portable-dl">
          <dt>{t("portable.driveLabel", "Label")}</dt>
          <dd>{drive.label || "—"}</dd>
          <dt>{t("portable.driveLetter", "Drive")}</dt>
          <dd>{drive.driveLetter}</dd>
          <dt>{t("portable.driveType", "Type")}</dt>
          <dd>{drive.driveType}</dd>
          <dt>{t("portable.fileSystem", "File System")}</dt>
          <dd>{drive.fileSystem}</dd>
        </dl>
        <div className="sor-portable-space">
          <div className="sor-portable-space-bar">
            <div className="sor-portable-space-used" style={{ width: `${usedPct}%` }} />
          </div>
          <span className="sor-portable-space-label">
            {formatBytes(usedBytes)} / {formatBytes(drive.totalBytes)} ({usedPct}%)
          </span>
        </div>
      </section>
    );
  };

  /* ================================================================ */
  /*  Paths Table                                                     */
  /* ================================================================ */
  const PATH_KEYS: (keyof PortablePaths)[] = [
    "data", "config", "cache", "logs", "extensions", "backups", "recordings", "temp",
  ];

  const renderPaths = () => {
    if (!paths) return null;
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">{t("portable.paths", "Paths")}</h3>
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
                <td className="sor-portable-path-label">{t(`portable.path.${k}`, k)}</td>
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
        <h3 className="sor-portable-card-title">{t("portable.configuration", "Configuration")}</h3>
        <div className="sor-portable-toggles">
          {([
            ["autoDetect", t("portable.autoDetect", "Auto-detect portable media")],
            ["preferPortable", t("portable.preferPortable", "Prefer portable paths")],
            ["syncOnEject", t("portable.syncOnEject", "Sync data before eject")],
            ["compactOnExit", t("portable.compactOnExit", "Compact database on exit")],
            ["encryptPortableData", t("portable.encrypt", "Encrypt portable data")],
            ["cleanTempOnExit", t("portable.cleanTemp", "Clean temp on exit")],
          ] as [keyof PortableConfig, string][]).map(([key, label]) => (
            <label key={key} className="sor-portable-toggle-row">
              <input type="checkbox" checked={!!config[key]} onChange={toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="sor-portable-sliders">
          <label className="sor-portable-slider-row">
            <span>{t("portable.maxCache", "Max cache size (MB)")}</span>
            <input
              type="range" min={50} max={2048} step={50}
              value={config.maxCacheSizeMb}
              onChange={(e) => updateConfig({ maxCacheSizeMb: Number(e.target.value) })}
            />
            <span className="sor-portable-slider-value">{config.maxCacheSizeMb}</span>
          </label>
          <label className="sor-portable-slider-row">
            <span>{t("portable.maxLog", "Max log size (MB)")}</span>
            <input
              type="range" min={10} max={512} step={10}
              value={config.maxLogSizeMb}
              onChange={(e) => updateConfig({ maxLogSizeMb: Number(e.target.value) })}
            />
            <span className="sor-portable-slider-value">{config.maxLogSizeMb}</span>
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
      <h3 className="sor-portable-card-title">{t("portable.actions", "Actions")}</h3>
      <div className="sor-portable-actions">
        <button className="sor-portable-btn sor-portable-btn--primary" disabled={loading} onClick={handleValidate}>
          {t("portable.validate", "Validate Portable Setup")}
        </button>
        <button className="sor-portable-btn" disabled={loading} onClick={() => handleMigrate("portable")}>
          {t("portable.migrateToPortable", "Migrate to Portable")}
        </button>
        <button className="sor-portable-btn" disabled={loading} onClick={() => handleMigrate("installed")}>
          {t("portable.migrateToInstalled", "Migrate to Installed")}
        </button>
        <button className="sor-portable-btn" disabled={loading} onClick={handleCreateMarker}>
          {t("portable.createMarker", "Create Portable Marker")}
        </button>
      </div>

      {validation && (
        <div className="sor-portable-validation">
          <h4>{t("portable.validationResults", "Validation Results")}</h4>
          <ul className="sor-portable-validation-list">
            <li data-ok={validation.markerFound}>{t("portable.markerFound", "Marker found")}: {validation.markerFound ? "✓" : "✗"}</li>
            <li data-ok={validation.dataIntegrity}>{t("portable.dataIntegrity", "Data integrity")}: {validation.dataIntegrity ? "✓" : "✗"}</li>
            <li data-ok={validation.writablePermissions}>{t("portable.permissions", "Permissions")}: {validation.writablePermissions ? "✓" : "✗"}</li>
            <li data-ok={validation.sufficientSpace}>{t("portable.space", "Space")}: {validation.sufficientSpace ? "✓" : "✗"}</li>
          </ul>
          {validation.issues.length > 0 && (
            <ul className="sor-portable-issues">
              {validation.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {migration && (
        <div className="sor-portable-migration">
          <h4>{migration.success ? t("portable.migrationSuccess", "Migration Succeeded") : t("portable.migrationFailed", "Migration Failed")}</h4>
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
              {migration.errors.map((e, i) => <li key={i} className="sor-portable-error">{e}</li>)}
            </ul>
          )}
          {migration.warnings.length > 0 && (
            <ul className="sor-portable-issues">
              {migration.warnings.map((w, i) => <li key={i} className="sor-portable-warning">{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Storage Usage Visualization                                     */
  /* ================================================================ */
  const STORAGE_KEYS = ["data", "config", "cache", "logs", "extensions"] as const;

  const renderStorageUsage = () => {
    const max = Math.max(...STORAGE_KEYS.map((k) => storageUsage[k] ?? 0), 1);
    return (
      <section className="sor-portable-card">
        <h3 className="sor-portable-card-title">{t("portable.storageUsage", "Storage Usage")}</h3>
        <div className="sor-portable-bar-chart">
          {STORAGE_KEYS.map((k) => {
            const val = storageUsage[k] ?? 0;
            const w = pct(val, max);
            return (
              <div key={k} className="sor-portable-bar-row">
                <span className="sor-portable-bar-label">{t(`portable.path.${k}`, k)}</span>
                <div className="sor-portable-bar-track">
                  <div className="sor-portable-bar-fill" data-key={k} style={{ width: `${w}%` }} />
                </div>
                <span className="sor-portable-bar-value">{formatBytes(val)}</span>
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
      <h2 className="sor-portable-heading">{t("portable.title", "Portable Mode Settings")}</h2>

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
