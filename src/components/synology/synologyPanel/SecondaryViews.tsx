import React from "react";
import { useTranslation } from "react-i18next";
import {
  Share2,
  Network,
  Users,
  Package,
  Settings2,
  Container,
  Monitor,
  Download,
  Camera,
  Archive,
  Shield,
  Cpu,
  ScrollText,
  Bell,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Lock,
  Unlock,
  Fan,
  Thermometer,
  Zap,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { SubProps } from "./types";

/* ─── Helpers ─────────────────────────────────────────────────── */

const EmptyState: React.FC<{
  icon: React.FC<{ className?: string }>;
  message: string;
}> = ({ icon: Icon, message }) => (
  <div className="text-center py-12 text-sm text-[var(--color-textSecondary)]">
    <Icon className="w-8 h-8 mx-auto opacity-40 mb-2" />
    {message}
  </div>
);

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

/* ─── Shares View ─────────────────────────────────────────────── */

export const SharesView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Share2 className="w-4 h-4 text-teal-500" />
        {t("synology.shares.title", "Shared Folders")} ({mgr.sharedFolders.length})
      </h3>
      {mgr.sharedFolders.length === 0 ? (
        <EmptyState icon={Share2} message={t("synology.shares.empty", "No shared folders")} />
      ) : (
        <div className="space-y-2">
          {mgr.sharedFolders.map((f) => (
            <div key={f.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">{f.name}</div>
                  <div className="text-[10px] text-[var(--color-textSecondary)]">
                    {f.vol_path ?? "—"} {f.desc ? `— ${f.desc}` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  {f.is_aclmode && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                      ACL
                    </span>
                  )}
                  {f.encryption !== undefined && f.encryption !== 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">
                      <Lock className="w-3 h-3 inline" /> Encrypted
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Network View ────────────────────────────────────────────── */

export const NetworkView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Network className="w-4 h-4 text-teal-500" />
        {t("synology.network.title", "Network")}
      </h3>

      {/* Interfaces */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Interfaces ({mgr.networkInterfaces.length})
        </h4>
        {mgr.networkInterfaces.length > 0 ? (
          <div className="space-y-2">
            {mgr.networkInterfaces.map((iface) => (
              <div key={iface.id ?? iface.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[var(--color-text)]">{iface.name ?? iface.id}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${iface.status === "up" ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                    {iface.status ?? "—"}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)] mt-1">
                  IP: {iface.ip ?? "—"} | MAC: {iface.mac ?? "—"} | Speed: {iface.speed ?? "—"} Mbps
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Network} message="No interfaces found" />
        )}
      </section>

      {/* Firewall */}
      {mgr.firewallRules.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
            Firewall Rules ({mgr.firewallRules.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Source</th>
                  <th className="pb-2 pr-3">Ports</th>
                  <th className="pb-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {mgr.firewallRules.map((rule, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]/50">
                    <td className="py-1.5 pr-3 text-[var(--color-text)]">{i + 1}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{rule.source_ip ?? "Any"}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{rule.ports ?? "All"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${rule.action === "allow" ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                        {rule.action}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

/* ─── Users View ──────────────────────────────────────────────── */

export const UsersView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Users className="w-4 h-4 text-teal-500" />
        {t("synology.users.title", "Users & Groups")}
      </h3>

      {/* Users */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Users ({mgr.users.length})
        </h4>
        {mgr.users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Description</th>
                  <th className="pb-2 pr-3">Email</th>
                  <th className="pb-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {mgr.users.map((u) => (
                  <tr key={u.name} className="border-b border-[var(--color-border)]/50">
                    <td className="py-1.5 pr-3 font-medium text-[var(--color-text)]">{u.name}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{u.description ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{u.email ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.expired === "false" || u.expired === undefined ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                        {u.expired === "true" ? "disabled" : "active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Users} message="No users found" />
        )}
      </section>

      {/* Groups */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Groups ({mgr.groups.length})
        </h4>
        {mgr.groups.length > 0 ? (
          <div className="space-y-2">
            {mgr.groups.map((g) => (
              <div key={g.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="text-sm font-medium text-[var(--color-text)]">{g.name}</div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {g.description ?? "—"} | Members: {g.members?.length ?? 0}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Users} message="No groups found" />
        )}
      </section>
    </div>
  );
};

/* ─── Packages View ───────────────────────────────────────────── */

export const PackagesView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Package className="w-4 h-4 text-teal-500" />
        {t("synology.packages.title", "Package Center")} ({mgr.packages.length})
      </h3>
      {mgr.packages.length === 0 ? (
        <EmptyState icon={Package} message="No packages installed" />
      ) : (
        <div className="space-y-2">
          {mgr.packages.map((pkg) => (
            <div key={pkg.id} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">{pkg.dname ?? pkg.id}</div>
                  <div className="text-[10px] text-[var(--color-textSecondary)]">
                    v{pkg.version ?? "?"} {pkg.additional?.description ? `— ${pkg.additional.description}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${pkg.additional?.status === "running" ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                    {pkg.additional?.status ?? "stopped"}
                  </span>
                  {pkg.additional?.status === "running" ? (
                    <button onClick={() => mgr.stopPackage(pkg.id)} className="p-1 rounded hover:bg-error/10 text-error transition-colors" title="Stop">
                      <Square className="w-3 h-3" />
                    </button>
                  ) : (
                    <button onClick={() => mgr.startPackage(pkg.id)} className="p-1 rounded hover:bg-success/10 text-success transition-colors" title="Start">
                      <Play className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Services View ───────────────────────────────────────────── */

export const ServicesView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-teal-500" />
        {t("synology.services.title", "Services")}
      </h3>

      {/* SMB */}
      {mgr.smbConfig && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-[var(--color-text)]">SMB/CIFS</div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.smbConfig.enable_smb ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
              {mgr.smbConfig.enable_smb ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] mt-1">
            Workgroup: {mgr.smbConfig.workgroup ?? "—"} | Max Protocol: {mgr.smbConfig.max_protocol ?? "—"}
          </div>
        </div>
      )}

      {/* NFS */}
      {mgr.nfsConfig && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-[var(--color-text)]">NFS</div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.nfsConfig.enable_nfs ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
              {mgr.nfsConfig.enable_nfs ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] mt-1">
            NFSv4: {mgr.nfsConfig.enable_nfs_v4 ? "Yes" : "No"}
          </div>
        </div>
      )}

      {/* SSH */}
      {mgr.sshConfig && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-[var(--color-text)]">SSH</div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.sshConfig.enable_ssh ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
              {mgr.sshConfig.enable_ssh ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] mt-1">
            Port: {mgr.sshConfig.ssh_port ?? "—"}
          </div>
        </div>
      )}

      {/* Service list */}
      {mgr.services.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
            All Services ({mgr.services.length})
          </h4>
          <div className="space-y-1">
            {mgr.services.map((svc) => (
              <div key={svc.id ?? svc.name} className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <span className="text-xs font-medium text-[var(--color-text)]">{svc.name ?? svc.id}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${svc.enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                  {svc.enabled ? "running" : "stopped"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

/* ─── Docker View ─────────────────────────────────────────────── */

export const DockerView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Container className="w-4 h-4 text-teal-500" />
        {t("synology.docker.title", "Container Manager")}
      </h3>

      {/* Containers */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Containers ({mgr.dockerContainers.length})
        </h4>
        {mgr.dockerContainers.length > 0 ? (
          <div className="space-y-2">
            {mgr.dockerContainers.map((c) => (
              <div key={c.name ?? c.id} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">{c.name ?? c.id}</div>
                    <div className="text-[10px] text-[var(--color-textSecondary)] truncate">{c.image ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.state === "running" ? "bg-success/15 text-success" : c.state === "exited" ? "bg-text-secondary/15 text-text-muted" : "bg-warning/15 text-warning"}`}>
                      {c.state ?? c.status}
                    </span>
                    {c.state === "running" ? (
                      <>
                        <button onClick={() => mgr.restartContainer(c.name ?? c.id ?? "")} className="p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="Restart">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <button onClick={() => mgr.stopContainer(c.name ?? c.id ?? "")} className="p-1 rounded hover:bg-error/10 text-error transition-colors" title="Stop">
                          <Square className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => mgr.startContainer(c.name ?? c.id ?? "")} className="p-1 rounded hover:bg-success/10 text-success transition-colors" title="Start">
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Container} message="No containers found" />
        )}
      </section>

      {/* Images */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Images ({mgr.dockerImages.length})
        </h4>
        {mgr.dockerImages.length > 0 ? (
          <div className="space-y-1">
            {mgr.dockerImages.map((img, i) => (
              <div key={img.id ?? i} className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <span className="text-xs text-[var(--color-text)] truncate flex-1 min-w-0">{img.repository ?? img.id}</span>
                <span className="text-[10px] text-[var(--color-textSecondary)] ml-2">{img.tags?.join(", ") ?? "—"}</span>
                <span className="text-[10px] text-[var(--color-textSecondary)] ml-2">{img.virtual_size ? formatBytes(img.virtual_size) : "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Container} message="No images found" />
        )}
      </section>

      {/* Projects */}
      {mgr.dockerProjects.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
            Compose Projects ({mgr.dockerProjects.length})
          </h4>
          <div className="space-y-1">
            {mgr.dockerProjects.map((p) => (
              <div key={p.name} className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <span className="text-xs font-medium text-[var(--color-text)]">{p.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === "running" ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

/* ─── VMs View ────────────────────────────────────────────────── */

export const VmsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Monitor className="w-4 h-4 text-teal-500" />
        {t("synology.vms.title", "Virtual Machine Manager")} ({mgr.vms.length})
      </h3>
      {mgr.vms.length === 0 ? (
        <EmptyState icon={Monitor} message="No virtual machines found" />
      ) : (
        <div className="space-y-2">
          {mgr.vms.map((vm) => (
            <div key={vm.guest_id ?? vm.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">{vm.name ?? vm.guest_id}</div>
                  <div className="text-[10px] text-[var(--color-textSecondary)]">
                    {vm.vcpu_num ?? "—"} vCPU | {vm.vram_size ? `${vm.vram_size} MB` : "—"} RAM | {vm.autorun ? "Autostart" : "Manual"}
                  </div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${vm.status === "running" ? "bg-success/15 text-success" : vm.status === "shutdown" ? "bg-text-secondary/15 text-text-muted" : "bg-warning/15 text-warning"}`}>
                  {vm.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Downloads View ──────────────────────────────────────────── */

export const DownloadsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Download className="w-4 h-4 text-teal-500" />
        {t("synology.downloads.title", "Download Station")}
      </h3>

      {/* Stats */}
      {mgr.downloadStats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] text-center">
            <div className="text-lg font-semibold text-success">
              {formatBytes(mgr.downloadStats.speed_download ?? 0)}/s
            </div>
            <div className="text-[10px] text-[var(--color-textSecondary)]">Download Speed</div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] text-center">
            <div className="text-lg font-semibold text-primary">
              {formatBytes(mgr.downloadStats.speed_upload ?? 0)}/s
            </div>
            <div className="text-[10px] text-[var(--color-textSecondary)]">Upload Speed</div>
          </div>
        </div>
      )}

      {/* Tasks */}
      {mgr.downloadTasks.length > 0 ? (
        <div className="space-y-2">
          {mgr.downloadTasks.map((task) => {
            const dl = task.size_downloaded ?? 0;
            const total = task.size ?? 0;
            const pct = total > 0 ? Math.round((dl / total) * 100) : 0;
            return (
              <div key={task.id} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate flex-1 min-w-0">{task.title}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ml-2 ${task.status === "downloading" ? "bg-primary/15 text-primary" : task.status === "finished" ? "bg-success/15 text-success" : task.status === "paused" ? "bg-warning/15 text-warning" : "bg-text-secondary/15 text-text-muted"}`}>
                    {task.status}
                  </span>
                </div>
                {task.status === "downloading" && (
                  <>
                    <div className="w-full h-1.5 rounded-full bg-[var(--color-bg)] overflow-hidden mb-1">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div className="text-[10px] text-[var(--color-textSecondary)]">
                      {pct}% — {formatBytes(dl)} / {formatBytes(total)}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Download} message="No download tasks" />
      )}
    </div>
  );
};

/* ─── Surveillance View ───────────────────────────────────────── */

export const SurveillanceView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Camera className="w-4 h-4 text-teal-500" />
        {t("synology.surveillance.title", "Surveillance Station")} ({mgr.cameras.length})
      </h3>
      {mgr.cameras.length === 0 ? (
        <EmptyState icon={Camera} message="No cameras found" />
      ) : (
        <div className="space-y-2">
          {mgr.cameras.map((cam) => (
            <div key={cam.id ?? cam.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">{cam.name}</div>
                  <div className="text-[10px] text-[var(--color-textSecondary)]">
                    {cam.host ?? "—"} | {cam.model ?? "—"} | {cam.resolution ?? "—"}
                  </div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${cam.enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                  {cam.enabled ? "enabled" : "disabled"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Backup View ─────────────────────────────────────────────── */

export const BackupView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Archive className="w-4 h-4 text-teal-500" />
        {t("synology.backup.title", "Backup")}
      </h3>

      {/* Hyper Backup tasks */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Hyper Backup Tasks ({mgr.backupTasks.length})
        </h4>
        {mgr.backupTasks.length > 0 ? (
          <div className="space-y-2">
            {mgr.backupTasks.map((task) => (
              <div key={task.task_id ?? task.name} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{task.name ?? task.task_id}</div>
                    <div className="text-[10px] text-[var(--color-textSecondary)]">
                      {task.target_type ?? "—"} | Last: {task.last_backup_time ?? "—"}
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.status === "idle" || task.status === "done" ? "bg-success/15 text-success" : task.status === "backing_up" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning"}`}>
                    {task.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Archive} message="No backup tasks configured" />
        )}
      </section>

      {/* Active Backup for Business */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Active Backup Devices ({mgr.activeBackupDevices.length})
        </h4>
        {mgr.activeBackupDevices.length > 0 ? (
          <div className="space-y-2">
            {mgr.activeBackupDevices.map((d, i) => (
              <div key={d.device_id ?? i} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{d.device_name ?? d.device_id}</div>
                    <div className="text-[10px] text-[var(--color-textSecondary)]">
                      {d.device_type ?? "—"} | {d.os_name ?? "—"}
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.status === "online" ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                    {d.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Archive} message="No active backup devices" />
        )}
      </section>
    </div>
  );
};

/* ─── Security View ───────────────────────────────────────────── */

export const SecurityView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Shield className="w-4 h-4 text-teal-500" />
        {t("synology.security.title", "Security")}
      </h3>

      {/* Overview */}
      {mgr.securityOverview && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
          <div className="flex items-center gap-2 mb-2">
            {mgr.securityOverview.overall_status === "safe" ? (
              <CheckCircle2 className="w-5 h-5 text-success" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-warning" />
            )}
            <span className="text-sm font-medium text-[var(--color-text)]">
              {mgr.securityOverview.overall_status === "safe" ? "System Secure" : "Attention Needed"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)]">
            Score: {mgr.securityOverview.risk_score ?? "—"} | Items: {mgr.securityOverview.items?.length ?? 0}
          </div>
        </div>
      )}

      {/* Auto-block */}
      {mgr.autoBlockConfig && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">Auto Block</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.autoBlockConfig.enable ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
              {mgr.autoBlockConfig.enable ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] mt-1">
            Attempts: {mgr.autoBlockConfig.login_attempts ?? "—"} within {mgr.autoBlockConfig.login_attempts_minutes ?? "—"} min
          </div>
        </div>
      )}

      {/* Blocked IPs */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Blocked IPs ({mgr.blockedIps.length})
        </h4>
        {mgr.blockedIps.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">IP</th>
                  <th className="pb-2 pr-3">Blocked At</th>
                  <th className="pb-2 pr-3">Expires</th>
                  <th className="pb-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {mgr.blockedIps.map((ip) => (
                  <tr key={ip.ip} className="border-b border-[var(--color-border)]/50">
                    <td className="py-1.5 pr-3 font-medium text-[var(--color-text)]">{ip.ip}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{ip.blocked_time ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-textSecondary)]">{ip.expire_time ?? "Never"}</td>
                    <td className="py-1.5 pr-3">
                      <button
                        onClick={() => mgr.unblockIp(ip.ip)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-success/10 border border-success/30 text-success text-[10px] hover:bg-success/20 transition-colors"
                      >
                        <Unlock className="w-3 h-3" />
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-textSecondary)] py-4 text-center">No blocked IPs</div>
        )}
      </section>

      {/* Certificates */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Certificates ({mgr.certificates.length})
        </h4>
        {mgr.certificates.length > 0 ? (
          <div className="space-y-2">
            {mgr.certificates.map((cert) => {
              const subjectName = typeof cert.subject === "object" ? cert.subject?.common_name : cert.subject;
              const issuerName = typeof cert.issuer === "object" ? cert.issuer?.common_name : cert.issuer;
              return (
              <div key={cert.id ?? subjectName} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{subjectName ?? cert.desc ?? "Certificate"}</div>
                    <div className="text-[10px] text-[var(--color-textSecondary)]">
                      Issuer: {issuerName ?? "—"} | Expires: {cert.valid_till ?? "—"}
                    </div>
                  </div>
                  {cert.is_default && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400">Default</span>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-textSecondary)] py-4 text-center">No certificates</div>
        )}
      </section>
    </div>
  );
};

/* ─── Hardware View ───────────────────────────────────────────── */

export const HardwareView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-teal-500" />
        {t("synology.hardware.title", "Hardware & Power")}
      </h3>

      {/* Fans */}
      {mgr.hardwareInfo?.fans && mgr.hardwareInfo.fans.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <Fan className="w-3.5 h-3.5 text-primary" />
            Fans
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {mgr.hardwareInfo.fans.map((fan, i) => (
              <div key={i} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] text-center">
                <div className="text-lg font-semibold text-primary">
                  {fan.speed ?? "—"} RPM
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {fan.name ?? `Fan ${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Temperatures */}
      {mgr.hardwareInfo?.temps && mgr.hardwareInfo.temps.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <Thermometer className="w-3.5 h-3.5 text-error" />
            Temperatures
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {mgr.hardwareInfo.temps.map((temp: { value?: number; name?: string; status?: string }, i: number) => (
              <div key={i} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] text-center">
                <div className={`text-lg font-semibold ${(temp.value ?? 0) > 60 ? "text-error" : (temp.value ?? 0) > 45 ? "text-warning" : "text-success"}`}>
                  {temp.value ?? "—"}°C
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {temp.name ?? `Sensor ${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* UPS */}
      {mgr.upsInfo && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-warning" />
            UPS
          </h4>
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[var(--color-textSecondary)]">Model: </span>
                <span className="text-[var(--color-text)]">{mgr.upsInfo.model ?? "—"}</span>
              </div>
              <div>
                <span className="text-[var(--color-textSecondary)]">Status: </span>
                <span className="text-[var(--color-text)]">{mgr.upsInfo.status ?? "—"}</span>
              </div>
              <div>
                <span className="text-[var(--color-textSecondary)]">Battery: </span>
                <span className="text-[var(--color-text)]">{mgr.upsInfo.battery_charge ?? "—"}%</span>
              </div>
              <div>
                <span className="text-[var(--color-textSecondary)]">Runtime: </span>
                <span className="text-[var(--color-text)]">{mgr.upsInfo.battery_runtime ?? "—"} min</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Power Schedule */}
      {mgr.powerSchedule && mgr.powerSchedule.entries && mgr.powerSchedule.entries.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
            Power Schedule ({mgr.powerSchedule.entries.length} entries)
          </h4>
          <div className="space-y-1">
            {mgr.powerSchedule.entries.map((entry, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
                <span className="text-xs text-[var(--color-text)]">
                  {entry.action ?? "—"} — {entry.day ?? "—"} at {entry.hour ?? "—"}:{String(entry.minute ?? 0).padStart(2, "0")}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${entry.enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                  {entry.enabled ? "active" : "disabled"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!mgr.hardwareInfo && !mgr.upsInfo && (
        <EmptyState icon={Cpu} message="Loading hardware data..." />
      )}
    </div>
  );
};

/* ─── Logs View ───────────────────────────────────────────────── */

export const LogsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-teal-500" />
        {t("synology.logs.title", "Logs")}
      </h3>

      {/* System logs */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          System Logs ({mgr.systemLogs.length})
        </h4>
        {mgr.systemLogs.length > 0 ? (
          <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Level</th>
                  <th className="pb-2 pr-3">User</th>
                  <th className="pb-2 pr-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {mgr.systemLogs.map((log, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]/30">
                    <td className="py-1 pr-3 text-[var(--color-textSecondary)] whitespace-nowrap">{log.time ?? "—"}</td>
                    <td className="py-1 pr-3">
                      <span className={`text-[10px] px-1 py-0.5 rounded ${log.level === "err" || log.level === "error" ? "bg-error/15 text-error" : log.level === "warn" || log.level === "warning" ? "bg-warning/15 text-warning" : "bg-text-secondary/15 text-text-muted"}`}>
                        {log.level ?? "—"}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-[var(--color-textSecondary)]">{log.user ?? "—"}</td>
                    <td className="py-1 pr-3 text-[var(--color-text)] truncate max-w-xs">{log.message ?? log.descr ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-textSecondary)] py-4 text-center">No system logs</div>
        )}
      </section>

      {/* Connection logs */}
      <section>
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2">
          Connection Logs ({mgr.connectionLogs.length})
        </h4>
        {mgr.connectionLogs.length > 0 ? (
          <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">User</th>
                  <th className="pb-2 pr-3">IP</th>
                  <th className="pb-2 pr-3">Service</th>
                  <th className="pb-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {mgr.connectionLogs.map((log, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]/30">
                    <td className="py-1 pr-3 text-[var(--color-textSecondary)] whitespace-nowrap">{log.time ?? "—"}</td>
                    <td className="py-1 pr-3 text-[var(--color-text)]">{log.user ?? "—"}</td>
                    <td className="py-1 pr-3 text-[var(--color-textSecondary)]">{log.ip ?? "—"}</td>
                    <td className="py-1 pr-3 text-[var(--color-textSecondary)]">{log.service ?? "—"}</td>
                    <td className="py-1 pr-3">
                      <span className={`text-[10px] px-1 py-0.5 rounded ${log.action === "login" ? "bg-success/15 text-success" : log.action === "logout" ? "bg-text-secondary/15 text-text-muted" : "bg-error/15 text-error"}`}>
                        {log.action ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-textSecondary)] py-4 text-center">No connection logs</div>
        )}
      </section>
    </div>
  );
};

/* ─── Notifications View ──────────────────────────────────────── */

export const NotificationsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Bell className="w-4 h-4 text-teal-500" />
        {t("synology.notifications.title", "Notifications")}
      </h3>

      {mgr.notificationConfig ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">Email Notifications</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.notificationConfig.email_enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                {mgr.notificationConfig.email_enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">Push Notifications</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.notificationConfig.push_enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                {mgr.notificationConfig.push_enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">SMS Notifications</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${mgr.notificationConfig.sms_enabled ? "bg-success/15 text-success" : "bg-text-secondary/15 text-text-muted"}`}>
                {mgr.notificationConfig.sms_enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState icon={Bell} message="Loading notification config..." />
      )}
    </div>
  );
};
