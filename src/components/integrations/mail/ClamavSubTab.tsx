// ClamAV (antivirus) — self-contained sub-tab of the unified Mail Server panel
// (t42 Wave M, exec t42-mail-clamav).
//
// Binds all 65 commands of src-tauri/crates/sorng-clamav via `useClamav()` /
// `clamavApi`. Unlike the cpanel/php shells, this sub-tab owns its OWN connect
// form + connection lifecycle + persistence — the mail shell provides no
// connection. Persistence uses `useIntegrationConfigStore` under the namespaced
// key `"mail.clamav"`; the SSH password + private key are bundled into the one
// opaque vault secret the store keeps per instance.
//
// The connect form maps to `clamav_connect` (SSH host/creds + the 4 binary
// paths, 2 config-file paths and the clamd socket). Management is grouped into
// internal sections: overview/service, scanning, databases, quarantine, clamd
// config, freshclam config, on-access, milter and scheduled scans.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bug,
  CalendarClock,
  Database,
  FileScan,
  FolderCog,
  Loader2,
  Plug,
  Power,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClamav, type ClamavManager } from "../../../hooks/integration/mail/useClamav";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../../utils/core/id";
import type { MailSubTabProps } from "./registry";
import type {
  ClamavConfigTestResult,
  ClamavDatabaseInfo,
  ClamavInfo,
  ClamavMilterConfig,
  ClamavOnAccessConfig,
  ClamavQuarantineEntry,
  ClamavQuarantineStats,
  ClamavScanResult,
  ClamavScanSummary,
  ClamavScheduledScan,
  ClamdConfigEntry,
  ClamdStats,
  FreshclamConfigEntry,
} from "../../../types/mail/clamav";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

const INTEGRATION_KEY = "mail.clamav";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
    <div className="text-[10px] uppercase text-[var(--color-textMuted)]">
      {label}
    </div>
    <div className="text-sm text-[var(--color-text)]">{value ?? "—"}</div>
  </div>
);

/** Coloured result badge for a scan verdict. */
const Verdict: React.FC<{ result: string }> = ({ result }) => {
  const cls =
    result === "clean"
      ? "text-green-500"
      : result === "infected"
        ? "text-red-500"
        : "text-yellow-500";
  return <span className={cls}>{result}</span>;
};

/** Render a `ClamavScanSummary` compactly. */
const ScanSummaryView: React.FC<{ summary: ClamavScanSummary | null }> = ({
  summary,
}) => {
  const { t } = useTranslation();
  if (!summary) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={t("integrations.mail.clamav.filesScanned", "Files scanned")}
          value={summary.files_scanned}
        />
        <Stat
          label={t("integrations.mail.clamav.infected", "Infected")}
          value={summary.infected_files}
        />
        <Stat
          label={t("integrations.mail.clamav.dataScanned", "Data (MB)")}
          value={summary.data_scanned_mb}
        />
        <Stat
          label={t("integrations.mail.clamav.scanTime", "Time (s)")}
          value={summary.scan_time_secs}
        />
      </div>
      {summary.results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">
                  {t("integrations.mail.clamav.file", "File")}
                </th>
                <th className="px-2 py-1">
                  {t("integrations.mail.clamav.result", "Result")}
                </th>
                <th className="px-2 py-1">
                  {t("integrations.mail.clamav.virus", "Virus")}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r, i) => (
                <tr
                  key={`${r.file_path}-${i}`}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                    {r.file_path}
                  </td>
                  <td className="px-2 py-1">
                    <Verdict result={r.result} />
                  </td>
                  <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                    {r.virus_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

type SectionKey =
  | "overview"
  | "scan"
  | "databases"
  | "quarantine"
  | "clamd"
  | "freshclam"
  | "onaccess"
  | "milter"
  | "scheduled";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  sshKey: string;
  clamscanBin: string;
  clamdscanBin: string;
  clamdBin: string;
  freshclamBin: string;
  clamdConf: string;
  freshclamConf: string;
  clamdSocket: string;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "22",
  sshUser: "",
  sshPassword: "",
  sshKey: "",
  clamscanBin: "/usr/bin/clamscan",
  clamdscanBin: "/usr/bin/clamdscan",
  clamdBin: "/usr/sbin/clamd",
  freshclamBin: "/usr/bin/freshclam",
  clamdConf: "/etc/clamav/clamd.conf",
  freshclamConf: "/etc/clamav/freshclam.conf",
  clamdSocket: "/var/run/clamav/clamd.ctl",
  timeoutSecs: "30",
  name: "",
};

/** SSH secrets bundled into ONE opaque vault secret. */
interface ClamavSecrets {
  sshPassword?: string;
  sshKey?: string;
}

const ConnectForm: React.FC<{ mgr: ClamavManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>();

  // Discover this sub-tab's own persisted instance (first under "mail.clamav")
  // and prefill host/fields + the bundled vault secret.
  const persisted = useMemo(
    () => store.instances.find((i) => i.integrationKey === INTEGRATION_KEY),
    [store.instances],
  );

  useEffect(() => {
    if (!persisted || store.isLoading) return;
    setSavedId(persisted.id);
    setForm((f) => ({
      ...f,
      name: persisted.name,
      host: persisted.host ?? "",
      port: persisted.fields?.port ?? f.port,
      sshUser: persisted.fields?.sshUser ?? "",
      clamscanBin: persisted.fields?.clamscanBin ?? f.clamscanBin,
      clamdscanBin: persisted.fields?.clamdscanBin ?? f.clamdscanBin,
      clamdBin: persisted.fields?.clamdBin ?? f.clamdBin,
      freshclamBin: persisted.fields?.freshclamBin ?? f.freshclamBin,
      clamdConf: persisted.fields?.clamdConf ?? f.clamdConf,
      freshclamConf: persisted.fields?.freshclamConf ?? f.freshclamConf,
      clamdSocket: persisted.fields?.clamdSocket ?? f.clamdSocket,
      timeoutSecs: persisted.fields?.timeoutSecs ?? f.timeoutSecs,
    }));
    store.readSecret(persisted).then((raw) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw) as ClamavSecrets;
        setForm((f) => ({
          ...f,
          sshPassword: s.sshPassword ?? "",
          sshKey: s.sshKey ?? "",
        }));
      } catch {
        // Legacy / non-JSON secret — treat as the SSH password.
        setForm((f) => ({ ...f, sshPassword: raw }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted?.id, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? generateId();
    await mgr.connect(id, {
      host: form.host.trim(),
      port: form.port ? Number(form.port) : undefined,
      ssh_user: form.sshUser || undefined,
      ssh_password: form.sshPassword || undefined,
      ssh_key: form.sshKey || undefined,
      clamscan_bin: form.clamscanBin || undefined,
      clamdscan_bin: form.clamdscanBin || undefined,
      clamd_bin: form.clamdBin || undefined,
      freshclam_bin: form.freshclamBin || undefined,
      clamd_conf: form.clamdConf || undefined,
      freshclam_conf: form.freshclamConf || undefined,
      clamd_socket: form.clamdSocket || undefined,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      sshUser: form.sshUser,
      clamscanBin: form.clamscanBin,
      clamdscanBin: form.clamdscanBin,
      clamdBin: form.clamdBin,
      freshclamBin: form.freshclamBin,
      clamdConf: form.clamdConf,
      freshclamConf: form.freshclamConf,
      clamdSocket: form.clamdSocket,
      timeoutSecs: form.timeoutSecs,
    };
    const secrets: ClamavSecrets = {
      sshPassword: form.sshPassword || undefined,
      sshKey: form.sshKey || undefined,
    };
    const hasSecret = Object.values(secrets).some(Boolean);
    const secret = hasSecret ? JSON.stringify(secrets) : undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: INTEGRATION_KEY,
        name: form.name || form.host,
        host: form.host,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.mail.clamav.host", "SSH host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="clamav.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.clamav.port", "SSH port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.mail.clamav.sshUser", "SSH user")}>
          <input
            className={field}
            value={form.sshUser}
            onChange={(e) => set("sshUser", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.sshPassword", "SSH password")}
        >
          <input
            className={field}
            type="password"
            value={form.sshPassword}
            onChange={(e) => set("sshPassword", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.sshKey", "SSH private key")}
        >
          <textarea
            className={`${field} font-mono`}
            rows={2}
            value={form.sshKey}
            onChange={(e) => set("sshKey", e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.clamscanBin", "clamscan path")}
        >
          <input
            className={field}
            value={form.clamscanBin}
            onChange={(e) => set("clamscanBin", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.clamdscanBin", "clamdscan path")}
        >
          <input
            className={field}
            value={form.clamdscanBin}
            onChange={(e) => set("clamdscanBin", e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.mail.clamav.clamdBin", "clamd path")}>
          <input
            className={field}
            value={form.clamdBin}
            onChange={(e) => set("clamdBin", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.freshclamBin", "freshclam path")}
        >
          <input
            className={field}
            value={form.freshclamBin}
            onChange={(e) => set("freshclamBin", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.clamdConf", "clamd.conf path")}
        >
          <input
            className={field}
            value={form.clamdConf}
            onChange={(e) => set("clamdConf", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t(
            "integrations.mail.clamav.freshclamConf",
            "freshclam.conf path",
          )}
        >
          <input
            className={field}
            value={form.freshclamConf}
            onChange={(e) => set("freshclamConf", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.clamdSocket", "clamd socket path")}
        >
          <input
            className={field}
            value={form.clamdSocket}
            onChange={(e) => set("clamdSocket", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled
          label={t("integrations.mail.clamav.instanceName", "Saved name")}
        >
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.host}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.mail.clamav.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.mail.clamav.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview / service section ──────────────────────────────────────────────

const OverviewSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ClamavInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [dbVersion, setDbVersion] = useState<string | null>(null);
  const [stats, setStats] = useState<ClamdStats | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced via mgr.error */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.info(cid), setInfo),
        safe(mgr.api.version(cid), setVersion),
        safe(mgr.api.getDbVersion(cid), setDbVersion),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadStatus = useCallback(async () => {
    try {
      setStats(await mgr.run(() => mgr.api.clamdStatus(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const checkUpdate = useCallback(async () => {
    try {
      setUpdateAvailable(await mgr.run(() => mgr.api.checkUpdate(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const control = useCallback(
    async (op: () => Promise<void>, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      try {
        await mgr.run(op);
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={loadStatus} disabled={mgr.isLoading}>
          <Activity size={12} />
          {t("integrations.mail.clamav.clamdStatus", "clamd status")}
        </button>
        <button className={btn} onClick={checkUpdate} disabled={mgr.isLoading}>
          <ShieldCheck size={12} />
          {t("integrations.mail.clamav.checkUpdate", "Check for update")}
        </button>
        {version && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.clamav.version", "Version")}: {version}
          </span>
        )}
        {updateAvailable != null && (
          <span
            className={`text-xs ${updateAvailable ? "text-yellow-500" : "text-green-500"}`}
          >
            {updateAvailable
              ? t("integrations.mail.clamav.updateAvailable", "Update available")
              : t("integrations.mail.clamav.upToDate", "Up to date")}
          </span>
        )}
      </div>

      {info && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t("integrations.mail.clamav.engine", "Engine")}
            value={info.engine_version}
          />
          <Stat
            label={t("integrations.mail.clamav.dbVersion", "DB version")}
            value={info.database_version ?? dbVersion}
          />
          <Stat
            label={t("integrations.mail.clamav.signatures", "Signatures")}
            value={info.signature_count}
          />
          <Stat
            label={t("integrations.mail.clamav.clamd", "clamd")}
            value={
              info.clamd_running
                ? t("integrations.mail.clamav.running", "running")
                : t("integrations.mail.clamav.stopped", "stopped")
            }
          />
          <Stat
            label={t("integrations.mail.clamav.freshclam", "freshclam")}
            value={
              info.freshclam_running
                ? t("integrations.mail.clamav.running", "running")
                : t("integrations.mail.clamav.stopped", "stopped")
            }
          />
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("integrations.mail.clamav.state", "State")} value={stats.state} />
          <Stat label={t("integrations.mail.clamav.pools", "Pools")} value={stats.pools} />
          <Stat
            label={t("integrations.mail.clamav.threads", "Threads (live/idle/max)")}
            value={`${stats.threads_live}/${stats.threads_idle}/${stats.threads_max}`}
          />
          <Stat label={t("integrations.mail.clamav.queue", "Queue")} value={stats.queue_items} />
          <Stat
            label={t("integrations.mail.clamav.memory", "Memory used")}
            value={stats.memory_used}
          />
          <Stat
            label={t("integrations.mail.clamav.malware", "Malware detected")}
            value={stats.malware_detected}
          />
          <Stat
            label={t("integrations.mail.clamav.bytesScanned", "Bytes scanned")}
            value={stats.bytes_scanned}
          />
          <Stat
            label={t("integrations.mail.clamav.uptime", "Uptime (s)")}
            value={stats.uptime_secs}
          />
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.clamdService", "clamd service")}
        </h4>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => void control(() => mgr.api.startClamd(cid))}>
            <Power size={12} />
            {t("integrations.mail.clamav.start", "Start")}
          </button>
          <button
            className={btn}
            onClick={() =>
              void control(
                () => mgr.api.stopClamd(cid),
                t("integrations.mail.clamav.stopConfirm", "Stop clamd?"),
              )
            }
          >
            <Power size={12} />
            {t("integrations.mail.clamav.stop", "Stop")}
          </button>
          <button className={btn} onClick={() => void control(() => mgr.api.restartClamd(cid))}>
            <RotateCw size={12} />
            {t("integrations.mail.clamav.restart", "Restart")}
          </button>
          <button className={btn} onClick={() => void control(() => mgr.api.reloadClamd(cid))}>
            <RefreshCw size={12} />
            {t("integrations.mail.clamav.reload", "Reload")}
          </button>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.freshclamService", "freshclam service")}
        </h4>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => void control(() => mgr.api.startFreshclam(cid))}>
            <Power size={12} />
            {t("integrations.mail.clamav.start", "Start")}
          </button>
          <button
            className={btn}
            onClick={() =>
              void control(
                () => mgr.api.stopFreshclam(cid),
                t("integrations.mail.clamav.stopFreshclamConfirm", "Stop freshclam?"),
              )
            }
          >
            <Power size={12} />
            {t("integrations.mail.clamav.stop", "Stop")}
          </button>
          <button className={btn} onClick={() => void control(() => mgr.api.restartFreshclam(cid))}>
            <RotateCw size={12} />
            {t("integrations.mail.clamav.restart", "Restart")}
          </button>
        </div>
      </div>

      <JsonView value={info} />
    </div>
  );
};

// ─── Scanning section ────────────────────────────────────────────────────────

const ScanSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [excludePatterns, setExcludePatterns] = useState("");
  const [maxFilesizeMb, setMaxFilesizeMb] = useState("");
  const [maxScansizeMb, setMaxScansizeMb] = useState("");
  const [maxFiles, setMaxFiles] = useState("");
  const [summary, setSummary] = useState<ClamavScanSummary | null>(null);
  const [single, setSingle] = useState<ClamavScanResult | null>(null);
  const [streamData, setStreamData] = useState("");

  const fullScan = useCallback(async () => {
    if (!path) return;
    try {
      setSingle(null);
      setSummary(
        await mgr.run(() =>
          mgr.api.scan(cid, {
            path,
            recursive,
            exclude_patterns: excludePatterns
              ? excludePatterns.split(",").map((s) => s.trim()).filter(Boolean)
              : [],
            max_filesize_mb: maxFilesizeMb ? Number(maxFilesizeMb) : undefined,
            max_scansize_mb: maxScansizeMb ? Number(maxScansizeMb) : undefined,
            max_files: maxFiles ? Number(maxFiles) : undefined,
          }),
        ),
      );
    } catch {
      /* surfaced */
    }
  }, [
    mgr,
    cid,
    path,
    recursive,
    excludePatterns,
    maxFilesizeMb,
    maxScansizeMb,
    maxFiles,
  ]);

  const runSummaryScan = useCallback(
    async (op: () => Promise<ClamavScanSummary>) => {
      if (!path) return;
      try {
        setSingle(null);
        setSummary(await mgr.run(op));
      } catch {
        /* surfaced */
      }
    },
    [mgr, path],
  );

  const quick = useCallback(async () => {
    if (!path) return;
    try {
      setSummary(null);
      setSingle(await mgr.run(() => mgr.api.quickScan(cid, path)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, path]);

  const stream = useCallback(async () => {
    if (!streamData) return;
    try {
      setSummary(null);
      setSingle(await mgr.run(() => mgr.api.scanStream(cid, streamData)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, streamData]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.clamav.scanPath", "Path to scan")}>
            <input
              className={field}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/var/spool/mail"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.excludePatterns", "Exclude patterns (comma-separated)")}>
            <input
              className={field}
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="*.log, *.tmp"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.maxFilesize", "Max file size (MB)")}>
            <input
              className={field}
              value={maxFilesizeMb}
              onChange={(e) => setMaxFilesizeMb(e.target.value)}
              inputMode="numeric"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.maxScansize", "Max scan size (MB)")}>
            <input
              className={field}
              value={maxScansizeMb}
              onChange={(e) => setMaxScansizeMb(e.target.value)}
              inputMode="numeric"
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.maxFiles", "Max files")}>
            <input
              className={field}
              value={maxFiles}
              onChange={(e) => setMaxFiles(e.target.value)}
              inputMode="numeric"
            />
          </Labeled>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
            {t("integrations.mail.clamav.recursive", "Recursive")}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btn} onClick={fullScan} disabled={mgr.isLoading || !path}>
            <FileScan size={12} />
            {t("integrations.mail.clamav.scan", "Scan")}
          </button>
          <button className={btn} onClick={quick} disabled={mgr.isLoading || !path}>
            {t("integrations.mail.clamav.quickScan", "Quick scan")}
          </button>
          <button
            className={btn}
            onClick={() => void runSummaryScan(() => mgr.api.multiscan(cid, path))}
            disabled={mgr.isLoading || !path}
          >
            {t("integrations.mail.clamav.multiscan", "Multiscan")}
          </button>
          <button
            className={btn}
            onClick={() => void runSummaryScan(() => mgr.api.contscan(cid, path))}
            disabled={mgr.isLoading || !path}
          >
            {t("integrations.mail.clamav.contscan", "Contscan")}
          </button>
          <button
            className={btn}
            onClick={() => void runSummaryScan(() => mgr.api.allmatchscan(cid, path))}
            disabled={mgr.isLoading || !path}
          >
            {t("integrations.mail.clamav.allmatchscan", "All-match scan")}
          </button>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.streamScan", "Stream scan (INSTREAM)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={3}
          value={streamData}
          onChange={(e) => setStreamData(e.target.value)}
          placeholder={t("integrations.mail.clamav.streamPlaceholder", "Raw / base64 data to scan…")}
        />
        <div className="mt-2">
          <button className={btn} onClick={stream} disabled={mgr.isLoading || !streamData}>
            <FileScan size={12} />
            {t("integrations.mail.clamav.scanStream", "Scan stream")}
          </button>
        </div>
      </div>

      {single && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t("integrations.mail.clamav.file", "File")}
            value={single.file_path}
          />
          <Stat
            label={t("integrations.mail.clamav.result", "Result")}
            value={<Verdict result={single.result} />}
          />
          <Stat
            label={t("integrations.mail.clamav.virus", "Virus")}
            value={single.virus_name ?? "—"}
          />
          <Stat
            label={t("integrations.mail.clamav.scanTimeMs", "Time (ms)")}
            value={single.scan_time_ms}
          />
        </div>
      )}
      <ScanSummaryView summary={summary} />
    </div>
  );
};

// ─── Databases section ───────────────────────────────────────────────────────

const DatabasesSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClamavDatabaseInfo[]>([]);
  const [mirrors, setMirrors] = useState<string[]>([]);
  const [newMirror, setNewMirror] = useState("");
  const [result, setResult] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.listDatabases(cid), setRows),
        safe(mgr.api.getMirrors(cid), setMirrors),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateAll = useCallback(async () => {
    try {
      setResult(await mgr.run(() => mgr.api.updateDatabases(cid)));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, refresh]);

  const updateOne = useCallback(
    async (name: string) => {
      try {
        setResult(await mgr.run(() => mgr.api.updateDatabase(cid, name)));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const addMirror = useCallback(async () => {
    if (!newMirror) return;
    try {
      await mgr.run(() => mgr.api.addMirror(cid, newMirror));
      setNewMirror("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, newMirror, refresh]);

  const removeMirror = useCallback(
    async (url: string) => {
      try {
        await mgr.run(() => mgr.api.removeMirror(cid, url));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={updateAll} disabled={mgr.isLoading}>
          <Database size={12} />
          {t("integrations.mail.clamav.updateAll", "Update all (freshclam)")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.clamav.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.version", "Version")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.signatures", "Signatures")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.buildTime", "Build time")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{d.name}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{d.version ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{d.signatures ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{d.build_time ?? "—"}</td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void updateOne(d.name)}>
                    {t("integrations.mail.clamav.update", "Update")}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.mail.clamav.noDatabases", "No databases")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.mirrors", "Mirrors")}
        </h4>
        <div className="mb-2 flex items-center gap-2">
          <input
            className={field}
            placeholder={t("integrations.mail.clamav.mirrorUrl", "Mirror URL")}
            value={newMirror}
            onChange={(e) => setNewMirror(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addMirror()}
          />
          <button className={btn} onClick={addMirror} disabled={!newMirror}>
            {t("integrations.mail.clamav.add", "Add")}
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {mirrors.map((m) => (
            <div key={m} className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--color-textSecondary)]">{m}</span>
              <button className={btn} onClick={() => void removeMirror(m)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {mirrors.length === 0 && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.mail.clamav.noMirrors", "No custom mirrors")}
            </span>
          )}
        </div>
      </div>

      <JsonView value={result} />
    </div>
  );
};

// ─── Quarantine section ──────────────────────────────────────────────────────

const QuarantineSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClamavQuarantineEntry[]>([]);
  const [stats, setStats] = useState<ClamavQuarantineStats | null>(null);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch {
        /* surfaced */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(mgr.api.listQuarantine(cid), setRows),
        safe(mgr.api.getQuarantineStats(cid), setStats),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (entryId: string) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getQuarantineEntry(cid, entryId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const restore = useCallback(
    async (entryId: string) => {
      try {
        await mgr.run(() => mgr.api.restoreQuarantine(cid, entryId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const del = useCallback(
    async (entryId: string) => {
      try {
        await mgr.run(() => mgr.api.deleteQuarantine(cid, entryId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const delAll = useCallback(async () => {
    if (
      !window.confirm(
        t("integrations.mail.clamav.deleteAllConfirm", "Delete ALL quarantined files?"),
      )
    )
      return;
    try {
      await mgr.run(() => mgr.api.deleteAllQuarantine(cid));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, refresh, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={delAll} disabled={mgr.isLoading}>
          <Trash2 size={12} />
          {t("integrations.mail.clamav.deleteAll", "Delete all")}
        </button>
        {stats && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.mail.clamav.quarantineTotals", "Items")}: {stats.total_items} ·{" "}
            {stats.total_size_bytes} {t("integrations.mail.clamav.bytes", "bytes")}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.clamav.virus", "Virus")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.originalPath", "Original path")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.quarantinedAt", "Quarantined")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.size", "Size")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-red-500">{q.virus_name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{q.original_path}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{q.quarantined_at}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{q.size_bytes}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(q.id)}>
                      {t("integrations.mail.clamav.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void restore(q.id)}>
                      {t("integrations.mail.clamav.restore", "Restore")}
                    </button>
                    <button className={btn} onClick={() => void del(q.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.mail.clamav.noQuarantine", "Quarantine is empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Config key/value editor (shared by clamd + freshclam) ───────────────────

interface ConfigEntry {
  key: string;
  value: string;
  comment?: string | null;
}

const ConfigEditor: React.FC<{
  mgr: ClamavManager;
  title: string;
  load: () => Promise<ConfigEntry[]>;
  getParam: (key: string) => Promise<ConfigEntry>;
  setParam: (key: string, value: string) => Promise<void>;
  deleteParam: (key: string) => Promise<void>;
}> = ({ mgr, title, load, getParam, setParam, deleteParam }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ConfigEntry[]>([]);
  const [form, setForm] = useState({ key: "", value: "" });
  const [lookup, setLookup] = useState("");
  const [looked, setLooked] = useState<ConfigEntry | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(load));
    } catch {
      /* surfaced */
    }
  }, [mgr, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!form.key) return;
    try {
      await mgr.run(() => setParam(form.key, form.value));
      setForm({ key: "", value: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, form, setParam, refresh]);

  const del = useCallback(
    async (key: string) => {
      try {
        await mgr.run(() => deleteParam(key));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, deleteParam, refresh],
  );

  const doLookup = useCallback(async () => {
    if (!lookup) return;
    try {
      setLooked(await mgr.run(() => getParam(lookup)));
    } catch {
      /* surfaced */
    }
  }, [mgr, lookup, getParam]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <span className="text-xs text-[var(--color-textMuted)]">{title}</span>
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            className={field}
            style={{ maxWidth: 200 }}
            placeholder={t("integrations.mail.clamav.paramKey", "Key")}
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
          />
          <input
            className={field}
            style={{ maxWidth: 260 }}
            placeholder={t("integrations.mail.clamav.paramValue", "Value")}
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
          />
          <button className={btn} onClick={save} disabled={!form.key}>
            {t("integrations.mail.clamav.setParam", "Set")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={field}
            style={{ maxWidth: 200 }}
            placeholder={t("integrations.mail.clamav.lookupKey", "Look up a key")}
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doLookup()}
          />
          <button className={btn} onClick={doLookup} disabled={!lookup}>
            {t("integrations.mail.clamav.getParam", "Get")}
          </button>
          {looked && (
            <span className="font-mono text-xs text-[var(--color-textSecondary)]">
              {looked.key} = {looked.value}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.clamav.paramKey", "Key")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.paramValue", "Value")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={`${c.key}-${i}`} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-mono text-[var(--color-text)]">{c.key}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{c.value}</td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void del(c.key)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.mail.clamav.noParams", "No directives")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Clamd config section (config editor + socket + config test) ─────────────

const ClamdConfigSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [socket, setSocketState] = useState("");
  const [testResult, setTestResult] = useState<ClamavConfigTestResult | null>(null);

  const load = useCallback(
    () => mgr.api.getClamdConfig(cid) as Promise<ClamdConfigEntry[]>,
    [mgr, cid],
  );

  const loadSocket = useCallback(async () => {
    try {
      setSocketState(await mgr.run(() => mgr.api.getSocket(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void loadSocket();
  }, [loadSocket]);

  const saveSocket = useCallback(async () => {
    try {
      await mgr.run(() => mgr.api.setSocket(cid, socket));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, socket]);

  const testConfig = useCallback(async () => {
    try {
      setTestResult(await mgr.run(() => mgr.api.testClamdConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.socket", "clamd socket")}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={field}
            style={{ maxWidth: 320 }}
            value={socket}
            onChange={(e) => setSocketState(e.target.value)}
            placeholder="/var/run/clamav/clamd.ctl"
          />
          <button className={btn} onClick={loadSocket} disabled={mgr.isLoading}>
            <RefreshCw size={12} />
            {t("integrations.mail.clamav.load", "Load")}
          </button>
          <button className={btn} onClick={saveSocket} disabled={mgr.isLoading || !socket}>
            {t("integrations.mail.clamav.setParam", "Set")}
          </button>
          <button className={btn} onClick={testConfig} disabled={mgr.isLoading}>
            <ShieldCheck size={12} />
            {t("integrations.mail.clamav.testConfig", "Test config")}
          </button>
        </div>
        {testResult && (
          <div
            className={`mt-2 rounded border px-3 py-2 text-xs ${
              testResult.success
                ? "border-green-500/40 bg-green-500/10 text-green-500"
                : "border-red-500/40 bg-red-500/10 text-red-500"
            }`}
          >
            <div className="whitespace-pre-wrap font-mono">{testResult.output}</div>
            {testResult.errors.map((e, i) => (
              <div key={i} className="font-mono">{e}</div>
            ))}
          </div>
        )}
      </div>

      <ConfigEditor
        mgr={mgr}
        title={t("integrations.mail.clamav.clamdConfTitle", "clamd.conf directives")}
        load={load}
        getParam={(key) => mgr.api.getClamdParam(cid, key)}
        setParam={(key, value) => mgr.api.setClamdParam(cid, key, value)}
        deleteParam={(key) => mgr.api.deleteClamdParam(cid, key)}
      />
    </div>
  );
};

// ─── Freshclam config section (config editor + update interval) ──────────────

const FreshclamConfigSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [interval, setIntervalState] = useState("");

  const load = useCallback(
    () => mgr.api.getFreshclamConfig(cid) as Promise<FreshclamConfigEntry[]>,
    [mgr, cid],
  );

  const loadInterval = useCallback(async () => {
    try {
      const v = await mgr.run(() => mgr.api.getUpdateInterval(cid));
      setIntervalState(String(v));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void loadInterval();
  }, [loadInterval]);

  const saveInterval = useCallback(async () => {
    if (!interval) return;
    try {
      await mgr.run(() => mgr.api.setUpdateInterval(cid, Number(interval)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, interval]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.updateInterval", "Update interval (checks/day → hours)")}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={field}
            style={{ maxWidth: 140 }}
            value={interval}
            onChange={(e) => setIntervalState(e.target.value)}
            inputMode="numeric"
            placeholder={t("integrations.mail.clamav.hours", "Hours")}
          />
          <button className={btn} onClick={loadInterval} disabled={mgr.isLoading}>
            <RefreshCw size={12} />
            {t("integrations.mail.clamav.load", "Load")}
          </button>
          <button className={btn} onClick={saveInterval} disabled={mgr.isLoading || !interval}>
            {t("integrations.mail.clamav.setParam", "Set")}
          </button>
        </div>
      </div>

      <ConfigEditor
        mgr={mgr}
        title={t("integrations.mail.clamav.freshclamConfTitle", "freshclam.conf directives")}
        load={load}
        getParam={(key) => mgr.api.getFreshclamParam(cid, key)}
        setParam={(key, value) => mgr.api.setFreshclamParam(cid, key, value)}
        deleteParam={(key) => mgr.api.deleteFreshclamParam(cid, key)}
      />
    </div>
  );
};

// ─── On-access section ───────────────────────────────────────────────────────

const OnAccessSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ClamavOnAccessConfig | null>(null);
  const [newPath, setNewPath] = useState("");

  const refresh = useCallback(async () => {
    try {
      setConfig(await mgr.run(() => mgr.api.getOnAccessConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!config) return;
    try {
      await mgr.run(() => mgr.api.setOnAccessConfig(cid, config));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, config, refresh]);

  const toggle = useCallback(
    async (enable: boolean) => {
      try {
        await mgr.run(() =>
          enable ? mgr.api.enableOnAccess(cid) : mgr.api.disableOnAccess(cid),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const addPath = useCallback(async () => {
    if (!newPath) return;
    try {
      await mgr.run(() => mgr.api.addOnAccessPath(cid, newPath));
      setNewPath("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, newPath, refresh]);

  const removePath = useCallback(
    async (path: string) => {
      try {
        await mgr.run(() => mgr.api.removeOnAccessPath(cid, path));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => void toggle(true)} disabled={mgr.isLoading}>
          {t("integrations.mail.clamav.enable", "Enable")}
        </button>
        <button className={btn} onClick={() => void toggle(false)} disabled={mgr.isLoading}>
          {t("integrations.mail.clamav.disable", "Disable")}
        </button>
        {config && (
          <span className={`text-xs ${config.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}`}>
            {config.enabled
              ? t("integrations.mail.clamav.enabled", "Enabled")
              : t("integrations.mail.clamav.disabled", "Disabled")}
          </span>
        )}
      </div>

      {config && (
        <div className={card}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label={t("integrations.mail.clamav.action", "Action")}>
              <select
                className={field}
                value={config.action}
                onChange={(e) => setConfig({ ...config, action: e.target.value })}
              >
                <option value="notify">notify</option>
                <option value="deny">deny</option>
              </select>
            </Labeled>
            <Labeled label={t("integrations.mail.clamav.maxFileSize", "Max file size (MB)")}>
              <input
                className={field}
                value={config.max_file_size_mb ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    max_file_size_mb: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                inputMode="numeric"
              />
            </Labeled>
          </div>
          <div className="mt-2">
            <button className={btn} onClick={save} disabled={mgr.isLoading}>
              {t("integrations.mail.clamav.saveConfig", "Save config")}
            </button>
          </div>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.mail.clamav.watchedPaths", "Watched paths")}
        </h4>
        <div className="mb-2 flex items-center gap-2">
          <input
            className={field}
            placeholder={t("integrations.mail.clamav.path", "Path")}
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addPath()}
          />
          <button className={btn} onClick={addPath} disabled={!newPath}>
            {t("integrations.mail.clamav.add", "Add")}
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {(config?.include_paths ?? []).map((p) => (
            <div key={p} className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--color-textSecondary)]">{p}</span>
              <button className={btn} onClick={() => void removePath(p)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {(config?.include_paths?.length ?? 0) === 0 && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.mail.clamav.noPaths", "No watched paths")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Milter section ──────────────────────────────────────────────────────────

const MilterSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ClamavMilterConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConfig(await mgr.run(() => mgr.api.getMilterConfig(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!config) return;
    try {
      await mgr.run(() => mgr.api.setMilterConfig(cid, config));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, config, refresh]);

  const toggle = useCallback(
    async (enable: boolean) => {
      try {
        await mgr.run(() =>
          enable ? mgr.api.enableMilter(cid) : mgr.api.disableMilter(cid),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.mail.clamav.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={() => void toggle(true)} disabled={mgr.isLoading}>
          {t("integrations.mail.clamav.enable", "Enable")}
        </button>
        <button className={btn} onClick={() => void toggle(false)} disabled={mgr.isLoading}>
          {t("integrations.mail.clamav.disable", "Disable")}
        </button>
        {config && (
          <span className={`text-xs ${config.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}`}>
            {config.enabled
              ? t("integrations.mail.clamav.enabled", "Enabled")
              : t("integrations.mail.clamav.disabled", "Disabled")}
          </span>
        )}
      </div>

      {config && (
        <div className={card}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label={t("integrations.mail.clamav.milterSocket", "Milter socket")}>
              <input
                className={field}
                value={config.socket}
                onChange={(e) => setConfig({ ...config, socket: e.target.value })}
                placeholder="/var/run/clamav/clamav-milter.ctl"
              />
            </Labeled>
            <Labeled label={t("integrations.mail.clamav.condition", "OnInfected condition")}>
              <input
                className={field}
                value={config.condition ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, condition: e.target.value || undefined })
                }
                placeholder="Reject"
              />
            </Labeled>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={config.add_header ?? false}
                onChange={(e) => setConfig({ ...config, add_header: e.target.checked })}
              />
              {t("integrations.mail.clamav.addHeader", "Add X-Virus-Scanned header")}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={config.reject_infected ?? false}
                onChange={(e) =>
                  setConfig({ ...config, reject_infected: e.target.checked })
                }
              />
              {t("integrations.mail.clamav.rejectInfected", "Reject infected mail")}
            </label>
          </div>
          <div className="mt-2">
            <button className={btn} onClick={save} disabled={mgr.isLoading}>
              {t("integrations.mail.clamav.saveConfig", "Save config")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Scheduled scans section ─────────────────────────────────────────────────

const emptyScheduled = (): ClamavScheduledScan => ({
  id: "",
  name: "",
  path: "",
  schedule_cron: "0 2 * * *",
  recursive: true,
  enabled: true,
  last_run: null,
  last_result: null,
});

const ScheduledSection: React.FC<{ mgr: ClamavManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClamavScheduledScan[]>([]);
  const [draft, setDraft] = useState<ClamavScheduledScan>(emptyScheduled());
  const [runResult, setRunResult] = useState<ClamavScanSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listScheduledScans(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!draft.name || !draft.path) return;
    try {
      await mgr.run(() => mgr.api.createScheduledScan(cid, draft));
      setDraft(emptyScheduled());
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, draft, refresh]);

  const edit = useCallback(
    async (scan: ClamavScheduledScan) => {
      try {
        await mgr.run(() => mgr.api.updateScheduledScan(cid, scan.id, scan));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const view = useCallback(
    async (scanId: string) => {
      try {
        setDraft(await mgr.run(() => mgr.api.getScheduledScan(cid, scanId)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const del = useCallback(
    async (scanId: string) => {
      try {
        await mgr.run(() => mgr.api.deleteScheduledScan(cid, scanId));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const toggle = useCallback(
    async (scan: ClamavScheduledScan) => {
      try {
        await mgr.run(() =>
          scan.enabled
            ? mgr.api.disableScheduledScan(cid, scan.id)
            : mgr.api.enableScheduledScan(cid, scan.id),
        );
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  const run = useCallback(
    async (scanId: string) => {
      try {
        setRunResult(await mgr.run(() => mgr.api.runScheduledScan(cid, scanId)));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.mail.clamav.refresh", "Refresh")}
      </button>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {draft.id
            ? t("integrations.mail.clamav.editScan", "Edit scheduled scan")
            : t("integrations.mail.clamav.newScan", "New scheduled scan")}
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t("integrations.mail.clamav.name", "Name")}>
            <input
              className={field}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.scanPath", "Path to scan")}>
            <input
              className={field}
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </Labeled>
          <Labeled label={t("integrations.mail.clamav.cron", "Cron schedule")}>
            <input
              className={`${field} font-mono`}
              value={draft.schedule_cron}
              onChange={(e) => setDraft({ ...draft, schedule_cron: e.target.value })}
              placeholder="0 2 * * *"
            />
          </Labeled>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={draft.recursive}
                onChange={(e) => setDraft({ ...draft, recursive: e.target.checked })}
              />
              {t("integrations.mail.clamav.recursive", "Recursive")}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              {t("integrations.mail.clamav.enabledLabel", "Enabled")}
            </label>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          {draft.id ? (
            <>
              <button className={btn} onClick={() => void edit(draft)} disabled={mgr.isLoading}>
                {t("integrations.mail.clamav.saveScan", "Save changes")}
              </button>
              <button className={btn} onClick={() => setDraft(emptyScheduled())}>
                {t("integrations.mail.clamav.newScan", "New")}
              </button>
            </>
          ) : (
            <button
              className={btn}
              onClick={create}
              disabled={mgr.isLoading || !draft.name || !draft.path}
            >
              {t("integrations.mail.clamav.create", "Create")}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.mail.clamav.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.scanPath", "Path")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.cron", "Cron")}</th>
              <th className="px-2 py-1">{t("integrations.mail.clamav.status", "Status")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.path}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{s.schedule_cron}</td>
                <td className="px-2 py-1">
                  <span className={s.enabled ? "text-green-500" : "text-[var(--color-textMuted)]"}>
                    {s.enabled
                      ? t("integrations.mail.clamav.enabled", "Enabled")
                      : t("integrations.mail.clamav.disabled", "Disabled")}
                  </span>
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(s.id)}>
                      {t("integrations.mail.clamav.edit", "Edit")}
                    </button>
                    <button className={btn} onClick={() => void toggle(s)}>
                      {s.enabled
                        ? t("integrations.mail.clamav.disable", "Disable")
                        : t("integrations.mail.clamav.enable", "Enable")}
                    </button>
                    <button className={btn} onClick={() => void run(s.id)}>
                      {t("integrations.mail.clamav.run", "Run")}
                    </button>
                    <button className={btn} onClick={() => void del(s.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={5}>
                  {t("integrations.mail.clamav.noScheduled", "No scheduled scans")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ScanSummaryView summary={runResult} />
    </div>
  );
};

// ─── Sub-tab shell ───────────────────────────────────────────────────────────

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "overview", labelKey: "integrations.mail.clamav.secOverview", labelDefault: "Overview", icon: Activity },
  { key: "scan", labelKey: "integrations.mail.clamav.secScan", labelDefault: "Scan", icon: FileScan },
  { key: "databases", labelKey: "integrations.mail.clamav.secDatabases", labelDefault: "Databases", icon: Database },
  { key: "quarantine", labelKey: "integrations.mail.clamav.secQuarantine", labelDefault: "Quarantine", icon: ShieldAlert },
  { key: "clamd", labelKey: "integrations.mail.clamav.secClamd", labelDefault: "clamd config", icon: Sliders },
  { key: "freshclam", labelKey: "integrations.mail.clamav.secFreshclam", labelDefault: "freshclam", icon: FolderCog },
  { key: "onaccess", labelKey: "integrations.mail.clamav.secOnAccess", labelDefault: "On-access", icon: ShieldCheck },
  { key: "milter", labelKey: "integrations.mail.clamav.secMilter", labelDefault: "Milter", icon: Bug },
  { key: "scheduled", labelKey: "integrations.mail.clamav.secScheduled", labelDefault: "Scheduled", icon: CalendarClock },
];

const ClamavSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const mgr = useClamav();
  const [section, setSection] = useState<SectionKey>("overview");

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t("integrations.mail.clamav.title", "ClamAV (antivirus)")}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`}
            />
            {mgr.isConnected
              ? mgr.summary?.host ?? t("integrations.mail.clamav.connected", "Connected")
              : t("integrations.mail.clamav.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.mail.clamav.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
        <ConnectForm mgr={mgr} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {SECTIONS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  section === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {section === "overview" && <OverviewSection mgr={mgr} cid={cid} />}
            {section === "scan" && <ScanSection mgr={mgr} cid={cid} />}
            {section === "databases" && <DatabasesSection mgr={mgr} cid={cid} />}
            {section === "quarantine" && <QuarantineSection mgr={mgr} cid={cid} />}
            {section === "clamd" && <ClamdConfigSection mgr={mgr} cid={cid} />}
            {section === "freshclam" && <FreshclamConfigSection mgr={mgr} cid={cid} />}
            {section === "onaccess" && <OnAccessSection mgr={mgr} cid={cid} />}
            {section === "milter" && <MilterSection mgr={mgr} cid={cid} />}
            {section === "scheduled" && <ScheduledSection mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default ClamavSubTab;
