import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface RdpConnection {
  name: string;
  hostname: string;
  port?: number;
  username?: string;
  [key: string]: unknown;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ImportEntry {
  filePath: string;
  connection: RdpConnection | null;
  validation: ValidationResult | null;
  selected: boolean;
}

interface HistoryEntry {
  timestamp: string;
  action: "import" | "export";
  files: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function basename(path: string): string {
  return path.replace(/^.*[\\/]/, "");
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export const RdpFileManager: React.FC = () => {
  const { t } = useTranslation();

  /* ── state ── */
  const [activeTab, setActiveTab] = useState<"import" | "export">("import");
  const [importEntries, setImportEntries] = useState<ImportEntry[]>([]);
  const [exportConnections, setExportConnections] = useState<RdpConnection[]>([]);
  const [exportSelected, setExportSelected] = useState<Set<number>>(new Set());
  const [exportPreview, setExportPreview] = useState<string>("");
  const [supportedSettings, setSupportedSettings] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── load supported settings on mount ── */
  useEffect(() => {
    invoke<string[]>("rdp_get_supported_settings")
      .then(setSupportedSettings)
      .catch(() => {/* ignore */});
  }, []);

  /* ── clear error after 5 s ── */
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);

  const pushHistory = useCallback((action: HistoryEntry["action"], files: string[]) => {
    setHistory((h) => [{ timestamp: new Date().toISOString(), action, files }, ...h].slice(0, 50));
  }, []);

  /* ── import handlers ── */
  const handlePickFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "RDP Files", extensions: ["rdp"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];

      setLoading(true);
      setError(null);

      const parsed = await invoke<(RdpConnection | null)[]>("rdp_parse_batch", { filePaths: paths });
      const entries: ImportEntry[] = await Promise.all(
        paths.map(async (fp, i) => {
          let validation: ValidationResult | null = null;
          try {
            validation = await invoke<ValidationResult>("rdp_validate", { filePath: fp });
          } catch { /* skip */ }
          return { filePath: fp, connection: parsed[i] ?? null, validation, selected: true };
        }),
      );
      setImportEntries((prev) => [...prev, ...entries]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleImportEntry = useCallback((idx: number) => {
    setImportEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, selected: !e.selected } : e)));
  }, []);

  const handleImportSelected = useCallback(() => {
    const imported = importEntries.filter((e) => e.selected && e.connection);
    if (imported.length === 0) return;
    pushHistory("import", imported.map((e) => e.filePath));
    setImportEntries([]);
  }, [importEntries, pushHistory]);

  const clearImport = useCallback(() => setImportEntries([]), []);

  /* ── export handlers ── */
  const handleLoadConnections = useCallback(async () => {
    try {
      setLoading(true);
      const conns = await invoke<RdpConnection[]>("rdp_parse_batch", { filePaths: [] });
      setExportConnections(conns);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleExportEntry = useCallback((idx: number) => {
    setExportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handlePreview = useCallback(async (conn: RdpConnection) => {
    try {
      const preview = await invoke<string>("rdp_preview", { connection: conn });
      setExportPreview(preview);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleExportSelected = useCallback(async () => {
    const conns = [...exportSelected].map((i) => exportConnections[i]).filter(Boolean);
    if (conns.length === 0) return;

    try {
      setLoading(true);
      setError(null);
      if (conns.length === 1) {
        const outPath = await save({
          filters: [{ name: "RDP Files", extensions: ["rdp"] }],
          defaultPath: `${conns[0].name || "connection"}.rdp`,
        });
        if (!outPath) return;
        await invoke("rdp_generate_file", { connection: conns[0], outputPath: outPath });
        pushHistory("export", [outPath]);
      } else {
        const outDir = await open({ directory: true });
        if (!outDir) return;
        await invoke("rdp_generate_batch", { connections: conns, outputDir: outDir });
        pushHistory("export", conns.map((c) => `${outDir}/${c.name || "connection"}.rdp`));
      }
      setExportSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [exportConnections, exportSelected, pushHistory]);

  /* ── render helpers ── */
  const validCount = importEntries.filter((e) => e.validation?.valid).length;
  const invalidCount = importEntries.filter((e) => e.validation && !e.validation.valid).length;

  /* ---------------------------------------------------------------- */
  return (
    <div className="sor-rdpmgr">
      {/* Header */}
      <header className="sor-rdpmgr-header">
        <h2 className="sor-rdpmgr-title">{t("rdpManager.title", "RDP File Manager")}</h2>
        <div className="sor-rdpmgr-actions">
          <button className="sor-rdpmgr-btn sor-rdpmgr-btn--primary" onClick={() => setActiveTab("import")}>
            {t("rdpManager.import", "Import .rdp")}
          </button>
          <button className="sor-rdpmgr-btn sor-rdpmgr-btn--primary" onClick={() => setActiveTab("export")}>
            {t("rdpManager.export", "Export .rdp")}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && <div className="sor-rdpmgr-alert sor-rdpmgr-alert--error">{error}</div>}

      {/* Loading overlay */}
      {loading && <div className="sor-rdpmgr-loading"><span className="sor-rdpmgr-spinner" />{t("common.loading", "Loading…")}</div>}

      {/* ── Import tab ── */}
      {activeTab === "import" && (
        <section className="sor-rdpmgr-section">
          <h3 className="sor-rdpmgr-section-title">{t("rdpManager.importTitle", "Import RDP Files")}</h3>

          {/* Drop-zone / picker */}
          <div className="sor-rdpmgr-dropzone" role="button" tabIndex={0} onClick={handlePickFiles} onKeyDown={(e) => e.key === "Enter" && handlePickFiles()}>
            <p className="sor-rdpmgr-dropzone-label">
              {t("rdpManager.dropHint", "Click to browse or drag .rdp files here")}
            </p>
          </div>

          {/* Validation summary */}
          {importEntries.length > 0 && (
            <div className="sor-rdpmgr-validation-summary">
              <span className="sor-rdpmgr-badge sor-rdpmgr-badge--success">{validCount} {t("rdpManager.valid", "valid")}</span>
              <span className="sor-rdpmgr-badge sor-rdpmgr-badge--error">{invalidCount} {t("rdpManager.invalid", "invalid")}</span>
            </div>
          )}

          {/* Parsed connections table */}
          {importEntries.length > 0 && (
            <div className="sor-rdpmgr-table-wrap">
              <table className="sor-rdpmgr-table">
                <thead>
                  <tr>
                    <th className="sor-rdpmgr-th">{""}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.file", "File")}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.host", "Host")}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.user", "User")}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {importEntries.map((entry, i) => (
                    <tr key={entry.filePath} className="sor-rdpmgr-tr">
                      <td className="sor-rdpmgr-td">
                        <input type="checkbox" checked={entry.selected} onChange={() => toggleImportEntry(i)} />
                      </td>
                      <td className="sor-rdpmgr-td sor-rdpmgr-mono">{basename(entry.filePath)}</td>
                      <td className="sor-rdpmgr-td">{entry.connection?.hostname ?? "—"}</td>
                      <td className="sor-rdpmgr-td">{entry.connection?.username ?? "—"}</td>
                      <td className="sor-rdpmgr-td">
                        {entry.validation?.valid
                          ? <span className="sor-rdpmgr-badge sor-rdpmgr-badge--success">{t("rdpManager.ok", "OK")}</span>
                          : <span className="sor-rdpmgr-badge sor-rdpmgr-badge--error" title={entry.validation?.errors.join("; ")}>
                              {t("rdpManager.err", "Error")}
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Import actions */}
          {importEntries.length > 0 && (
            <div className="sor-rdpmgr-bar">
              <button className="sor-rdpmgr-btn sor-rdpmgr-btn--primary" disabled={loading || importEntries.every((e) => !e.selected)} onClick={handleImportSelected}>
                {t("rdpManager.importSelected", "Import Selected")} ({importEntries.filter((e) => e.selected).length})
              </button>
              <button className="sor-rdpmgr-btn" onClick={clearImport}>{t("rdpManager.clear", "Clear")}</button>
            </div>
          )}
        </section>
      )}

      {/* ── Export tab ── */}
      {activeTab === "export" && (
        <section className="sor-rdpmgr-section">
          <h3 className="sor-rdpmgr-section-title">{t("rdpManager.exportTitle", "Export RDP Files")}</h3>

          <button className="sor-rdpmgr-btn" onClick={handleLoadConnections} disabled={loading}>
            {t("rdpManager.loadConnections", "Load Connections")}
          </button>

          {/* Connection selector */}
          {exportConnections.length > 0 && (
            <div className="sor-rdpmgr-table-wrap">
              <table className="sor-rdpmgr-table">
                <thead>
                  <tr>
                    <th className="sor-rdpmgr-th">{""}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.name", "Name")}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.host", "Host")}</th>
                    <th className="sor-rdpmgr-th">{t("rdpManager.preview", "Preview")}</th>
                  </tr>
                </thead>
                <tbody>
                  {exportConnections.map((conn, i) => (
                    <tr key={`${conn.name}-${i}`} className="sor-rdpmgr-tr">
                      <td className="sor-rdpmgr-td">
                        <input type="checkbox" checked={exportSelected.has(i)} onChange={() => toggleExportEntry(i)} />
                      </td>
                      <td className="sor-rdpmgr-td">{conn.name}</td>
                      <td className="sor-rdpmgr-td">{conn.hostname}{conn.port ? `:${conn.port}` : ""}</td>
                      <td className="sor-rdpmgr-td">
                        <button className="sor-rdpmgr-link" onClick={() => handlePreview(conn)}>
                          {t("rdpManager.show", "Show")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Export preview */}
          {exportPreview && (
            <div className="sor-rdpmgr-preview">
              <h4 className="sor-rdpmgr-preview-title">{t("rdpManager.previewTitle", "RDP File Preview")}</h4>
              <pre className="sor-rdpmgr-code">{exportPreview}</pre>
            </div>
          )}

          {/* Export action */}
          {exportConnections.length > 0 && (
            <div className="sor-rdpmgr-bar">
              <button className="sor-rdpmgr-btn sor-rdpmgr-btn--primary" disabled={loading || exportSelected.size === 0} onClick={handleExportSelected}>
                {t("rdpManager.exportSelected", "Export Selected")} ({exportSelected.size})
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Supported Settings ── */}
      <section className="sor-rdpmgr-section">
        <button className="sor-rdpmgr-collapse-toggle" onClick={() => setSettingsOpen((v) => !v)}>
          <span>{t("rdpManager.supportedSettings", "Supported RDP Settings")}</span>
          <span className="sor-rdpmgr-chevron" data-open={settingsOpen}>▸</span>
        </button>
        {settingsOpen && (
          <ul className="sor-rdpmgr-settings-list">
            {supportedSettings.map((s) => (
              <li key={s} className="sor-rdpmgr-settings-item">{s}</li>
            ))}
            {supportedSettings.length === 0 && (
              <li className="sor-rdpmgr-muted">{t("rdpManager.noSettings", "No settings loaded")}</li>
            )}
          </ul>
        )}
      </section>

      {/* ── History log ── */}
      <section className="sor-rdpmgr-section">
        <h3 className="sor-rdpmgr-section-title">{t("rdpManager.history", "Import / Export History")}</h3>
        {history.length === 0 && (
          <p className="sor-rdpmgr-muted">{t("rdpManager.noHistory", "No activity yet")}</p>
        )}
        <ul className="sor-rdpmgr-history">
          {history.map((h, i) => (
            <li key={i} className="sor-rdpmgr-history-item">
              <span className={`sor-rdpmgr-badge sor-rdpmgr-badge--${h.action === "import" ? "info" : "success"}`}>
                {h.action}
              </span>
              <span className="sor-rdpmgr-history-time">{formatTime(h.timestamp)}</span>
              <span className="sor-rdpmgr-mono">{h.files.map(basename).join(", ")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default RdpFileManager;
