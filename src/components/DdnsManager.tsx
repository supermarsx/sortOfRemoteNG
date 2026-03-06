import React, { useState, useEffect } from "react";
import {
  Globe,
  RefreshCw,
  Plus,
  Trash2,
  Settings,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Pause,
  Clock,
  Activity,
  Server,
  Shield,
  Wifi,
  WifiOff,
  Eye,
  Copy,
  Edit,
  Power,
  PowerOff,
  Cloud,
  FileText,
  BarChart2,
  Zap,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "./ui/overlays/Modal";
import { EmptyState } from "./ui/display";
import { PasswordInput } from "./ui/forms";
import { useDdnsManager } from "../hooks/useDdnsManager";
import type {
  DdnsProfile,
  DdnsProvider,
  DdnsProfileHealth,
  ProviderCapabilities,
  DdnsUpdateResult,
  DdnsAuditEntry,
  CloudflareZone,
  CloudflareDnsRecord,
  UpdateStatus,
} from "../types/ddns";

type Mgr = ReturnType<typeof useDdnsManager>;

type DdnsTab =
  | "profiles"
  | "health"
  | "cloudflare"
  | "ip"
  | "scheduler"
  | "config"
  | "audit";

interface DdnsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const StatusBadge: React.FC<{ ok: boolean; label: string }> = ({
  ok,
  label,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
    }`}
  >
    {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
    {label}
  </span>
);

const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded bg-red-500/10 text-red-400 text-sm">
      <AlertTriangle size={14} />
      {error}
    </div>
  ) : null;

const DangerConfirm: React.FC<{
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ action, onConfirm, onCancel }) => (
  <div className="flex items-center gap-3 p-3 rounded bg-red-500/10 border border-red-500/30 text-sm">
    <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
    <span className="flex-1">Are you sure you want to {action}?</span>
    <button
      onClick={onConfirm}
      className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs"
    >
      Confirm
    </button>
    <button
      onClick={onCancel}
      className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
    >
      Cancel
    </button>
  </div>
);

const ProviderBadge: React.FC<{ provider: DdnsProvider }> = ({ provider }) => {
  const colours: Record<string, string> = {
    Cloudflare: "bg-orange-500/10 text-orange-400",
    NoIp: "bg-blue-500/10 text-blue-400",
    DuckDns: "bg-yellow-500/10 text-yellow-400",
    AfraidDns: "bg-purple-500/10 text-purple-400",
    Custom: "bg-neutral-500/10 text-neutral-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colours[provider] ?? "bg-sky-500/10 text-sky-400"}`}
    >
      {provider}
    </span>
  );
};

const UpdateStatusBadge: React.FC<{ status: UpdateStatus }> = ({ status }) => {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    Success: {
      cls: "bg-green-500/10 text-green-400",
      icon: <CheckCircle2 size={12} />,
    },
    NoChange: {
      cls: "bg-blue-500/10 text-blue-400",
      icon: <CheckCircle2 size={12} />,
    },
    Failed: {
      cls: "bg-red-500/10 text-red-400",
      icon: <XCircle size={12} />,
    },
    AuthError: {
      cls: "bg-red-500/10 text-red-400",
      icon: <Shield size={12} />,
    },
    RateLimited: {
      cls: "bg-yellow-500/10 text-yellow-400",
      icon: <Clock size={12} />,
    },
    Disabled: {
      cls: "bg-neutral-500/10 text-neutral-400",
      icon: <PowerOff size={12} />,
    },
  };
  const info = map[status] ?? {
    cls: "bg-neutral-500/10 text-neutral-400",
    icon: <AlertTriangle size={12} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${info.cls}`}
    >
      {info.icon}
      {status}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: Profiles                                                      */
/* ------------------------------------------------------------------ */

const ProfilesTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    mgr.listProfiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mgr.profiles.length) {
    return (
      <EmptyState
        icon={Globe}
        message={t("ddns.profiles.empty", "No DDNS profiles")}
        hint={t("ddns.profiles.emptyHint", "Create a profile to start managing dynamic DNS records")}
      />
    );
  }

  return (
    <div className="space-y-2">
      {mgr.profiles.map((p: DdnsProfile) => (
        <div
          key={p.id}
          className="flex items-center gap-3 p-3 rounded bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm truncate">{p.name}</span>
              <ProviderBadge provider={p.provider} />
              <StatusBadge ok={p.enabled} label={p.enabled ? "Enabled" : "Disabled"} />
            </div>
            <div className="text-xs text-neutral-400 truncate">
              {p.hostname && p.hostname !== "@"
                ? `${p.hostname}.${p.domain}`
                : p.domain}{" "}
              · {p.ip_version} · {p.update_interval_secs}s
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => mgr.triggerUpdate(p.id)}
              className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-green-400"
              title={t("ddns.profiles.update", "Trigger update")}
            >
              <Zap size={14} />
            </button>
            <button
              onClick={() =>
                p.enabled ? mgr.disableProfile(p.id) : mgr.enableProfile(p.id)
              }
              className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-yellow-400"
              title={p.enabled ? "Disable" : "Enable"}
            >
              {p.enabled ? <PowerOff size={14} /> : <Power size={14} />}
            </button>
            {confirmDelete === p.id ? (
              <DangerConfirm
                action={`delete "${p.name}"`}
                onConfirm={() => {
                  mgr.deleteProfile(p.id);
                  setConfirmDelete(null);
                }}
                onCancel={() => setConfirmDelete(null)}
              />
            ) : (
              <button
                onClick={() => setConfirmDelete(p.id)}
                className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-red-400"
                title={t("ddns.profiles.delete", "Delete")}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: Health                                                        */
/* ------------------------------------------------------------------ */

const HealthTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  useEffect(() => {
    mgr.getAllHealth();
    mgr.getSystemStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* System overview */}
      {mgr.systemStatus && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: t("ddns.health.total", "Total"), value: mgr.systemStatus.total_profiles, icon: Server },
            { label: t("ddns.health.enabled", "Enabled"), value: mgr.systemStatus.enabled_profiles, icon: Power },
            { label: t("ddns.health.healthy", "Healthy"), value: mgr.systemStatus.healthy_profiles, icon: CheckCircle2 },
            { label: t("ddns.health.errors", "Errors"), value: mgr.systemStatus.error_profiles, icon: XCircle },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center p-3 rounded bg-neutral-800/50 text-center"
            >
              <s.icon size={18} className="mb-1 text-neutral-400" />
              <span className="text-lg font-bold">{s.value}</span>
              <span className="text-xs text-neutral-500">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* IP addresses */}
      {mgr.systemStatus && (
        <div className="flex items-center gap-4 p-3 rounded bg-neutral-800/50 text-sm">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-neutral-400" />
            <span className="text-neutral-500">IPv4:</span>
            <span className="font-mono">{mgr.systemStatus.current_ipv4 ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-neutral-400" />
            <span className="text-neutral-500">IPv6:</span>
            <span className="font-mono text-xs">
              {mgr.systemStatus.current_ipv6 ?? "—"}
            </span>
          </div>
        </div>
      )}

      {/* Per-profile health */}
      {mgr.healthList.length === 0 ? (
        <EmptyState
          icon={Activity}
          message={t("ddns.health.empty", "No health data")}
          hint={t("ddns.health.emptyHint", "Run an update to generate health data")}
        />
      ) : (
        <div className="space-y-2">
          {mgr.healthList.map((h: DdnsProfileHealth) => (
            <div
              key={h.profile_id}
              className="flex items-center gap-3 p-3 rounded bg-neutral-800/50"
            >
              <div
                className={`w-2 h-2 rounded-full ${h.is_healthy ? "bg-green-400" : "bg-red-400"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {h.profile_name}
                  </span>
                  <ProviderBadge provider={h.provider} />
                </div>
                <div className="text-xs text-neutral-400 truncate">
                  {h.fqdn} ·{" "}
                  {h.current_ipv4 ?? "no IP"} ·{" "}
                  {h.success_count} ok / {h.failure_count} fail
                </div>
              </div>
              {h.last_error && (
                <span className="text-xs text-red-400 max-w-[200px] truncate">
                  {h.last_error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: Cloudflare                                                    */
/* ------------------------------------------------------------------ */

const CloudflareTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  const cfProfiles = mgr.profiles.filter(
    (p: DdnsProfile) => p.provider === "Cloudflare",
  );
  const [selectedCfProfile, setSelectedCfProfile] = useState<string>("");
  const [selectedZone, setSelectedZone] = useState<string>("");

  if (!cfProfiles.length) {
    return (
      <EmptyState
        icon={Cloud}
        message={t("ddns.cloudflare.empty", "No Cloudflare profiles")}
        hint={t(
          "ddns.cloudflare.emptyHint",
          "Create a Cloudflare DDNS profile first",
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Profile selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedCfProfile}
          onChange={(e) => setSelectedCfProfile(e.target.value)}
          className="flex-1 px-3 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm"
        >
          <option value="">
            {t("ddns.cloudflare.selectProfile", "Select profile...")}
          </option>
          {cfProfiles.map((p: DdnsProfile) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.domain})
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            selectedCfProfile && mgr.cfListZones(selectedCfProfile)
          }
          disabled={!selectedCfProfile || mgr.loading}
          className="px-3 py-2 rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-sm"
        >
          <Search size={14} className="inline mr-1" />
          {t("ddns.cloudflare.listZones", "List zones")}
        </button>
      </div>

      {/* Zones */}
      {mgr.cfZones.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            {t("ddns.cloudflare.zones", "Zones")}
          </h4>
          {mgr.cfZones.map((z: CloudflareZone) => (
            <button
              key={z.id}
              onClick={() => {
                setSelectedZone(z.id);
                if (selectedCfProfile)
                  mgr.cfListRecords(selectedCfProfile, z.id);
              }}
              className={`w-full text-left flex items-center gap-2 p-2 rounded text-sm ${
                selectedZone === z.id
                  ? "bg-orange-500/20 border border-orange-500/40"
                  : "bg-neutral-800/50 hover:bg-neutral-800"
              }`}
            >
              <Globe size={14} />
              <span className="font-mono">{z.name}</span>
              <StatusBadge ok={z.status === "active"} label={z.status} />
            </button>
          ))}
        </div>
      )}

      {/* Records */}
      {mgr.cfRecords.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            {t("ddns.cloudflare.records", "DNS records")}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 border-b border-neutral-700">
                  <th className="text-left py-1 px-2">Type</th>
                  <th className="text-left py-1 px-2">Name</th>
                  <th className="text-left py-1 px-2">Content</th>
                  <th className="text-left py-1 px-2">TTL</th>
                  <th className="text-left py-1 px-2">Proxy</th>
                  <th className="text-right py-1 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mgr.cfRecords.map((r: CloudflareDnsRecord) => (
                  <tr key={r.id} className="border-b border-neutral-800">
                    <td className="py-1.5 px-2 font-mono">{r.record_type}</td>
                    <td className="py-1.5 px-2 font-mono truncate max-w-[200px]">
                      {r.name}
                    </td>
                    <td className="py-1.5 px-2 font-mono truncate max-w-[200px]">
                      {r.content}
                    </td>
                    <td className="py-1.5 px-2">{r.ttl === 1 ? "Auto" : r.ttl}</td>
                    <td className="py-1.5 px-2">
                      {r.proxied ? (
                        <Cloud size={14} className="text-orange-400" />
                      ) : (
                        <Globe size={14} className="text-neutral-500" />
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <button
                        onClick={() =>
                          selectedCfProfile &&
                          mgr.cfDeleteRecord(
                            selectedCfProfile,
                            selectedZone,
                            r.id,
                          )
                        }
                        className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: IP Detection                                                  */
/* ------------------------------------------------------------------ */

const IpTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3">
      <button
        onClick={() => mgr.detectIp()}
        disabled={mgr.loading}
        className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-sm"
      >
        <RefreshCw
          size={14}
          className={`inline mr-1 ${mgr.loading ? "animate-spin" : ""}`}
        />
        {t("ddns.ip.detect", "Detect public IP")}
      </button>
      <button
        onClick={() => mgr.getCurrentIps()}
        className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
      >
        <Eye size={14} className="inline mr-1" />
        {t("ddns.ip.cached", "Show cached")}
      </button>
    </div>

    {mgr.ipResult && (
      <div className="p-4 rounded bg-neutral-800/50 space-y-2">
        <h4 className="text-sm font-semibold">
          {t("ddns.ip.detectionResult", "Detection result")}
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-neutral-500">IPv4:</span>{" "}
            <span className="font-mono">{mgr.ipResult.ipv4 ?? "—"}</span>
          </div>
          <div>
            <span className="text-neutral-500">IPv6:</span>{" "}
            <span className="font-mono text-xs">
              {mgr.ipResult.ipv6 ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">Service:</span>{" "}
            {mgr.ipResult.service_used}
          </div>
          <div>
            <span className="text-neutral-500">Latency:</span>{" "}
            {mgr.ipResult.latency_ms}ms
          </div>
        </div>
      </div>
    )}

    {mgr.currentIps[0] || mgr.currentIps[1] ? (
      <div className="p-4 rounded bg-neutral-800/50 space-y-2">
        <h4 className="text-sm font-semibold">
          {t("ddns.ip.cached_title", "Cached IPs")}
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-neutral-500">IPv4:</span>{" "}
            <span className="font-mono">{mgr.currentIps[0] ?? "—"}</span>
          </div>
          <div>
            <span className="text-neutral-500">IPv6:</span>{" "}
            <span className="font-mono text-xs">
              {mgr.currentIps[1] ?? "—"}
            </span>
          </div>
        </div>
      </div>
    ) : null}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Tab: Scheduler                                                     */
/* ------------------------------------------------------------------ */

const SchedulerTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  useEffect(() => {
    mgr.getSchedulerStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => mgr.startScheduler()}
          disabled={mgr.loading}
          className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-sm"
        >
          <Play size={14} className="inline mr-1" />
          {t("ddns.scheduler.start", "Start")}
        </button>
        <button
          onClick={() => mgr.stopScheduler()}
          disabled={mgr.loading}
          className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-sm"
        >
          <Pause size={14} className="inline mr-1" />
          {t("ddns.scheduler.stop", "Stop")}
        </button>
        <button
          onClick={() => mgr.getSchedulerStatus()}
          className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
        >
          <RefreshCw size={14} className="inline mr-1" />
          {t("ddns.scheduler.refresh", "Refresh")}
        </button>
      </div>

      {mgr.schedulerStatus && (
        <div className="p-4 rounded bg-neutral-800/50 space-y-3">
          <div className="flex items-center gap-3">
            <StatusBadge
              ok={mgr.schedulerStatus.running}
              label={mgr.schedulerStatus.running ? "Running" : "Stopped"}
            />
            <span className="text-xs text-neutral-500">
              {mgr.schedulerStatus.active_entries} active /{" "}
              {mgr.schedulerStatus.paused_entries} paused /{" "}
              {mgr.schedulerStatus.total_entries} total
            </span>
          </div>

          {mgr.schedulerStatus.entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-500 border-b border-neutral-700">
                    <th className="text-left py-1 px-2">Profile</th>
                    <th className="text-left py-1 px-2">Interval</th>
                    <th className="text-left py-1 px-2">Next run</th>
                    <th className="text-left py-1 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mgr.schedulerStatus.entries.map((e) => (
                    <tr
                      key={e.profile_id}
                      className="border-b border-neutral-800"
                    >
                      <td className="py-1.5 px-2 font-mono truncate max-w-[150px]">
                        {e.profile_id.slice(0, 8)}…
                      </td>
                      <td className="py-1.5 px-2">{e.interval_secs}s</td>
                      <td className="py-1.5 px-2 font-mono text-xs">
                        {new Date(e.next_run).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 px-2">
                        <StatusBadge
                          ok={!e.paused}
                          label={e.paused ? "Paused" : "Active"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: Config                                                        */
/* ------------------------------------------------------------------ */

const ConfigTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  useEffect(() => {
    mgr.getConfig();
    mgr.listProviders();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Configuration */}
      {mgr.config && (
        <div className="p-4 rounded bg-neutral-800/50 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Settings size={14} />
            {t("ddns.config.title", "Configuration")}
          </h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              {
                label: t("ddns.config.ipCheckInterval", "IP check interval"),
                value: `${mgr.config.ip_check_interval_secs}s`,
              },
              {
                label: t("ddns.config.httpTimeout", "HTTP timeout"),
                value: `${mgr.config.http_timeout_secs}s`,
              },
              {
                label: t("ddns.config.maxRetries", "Max retries"),
                value: mgr.config.max_retries,
              },
              {
                label: t("ddns.config.backoffBase", "Backoff base"),
                value: `${mgr.config.retry_backoff_base_secs}s`,
              },
              {
                label: t("ddns.config.backoffMax", "Backoff max"),
                value: `${mgr.config.retry_backoff_max_secs}s`,
              },
              {
                label: t("ddns.config.maxAudit", "Max audit entries"),
                value: mgr.config.max_audit_entries,
              },
            ].map((item) => (
              <div key={item.label} className="flex justify-between">
                <span className="text-neutral-500">{item.label}:</span>
                <span className="font-mono">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <StatusBadge
              ok={mgr.config.auto_start_scheduler}
              label={t("ddns.config.autoStart", "Auto-start scheduler")}
            />
            <StatusBadge
              ok={mgr.config.notify_on_ip_change}
              label={t("ddns.config.notifyIp", "Notify IP change")}
            />
            <StatusBadge
              ok={mgr.config.notify_on_failure}
              label={t("ddns.config.notifyFail", "Notify on failure")}
            />
          </div>
        </div>
      )}

      {/* Provider capabilities */}
      {mgr.providers.length > 0 && (
        <div className="p-4 rounded bg-neutral-800/50 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Server size={14} />
            {t("ddns.config.providers", "Supported providers")} ({mgr.providers.length})
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {mgr.providers.map((p: ProviderCapabilities) => (
              <div
                key={p.display_name}
                className="flex items-center gap-2 p-2 rounded bg-neutral-900/50 text-xs"
              >
                <ProviderBadge provider={p.provider} />
                <span className="flex-1 truncate">{p.display_name}</span>
                <div className="flex gap-1">
                  {p.supports_ipv4 && (
                    <span className="text-green-400" title="IPv4">
                      4
                    </span>
                  )}
                  {p.supports_ipv6 && (
                    <span className="text-sky-400" title="IPv6">
                      6
                    </span>
                  )}
                  {p.free_tier && (
                    <span className="text-yellow-400" title="Free tier">
                      ★
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab: Audit                                                         */
/* ------------------------------------------------------------------ */

const AuditTab: React.FC<{ mgr: Mgr; t: (k: string, f?: string) => string }> = ({
  mgr,
  t,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    mgr.getAuditLog();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => mgr.getAuditLog()}
          className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
        >
          <RefreshCw size={12} className="inline mr-1" />
          {t("ddns.audit.refresh", "Refresh")}
        </button>
        <button
          onClick={async () => {
            const json = await mgr.exportAudit();
            if (json) {
              navigator.clipboard.writeText(json);
            }
          }}
          className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
        >
          <Copy size={12} className="inline mr-1" />
          {t("ddns.audit.export", "Export")}
        </button>
        {confirmClear ? (
          <DangerConfirm
            action="clear the audit log"
            onConfirm={() => {
              mgr.clearAudit();
              setConfirmClear(false);
            }}
            onCancel={() => setConfirmClear(false)}
          />
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="px-3 py-1.5 rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs"
          >
            <Trash2 size={12} className="inline mr-1" />
            {t("ddns.audit.clear", "Clear")}
          </button>
        )}
      </div>

      {mgr.auditLog.length === 0 ? (
        <EmptyState
          icon={FileText}
          message={t("ddns.audit.empty", "No audit entries")}
          hint={t("ddns.audit.emptyHint", "Actions will be logged here")}
        />
      ) : (
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {mgr.auditLog.map((e: DdnsAuditEntry) => (
            <div
              key={e.id}
              className="flex items-start gap-2 p-2 rounded bg-neutral-800/50 text-xs"
            >
              {e.success ? (
                <CheckCircle2 size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{e.action}</span>
                  {e.provider && <ProviderBadge provider={e.provider} />}
                  <span className="text-neutral-500">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="text-neutral-400 truncate">{e.detail}</div>
                {e.error && (
                  <div className="text-red-400 truncate">Error: {e.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const tabDefs: { id: DdnsTab; icon: React.FC<{ size?: number }>; label: string }[] = [
  { id: "profiles", icon: Globe, label: "ddns.tabs.profiles" },
  { id: "health", icon: Activity, label: "ddns.tabs.health" },
  { id: "cloudflare", icon: Cloud, label: "ddns.tabs.cloudflare" },
  { id: "ip", icon: Wifi, label: "ddns.tabs.ip" },
  { id: "scheduler", icon: Clock, label: "ddns.tabs.scheduler" },
  { id: "config", icon: Settings, label: "ddns.tabs.config" },
  { id: "audit", icon: FileText, label: "ddns.tabs.audit" },
];

const TabBar: React.FC<{
  active: DdnsTab;
  onSelect: (t: DdnsTab) => void;
  t: (k: string, f?: string) => string;
}> = ({ active, onSelect, t }) => (
  <div className="flex gap-1 px-1 py-1 bg-neutral-900/50 rounded-lg mb-4 overflow-x-auto">
    {tabDefs.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onSelect(tab.id)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
          active === tab.id
            ? "bg-neutral-700 text-white"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
        }`}
      >
        <tab.icon size={14} />
        {t(tab.label, tab.id.toUpperCase())}
      </button>
    ))}
  </div>
);

export const DdnsManager: React.FC<DdnsManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useDdnsManager();
  const [activeTab, setActiveTab] = useState<DdnsTab>("profiles");

  const renderTab = () => {
    switch (activeTab) {
      case "profiles":
        return <ProfilesTab mgr={mgr} t={t} />;
      case "health":
        return <HealthTab mgr={mgr} t={t} />;
      case "cloudflare":
        return <CloudflareTab mgr={mgr} t={t} />;
      case "ip":
        return <IpTab mgr={mgr} t={t} />;
      case "scheduler":
        return <SchedulerTab mgr={mgr} t={t} />;
      case "config":
        return <ConfigTab mgr={mgr} t={t} />;
      case "audit":
        return <AuditTab mgr={mgr} t={t} />;
      default:
        return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalHeader title={t("ddns.title", "DDNS Manager")} />
      <ModalBody>
        <ErrorBanner error={mgr.error} />
        <TabBar active={activeTab} onSelect={setActiveTab} t={t} />
        {renderTab()}
      </ModalBody>
      <ModalFooter>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={() => mgr.triggerUpdateAll()}
              disabled={mgr.loading}
              className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-xs"
            >
              <Zap size={12} className="inline mr-1" />
              {t("ddns.updateAll", "Update all")}
            </button>
            <button
              onClick={async () => {
                const data = await mgr.exportProfiles();
                if (data) navigator.clipboard.writeText(JSON.stringify(data, null, 2));
              }}
              className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
            >
              <Download size={12} className="inline mr-1" />
              {t("ddns.export", "Export")}
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default DdnsManager;
