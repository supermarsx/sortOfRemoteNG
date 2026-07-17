// VMware vSphere integration panel (t42-vmware).
//
// Full management surface for the sorng-vmware crate — binds ALL 55
// `vmware_*` commands through `useVmware()` / `vmwareApi`. Connect form maps to
// `vmware_connect`; sub-tabs cover VMs & power, snapshots, infrastructure,
// metrics, console (WebMKS/VNC) and the VMRC/Horizon binary fallback.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Server,
  Play,
  Square,
  Pause,
  RotateCcw,
  Power,
  RefreshCw,
  Loader2,
  Camera,
  Network,
  HardDrive,
  Boxes,
  Gauge,
  MonitorPlay,
  Trash2,
  Plug,
  PlugZap,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVmware, type VmwareManager } from "../../hooks/integration/useVmware";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  ClusterSummary,
  ConsoleSession,
  ConsoleTicketType,
  DatacenterSummary,
  DatastoreSummary,
  FolderSummary,
  HostSummary,
  InventorySummary,
  NetworkSummary,
  ResourcePoolSummary,
  SnapshotSummary,
  VmInfo,
  VmQuickStats,
  VmSummary,
  VmrcSession,
} from "../../types/vmware";

// ─── Small shared UI helpers ────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

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

function fmtBytes(n?: number): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

type TabKey =
  | "overview"
  | "vms"
  | "snapshots"
  | "infra"
  | "console"
  | "vmrc";

// ─── Connect form ───────────────────────────────────────────────────────────

interface ConnectState {
  host: string;
  port: string;
  username: string;
  password: string;
  insecure: boolean;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  host: "",
  port: "443",
  username: "",
  password: "",
  insecure: true,
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{
  mgr: VmwareManager;
  instanceId?: string;
}> = ({ mgr, instanceId }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<ConnectState>(emptyConnect);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);

  // Prefill from a persisted instance (host/fields + vault secret).
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setForm((f) => ({
      ...f,
      name: inst.name,
      host: inst.host ?? "",
      port: inst.fields?.port ?? "443",
      username: inst.fields?.username ?? "",
      insecure: inst.fields?.insecure !== "false",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (secret) setForm((f) => ({ ...f, password: secret }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    try {
      await mgr.connect({
        host: form.host.trim(),
        port: form.port ? Number(form.port) : undefined,
        username: form.username,
        password: form.password,
        insecure: form.insecure,
        timeoutSecs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
      });
    } catch {
      // error is surfaced via mgr.error
    }
  }, [mgr, form]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      port: form.port,
      username: form.username,
      insecure: String(form.insecure),
      timeoutSecs: form.timeoutSecs,
    };
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.password || undefined,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "vmware",
        name: form.name || form.host,
        host: form.host,
        fields,
        secret: form.password || undefined,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.vmware.host", "vCenter / ESXi host")}>
          <input
            className={field}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="vcenter.lab.local"
          />
        </Labeled>
        <Labeled label={t("integrations.vmware.port", "Port")}>
          <input
            className={field}
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.vmware.username", "Username")}>
          <input
            className={field}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder="administrator@vsphere.local"
          />
        </Labeled>
        <Labeled label={t("integrations.vmware.password", "Password")}>
          <input
            className={field}
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Labeled>
        <Labeled
          label={t("integrations.vmware.timeout", "Timeout (seconds)")}
        >
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.vmware.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.host}
          />
        </Labeled>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
        <input
          type="checkbox"
          checked={form.insecure}
          onChange={(e) => set("insecure", e.target.checked)}
        />
        {t(
          "integrations.vmware.insecure",
          "Skip TLS verification (self-signed labs)",
        )}
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isLoading || !form.host || !form.username}
        >
          {mgr.isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.vmware.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.host}>
          {t("integrations.vmware.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview / metrics tab ─────────────────────────────────────────────────

const OverviewTab: React.FC<{ mgr: VmwareManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [stats, setStats] = useState<VmQuickStats[]>([]);
  const [session, setSession] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await mgr.run(() => mgr.api.getInventorySummary()));
    } catch {
      /* surfaced via mgr.error */
    }
    try {
      setStats(await mgr.api.getAllVmStats());
    } catch {
      /* ignore */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tiles: [string, number | undefined][] = summary
    ? [
        [t("integrations.vmware.datacenters", "Datacenters"), summary.datacenterCount],
        [t("integrations.vmware.clusters", "Clusters"), summary.clusterCount],
        [t("integrations.vmware.hosts", "Hosts"), summary.hostCount],
        [t("integrations.vmware.vms", "VMs"), summary.vmCount],
        [t("integrations.vmware.poweredOn", "Powered on"), summary.vmPoweredOn],
        [t("integrations.vmware.datastores", "Datastores"), summary.datastoreCount],
        [t("integrations.vmware.networks", "Networks"), summary.networkCount],
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.vmware.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => setSession(await mgr.api.checkSession())}
        >
          {t("integrations.vmware.checkSession", "Check session")}
        </button>
        {session != null && (
          <span className="text-xs text-[var(--color-textSecondary)]">
            {session
              ? t("integrations.vmware.sessionValid", "Session valid")
              : t("integrations.vmware.sessionInvalid", "Session invalid")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([label, value]) => (
          <div key={label} className={card}>
            <div className="text-lg font-semibold text-[var(--color-text)]">
              {value ?? "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
              {label}
            </div>
          </div>
        ))}
      </div>
      {stats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.vmware.name", "Name")}</th>
                <th className="px-2 py-1">{t("integrations.vmware.power", "Power")}</th>
                <th className="px-2 py-1">CPU</th>
                <th className="px-2 py-1">{t("integrations.vmware.memory", "Memory")}</th>
                <th className="px-2 py-1">{t("integrations.vmware.guestOs", "Guest OS")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.vm} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 text-[var(--color-text)]">{s.name}</td>
                  <td className="px-2 py-1">{s.powerState}</td>
                  <td className="px-2 py-1">{s.cpuCount ?? "—"}</td>
                  <td className="px-2 py-1">
                    {s.memorySizeMib != null ? `${s.memorySizeMib} MiB` : "—"}
                  </td>
                  <td className="px-2 py-1">{s.guestOs ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── VMs & power tab ────────────────────────────────────────────────────────

const VmsTab: React.FC<{
  mgr: VmwareManager;
  selectedVm: string | null;
  onSelectVm: (id: string | null) => void;
}> = ({ mgr, selectedVm, onSelectVm }) => {
  const { t } = useTranslation();
  const [vms, setVms] = useState<VmSummary[]>([]);
  const [runningOnly, setRunningOnly] = useState(false);
  const [detail, setDetail] = useState<VmInfo | null>(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = runningOnly
        ? await mgr.run(() => mgr.api.listRunningVms())
        : await mgr.run(() => mgr.api.listVms());
      setVms(list);
    } catch {
      /* surfaced */
    }
  }, [mgr, runningOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadDetail = useCallback(
    async (vmId: string) => {
      onSelectVm(vmId);
      try {
        setDetail(await mgr.run(() => mgr.api.getVm(vmId)));
      } catch {
        setDetail(null);
      }
    },
    [mgr, onSelectVm],
  );

  const power = useCallback(
    async (fn: (id: string) => Promise<void>, id: string) => {
      try {
        await mgr.run(() => fn(id));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, refresh],
  );

  const doSearch = useCallback(async () => {
    if (!search.trim()) return;
    try {
      const found = await mgr.run(() => mgr.api.findVmByName(search.trim()));
      if (found) {
        setVms([found]);
        void loadDetail(found.vm);
      }
    } catch {
      /* surfaced */
    }
  }, [mgr, search, loadDetail]);

  const updateCpu = useCallback(
    async (id: string) => {
      const raw = window.prompt(t("integrations.vmware.cpuCountPrompt", "New vCPU count"));
      if (!raw) return;
      await mgr.run(() => mgr.api.updateCpu(id, { count: Number(raw) })).catch(() => {});
    },
    [mgr, t],
  );

  const updateMemory = useCallback(
    async (id: string) => {
      const raw = window.prompt(t("integrations.vmware.memoryPrompt", "New memory (MiB)"));
      if (!raw) return;
      await mgr.run(() => mgr.api.updateMemory(id, { sizeMib: Number(raw) })).catch(() => {});
    },
    [mgr, t],
  );

  const cloneVm = useCallback(
    async (id: string) => {
      const name = window.prompt(t("integrations.vmware.cloneNamePrompt", "Name for the clone"));
      if (!name) return;
      await mgr.run(() => mgr.api.cloneVm({ name, source: id })).catch(() => {});
      await refresh();
    },
    [mgr, t, refresh],
  );

  const relocateVm = useCallback(
    async (id: string) => {
      const host = window.prompt(t("integrations.vmware.relocateHostPrompt", "Target host id (optional)")) ?? undefined;
      const datastore = window.prompt(t("integrations.vmware.relocateDsPrompt", "Target datastore id (optional)")) ?? undefined;
      await mgr.run(() => mgr.api.relocateVm(id, { host: host || undefined, datastore: datastore || undefined })).catch(() => {});
    },
    [mgr, t],
  );

  const createVm = useCallback(async () => {
    const name = window.prompt(t("integrations.vmware.createNamePrompt", "New VM name"));
    if (!name) return;
    const guestOs = window.prompt(t("integrations.vmware.createGuestPrompt", "Guest OS id (e.g. UBUNTU_64)")) ?? undefined;
    await mgr.run(() => mgr.api.createVm({ name, guestOs: guestOs || undefined })).catch(() => {});
    await refresh();
  }, [mgr, t, refresh]);

  const deleteVm = useCallback(
    async (id: string) => {
      if (!window.confirm(t("integrations.vmware.deleteVmConfirm", "Delete this VM permanently?"))) return;
      await mgr.run(() => mgr.api.deleteVm(id)).catch(() => {});
      if (selectedVm === id) onSelectVm(null);
      await refresh();
    },
    [mgr, t, refresh, selectedVm, onSelectVm],
  );

  const filtered = useMemo(
    () => vms.filter((v) => v.name.toLowerCase().includes(search.toLowerCase())),
    [vms, search],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.vmware.refresh", "Refresh")}
        </button>
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={runningOnly}
            onChange={(e) => setRunningOnly(e.target.checked)}
          />
          {t("integrations.vmware.runningOnly", "Running only")}
        </label>
        <button className={btn} onClick={createVm}>
          {t("integrations.vmware.createVm", "Create VM")}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <input
            className={field}
            style={{ width: 180 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("integrations.vmware.searchVm", "Search / find by name")}
          />
          <button className={btn} onClick={doSearch}>
            <Search size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--color-textMuted)]">
              <tr>
                <th className="px-2 py-1">{t("integrations.vmware.name", "Name")}</th>
                <th className="px-2 py-1">{t("integrations.vmware.power", "Power")}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.vm}
                  className={`cursor-pointer border-t border-[var(--color-border)] ${
                    selectedVm === v.vm ? "bg-[var(--color-border)]" : ""
                  }`}
                  onClick={() => loadDetail(v.vm)}
                >
                  <td className="px-2 py-1 text-[var(--color-text)]">{v.name}</td>
                  <td className="px-2 py-1">{v.powerState}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <button className={btn} title={t("integrations.vmware.powerOn", "Power on")} onClick={(e) => { e.stopPropagation(); void power(mgr.api.powerOn, v.vm); }}><Play size={12} /></button>
                      <button className={btn} title={t("integrations.vmware.powerOff", "Power off")} onClick={(e) => { e.stopPropagation(); void power(mgr.api.powerOff, v.vm); }}><Square size={12} /></button>
                      <button className={btn} title={t("integrations.vmware.suspend", "Suspend")} onClick={(e) => { e.stopPropagation(); void power(mgr.api.suspend, v.vm); }}><Pause size={12} /></button>
                      <button className={btn} title={t("integrations.vmware.reset", "Reset")} onClick={(e) => { e.stopPropagation(); void power(mgr.api.reset, v.vm); }}><RotateCcw size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                    {t("integrations.vmware.noVms", "No VMs")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedVm && (
          <div className={card}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">
                {detail?.name ?? selectedVm}
              </span>
              <span className="text-xs text-[var(--color-textSecondary)]">
                {detail?.powerState}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 text-xs text-[var(--color-textSecondary)]">
              <span>{t("integrations.vmware.guestOs", "Guest OS")}: {detail?.guestOs ?? "—"}</span>
              <span>CPU: {detail?.cpu?.count ?? "—"}</span>
              <span>{t("integrations.vmware.memory", "Memory")}: {detail?.memory?.sizeMib != null ? `${detail.memory.sizeMib} MiB` : "—"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button className={btn} onClick={() => void power(mgr.api.shutdownGuest, selectedVm)}><Power size={12} />{t("integrations.vmware.shutdownGuest", "Shutdown guest")}</button>
              <button className={btn} onClick={() => void power(mgr.api.rebootGuest, selectedVm)}><RotateCcw size={12} />{t("integrations.vmware.rebootGuest", "Reboot guest")}</button>
              <button className={btn} onClick={async () => { const id = await mgr.api.getGuestIdentity(selectedVm).catch(() => null); if (id) window.alert(`${id.hostName ?? ""} ${id.ipAddress ?? ""}`.trim() || JSON.stringify(id)); }}>{t("integrations.vmware.guestIdentity", "Guest identity")}</button>
              <button className={btn} onClick={async () => { const s = await mgr.api.getPowerState(selectedVm).catch(() => null); if (s) window.alert(s); }}>{t("integrations.vmware.powerState", "Power state")}</button>
              <button className={btn} onClick={async () => { const st = await mgr.api.getVmStats(selectedVm).catch(() => null); if (st) window.alert(JSON.stringify(st, null, 2)); }}><Gauge size={12} />{t("integrations.vmware.stats", "Stats")}</button>
              <button className={btn} onClick={() => void updateCpu(selectedVm)}>{t("integrations.vmware.updateCpu", "Set CPU")}</button>
              <button className={btn} onClick={() => void updateMemory(selectedVm)}>{t("integrations.vmware.updateMemory", "Set memory")}</button>
              <button className={btn} onClick={() => void cloneVm(selectedVm)}>{t("integrations.vmware.clone", "Clone")}</button>
              <button className={btn} onClick={() => void relocateVm(selectedVm)}>{t("integrations.vmware.relocate", "Relocate")}</button>
              <button className={btn} onClick={() => void deleteVm(selectedVm)}><Trash2 size={12} />{t("integrations.vmware.delete", "Delete")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Snapshots tab ──────────────────────────────────────────────────────────

const SnapshotsTab: React.FC<{ mgr: VmwareManager; selectedVm: string | null }> = ({
  mgr,
  selectedVm,
}) => {
  const { t } = useTranslation();
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);

  const refresh = useCallback(async () => {
    if (!selectedVm) return;
    try {
      setSnaps(await mgr.run(() => mgr.api.listSnapshots(selectedVm)));
    } catch {
      /* surfaced */
    }
  }, [mgr, selectedVm]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!selectedVm) {
    return (
      <p className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.vmware.selectVmFirst", "Select a VM in the VMs tab first.")}
      </p>
    );
  }

  const create = async () => {
    const name = window.prompt(t("integrations.vmware.snapshotNamePrompt", "Snapshot name"));
    if (!name) return;
    await mgr.run(() => mgr.api.createSnapshot(selectedVm, { name })).catch(() => {});
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.vmware.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={create}>
          <Camera size={12} />
          {t("integrations.vmware.createSnapshot", "Create snapshot")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            if (!window.confirm(t("integrations.vmware.deleteAllSnapsConfirm", "Delete ALL snapshots?"))) return;
            await mgr.run(() => mgr.api.deleteAllSnapshots(selectedVm)).catch(() => {});
            await refresh();
          }}
        >
          <Trash2 size={12} />
          {t("integrations.vmware.deleteAllSnapshots", "Delete all")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.vmware.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.vmware.created", "Created")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {snaps.map((s) => (
              <tr key={s.snapshot} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{s.name ?? s.snapshot}</td>
                <td className="px-2 py-1">{s.creationTime ?? "—"}</td>
                <td className="px-2 py-1">
                  <div className="flex gap-1">
                    <button
                      className={btn}
                      onClick={async () => {
                        await mgr.run(() => mgr.api.revertSnapshot(selectedVm, s.snapshot)).catch(() => {});
                        await refresh();
                      }}
                    >
                      {t("integrations.vmware.revert", "Revert")}
                    </button>
                    <button
                      className={btn}
                      onClick={async () => {
                        await mgr.run(() => mgr.api.deleteSnapshot(selectedVm, s.snapshot)).catch(() => {});
                        await refresh();
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {snaps.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.vmware.noSnapshots", "No snapshots")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Infrastructure tab (hosts / clusters / dcs / folders / pools / net / ds) ─

const InfraTab: React.FC<{ mgr: VmwareManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [datacenters, setDatacenters] = useState<DatacenterSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [pools, setPools] = useState<ResourcePoolSummary[]>([]);
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [datastores, setDatastores] = useState<DatastoreSummary[]>([]);

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
        safe(mgr.api.listHosts(), setHosts),
        safe(mgr.api.listClusters(), setClusters),
        safe(mgr.api.listDatacenters(), setDatacenters),
        safe(mgr.api.listFolders(), setFolders),
        safe(mgr.api.listResourcePools(), setPools),
        safe(mgr.api.listNetworks(), setNetworks),
        safe(mgr.api.listDatastores(), setDatastores),
      ]);
    });
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hostAction = async (
    fn: (id: string) => Promise<void>,
    id: string,
  ) => {
    await mgr.run(() => fn(id)).catch(() => {});
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.vmware.refresh", "Refresh")}
      </button>

      <section className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <Server size={12} /> {t("integrations.vmware.hosts", "Hosts")}
        </h4>
        <div className="flex flex-col gap-1">
          {hosts.map((h) => (
            <div key={h.host} className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {h.name} · {h.connectionState}
              </span>
              <div className="flex gap-1">
                <button className={btn} onClick={async () => { const info = await mgr.api.getHost(h.host).catch(() => null); if (info) window.alert(JSON.stringify(info, null, 2)); }}>{t("integrations.vmware.details", "Details")}</button>
                <button className={btn} title={t("integrations.vmware.disconnectHost", "Disconnect host")} onClick={() => void hostAction(mgr.api.disconnectHost, h.host)}><Plug size={12} /></button>
                <button className={btn} title={t("integrations.vmware.reconnectHost", "Reconnect host")} onClick={() => void hostAction(mgr.api.reconnectHost, h.host)}><PlugZap size={12} /></button>
              </div>
            </div>
          ))}
          {hosts.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]"><Boxes size={12} /> {t("integrations.vmware.clusters", "Clusters")}</h4>
          {clusters.map((c) => <div key={c.cluster} className="text-xs text-[var(--color-textSecondary)]">{c.name}</div>)}
          {clusters.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">{t("integrations.vmware.datacenters", "Datacenters")}</h4>
          {datacenters.map((d) => <div key={d.datacenter} className="text-xs text-[var(--color-textSecondary)]">{d.name}</div>)}
          {datacenters.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">{t("integrations.vmware.folders", "Folders")}</h4>
          {folders.map((f) => <div key={f.folder} className="text-xs text-[var(--color-textSecondary)]">{f.name}{f.type ? ` · ${f.type}` : ""}</div>)}
          {folders.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">{t("integrations.vmware.resourcePools", "Resource pools")}</h4>
          {pools.map((p) => <div key={p.resourcePool} className="text-xs text-[var(--color-textSecondary)]">{p.name}</div>)}
          {pools.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]"><Network size={12} /> {t("integrations.vmware.networks", "Networks")}</h4>
          {networks.map((n) => (
            <div key={n.network} className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]">
              <span>{n.name}{n.type ? ` · ${n.type}` : ""}</span>
              <button className={btn} onClick={async () => { const info = await mgr.api.getNetwork(n.network).catch(() => null); if (info) window.alert(JSON.stringify(info, null, 2)); }}>{t("integrations.vmware.details", "Details")}</button>
            </div>
          ))}
          {networks.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
        <section className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]"><HardDrive size={12} /> {t("integrations.vmware.datastores", "Datastores")}</h4>
          {datastores.map((d) => (
            <div key={d.datastore} className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]">
              <span>{d.name} · {fmtBytes(d.freeSpace)} / {fmtBytes(d.capacity)}</span>
              <button className={btn} onClick={async () => { const info = await mgr.api.getDatastore(d.datastore).catch(() => null); if (info) window.alert(JSON.stringify(info, null, 2)); }}>{t("integrations.vmware.details", "Details")}</button>
            </div>
          ))}
          {datastores.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">—</span>}
        </section>
      </div>
    </div>
  );
};

// ─── Console tab (WebMKS / VNC / MKS) ───────────────────────────────────────

const ConsoleTab: React.FC<{ mgr: VmwareManager; selectedVm: string | null }> = ({
  mgr,
  selectedVm,
}) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ConsoleSession[]>([]);
  const [ticketType, setTicketType] = useState<ConsoleTicketType>("WEBMKS");

  const refresh = useCallback(async () => {
    try {
      setSessions(await mgr.run(() => mgr.api.listConsoleSessions()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={field}
          style={{ width: 120 }}
          value={ticketType}
          onChange={(e) => setTicketType(e.target.value as ConsoleTicketType)}
        >
          <option value="WEBMKS">WebMKS</option>
          <option value="VNC">VNC</option>
          <option value="MKS">MKS</option>
        </select>
        <button
          className={btn}
          disabled={!selectedVm}
          onClick={async () => {
            if (!selectedVm) return;
            const ticket = await mgr.run(() => mgr.api.acquireConsoleTicket(selectedVm, ticketType)).catch(() => null);
            if (ticket) window.alert(`${t("integrations.vmware.ticket", "Ticket")}: ${ticket.ticket}`);
          }}
        >
          {t("integrations.vmware.acquireTicket", "Acquire ticket")}
        </button>
        <button
          className={btn}
          disabled={!selectedVm}
          onClick={async () => {
            if (!selectedVm) return;
            await mgr.run(() => mgr.api.openConsole({ vmId: selectedVm, ticketType, insecure: true })).catch(() => {});
            await refresh();
          }}
        >
          <MonitorPlay size={12} />
          {t("integrations.vmware.openConsole", "Open console")}
        </button>
        <button className={btn} onClick={refresh}>
          <RefreshCw size={12} />
          {t("integrations.vmware.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            await mgr.run(() => mgr.api.closeAllConsoles()).catch(() => {});
            await refresh();
          }}
        >
          {t("integrations.vmware.closeAll", "Close all")}
        </button>
      </div>
      {!selectedVm && (
        <p className="text-xs text-[var(--color-textMuted)]">
          {t("integrations.vmware.selectVmForConsole", "Select a VM in the VMs tab to open a console.")}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {sessions.map((s) => (
          <div key={s.sessionId} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {s.vmId} · {s.ticketType} · {s.proxyUrl ?? s.directUrl}
            </span>
            <div className="flex gap-1">
              <button className={btn} onClick={async () => { const info = await mgr.api.getConsoleSession(s.sessionId).catch(() => null); if (info) window.alert(JSON.stringify(info, null, 2)); }}>{t("integrations.vmware.details", "Details")}</button>
              <button className={btn} onClick={async () => { await mgr.api.closeConsole(s.sessionId).catch(() => {}); await refresh(); }}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">{t("integrations.vmware.noConsoles", "No open console sessions")}</span>}
      </div>
    </div>
  );
};

// ─── VMRC / Horizon tab (binary fallback) ───────────────────────────────────

const VmrcTab: React.FC<{ mgr: VmwareManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<VmrcSession[]>([]);
  const [avail, setAvail] = useState<{ vmrc: boolean; horizon: boolean } | null>(null);
  const [form, setForm] = useState({ host: "", port: "443", vmMoid: "", username: "", password: "", useHorizon: false, desktopName: "", domain: "" });

  const refresh = useCallback(async () => {
    try {
      setSessions(await mgr.run(() => mgr.api.listVmrcSessions()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
    Promise.all([mgr.api.isVmrcAvailable(), mgr.api.isHorizonAvailable()])
      .then(([vmrc, horizon]) => setAvail({ vmrc, horizon }))
      .catch(() => setAvail(null));
  }, [mgr, refresh]);

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const launch = async () => {
    await mgr
      .run(() =>
        mgr.api.launchVmrc({
          host: form.host,
          port: Number(form.port) || 443,
          vmMoid: form.vmMoid,
          username: form.username || undefined,
          password: form.password || undefined,
          useHorizon: form.useHorizon,
          desktopName: form.desktopName || undefined,
          domain: form.domain || undefined,
        }),
      )
      .catch(() => {});
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {avail && (
        <div className="text-xs text-[var(--color-textSecondary)]">
          VMRC: {avail.vmrc ? "✓" : "✗"} · Horizon: {avail.horizon ? "✓" : "✗"}
        </div>
      )}
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.vmware.host", "Host")}><input className={field} value={form.host} onChange={(e) => set("host", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.port", "Port")}><input className={field} value={form.port} onChange={(e) => set("port", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.vmMoid", "VM MOID (vm-42)")}><input className={field} value={form.vmMoid} onChange={(e) => set("vmMoid", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.username", "Username")}><input className={field} value={form.username} onChange={(e) => set("username", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.password", "Password")}><input className={field} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.desktopName", "Horizon desktop")}><input className={field} value={form.desktopName} onChange={(e) => set("desktopName", e.target.value)} /></Labeled>
          <Labeled label={t("integrations.vmware.domain", "Domain")}><input className={field} value={form.domain} onChange={(e) => set("domain", e.target.value)} /></Labeled>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input type="checkbox" checked={form.useHorizon} onChange={(e) => set("useHorizon", e.target.checked)} />
          {t("integrations.vmware.useHorizon", "Use Horizon View client")}
        </label>
        <div className="mt-2 flex gap-2">
          <button className={btn} onClick={launch} disabled={!form.host || !form.vmMoid}>
            <MonitorPlay size={12} />
            {t("integrations.vmware.launchVmrc", "Launch VMRC")}
          </button>
          <button className={btn} onClick={refresh}><RefreshCw size={12} />{t("integrations.vmware.refresh", "Refresh")}</button>
          <button className={btn} onClick={async () => { await mgr.api.closeAllVmrcSessions().catch(() => {}); await refresh(); }}>{t("integrations.vmware.closeAll", "Close all")}</button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {sessions.map((s) => (
          <div key={s.sessionId} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">{s.vmMoid} · {s.host} · pid {s.processId}</span>
            <button className={btn} onClick={async () => { await mgr.api.closeVmrcSession(s.sessionId).catch(() => {}); await refresh(); }}><Trash2 size={12} /></button>
          </div>
        ))}
        {sessions.length === 0 && <span className="text-xs text-[var(--color-textMuted)]">{t("integrations.vmware.noVmrc", "No VMRC sessions")}</span>}
      </div>
    </div>
  );
};

// ─── Panel shell ────────────────────────────────────────────────────────────

const TABS: { key: TabKey; labelKey: string; labelDefault: string; icon: React.ComponentType<{ size?: number | string }> }[] = [
  { key: "overview", labelKey: "integrations.vmware.tabOverview", labelDefault: "Overview", icon: Gauge },
  { key: "vms", labelKey: "integrations.vmware.tabVms", labelDefault: "VMs", icon: Server },
  { key: "snapshots", labelKey: "integrations.vmware.tabSnapshots", labelDefault: "Snapshots", icon: Camera },
  { key: "infra", labelKey: "integrations.vmware.tabInfra", labelDefault: "Infrastructure", icon: Boxes },
  { key: "console", labelKey: "integrations.vmware.tabConsole", labelDefault: "Console", icon: MonitorPlay },
  { key: "vmrc", labelKey: "integrations.vmware.tabVmrc", labelDefault: "VMRC", icon: MonitorPlay },
];

const VmwarePanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useVmware();
  const [tab, setTab] = useState<TabKey>("overview");
  const [selectedVm, setSelectedVm] = useState<string | null>(null);

  // Reflect any pre-existing backend session on mount.
  useEffect(() => {
    void mgr.refreshConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Server className="h-5 w-5 text-primary" />
          {t("integrations.vmware.title", "VMware vSphere")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`} />
            {mgr.isConnected
              ? mgr.config?.host ?? t("integrations.vmware.connected", "Connected")
              : t("integrations.vmware.disconnected", "Disconnected")}
          </span>
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.vmware.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected ? (
        <ConnectForm mgr={mgr} instanceId={instanceId} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {TABS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  tab === key
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
            {tab === "overview" && <OverviewTab mgr={mgr} />}
            {tab === "vms" && (
              <VmsTab mgr={mgr} selectedVm={selectedVm} onSelectVm={setSelectedVm} />
            )}
            {tab === "snapshots" && <SnapshotsTab mgr={mgr} selectedVm={selectedVm} />}
            {tab === "infra" && <InfraTab mgr={mgr} />}
            {tab === "console" && <ConsoleTab mgr={mgr} selectedVm={selectedVm} />}
            {tab === "vmrc" && <VmrcTab mgr={mgr} />}
          </div>
        </>
      )}
    </div>
  );
};

export default VmwarePanel;

/** Registry descriptor for the VMware vSphere integration (category: infra).
 *  The Wave-1 infra integrator appends this to `registry.infra.ts`. */
export const vmwareDescriptor: IntegrationDescriptor = {
  key: "vmware",
  label: "VMware vSphere",
  category: "virtualization",
  icon: Server,
  importPanel: () => import("./VmwarePanel"),
};
