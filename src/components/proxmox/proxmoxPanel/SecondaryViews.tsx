import React from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Shield,
  Boxes,
  HeartPulse,
  Database,
  RefreshCw,
  Terminal,
} from "lucide-react";
import type { SubProps } from "./types";

/** Backup Jobs view */
export const BackupsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <ViewHeader
        icon={Archive}
        color="text-amber-500"
        title={t("proxmox.backups.title", "Backup Jobs")}
        count={mgr.backupJobs.length}
        onRefresh={mgr.refreshBackups}
        refreshing={mgr.refreshing}
      />
      {mgr.backupJobs.length === 0 ? (
        <EmptyState icon={Archive} message={t("proxmox.backups.noJobs", "No backup jobs configured")} />
      ) : (
        <div className="space-y-2">
          {mgr.backupJobs.map((job, i) => (
            <div key={job.id ?? i} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">{job.id ?? `Job ${i + 1}`}</div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">
                    {job.schedule ?? "no schedule"} — {job.storage ?? "default"} — {job.mode ?? "snapshot"}
                  </div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  job.enabled !== false ? "bg-green-500/15 text-green-400" : "bg-gray-500/15 text-gray-400"
                }`}>
                  {job.enabled !== false ? "enabled" : "disabled"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Firewall view */
export const FirewallView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <ViewHeader
        icon={Shield}
        color="text-rose-500"
        title={t("proxmox.firewall.title", "Cluster Firewall")}
        count={mgr.firewallRules.length}
        onRefresh={mgr.refreshFirewall}
        refreshing={mgr.refreshing}
      />
      {mgr.firewallOptions && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)]">
          Firewall: {mgr.firewallOptions.enable ? "enabled" : "disabled"} | Policy IN: {mgr.firewallOptions.policyIn ?? "—"} | Policy OUT: {mgr.firewallOptions.policyOut ?? "—"}
        </div>
      )}
      {mgr.firewallRules.length === 0 ? (
        <EmptyState icon={Shield} message={t("proxmox.firewall.noRules", "No firewall rules")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                <th className="pb-2 pr-3">#</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2 pr-3">Source</th>
                <th className="pb-2 pr-3">Dest</th>
                <th className="pb-2 pr-3">Proto</th>
                <th className="pb-2">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {mgr.firewallRules.map((rule, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]">
                  <td className="py-1.5 pr-3">{rule.pos ?? i}</td>
                  <td className="py-1.5 pr-3">{rule.ruleType ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      rule.action === "ACCEPT" ? "bg-green-500/15 text-green-400" :
                      rule.action === "DROP" ? "bg-red-500/15 text-red-400" :
                      "bg-yellow-500/15 text-yellow-400"
                    }`}>
                      {rule.action}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{rule.source ?? "any"}</td>
                  <td className="py-1.5 pr-3">{rule.dest ?? "any"}</td>
                  <td className="py-1.5 pr-3">{rule.proto ?? "—"}</td>
                  <td className="py-1.5">{rule.enable ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/** Pools view */
export const PoolsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <ViewHeader
        icon={Boxes}
        color="text-violet-500"
        title={t("proxmox.pools.title", "Resource Pools")}
        count={mgr.pools.length}
        onRefresh={mgr.refreshPools}
        refreshing={mgr.refreshing}
      />
      {mgr.pools.length === 0 ? (
        <EmptyState icon={Boxes} message={t("proxmox.pools.noPools", "No resource pools")} />
      ) : (
        <div className="space-y-2">
          {mgr.pools.map((pool) => (
            <div key={pool.poolid} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="text-sm font-medium text-[var(--color-text)]">{pool.poolid}</div>
              {pool.comment && <div className="text-[10px] text-[var(--color-text-secondary)]">{pool.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** HA view */
export const HaView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <ViewHeader
        icon={HeartPulse}
        color="text-pink-500"
        title={t("proxmox.ha.title", "High Availability")}
        count={mgr.haResources.length}
        onRefresh={mgr.refreshHa}
        refreshing={mgr.refreshing}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Resources */}
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">Resources ({mgr.haResources.length})</h4>
          {mgr.haResources.length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)]">No HA resources</div>
          ) : (
            <div className="space-y-1.5">
              {mgr.haResources.map((r) => (
                <div key={r.sid} className="p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs">
                  <div className="font-medium text-[var(--color-text)]">{r.sid}</div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">
                    state: {r.state ?? "—"} | group: {r.group ?? "—"} | max relocate: {r.maxRelocate ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        {/* Groups */}
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">Groups ({mgr.haGroups.length})</h4>
          {mgr.haGroups.length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)]">No HA groups</div>
          ) : (
            <div className="space-y-1.5">
              {mgr.haGroups.map((g) => (
                <div key={g.group} className="p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs">
                  <div className="font-medium text-[var(--color-text)]">{g.group}</div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">
                    nodes: {g.nodes ?? "—"} | restricted: {g.restricted ? "yes" : "no"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

/** Ceph view */
export const CephView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <ViewHeader
        icon={Database}
        color="text-red-500"
        title={t("proxmox.ceph.title", "Ceph Storage")}
        count={mgr.cephPools.length}
        onRefresh={() => node && mgr.refreshCeph(node)}
        refreshing={mgr.refreshing}
      />
      {mgr.cephStatus && (
        <div className="mb-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="text-xs text-[var(--color-text-secondary)]">
            Health: <span className="font-medium text-[var(--color-text)]">{mgr.cephStatus.health?.status ?? "—"}</span>
          </div>
        </div>
      )}
      {mgr.cephPools.length === 0 ? (
        <EmptyState icon={Database} message={t("proxmox.ceph.noPools", "No Ceph pools")} />
      ) : (
        <div className="space-y-2">
          {mgr.cephPools.map((pool) => (
            <div key={pool.poolName ?? pool.pool} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="text-sm font-medium text-[var(--color-text)]">{pool.poolName ?? `Pool ${pool.pool}`}</div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">
                size: {pool.size ?? "—"} | pg: {pool.pgNum ?? "—"} | crush rule: {pool.crushRule ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Console view — entry point for opening consoles */
export const ConsoleView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Terminal className="w-4 h-4 text-cyan-500" />
        {t("proxmox.console.title", "Console Access")}
      </h3>

      {/* Node console */}
      {node && (
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
            {t("proxmox.console.nodeConsole", "Node Console")}
          </h4>
          <button
            onClick={() => mgr.openNodeConsole(node)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            {t("proxmox.console.openNode", "Open Node Shell")} ({node})
          </button>
        </div>
      )}

      {/* VM/CT consoles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* QEMU VMs */}
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">QEMU VMs</h4>
          {mgr.qemuVms.filter(v => v.status === "running").length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)]">No running VMs</div>
          ) : (
            <div className="space-y-1.5">
              {mgr.qemuVms.filter(v => v.status === "running").map((vm) => (
                <div key={vm.vmid} className="flex items-center justify-between p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <span className="text-xs text-[var(--color-text)]">{vm.name || `VM ${vm.vmid}`}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => node && mgr.openVncConsole(node, vm.vmid, "qemu")}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
                    >
                      VNC
                    </button>
                    <button
                      onClick={() => node && mgr.openTermConsole(node, vm.vmid, "qemu")}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors"
                    >
                      xterm
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        {/* LXC Containers */}
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">LXC Containers</h4>
          {mgr.lxcContainers.filter(c => c.status === "running").length === 0 ? (
            <div className="text-xs text-[var(--color-text-secondary)]">No running containers</div>
          ) : (
            <div className="space-y-1.5">
              {mgr.lxcContainers.filter(c => c.status === "running").map((ct) => (
                <div key={ct.vmid} className="flex items-center justify-between p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <span className="text-xs text-[var(--color-text)]">{ct.name || `CT ${ct.vmid}`}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => node && mgr.openVncConsole(node, ct.vmid, "lxc")}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
                    >
                      VNC
                    </button>
                    <button
                      onClick={() => node && mgr.openTermConsole(node, ct.vmid, "lxc")}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors"
                    >
                      xterm
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// ── Shared helpers ──────────────────────────────────────────────

const ViewHeader: React.FC<{
  icon: React.FC<{ className?: string }>;
  color: string;
  title: string;
  count: number;
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ icon: Icon, color, title, count, onRefresh, refreshing }) => (
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
      <Icon className={`w-4 h-4 ${color}`} />
      {title}
      <span className="text-xs font-normal text-[var(--color-text-secondary)]">({count})</span>
    </h3>
    <button
      onClick={onRefresh}
      className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
    </button>
  </div>
);

const EmptyState: React.FC<{
  icon: React.FC<{ className?: string }>;
  message: string;
}> = ({ icon: Icon, message }) => (
  <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
    <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" />
    {message}
  </div>
);
