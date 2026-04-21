import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../ui/forms";
import { useUpdater } from "../../hooks/updater/useUpdater";
import type {
  UpdateChannel,
  UpdateHistoryEntry,
  RollbackInfo,
  ReleaseNotes,
} from "../../types/updater/updater";

/* ------------------------------------------------------------------ */
/*  Inline SVG micro-icons                                            */
/* ------------------------------------------------------------------ */

const IconRefresh: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M13.5 2.5v4h-4" />
    <path d="M2.5 13.5v-4h4" />
    <path d="M3.2 6a5.5 5.5 0 0 1 9.3-1.5" />
    <path d="M12.8 10a5.5 5.5 0 0 1-9.3 1.5" />
  </svg>
);

const IconCheck: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
  </svg>
);

const IconX: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3 11 11M11 3 3 11" />
  </svg>
);

const IconDownload: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M3 13h10" />
  </svg>
);

const IconRollback: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M2.5 5.5h8a3 3 0 0 1 0 6h-4" />
    <path d="M5.5 2.5 2.5 5.5l3 3" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

const CHANNELS: UpdateChannel[] = ["stable", "beta", "nightly"];

const CHECK_INTERVALS = [
  { label: "1 hour", ms: 3_600_000 },
  { label: "6 hours", ms: 21_600_000 },
  { label: "12 hours", ms: 43_200_000 },
  { label: "24 hours", ms: 86_400_000 },
  { label: "Weekly", ms: 604_800_000 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export const UpdaterPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    updateInfo, progress, versionInfo, history, rollbacks, releaseNotes, config,
    checking, downloading, error,
    checkForUpdates, download, cancelDownload, install, scheduleInstall,
    setChannel, fetchVersionInfo, fetchHistory, rollback, fetchRollbacks,
    fetchReleaseNotes, updateConfig,
  } = useUpdater();

  const [activeTab, setActiveTab] = useState<"status" | "notes" | "history" | "rollback" | "settings">("status");

  useEffect(() => {
    fetchVersionInfo();
    fetchHistory();
    fetchRollbacks();
  }, [fetchVersionInfo, fetchHistory, fetchRollbacks]);

  const handleCheck = useCallback(async () => {
    const info = await checkForUpdates();
    if (info) fetchReleaseNotes(info.version);
  }, [checkForUpdates, fetchReleaseNotes]);

  /* ── status derivation ── */
  const status = progress?.status ?? (updateInfo ? "available" : "idle");
  const isReady = status === "ready";
  const isUpToDate = status === "up_to_date";
  const isError = status === "error";

  /* ================================================================ */
  /*  Version Info Card                                               */
  /* ================================================================ */
  const renderVersionCard = () => (
    <section className="sor-updater-card">
      <h3 className="sor-updater-card-title">{t("updater.versionInfo", "Version Info")}</h3>
      {versionInfo ? (
        <dl className="sor-updater-dl">
          <dt>{t("updater.version", "Version")}</dt>
          <dd>{versionInfo.currentVersion}</dd>
          <dt>{t("updater.buildDate", "Build Date")}</dt>
          <dd>{formatDate(versionInfo.buildDate)}</dd>
          <dt>{t("updater.commit", "Commit")}</dt>
          <dd className="sor-updater-mono">{versionInfo.commitHash.slice(0, 10)}</dd>
          <dt>{t("updater.tauriVersion", "Tauri")}</dt>
          <dd>{versionInfo.tauriVersion}</dd>
          <dt>{t("updater.os", "OS")}</dt>
          <dd>{versionInfo.osInfo}</dd>
          <dt>{t("updater.channel", "Channel")}</dt>
          <dd className="sor-updater-channel-badge" data-channel={versionInfo.channel}>{versionInfo.channel}</dd>
        </dl>
      ) : (
        <p className="sor-updater-muted">{t("updater.loading", "Loading…")}</p>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Update Status                                                   */
  /* ================================================================ */
  const renderUpdateStatus = () => (
    <section className="sor-updater-card">
      <h3 className="sor-updater-card-title">{t("updater.updateStatus", "Update Status")}</h3>

      {/* Check button */}
      <button className="sor-updater-btn sor-updater-btn--primary" disabled={checking || downloading} onClick={handleCheck}>
        {checking ? <span className="sor-updater-spinner" /> : <IconRefresh />}
        {checking ? t("updater.checking", "Checking…") : t("updater.checkForUpdates", "Check for Updates")}
      </button>

      {/* Error */}
      {isError && (
        <div className="sor-updater-alert sor-updater-alert--error">
          {progress?.errorMessage ?? error ?? t("updater.unknownError", "Unknown error")}
        </div>
      )}

      {/* Up to date */}
      {isUpToDate && !updateInfo && (
        <div className="sor-updater-badge sor-updater-badge--success">
          <IconCheck /> {t("updater.upToDate", "You're up to date!")}
        </div>
      )}

      {/* Update available */}
      {updateInfo && !downloading && !isReady && (
        <div className="sor-updater-available">
          <p className="sor-updater-available-version">
            {t("updater.newVersion", "New version available:")} <strong>{updateInfo.version}</strong>
          </p>
          <dl className="sor-updater-dl sor-updater-dl--compact">
            <dt>{t("updater.releaseDate", "Release Date")}</dt>
            <dd>{formatDate(updateInfo.releaseDate)}</dd>
            <dt>{t("updater.fileSize", "Size")}</dt>
            <dd>{formatBytes(updateInfo.fileSize)}</dd>
          </dl>
          <button className="sor-updater-btn sor-updater-btn--primary" onClick={download}>
            <IconDownload /> {t("updater.download", "Download Update")}
          </button>
        </div>
      )}

      {/* Download progress */}
      {downloading && progress && (
        <div className="sor-updater-progress-section">
          <div className="sor-updater-progress-bar-track">
            <div className="sor-updater-progress-bar-fill" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
          </div>
          <div className="sor-updater-progress-stats">
            <span>{progress.percent.toFixed(1)}%</span>
            <span>{formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}</span>
            <span>{formatSpeed(progress.speedBps)}</span>
            <span>ETA: {formatEta(progress.etaSeconds)}</span>
          </div>
          <button className="sor-updater-btn sor-updater-btn--danger" onClick={cancelDownload}>
            <IconX /> {t("updater.cancel", "Cancel")}
          </button>
        </div>
      )}

      {/* Ready to install */}
      {isReady && (
        <div className="sor-updater-ready">
          <p className="sor-updater-ready-text">{t("updater.readyToInstall", "Update downloaded and ready to install.")}</p>
          <div className="sor-updater-ready-actions">
            <button className="sor-updater-btn sor-updater-btn--primary" onClick={install}>
              {t("updater.installNow", "Install Now")}
            </button>
            <button className="sor-updater-btn sor-updater-btn--secondary" onClick={() => scheduleInstall(0)}>
              {t("updater.installOnExit", "Install on Exit")}
            </button>
          </div>
        </div>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Channel Selector                                                */
  /* ================================================================ */
  const renderChannelSelector = () => (
    <section className="sor-updater-card">
      <h3 className="sor-updater-card-title">{t("updater.updateChannel", "Update Channel")}</h3>
      <div className="sor-updater-channel-group" role="radiogroup" aria-label={t("updater.updateChannel", "Update Channel")}>
        {CHANNELS.map((ch) => (
          <label key={ch} className={`sor-updater-channel-option ${config?.channel === ch ? "sor-updater-channel-option--active" : ""}`}>
            <input
              type="radio"
              name="update-channel"
              value={ch}
              checked={config?.channel === ch}
              onChange={() => setChannel(ch)}
              className="sor-updater-sr-only"
            />
            <span className="sor-updater-channel-dot" data-channel={ch} />
            <span className="sor-updater-channel-label">{ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
          </label>
        ))}
      </div>
    </section>
  );

  /* ================================================================ */
  /*  Release Notes                                                   */
  /* ================================================================ */
  const renderReleaseNotes = () => {
    if (!releaseNotes) {
      return (
        <section className="sor-updater-card">
          <h3 className="sor-updater-card-title">{t("updater.releaseNotes", "Release Notes")}</h3>
          <p className="sor-updater-muted">{t("updater.noReleaseNotes", "No release notes available. Check for updates first.")}</p>
        </section>
      );
    }
    return (
      <section className="sor-updater-card">
        <h3 className="sor-updater-card-title">
          {t("updater.releaseNotes", "Release Notes")} — {releaseNotes.version}
        </h3>
        <span className="sor-updater-channel-badge" data-channel={releaseNotes.channel}>{releaseNotes.channel}</span>
        <time className="sor-updater-muted">{formatDate(releaseNotes.date)}</time>

        {/* Highlights */}
        {releaseNotes.highlights.length > 0 && (
          <div className="sor-updater-notes-block">
            <h4 className="sor-updater-notes-heading">{t("updater.highlights", "Highlights")}</h4>
            <ul className="sor-updater-notes-list">
              {releaseNotes.highlights.map((h, i) => <li key={`hl-${h.slice(0, 50)}-${i}`}>{h}</li>)}
            </ul>
          </div>
        )}

        {/* Categorized changes */}
        {releaseNotes.changes.length > 0 && (
          <div className="sor-updater-notes-block">
            <h4 className="sor-updater-notes-heading">{t("updater.changes", "Changes")}</h4>
            {Object.entries(
              releaseNotes.changes.reduce<Record<string, string[]>>((acc, c) => {
                (acc[c.category] ??= []).push(c.description);
                return acc;
              }, {}),
            ).map(([cat, descs]) => (
              <div key={cat} className="sor-updater-notes-category">
                <h5 className="sor-updater-notes-cat-label">{cat}</h5>
                <ul className="sor-updater-notes-list">
                  {descs.map((d, i) => <li key={`desc-${d.slice(0, 50)}-${i}`}>{d}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Breaking changes */}
        {releaseNotes.breakingChanges.length > 0 && (
          <div className="sor-updater-notes-block sor-updater-notes-block--warning">
            <h4 className="sor-updater-notes-heading">{t("updater.breakingChanges", "Breaking Changes")}</h4>
            <ul className="sor-updater-notes-list">
              {releaseNotes.breakingChanges.map((b, i) => <li key={`bc-${b.slice(0, 50)}-${i}`}>{b}</li>)}
            </ul>
          </div>
        )}

        {/* Known issues */}
        {releaseNotes.knownIssues.length > 0 && (
          <div className="sor-updater-notes-block sor-updater-notes-block--info">
            <h4 className="sor-updater-notes-heading">{t("updater.knownIssues", "Known Issues")}</h4>
            <ul className="sor-updater-notes-list">
              {releaseNotes.knownIssues.map((k, i) => <li key={`ki-${k.slice(0, 50)}-${i}`}>{k}</li>)}
            </ul>
          </div>
        )}
      </section>
    );
  };

  /* ================================================================ */
  /*  Update History                                                  */
  /* ================================================================ */
  const renderHistory = () => (
    <section className="sor-updater-card">
      <h3 className="sor-updater-card-title">{t("updater.updateHistory", "Update History")}</h3>
      {history.length === 0 ? (
        <p className="sor-updater-muted">{t("updater.noHistory", "No update history yet.")}</p>
      ) : (
        <div className="sor-updater-table-wrap">
          <table className="sor-updater-table">
            <thead>
              <tr>
                <th>{t("updater.version", "Version")}</th>
                <th>{t("updater.channel", "Channel")}</th>
                <th>{t("updater.date", "Date")}</th>
                <th>{t("updater.previousVersion", "Previous")}</th>
                <th>{t("updater.result", "Result")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h: UpdateHistoryEntry) => (
                <tr key={`${h.version}-${h.installedAt}`}>
                  <td className="sor-updater-mono">{h.version}</td>
                  <td><span className="sor-updater-channel-badge" data-channel={h.channel}>{h.channel}</span></td>
                  <td>{formatDate(h.installedAt)}</td>
                  <td className="sor-updater-mono">{h.previousVersion}</td>
                  <td>
                    {h.success ? (
                      <span className="sor-updater-badge sor-updater-badge--success"><IconCheck /> OK</span>
                    ) : (
                      <span className="sor-updater-badge sor-updater-badge--error"><IconX /> Fail</span>
                    )}
                  </td>
                  <td>
                    {h.rollbackAvailable && (
                      <button className="sor-updater-btn sor-updater-btn--small" onClick={() => rollback(h.previousVersion)} title={t("updater.rollbackTo", "Rollback")}>
                        <IconRollback /> {t("updater.rollback", "Rollback")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Rollback Section                                                */
  /* ================================================================ */
  const renderRollback = () => (
    <section className="sor-updater-card">
      <h3 className="sor-updater-card-title">{t("updater.rollbackVersions", "Available Rollback Versions")}</h3>
      {rollbacks.length === 0 ? (
        <p className="sor-updater-muted">{t("updater.noRollbacks", "No rollback versions available.")}</p>
      ) : (
        <ul className="sor-updater-rollback-list">
          {rollbacks.map((r: RollbackInfo) => (
            <li key={r.version} className="sor-updater-rollback-item">
              <div className="sor-updater-rollback-info">
                <span className="sor-updater-mono">{r.version}</span>
                <span className="sor-updater-muted">{formatBytes(r.fileSize)}</span>
                <span className="sor-updater-muted">{formatDate(r.backedUpAt)}</span>
              </div>
              <button
                className="sor-updater-btn sor-updater-btn--small"
                disabled={!r.canRollback}
                onClick={() => rollback(r.version)}
              >
                <IconRollback /> {t("updater.rollback", "Rollback")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ================================================================ */
  /*  Settings Section                                                */
  /* ================================================================ */
  const renderSettings = () => {
    if (!config) return <p className="sor-updater-muted">{t("updater.loading", "Loading…")}</p>;

    const toggle = (key: keyof typeof config) => {
      updateConfig({ [key]: !config[key] });
    };

    return (
      <section className="sor-updater-card">
        <h3 className="sor-updater-card-title">{t("updater.settings", "Updater Settings")}</h3>
        <div className="sor-updater-settings-grid">
          {/* Auto-check */}
          <label className="sor-updater-toggle-row">
            <input type="checkbox" checked={config.autoCheck} onChange={() => toggle("autoCheck")} />
            <span>{t("updater.autoCheck", "Automatically check for updates")}</span>
          </label>

          {/* Auto-download */}
          <label className="sor-updater-toggle-row">
            <input type="checkbox" checked={config.autoDownload} onChange={() => toggle("autoDownload")} />
            <span>{t("updater.autoDownload", "Automatically download updates")}</span>
          </label>

          {/* Auto-install */}
          <label className="sor-updater-toggle-row">
            <input type="checkbox" checked={config.autoInstall} onChange={() => toggle("autoInstall")} />
            <span>{t("updater.autoInstall", "Automatically install updates")}</span>
          </label>

          {/* Install on exit */}
          <label className="sor-updater-toggle-row">
            <input type="checkbox" checked={config.installOnExit} onChange={() => toggle("installOnExit")} />
            <span>{t("updater.installOnExitOption", "Install pending updates on app exit")}</span>
          </label>

          {/* Pre-release opt-in */}
          <label className="sor-updater-toggle-row">
            <input type="checkbox" checked={config.preReleaseOptIn} onChange={() => toggle("preReleaseOptIn")} />
            <span>{t("updater.preRelease", "Opt into pre-release updates")}</span>
          </label>

          {/* Check interval */}
          <div className="sor-updater-select-row">
            <span className="sor-updater-select-label">{t("updater.checkInterval", "Check interval")}</span>
            <Select
              value={String(config.checkIntervalMs)}
              onChange={(v) => updateConfig({ checkIntervalMs: Number(v) })}
              variant="form-sm"
              options={CHECK_INTERVALS.map((ci) => ({
                value: String(ci.ms),
                label: ci.label,
              }))}
            />
          </div>

          {/* Keep rollback count */}
          <div className="sor-updater-select-row">
            <span className="sor-updater-select-label">{t("updater.keepRollbacks", "Rollback versions to keep")}</span>
            <input
              type="number"
              className="sor-updater-input-number"
              min={0}
              max={20}
              value={config.keepRollbackCount}
              onChange={(e) => updateConfig({ keepRollbackCount: Math.max(0, Math.min(20, Number(e.target.value))) })}
            />
          </div>
        </div>
      </section>
    );
  };

  /* ================================================================ */
  /*  Main Render                                                     */
  /* ================================================================ */
  const tabs: Array<{ key: typeof activeTab; label: string }> = [
    { key: "status", label: t("updater.tabStatus", "Status") },
    { key: "notes", label: t("updater.tabNotes", "Release Notes") },
    { key: "history", label: t("updater.tabHistory", "History") },
    { key: "rollback", label: t("updater.tabRollback", "Rollback") },
    { key: "settings", label: t("updater.tabSettings", "Settings") },
  ];

  return (
    <div className="sor-updater-panel" data-testid="updater-panel">
      <header className="sor-updater-header">
        <h2 className="sor-updater-title">{t("updater.panelTitle", "App Auto-Updater")}</h2>
      </header>

      {/* Global error banner */}
      {error && !isError && (
        <div className="sor-updater-alert sor-updater-alert--error">{error}</div>
      )}

      {/* Version info is always visible */}
      {renderVersionCard()}

      {/* Channel selector */}
      {renderChannelSelector()}

      {/* Tabs */}
      <nav className="sor-updater-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`sor-updater-tab ${activeTab === tab.key ? "sor-updater-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="sor-updater-tab-content" role="tabpanel">
        {activeTab === "status" && renderUpdateStatus()}
        {activeTab === "notes" && renderReleaseNotes()}
        {activeTab === "history" && renderHistory()}
        {activeTab === "rollback" && renderRollback()}
        {activeTab === "settings" && renderSettings()}
      </div>
    </div>
  );
};

export default UpdaterPanel;
