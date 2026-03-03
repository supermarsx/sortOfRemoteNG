import React from "react";
import {
  Shield,
  Key,
  Play,
  Square,
  RefreshCw,
  Lock,
  Unlock,
  Link,
  Unlink,
  Trash2,
  ArrowRightLeft,
  FileText,
  Settings,
  Search,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Server,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import { PasswordInput } from "../ui/forms";
import {
  useSSHAgentManager,
  type SshAgentTab,
} from "../../hooks/ssh/useSSHAgentManager";

type Mgr = ReturnType<typeof useSSHAgentManager>;

interface SSHAgentManagerProps {
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
      ok
        ? "bg-green-500/10 text-green-400"
        : "bg-red-500/10 text-red-400"
    }`}
  >
    {ok ? (
      <CheckCircle2 className="w-3 h-3" />
    ) : (
      <XCircle className="w-3 h-3" />
    )}
    {label}
  </span>
);

const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab Navigation                                                     */
/* ------------------------------------------------------------------ */

const tabs: { id: SshAgentTab; icon: React.ReactNode; labelKey: string }[] = [
  { id: "overview", icon: <Shield className="w-4 h-4" />, labelKey: "sshAgent.tabs.overview" },
  { id: "keys", icon: <Key className="w-4 h-4" />, labelKey: "sshAgent.tabs.keys" },
  { id: "system-agent", icon: <Server className="w-4 h-4" />, labelKey: "sshAgent.tabs.systemAgent" },
  { id: "forwarding", icon: <ArrowRightLeft className="w-4 h-4" />, labelKey: "sshAgent.tabs.forwarding" },
  { id: "config", icon: <Settings className="w-4 h-4" />, labelKey: "sshAgent.tabs.config" },
  { id: "audit", icon: <FileText className="w-4 h-4" />, labelKey: "sshAgent.tabs.audit" },
];

const TabBar: React.FC<{
  active: SshAgentTab;
  onChange: (tab: SshAgentTab) => void;
}> = ({ active, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-sm whitespace-nowrap transition-colors ${
            active === tab.id
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          {tab.icon}
          {t(tab.labelKey, tab.id)}
        </button>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Overview Tab                                                       */
/* ------------------------------------------------------------------ */

const OverviewTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const s = mgr.status;

  return (
    <div className="space-y-4">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("sshAgent.status.agentStatus", "Agent Status")}
          </div>
          <StatusBadge
            ok={s?.running ?? false}
            label={s?.running ? t("sshAgent.status.running", "Running") : t("sshAgent.status.stopped", "Stopped")}
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("sshAgent.status.loadedKeys", "Loaded Keys")}
          </div>
          <div className="text-lg font-semibold">{s?.loaded_keys ?? 0}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("sshAgent.status.lockState", "Lock State")}
          </div>
          <StatusBadge
            ok={!s?.locked}
            label={s?.locked ? t("sshAgent.status.locked", "Locked") : t("sshAgent.status.unlocked", "Unlocked")}
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("sshAgent.status.systemAgent", "System Agent")}
          </div>
          <StatusBadge
            ok={s?.system_agent_connected ?? false}
            label={
              s?.system_agent_connected
                ? t("sshAgent.status.connected", "Connected")
                : t("sshAgent.status.disconnected", "Disconnected")
            }
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("sshAgent.status.forwarding", "Forwarding")}
          </div>
          <div className="text-lg font-semibold">
            {s?.forwarding_sessions ?? 0}{" "}
            <span className="text-xs text-muted-foreground">
              {t("sshAgent.status.sessions", "sessions")}
            </span>
          </div>
        </div>
        {s?.socket_path && (
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">
              {t("sshAgent.status.socket", "Socket")}
            </div>
            <div className="text-xs font-mono truncate">{s.socket_path}</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {!s?.running ? (
          <button
            onClick={mgr.startAgent}
            disabled={mgr.isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-[var(--color-text)] rounded-md hover:bg-green-500 transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {t("sshAgent.actions.start", "Start Agent")}
          </button>
        ) : (
          <>
            <button
              onClick={mgr.stopAgent}
              disabled={mgr.isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-[var(--color-text)] rounded-md hover:bg-red-500 transition-colors disabled:opacity-50"
            >
              <Square className="w-4 h-4" />
              {t("sshAgent.actions.stop", "Stop Agent")}
            </button>
            <button
              onClick={mgr.restartAgent}
              disabled={mgr.isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-[var(--color-text)] rounded-md hover:bg-amber-500 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              {t("sshAgent.actions.restart", "Restart")}
            </button>
          </>
        )}
        <button
          onClick={mgr.runMaintenance}
          className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t("sshAgent.actions.maintenance", "Run Maintenance")}
        </button>
      </div>

      {/* Lock / Unlock */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("sshAgent.lock.title", "Agent Lock")}
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <PasswordInput
              value={mgr.lockPassphrase}
              onChange={(e) => mgr.setLockPassphrase(e.target.value)}
              placeholder={t("sshAgent.lock.passphrase", "Passphrase")}
              className="w-full"
            />
          </div>
          {!s?.locked ? (
            <button
              onClick={() => {
                mgr.lockAgent(mgr.lockPassphrase);
                mgr.setLockPassphrase("");
              }}
              disabled={!mgr.lockPassphrase}
              className="flex items-center gap-1 px-3 py-2 bg-amber-600 text-[var(--color-text)] rounded-md hover:bg-amber-500 disabled:opacity-50"
            >
              <Lock className="w-4 h-4" />
              {t("sshAgent.lock.lock", "Lock")}
            </button>
          ) : (
            <button
              onClick={() => {
                mgr.unlockAgent(mgr.lockPassphrase);
                mgr.setLockPassphrase("");
              }}
              disabled={!mgr.lockPassphrase}
              className="flex items-center gap-1 px-3 py-2 bg-green-600 text-[var(--color-text)] rounded-md hover:bg-green-500 disabled:opacity-50"
            >
              <Unlock className="w-4 h-4" />
              {t("sshAgent.lock.unlock", "Unlock")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Keys Tab                                                           */
/* ------------------------------------------------------------------ */

const KeysTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.isLoadingKeys) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mgr.keys.length === 0) {
    return (
      <EmptyState
        icon={<Key className="w-8 h-8" />}
        title={t("sshAgent.keys.empty", "No Keys Loaded")}
        description={t("sshAgent.keys.emptyDesc", "The agent has no keys loaded. Add keys or connect to the system agent.")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">
          {t("sshAgent.keys.loaded", "Loaded Keys")} ({mgr.keys.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={mgr.loadKeys}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <RefreshCw className="w-3 h-3" />
            {t("common.refresh", "Refresh")}
          </button>
          <button
            onClick={mgr.removeAllKeys}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600/10 text-red-500 rounded hover:bg-red-600/20"
          >
            <Trash2 className="w-3 h-3" />
            {t("sshAgent.keys.removeAll", "Remove All")}
          </button>
        </div>
      </div>

      {mgr.keys.map((key) => (
        <div
          key={key.id}
          className="bg-card border border-border rounded-lg p-3 space-y-2"
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-sm">{key.comment || key.id}</div>
              <div className="text-xs text-muted-foreground">
                {key.algorithm} · {key.bits > 0 ? `${key.bits} bits · ` : ""}
                {key.source}
              </div>
            </div>
            <button
              onClick={() => mgr.removeKey(key.id)}
              className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
              title={t("sshAgent.keys.remove", "Remove Key")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="text-xs font-mono bg-muted/50 rounded p-1.5 truncate">
            {key.fingerprint_sha256}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {key.sign_count > 0 && (
              <span>
                {t("sshAgent.keys.signs", "Signs")}: {key.sign_count}
              </span>
            )}
            {key.last_used_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(key.last_used_at).toLocaleString()}
              </span>
            )}
            {key.constraints.length > 0 && (
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {key.constraints.length}{" "}
                {t("sshAgent.keys.constraints", "constraints")}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  System Agent Tab                                                   */
/* ------------------------------------------------------------------ */

const SystemAgentTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Server className="w-4 h-4" />
          {t("sshAgent.systemAgent.title", "System SSH Agent Bridge")}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("sshAgent.systemAgent.socketPath", "Socket Path")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={mgr.systemAgentPath}
                onChange={(e) => mgr.setSystemAgentPath(e.target.value)}
                placeholder={t("sshAgent.systemAgent.socketPlaceholder", "/tmp/ssh-agent.sock or \\\\.\\pipe\\openssh-ssh-agent")}
                className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm font-mono"
              />
              <button
                onClick={mgr.discoverSystemAgent}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted rounded hover:bg-muted/80"
                title={t("sshAgent.systemAgent.discover", "Auto-discover")}
              >
                <Search className="w-3 h-3" />
                {t("sshAgent.systemAgent.discover", "Discover")}
              </button>
            </div>
            {mgr.discoveredPath && mgr.discoveredPath !== mgr.systemAgentPath && (
              <div className="mt-1 text-xs text-green-500">
                {t("sshAgent.systemAgent.discovered", "Found")}: {mgr.discoveredPath}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => mgr.setSystemPath(mgr.systemAgentPath)}
              disabled={!mgr.systemAgentPath}
              className="px-3 py-1.5 text-xs bg-blue-600 text-[var(--color-text)] rounded hover:bg-blue-500 disabled:opacity-50"
            >
              {t("sshAgent.systemAgent.setPath", "Set Path")}
            </button>
            {!mgr.status?.system_agent_connected ? (
              <button
                onClick={mgr.connectSystemAgent}
                disabled={mgr.isLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-[var(--color-text)] rounded hover:bg-green-500 disabled:opacity-50"
              >
                <Link className="w-3 h-3" />
                {t("sshAgent.systemAgent.connect", "Connect")}
              </button>
            ) : (
              <button
                onClick={mgr.disconnectSystemAgent}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 text-[var(--color-text)] rounded hover:bg-red-500"
              >
                <Unlink className="w-3 h-3" />
                {t("sshAgent.systemAgent.disconnect", "Disconnect")}
              </button>
            )}
          </div>
        </div>
      </div>

      <StatusBadge
        ok={mgr.status?.system_agent_connected ?? false}
        label={
          mgr.status?.system_agent_connected
            ? t("sshAgent.systemAgent.bridgeActive", "Bridge Active — system keys merged")
            : t("sshAgent.systemAgent.bridgeInactive", "Bridge Inactive")
        }
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Forwarding Tab                                                     */
/* ------------------------------------------------------------------ */

const ForwardingTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.forwardingSessions.length === 0) {
    return (
      <EmptyState
        icon={<ArrowRightLeft className="w-8 h-8" />}
        title={t("sshAgent.forwarding.empty", "No Active Forwarding")}
        description={t("sshAgent.forwarding.emptyDesc", "Agent forwarding sessions will appear here when active SSH connections use forwarding.")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">
        {t("sshAgent.forwarding.active", "Active Sessions")} (
        {mgr.forwardingSessions.length})
      </h3>
      {mgr.forwardingSessions.map((s) => (
        <div
          key={s.id}
          className="bg-card border border-border rounded-lg p-3 flex justify-between items-center"
        >
          <div>
            <div className="font-medium text-sm">
              {s.remote_user}@{s.remote_host}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("sshAgent.forwarding.depth", "Depth")}: {s.depth} ·{" "}
              {t("sshAgent.forwarding.signs", "Signs")}: {s.sign_count} ·{" "}
              {new Date(s.started_at).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => mgr.stopForwarding(s.id)}
            className="p-1.5 text-red-500 hover:bg-red-600/10 rounded transition-colors"
            title={t("sshAgent.forwarding.stop", "Stop")}
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Config Tab                                                         */
/* ------------------------------------------------------------------ */

const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.config;

  if (!c) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Settings className="w-4 h-4" />
          {t("sshAgent.config.general", "General Settings")}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.auto_connect_system_agent}
              onChange={(e) =>
                mgr.updateConfig({ ...c, auto_connect_system_agent: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.autoConnect", "Auto-connect system agent")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.confirm_before_use}
              onChange={(e) =>
                mgr.updateConfig({ ...c, confirm_before_use: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.confirmBeforeUse", "Confirm before use")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.allow_forwarding}
              onChange={(e) =>
                mgr.updateConfig({ ...c, allow_forwarding: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.allowForwarding", "Allow forwarding")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.lock_on_idle}
              onChange={(e) =>
                mgr.updateConfig({ ...c, lock_on_idle: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.lockOnIdle", "Lock on idle")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.audit_enabled}
              onChange={(e) =>
                mgr.updateConfig({ ...c, audit_enabled: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.auditEnabled", "Enable audit logging")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.persist_keys}
              onChange={(e) =>
                mgr.updateConfig({ ...c, persist_keys: e.target.checked })
              }
              className="rounded"
            />
            {t("sshAgent.config.persistKeys", "Persist keys to disk")}
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("sshAgent.config.maxKeys", "Max loaded keys")}
            </label>
            <input
              type="number"
              value={c.max_loaded_keys}
              onChange={(e) =>
                mgr.updateConfig({ ...c, max_loaded_keys: parseInt(e.target.value) || 0 })
              }
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("sshAgent.config.defaultLifetime", "Default key lifetime (s)")}
            </label>
            <input
              type="number"
              value={c.default_key_lifetime}
              onChange={(e) =>
                mgr.updateConfig({ ...c, default_key_lifetime: parseInt(e.target.value) || 0 })
              }
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("sshAgent.config.maxForwardingDepth", "Max forwarding depth")}
            </label>
            <input
              type="number"
              value={c.max_forwarding_depth}
              onChange={(e) =>
                mgr.updateConfig({ ...c, max_forwarding_depth: parseInt(e.target.value) || 0 })
              }
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("sshAgent.config.idleTimeout", "Idle lock timeout (s)")}
            </label>
            <input
              type="number"
              value={c.idle_lock_timeout}
              onChange={(e) =>
                mgr.updateConfig({ ...c, idle_lock_timeout: parseInt(e.target.value) || 0 })
              }
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Audit Tab                                                          */
/* ------------------------------------------------------------------ */

const AuditTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">
          {t("sshAgent.audit.title", "Audit Log")} ({mgr.auditLog.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={mgr.loadAudit}
            disabled={mgr.isLoadingAudit}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <RefreshCw className={`w-3 h-3 ${mgr.isLoadingAudit ? "animate-spin" : ""}`} />
            {t("common.refresh", "Refresh")}
          </button>
          <button
            onClick={async () => {
              const json = await mgr.exportAudit();
              if (json) {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "ssh-agent-audit.json";
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <Download className="w-3 h-3" />
            {t("sshAgent.audit.export", "Export")}
          </button>
          <button
            onClick={mgr.clearAudit}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600/10 text-red-500 rounded hover:bg-red-600/20"
          >
            <Trash2 className="w-3 h-3" />
            {t("sshAgent.audit.clear", "Clear")}
          </button>
        </div>
      </div>

      {mgr.auditLog.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8" />}
          title={t("sshAgent.audit.empty", "No Audit Entries")}
          description={t("sshAgent.audit.emptyDesc", "Audit entries will appear here as agent operations occur.")}
        />
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1">
          {mgr.auditLog.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 p-2 bg-card border border-border rounded text-xs"
            >
              <span
                className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                  entry.success ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-muted-foreground truncate">
                  {entry.details}
                </div>
                {entry.key_fingerprint && (
                  <div className="font-mono text-muted-foreground truncate">
                    {entry.key_fingerprint}
                  </div>
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

export const SSHAgentManager: React.FC<SSHAgentManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useSSHAgentManager(isOpen);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          {t("sshAgent.title", "SSH Agent Manager")}
        </div>
      </ModalHeader>
      <ModalBody>
        <ErrorBanner error={mgr.error} />
        <TabBar active={mgr.activeTab} onChange={mgr.setActiveTab} />

        {mgr.activeTab === "overview" && <OverviewTab mgr={mgr} />}
        {mgr.activeTab === "keys" && <KeysTab mgr={mgr} />}
        {mgr.activeTab === "system-agent" && <SystemAgentTab mgr={mgr} />}
        {mgr.activeTab === "forwarding" && <ForwardingTab mgr={mgr} />}
        {mgr.activeTab === "config" && <ConfigTab mgr={mgr} />}
        {mgr.activeTab === "audit" && <AuditTab mgr={mgr} />}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          {t("common.close", "Close")}
        </button>
      </ModalFooter>
    </Modal>
  );
};
