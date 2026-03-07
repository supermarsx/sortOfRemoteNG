import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Network,
  Package,
  ClipboardList,
  Disc,
  Monitor,
  FileText,
  Users,
  Settings,
  ShieldCheck,
  HeartPulse,
  Activity,
  Terminal,
  Loader2,
  CheckCircle,
  AlertCircle,
  XCircle,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import type { SubProps } from "./types";

// ── Network View ─────────────────────────────────────────────────

export const NetworkView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.networkAdapters.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {mgr.networkAdapters.map((adapter) => (
        <div key={adapter.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Network className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">{adapter.name}</h3>
            <span className="text-[10px] text-[var(--color-text-secondary)]">{adapter.model ?? ""}</span>
          </div>
          {adapter.ports.length > 0 && (
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  <th className="text-left py-1">Port</th>
                  <th className="text-left py-1">MAC</th>
                  <th className="text-left py-1">Link</th>
                  <th className="text-right py-1">Speed</th>
                </tr>
              </thead>
              <tbody>
                {adapter.ports.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1 text-[var(--color-text)]">{p.name}</td>
                    <td className="py-1 text-[var(--color-text-secondary)]">{p.macAddress ?? "—"}</td>
                    <td className="py-1">
                      <span className={p.linkStatus?.toLowerCase() === "up" ? "text-success" : "text-[var(--color-text-secondary)]"}>
                        {p.linkStatus ?? "—"}
                      </span>
                    </td>
                    <td className="py-1 text-right text-[var(--color-text)]">
                      {p.currentSpeedGbps != null ? `${p.currentSpeedGbps} Gbps` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {mgr.networkConfig && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text)] mb-3">{t("idrac.network.management", "iDRAC Management Network")}</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {[
              ["IPv4", mgr.networkConfig.ipv4Address],
              ["Subnet", mgr.networkConfig.ipv4Subnet],
              ["Gateway", mgr.networkConfig.ipv4Gateway],
              ["MAC", mgr.networkConfig.macAddress],
              ["Hostname", mgr.networkConfig.hostname],
              ["Domain", mgr.networkConfig.domainName],
              ["DNS", mgr.networkConfig.dnsServers.join(", ") || "N/A"],
              ["VLAN", mgr.networkConfig.vlanEnable ? `ID ${mgr.networkConfig.vlanId}` : "Disabled"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <span className="text-[10px] text-[var(--color-text-secondary)] w-20 shrink-0">{label}:</span>
                <span className="text-[10px] text-[var(--color-text)]">{value ?? "N/A"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Firmware View ────────────────────────────────────────────────

export const FirmwareView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.firmware.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-warning" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.firmware.inventory", "Firmware Inventory")}</h3>
          <span className="text-[10px] text-[var(--color-text-secondary)]">({mgr.firmware.length} components)</span>
        </div>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
              <th className="text-left py-1">Component</th>
              <th className="text-left py-1">Version</th>
              <th className="text-left py-1">Install Date</th>
              <th className="text-center py-1">Updateable</th>
              <th className="text-center py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {mgr.firmware.map((fw) => (
              <tr key={fw.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 text-[var(--color-text)]">{fw.name}</td>
                <td className="py-1 text-[var(--color-text)]">{fw.version}</td>
                <td className="py-1 text-[var(--color-text-secondary)]">{fw.installDate ?? "—"}</td>
                <td className="py-1 text-center">{fw.updateable ? <CheckCircle className="w-3 h-3 text-success inline" /> : <XCircle className="w-3 h-3 text-[var(--color-text-secondary)] inline" />}</td>
                <td className="py-1 text-center"><span className={fw.status.health?.toLowerCase() === "ok" ? "text-success" : "text-warning"}>{fw.status.health ?? "N/A"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Lifecycle View ───────────────────────────────────────────────

export const LifecycleView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.jobs.length === 0 && !mgr.lcStatus) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] text-[var(--color-text-secondary)]">LC Status: <span className="text-[var(--color-text)]">{mgr.lcStatus ?? "Unknown"}</span></span>
        <button onClick={() => mgr.purgeJobQueue()} className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] text-error hover:bg-error/10">
          <Trash2 className="w-3 h-3 inline mr-1" />{t("idrac.lifecycle.purge", "Purge All Jobs")}
        </button>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="w-4 h-4 text-warning" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.lifecycle.jobs", "Lifecycle Jobs")}</h3>
        </div>
        {mgr.jobs.length === 0 ? (
          <p className="text-[10px] text-[var(--color-text-secondary)]">{t("idrac.lifecycle.no_jobs", "No jobs found")}</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">ID</th>
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">State</th>
                <th className="text-right py-1">Progress</th>
                <th className="text-left py-1">Message</th>
              </tr>
            </thead>
            <tbody>
              {mgr.jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1 text-[var(--color-text)]">{j.id}</td>
                  <td className="py-1 text-[var(--color-text)]">{j.name ?? "—"}</td>
                  <td className="py-1"><span className={j.jobState.toLowerCase().includes("completed") ? "text-success" : j.jobState.toLowerCase().includes("failed") ? "text-error" : "text-warning"}>{j.jobState}</span></td>
                  <td className="py-1 text-right text-[var(--color-text)]">{j.percentComplete != null ? `${j.percentComplete}%` : "—"}</td>
                  <td className="py-1 text-[var(--color-text-secondary)] truncate max-w-[200px]">{j.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ── Virtual Media View ───────────────────────────────────────────

export const VirtualMediaView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.virtualMedia.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {mgr.virtualMedia.map((vm) => (
        <div key={vm.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Disc className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">{vm.name}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${vm.inserted ? "bg-success/10 text-success" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)]"}`}>
              {vm.inserted ? "Inserted" : "Empty"}
            </span>
          </div>
          {vm.image && <p className="text-[10px] text-[var(--color-text-secondary)] mb-2">Image: {vm.image}</p>}
          <div className="flex gap-2">
            {vm.inserted && (
              <button onClick={() => mgr.unmountVirtualMedia(vm.id)} className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] text-error hover:bg-error/10">
                Eject
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Console View ─────────────────────────────────────────────────

export const ConsoleView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const ci = mgr.consoleInfo;
  if (mgr.loading && !ci) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Monitor className="w-4 h-4 text-success" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.console.info", "Virtual Console")}</h3>
        </div>
        {ci ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div><span className="text-[var(--color-text-secondary)]">Type:</span> <span className="text-[var(--color-text)]">{ci.consoleType}</span></div>
              <div><span className="text-[var(--color-text-secondary)]">Enabled:</span> <span className={ci.enabled ? "text-success" : "text-error"}>{ci.enabled ? "Yes" : "No"}</span></div>
              <div><span className="text-[var(--color-text-secondary)]">Max Sessions:</span> <span className="text-[var(--color-text)]">{ci.maxSessions ?? "—"}</span></div>
              <div><span className="text-[var(--color-text-secondary)]">Encryption:</span> <span className="text-[var(--color-text)]">{ci.sslEncryptionBits ? `${ci.sslEncryptionBits}-bit` : "—"}</span></div>
            </div>
            {ci.url && (
              <a href={ci.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                <Monitor className="w-3 h-3" /> Open Console
              </a>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-[var(--color-text-secondary)]">{t("idrac.no_data", "No data available")}</p>
        )}
      </div>
    </div>
  );
};

// ── Event Log View ───────────────────────────────────────────────

export const EventLogView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [logTab, setLogTab] = useState<"sel" | "lc">("sel");
  const entries = logTab === "sel" ? mgr.selEntries : mgr.lcLogEntries;

  if (mgr.loading && mgr.selEntries.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setLogTab("sel")} className={`text-[10px] px-3 py-1.5 rounded-lg border ${logTab === "sel" ? "border-warning text-warning bg-warning/10" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
          SEL ({mgr.selEntries.length})
        </button>
        <button onClick={() => setLogTab("lc")} className={`text-[10px] px-3 py-1.5 rounded-lg border ${logTab === "lc" ? "border-warning text-warning bg-warning/10" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
          LC Log ({mgr.lcLogEntries.length})
        </button>
        <div className="ml-auto flex gap-1">
          <button onClick={() => mgr.clearSel()} className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] text-error hover:bg-error/10">Clear SEL</button>
          <button onClick={() => mgr.clearLcLog()} className="text-[10px] px-2 py-1 rounded border border-[var(--color-border)] text-error hover:bg-error/10">Clear LC</button>
        </div>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 max-h-[70vh] overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
              <th className="text-left py-1">ID</th>
              <th className="text-left py-1">Severity</th>
              <th className="text-left py-1">Message</th>
              <th className="text-left py-1">Date</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 text-[var(--color-text)]">{e.id}</td>
                <td className="py-1"><span className={e.severity.toLowerCase() === "critical" ? "text-error" : e.severity.toLowerCase() === "warning" ? "text-warning" : "text-[var(--color-text-secondary)]"}>{e.severity}</span></td>
                <td className="py-1 text-[var(--color-text)] truncate max-w-[400px]">{e.message}</td>
                <td className="py-1 text-[var(--color-text-secondary)]">{e.created ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Users View ───────────────────────────────────────────────────

export const UsersView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.users.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.users.local", "Local Users")}</h3>
        </div>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
              <th className="text-left py-1">Slot</th>
              <th className="text-left py-1">Username</th>
              <th className="text-left py-1">Role</th>
              <th className="text-center py-1">Enabled</th>
              <th className="text-center py-1">Locked</th>
              <th className="text-center py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mgr.users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 text-[var(--color-text)]">{u.id}</td>
                <td className="py-1 text-[var(--color-text)]">{u.name || <span className="text-[var(--color-text-secondary)] italic">empty</span>}</td>
                <td className="py-1 text-[var(--color-text-secondary)]">{u.roleId}</td>
                <td className="py-1 text-center">{u.enabled ? <CheckCircle className="w-3 h-3 text-success inline" /> : <XCircle className="w-3 h-3 text-[var(--color-text-secondary)] inline" />}</td>
                <td className="py-1 text-center">{u.locked ? <AlertCircle className="w-3 h-3 text-error inline" /> : "—"}</td>
                <td className="py-1 text-center">
                  {u.name && (
                    <button onClick={() => mgr.requestConfirm("Delete User", `Delete user "${u.name}" in slot ${u.id}?`, () => mgr.deleteUser(u.id))} className="text-error hover:text-error">
                      <Trash2 className="w-3 h-3 inline" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── BIOS View ────────────────────────────────────────────────────

export const BiosView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  if (mgr.loading && mgr.biosAttributes.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  const filtered = mgr.biosAttributes.filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || (a.displayName?.toLowerCase().includes(filter.toLowerCase()) ?? false));
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {mgr.bootConfig && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 mb-3">
          <h3 className="text-xs font-semibold text-[var(--color-text)] mb-2">{t("idrac.bios.boot", "Boot Configuration")}</h3>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div><span className="text-[var(--color-text-secondary)]">Boot Mode:</span> <span className="text-[var(--color-text)]">{mgr.bootConfig.bootMode}</span></div>
            <div><span className="text-[var(--color-text-secondary)]">Override:</span> <span className="text-[var(--color-text)]">{mgr.bootConfig.bootSourceOverrideTarget ?? "None"}</span></div>
          </div>
          <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
            Boot Order: {mgr.bootConfig.bootOrder.join(" → ") || "N/A"}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-warning/50" placeholder="Filter BIOS attributes..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-[10px] text-[var(--color-text-secondary)]">{filtered.length} attrs</span>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 max-h-[65vh] overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
              <th className="text-left py-1">Attribute</th>
              <th className="text-left py-1">Value</th>
              <th className="text-left py-1">Type</th>
              <th className="text-center py-1">Read Only</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.name} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 text-[var(--color-text)]">{a.displayName ?? a.name}</td>
                <td className="py-1 text-[var(--color-text)] max-w-[200px] truncate">{String(a.value)}</td>
                <td className="py-1 text-[var(--color-text-secondary)]">{a.attributeType ?? "—"}</td>
                <td className="py-1 text-center">{a.readOnly ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Certificates View ────────────────────────────────────────────

export const CertificatesView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  if (mgr.loading && mgr.certificates.length === 0) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-success" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.certs.title", "SSL Certificates")}</h3>
        </div>
        {mgr.certificates.length === 0 ? (
          <p className="text-[10px] text-[var(--color-text-secondary)]">No certificates found</p>
        ) : (
          <div className="space-y-3">
            {mgr.certificates.map((c) => (
              <div key={c.id} className="border border-[var(--color-border)] rounded-lg p-3 space-y-1">
                <div className="text-[10px]"><span className="text-[var(--color-text-secondary)]">Subject:</span> <span className="text-[var(--color-text)]">{c.subject}</span></div>
                <div className="text-[10px]"><span className="text-[var(--color-text-secondary)]">Issuer:</span> <span className="text-[var(--color-text)]">{c.issuer}</span></div>
                <div className="text-[10px]"><span className="text-[var(--color-text-secondary)]">Valid:</span> <span className="text-[var(--color-text)]">{c.validFrom} → {c.validTo}</span></div>
                <div className="text-[10px]"><span className="text-[var(--color-text-secondary)]">Serial:</span> <span className="text-[var(--color-text)]">{c.serialNumber}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Health View ──────────────────────────────────────────────────

export const HealthView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const hr = mgr.healthRollup;
  if (mgr.loading && !hr) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  if (!hr) {
    return <div className="flex items-center justify-center flex-1 text-xs text-[var(--color-text-secondary)]">{t("idrac.no_data", "No data available")}</div>;
  }

  const healthColor = (h?: string) => {
    const v = (h ?? "").toLowerCase();
    if (v === "ok" || v === "healthy") return "text-success";
    if (v === "warning") return "text-warning";
    if (v === "critical" || v === "error") return "text-error";
    return "text-[var(--color-text-secondary)]";
  };

  const components = [
    ["Overall", hr.overallHealth],
    ["System", hr.system.health],
    ["Processors", hr.processors.health],
    ["Memory", hr.memory.health],
    ["Storage", hr.storage.health],
    ["Fans", hr.fans.health],
    ["Temperatures", hr.temperatures.health],
    ["Power Supplies", hr.powerSupplies.health],
    ["Network", hr.network.health],
    ["iDRAC", hr.idrac.health],
    ["Voltage", hr.voltage.health],
    ["Intrusion", hr.intrusion.health],
    ["Batteries", hr.batteries.health],
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-4">
          <HeartPulse className="w-4 h-4 text-error" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.health.rollup", "Health Rollup")}</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {components.map(([label, health]) => (
            <div key={label} className="flex items-center gap-2 p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div className={`w-2 h-2 rounded-full ${healthColor(health as string)} ${health ? "bg-current" : "bg-text-secondary"}`} />
              <span className="text-[10px] text-[var(--color-text-secondary)]">{label}</span>
              <span className={`ml-auto text-[10px] font-medium ${healthColor(health as string)}`}>{(health as string) ?? "N/A"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Telemetry View ───────────────────────────────────────────────

export const TelemetryView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const pt = mgr.powerTelemetry;
  const tt = mgr.thermalTelemetry;
  if (mgr.loading && !pt && !tt) {
    return <div className="flex items-center justify-center flex-1"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-secondary)]" /></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {pt && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text)] mb-3">{t("idrac.telemetry.power", "Power Telemetry")}</h3>
          <div className="grid grid-cols-4 gap-3">
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Current</p><p className="text-sm font-semibold text-[var(--color-text)]">{pt.currentWatts} W</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Peak</p><p className="text-sm font-semibold text-[var(--color-text)]">{pt.peakWatts} W</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Min</p><p className="text-sm font-semibold text-[var(--color-text)]">{pt.minWatts} W</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Average</p><p className="text-sm font-semibold text-[var(--color-text)]">{pt.averageWatts} W</p></div>
          </div>
          {pt.history.length > 0 && (
            <div className="mt-3 text-[10px] text-[var(--color-text-secondary)]">{pt.history.length} data points over {pt.timeWindowMinutes} min</div>
          )}
        </div>
      )}
      {tt && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text)] mb-3">{t("idrac.telemetry.thermal", "Thermal Telemetry")}</h3>
          <div className="grid grid-cols-4 gap-3">
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Inlet</p><p className="text-sm font-semibold text-[var(--color-text)]">{tt.inletTempCelsius ?? "N/A"} °C</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Exhaust</p><p className="text-sm font-semibold text-[var(--color-text)]">{tt.exhaustTempCelsius ?? "N/A"} °C</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Peak Inlet</p><p className="text-sm font-semibold text-[var(--color-text)]">{tt.peakInletCelsius ?? "N/A"} °C</p></div>
            <div><p className="text-[10px] text-[var(--color-text-secondary)]">Avg Inlet</p><p className="text-sm font-semibold text-[var(--color-text)]">{tt.averageInletCelsius ?? "N/A"} °C</p></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── RACADM View ──────────────────────────────────────────────────

export const RacadmView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [command, setCommand] = useState("");
  const [executing, setExecuting] = useState(false);

  const execute = async () => {
    if (!command.trim()) return;
    setExecuting(true);
    try {
      await mgr.racadmExecute(command.trim());
    } catch {
      // error is surfaced through mgr.racadmOutput or mgr.dataError
    }
    setExecuting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Terminal className="w-4 h-4 text-success" />
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{t("idrac.racadm.title", "RACADM Console")}</h3>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] font-mono focus:outline-none focus:ring-1 focus:ring-warning/50"
            placeholder="racadm getsysinfo"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && execute()}
            disabled={executing}
          />
          <button
            onClick={execute}
            disabled={executing || !command.trim()}
            className="px-3 py-2 rounded-lg bg-warning hover:bg-warning/90 text-white text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {executing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Execute
          </button>
          <button
            onClick={() => mgr.requestConfirm("Reset iDRAC", "Are you sure you want to reset the iDRAC?", () => mgr.resetIdrac())}
            className="px-3 py-2 rounded-lg border border-error/30 text-error hover:bg-error/10 text-xs transition-colors"
          >
            Reset iDRAC
          </button>
        </div>
        {mgr.racadmOutput && (
          <div className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-3">
            <div className="flex items-center gap-2 mb-2 text-[10px]">
              <span className="text-[var(--color-text-secondary)]">$ {mgr.racadmOutput.command}</span>
              <span className={mgr.racadmOutput.success ? "text-success" : "text-error"}>
                (rc={mgr.racadmOutput.returnCode})
              </span>
            </div>
            <pre className="text-[10px] text-[var(--color-text)] font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
              {mgr.racadmOutput.output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
