// NetboxVirtualizationTab — Virtualization + Circuits category tab (t42 exec c3,
// t42-netbox-c3). Renders three sections (Virtual Machines, Clusters, Circuits)
// over a live `connectionId`, driving all 31 Virtualization/Circuits commands
// through `useNetboxVirtualization`: list/detail reads, sub-resource lists
// (VM interfaces, circuit terminations), reference lists (cluster types/groups,
// circuit providers/types), and full create/update/delete via a JSON editor.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Cable,
  ChevronLeft,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NetboxTabProps } from "../../../types/netbox";
import type {
  Circuit,
  CircuitProvider,
  CircuitType,
  Cluster,
  ClusterType,
  VirtualMachine,
  VmInterface,
} from "../../../types/netbox/virtualization";
import {
  useNetboxVirtualization,
  type NetboxData,
} from "../../../hooks/integration/netbox/useNetboxVirtualization";

type SectionKey = "vms" | "clusters" | "circuits";

/** Best-effort human label for a nested NetBox object (`serde_json::Value`). */
function refLabel(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["display", "name", "label", "cid", "value"]) {
      const val = o[k];
      if (typeof val === "string" || typeof val === "number") return String(val);
    }
  }
  return "—";
}

function num(v: number | null | undefined): string {
  return v == null ? "—" : String(v);
}

// ─── Editor modal ─────────────────────────────────────────────────────────────

interface EditorState {
  title: string;
  initial: NetboxData;
  submit: (data: NetboxData) => Promise<boolean>;
}

const JsonEditorModal: React.FC<{
  editor: EditorState;
  onClose: () => void;
}> = ({ editor, onClose }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    JSON.stringify(editor.initial, null, 2),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(async () => {
    let parsed: NetboxData;
    try {
      parsed = JSON.parse(text) as NetboxData;
    } catch {
      setErr(
        t("integrations.netbox.virtualization.editor.invalidJson", "Invalid JSON"),
      );
      return;
    }
    setBusy(true);
    const ok = await editor.submit(parsed);
    setBusy(false);
    if (ok) onClose();
  }, [text, editor, onClose, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {editor.title}
          </h3>
          <button onClick={onClose} className="app-bar-button p-1">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <label className="mb-1 block text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.netbox.virtualization.editor.jsonLabel",
              "JSON body",
            )}
          </label>
          <textarea
            className="h-64 w-full rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          {err && (
            <p className="mt-1 text-xs text-[var(--color-error,#ef4444)]">
              {err}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2">
          <button
            onClick={onClose}
            className="app-bar-button px-3 py-1.5 text-sm"
          >
            {t("integrations.netbox.virtualization.actions.cancel", "Cancel")}
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t("integrations.netbox.virtualization.actions.save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Small building blocks ────────────────────────────────────────────────────

const SectionHeader: React.FC<{
  title: string;
  onRefresh: () => void;
  onCreate?: () => void;
  createLabel?: string;
}> = ({ title, onRefresh, onCreate, createLabel }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
          title={t("integrations.netbox.virtualization.actions.refresh", "Refresh")}
        >
          <RefreshCw size={12} />
        </button>
        {onCreate && (
          <button
            onClick={onCreate}
            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
          >
            <Plus size={12} />
            {createLabel ??
              t("integrations.netbox.virtualization.actions.create", "Create")}
          </button>
        )}
      </div>
    </div>
  );
};

const emptyRow = (cols: number, text: string) => (
  <tr>
    <td
      colSpan={cols}
      className="px-2 py-4 text-center text-xs text-[var(--color-textSecondary)]"
    >
      {text}
    </td>
  </tr>
);

// ─── Main component ───────────────────────────────────────────────────────────

const NetboxVirtualizationTab: React.FC<NetboxTabProps> = ({
  connectionId,
}) => {
  const { t } = useTranslation();
  const vt = useNetboxVirtualization(connectionId);
  const [section, setSection] = useState<SectionKey>("vms");
  const [editor, setEditor] = useState<EditorState | null>(null);

  const tr = useCallback(
    (key: string, def: string) =>
      t(`integrations.netbox.virtualization.${key}`, def),
    [t],
  );

  const {
    loadVms,
    loadClusters,
    loadClusterTypes,
    loadClusterGroups,
    loadCircuits,
    loadCircuitProviders,
    loadCircuitTypes,
  } = vt;

  // Load each section's data the first time it becomes active.
  const [loaded, setLoaded] = useState<Record<SectionKey, boolean>>({
    vms: false,
    clusters: false,
    circuits: false,
  });
  useEffect(() => {
    if (loaded[section]) return;
    setLoaded((p) => ({ ...p, [section]: true }));
    if (section === "vms") {
      void loadVms();
    } else if (section === "clusters") {
      void loadClusters();
      void loadClusterTypes();
      void loadClusterGroups();
    } else {
      void loadCircuits();
      void loadCircuitProviders();
      void loadCircuitTypes();
    }
  }, [
    section,
    loaded,
    loadVms,
    loadClusters,
    loadClusterTypes,
    loadClusterGroups,
    loadCircuits,
    loadCircuitProviders,
    loadCircuitTypes,
  ]);

  const confirmDelete = useCallback(
    () => window.confirm(tr("confirm.delete", "Delete this item?")),
    [tr],
  );

  const sections: { key: SectionKey; label: string; icon: typeof Server }[] =
    useMemo(
      () => [
        { key: "vms", label: tr("sections.vms", "Virtual Machines"), icon: Server },
        { key: "clusters", label: tr("sections.clusters", "Clusters"), icon: Boxes },
        { key: "circuits", label: tr("sections.circuits", "Circuits"), icon: Cable },
      ],
      [tr],
    );

  return (
    <div className="flex h-full flex-col">
      {/* Inner section switcher */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1 border-b-2 px-3 py-2 text-xs ${
                active
                  ? "border-primary text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {s.label}
            </button>
          );
        })}
        {vt.loading && (
          <Loader2 size={13} className="ml-1 animate-spin text-primary" />
        )}
      </div>

      {vt.error && (
        <div className="flex items-center justify-between bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{vt.error}</span>
          <button onClick={vt.clearError} className="app-bar-button p-0.5">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {section === "vms" && (
          <VmsSection vt={vt} tr={tr} openEditor={setEditor} confirm={confirmDelete} />
        )}
        {section === "clusters" && (
          <ClustersSection
            vt={vt}
            tr={tr}
            openEditor={setEditor}
            confirm={confirmDelete}
          />
        )}
        {section === "circuits" && (
          <CircuitsSection
            vt={vt}
            tr={tr}
            openEditor={setEditor}
            confirm={confirmDelete}
          />
        )}
      </div>

      {editor && (
        <JsonEditorModal editor={editor} onClose={() => setEditor(null)} />
      )}
    </div>
  );
};

// ─── Shared prop shape for sections ──────────────────────────────────────────

type Vt = ReturnType<typeof useNetboxVirtualization>;
interface SectionProps {
  vt: Vt;
  tr: (key: string, def: string) => string;
  openEditor: (e: EditorState) => void;
  confirm: () => boolean;
}

const cellCls = "px-2 py-1.5 text-xs text-[var(--color-text)]";
const headCls =
  "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-textSecondary)]";
const rowCls =
  "border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]";
const iconBtn = "app-bar-button p-1 text-[var(--color-textSecondary)]";

// ─── Virtual Machines ─────────────────────────────────────────────────────────

const VmsSection: React.FC<SectionProps> = ({ vt, tr, openEditor, confirm }) => {
  const detail = vt.vmDetail;

  if (detail) {
    return <VmDetailPanel vt={vt} tr={tr} openEditor={openEditor} confirm={confirm} />;
  }

  return (
    <div>
      <SectionHeader
        title={tr("sections.vms", "Virtual Machines")}
        onRefresh={() => void vt.loadVms()}
        onCreate={() =>
          openEditor({
            title: tr("vm.create", "Create virtual machine"),
            initial: { name: "", status: "active" },
            submit: vt.createVm,
          })
        }
      />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={headCls}>{tr("vm.columns.name", "Name")}</th>
            <th className={headCls}>{tr("vm.columns.status", "Status")}</th>
            <th className={headCls}>{tr("vm.columns.cluster", "Cluster")}</th>
            <th className={headCls}>{tr("vm.columns.vcpus", "vCPUs")}</th>
            <th className={headCls}>{tr("vm.columns.memory", "Memory")}</th>
            <th className={headCls}>{tr("vm.columns.primaryIp", "Primary IP")}</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {vt.vms.length === 0
            ? emptyRow(7, tr("empty", "No records."))
            : vt.vms.map((vm: VirtualMachine) => (
                <tr key={vm.id ?? vm.name} className={rowCls}>
                  <td className={cellCls}>{vm.name ?? "—"}</td>
                  <td className={cellCls}>{refLabel(vm.status)}</td>
                  <td className={cellCls}>{refLabel(vm.cluster)}</td>
                  <td className={cellCls}>{num(vm.vcpus)}</td>
                  <td className={cellCls}>{num(vm.memory)}</td>
                  <td className={cellCls}>{refLabel(vm.primaryIp4)}</td>
                  <td className={`${cellCls} whitespace-nowrap text-right`}>
                    <button
                      className={iconBtn}
                      title={tr("actions.view", "View")}
                      onClick={() => vm.id != null && void vt.selectVm(vm.id)}
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      className={iconBtn}
                      title={tr("actions.edit", "Edit")}
                      onClick={() =>
                        openEditor({
                          title: tr("vm.edit", "Edit virtual machine"),
                          initial: vm as unknown as NetboxData,
                          submit: (d) => vt.updateVm(vm.id as number, d),
                        })
                      }
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className={iconBtn}
                      title={tr("actions.delete", "Delete")}
                      onClick={() =>
                        vm.id != null &&
                        confirm() &&
                        void vt.deleteVm(vm.id)
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
};

const VmDetailPanel: React.FC<SectionProps> = ({
  vt,
  tr,
  openEditor,
  confirm,
}) => {
  const detail = vt.vmDetail;
  if (!detail) return null;
  const { vm, interfaces } = detail;
  const vmId = vm.id as number;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={vt.clearVmDetail}
          className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
        >
          <ChevronLeft size={13} />
          {tr("actions.back", "Back")}
        </button>
        <button
          onClick={() =>
            openEditor({
              title: tr("vm.addInterface", "Add interface"),
              initial: { virtual_machine: vmId, name: "eth0" },
              submit: (d) => vt.createVmInterface(d, vmId),
            })
          }
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
        >
          <Plus size={12} />
          {tr("vm.addInterface", "Add interface")}
        </button>
      </div>

      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {vm.name ?? tr("vm.detail", "Virtual machine")}
      </h3>
      <dl className="mb-4 mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <Field label={tr("vm.columns.status", "Status")} value={refLabel(vm.status)} />
        <Field label={tr("vm.columns.cluster", "Cluster")} value={refLabel(vm.cluster)} />
        <Field label={tr("vm.columns.vcpus", "vCPUs")} value={num(vm.vcpus)} />
        <Field label={tr("vm.columns.memory", "Memory")} value={num(vm.memory)} />
        <Field label={tr("vm.columns.disk", "Disk")} value={num(vm.disk)} />
        <Field label={tr("vm.columns.primaryIp", "Primary IP")} value={refLabel(vm.primaryIp4)} />
      </dl>

      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
        {tr("vm.interfaces", "Interfaces")}
      </h4>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={headCls}>{tr("vm.iface.name", "Name")}</th>
            <th className={headCls}>{tr("vm.iface.enabled", "Enabled")}</th>
            <th className={headCls}>{tr("vm.iface.mac", "MAC")}</th>
            <th className={headCls}>{tr("vm.iface.mtu", "MTU")}</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {interfaces.length === 0
            ? emptyRow(5, tr("empty", "No records."))
            : interfaces.map((i: VmInterface) => (
                <tr key={i.id ?? i.name} className={rowCls}>
                  <td className={cellCls}>{i.name ?? "—"}</td>
                  <td className={cellCls}>{i.enabled ? "✓" : "—"}</td>
                  <td className={cellCls}>{i.macAddress ?? "—"}</td>
                  <td className={cellCls}>{num(i.mtu)}</td>
                  <td className={`${cellCls} whitespace-nowrap text-right`}>
                    <button
                      className={iconBtn}
                      title={tr("actions.edit", "Edit")}
                      onClick={() =>
                        openEditor({
                          title: tr("vm.editInterface", "Edit interface"),
                          initial: i as unknown as NetboxData,
                          submit: (d) =>
                            vt.updateVmInterface(i.id as number, d, vmId),
                        })
                      }
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className={iconBtn}
                      title={tr("actions.delete", "Delete")}
                      onClick={() =>
                        i.id != null &&
                        confirm() &&
                        void vt.deleteVmInterface(i.id, vmId)
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Clusters ─────────────────────────────────────────────────────────────────

const ClustersSection: React.FC<SectionProps> = ({
  vt,
  tr,
  openEditor,
  confirm,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          title={tr("sections.clusters", "Clusters")}
          onRefresh={() => void vt.loadClusters()}
          onCreate={() =>
            openEditor({
              title: tr("cluster.create", "Create cluster"),
              initial: { name: "", type: null },
              submit: vt.createCluster,
            })
          }
        />
        {vt.clusterDetail && (
          <div className="mb-2 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-[var(--color-text)]">
                {vt.clusterDetail.name ?? tr("cluster.detail", "Cluster")}
              </span>
              <button onClick={vt.clearClusterDetail} className="app-bar-button p-0.5">
                <X size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
              <Field label={tr("cluster.columns.type", "Type")} value={refLabel(vt.clusterDetail.type)} />
              <Field label={tr("cluster.columns.group", "Group")} value={refLabel(vt.clusterDetail.group)} />
              <Field label={tr("cluster.columns.site", "Site")} value={refLabel(vt.clusterDetail.site)} />
              <Field label={tr("cluster.columns.status", "Status")} value={refLabel(vt.clusterDetail.status)} />
              <Field label={tr("cluster.columns.devices", "Devices")} value={num(vt.clusterDetail.deviceCount)} />
              <Field label={tr("cluster.columns.vms", "VMs")} value={num(vt.clusterDetail.virtualmachineCount)} />
            </div>
          </div>
        )}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={headCls}>{tr("cluster.columns.name", "Name")}</th>
              <th className={headCls}>{tr("cluster.columns.type", "Type")}</th>
              <th className={headCls}>{tr("cluster.columns.group", "Group")}</th>
              <th className={headCls}>{tr("cluster.columns.site", "Site")}</th>
              <th className={headCls}>{tr("cluster.columns.vms", "VMs")}</th>
              <th className={headCls} />
            </tr>
          </thead>
          <tbody>
            {vt.clusters.length === 0
              ? emptyRow(6, tr("empty", "No records."))
              : vt.clusters.map((c: Cluster) => (
                  <tr key={c.id ?? c.name} className={rowCls}>
                    <td className={cellCls}>{c.name ?? "—"}</td>
                    <td className={cellCls}>{refLabel(c.type)}</td>
                    <td className={cellCls}>{refLabel(c.group)}</td>
                    <td className={cellCls}>{refLabel(c.site)}</td>
                    <td className={cellCls}>{num(c.virtualmachineCount)}</td>
                    <td className={`${cellCls} whitespace-nowrap text-right`}>
                      <button
                        className={iconBtn}
                        title={tr("actions.view", "View")}
                        onClick={() => c.id != null && void vt.selectCluster(c.id)}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.edit", "Edit")}
                        onClick={() =>
                          openEditor({
                            title: tr("cluster.edit", "Edit cluster"),
                            initial: c as unknown as NetboxData,
                            submit: (d) => vt.updateCluster(c.id as number, d),
                          })
                        }
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.delete", "Delete")}
                        onClick={() =>
                          c.id != null && confirm() && void vt.deleteCluster(c.id)
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Cluster types */}
      <div>
        <SectionHeader
          title={tr("cluster.types", "Cluster types")}
          onRefresh={() => void vt.loadClusterTypes()}
          onCreate={() =>
            openEditor({
              title: tr("cluster.addType", "Add cluster type"),
              initial: { name: "", slug: "" },
              submit: vt.createClusterType,
            })
          }
          createLabel={tr("cluster.addType", "Add cluster type")}
        />
        <ReferenceTable
          rows={vt.clusterTypes}
          tr={tr}
          countLabel={tr("cluster.columns.clusters", "Clusters")}
          countOf={(r: ClusterType) => r.clusterCount}
          onView={(r: ClusterType) =>
            r.id != null && void vt.loadClusterType(r.id)
          }
        />
      </div>

      {/* Cluster groups */}
      <div>
        <SectionHeader
          title={tr("cluster.groups", "Cluster groups")}
          onRefresh={() => void vt.loadClusterGroups()}
        />
        <ReferenceTable
          rows={vt.clusterGroups}
          tr={tr}
          countLabel={tr("cluster.columns.clusters", "Clusters")}
          countOf={(r) => r.clusterCount}
        />
      </div>
    </div>
  );
};

// ─── Circuits ─────────────────────────────────────────────────────────────────

const CircuitsSection: React.FC<SectionProps> = ({
  vt,
  tr,
  openEditor,
  confirm,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          title={tr("sections.circuits", "Circuits")}
          onRefresh={() => void vt.loadCircuits()}
          onCreate={() =>
            openEditor({
              title: tr("circuit.create", "Create circuit"),
              initial: { cid: "", provider: null, type: null, status: "active" },
              submit: vt.createCircuit,
            })
          }
        />
        {vt.circuitDetail && (
          <div className="mb-2 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-[var(--color-text)]">
                {vt.circuitDetail.circuit.cid ?? tr("circuit.detail", "Circuit")}
              </span>
              <button onClick={vt.clearCircuitDetail} className="app-bar-button p-0.5">
                <X size={12} />
              </button>
            </div>
            <h5 className="mb-1 mt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-textSecondary)]">
              {tr("circuit.terminations", "Terminations")}
            </h5>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={headCls}>{tr("circuit.term.side", "Side")}</th>
                  <th className={headCls}>{tr("circuit.term.site", "Site")}</th>
                  <th className={headCls}>{tr("circuit.term.portSpeed", "Port speed")}</th>
                </tr>
              </thead>
              <tbody>
                {vt.circuitDetail.terminations.length === 0
                  ? emptyRow(3, tr("empty", "No records."))
                  : vt.circuitDetail.terminations.map((tm) => (
                      <tr key={tm.id} className={rowCls}>
                        <td className={cellCls}>{tm.termSide ?? "—"}</td>
                        <td className={cellCls}>{refLabel(tm.site)}</td>
                        <td className={cellCls}>{num(tm.portSpeed)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={headCls}>{tr("circuit.columns.cid", "Circuit ID")}</th>
              <th className={headCls}>{tr("circuit.columns.provider", "Provider")}</th>
              <th className={headCls}>{tr("circuit.columns.type", "Type")}</th>
              <th className={headCls}>{tr("circuit.columns.status", "Status")}</th>
              <th className={headCls}>{tr("circuit.columns.commitRate", "Commit rate")}</th>
              <th className={headCls} />
            </tr>
          </thead>
          <tbody>
            {vt.circuits.length === 0
              ? emptyRow(6, tr("empty", "No records."))
              : vt.circuits.map((c: Circuit) => (
                  <tr key={c.id ?? c.cid} className={rowCls}>
                    <td className={cellCls}>{c.cid ?? "—"}</td>
                    <td className={cellCls}>{refLabel(c.provider)}</td>
                    <td className={cellCls}>{refLabel(c.type)}</td>
                    <td className={cellCls}>{refLabel(c.status)}</td>
                    <td className={cellCls}>{num(c.commitRate)}</td>
                    <td className={`${cellCls} whitespace-nowrap text-right`}>
                      <button
                        className={iconBtn}
                        title={tr("actions.view", "View")}
                        onClick={() => c.id != null && void vt.selectCircuit(c.id)}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.edit", "Edit")}
                        onClick={() =>
                          openEditor({
                            title: tr("circuit.edit", "Edit circuit"),
                            initial: c as unknown as NetboxData,
                            submit: (d) => vt.updateCircuit(c.id as number, d),
                          })
                        }
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.delete", "Delete")}
                        onClick={() =>
                          c.id != null && confirm() && void vt.deleteCircuit(c.id)
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Providers */}
      <div>
        <SectionHeader
          title={tr("circuit.providers", "Providers")}
          onRefresh={() => void vt.loadCircuitProviders()}
          onCreate={() =>
            openEditor({
              title: tr("circuit.addProvider", "Add provider"),
              initial: { name: "", slug: "" },
              submit: vt.createCircuitProvider,
            })
          }
          createLabel={tr("circuit.addProvider", "Add provider")}
        />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={headCls}>{tr("circuit.prov.name", "Name")}</th>
              <th className={headCls}>{tr("circuit.prov.account", "Account")}</th>
              <th className={headCls}>{tr("circuit.columns.circuits", "Circuits")}</th>
              <th className={headCls} />
            </tr>
          </thead>
          <tbody>
            {vt.circuitProviders.length === 0
              ? emptyRow(4, tr("empty", "No records."))
              : vt.circuitProviders.map((p: CircuitProvider) => (
                  <tr key={p.id ?? p.name} className={rowCls}>
                    <td className={cellCls}>{p.name ?? "—"}</td>
                    <td className={cellCls}>{p.account ?? "—"}</td>
                    <td className={cellCls}>{num(p.circuitCount)}</td>
                    <td className={`${cellCls} whitespace-nowrap text-right`}>
                      <button
                        className={iconBtn}
                        title={tr("actions.view", "View")}
                        onClick={() =>
                          p.id != null && void vt.loadCircuitProvider(p.id)
                        }
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.edit", "Edit")}
                        onClick={() =>
                          openEditor({
                            title: tr("circuit.editProvider", "Edit provider"),
                            initial: p as unknown as NetboxData,
                            submit: (d) =>
                              vt.updateCircuitProvider(p.id as number, d),
                          })
                        }
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className={iconBtn}
                        title={tr("actions.delete", "Delete")}
                        onClick={() =>
                          p.id != null &&
                          confirm() &&
                          void vt.deleteCircuitProvider(p.id)
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Circuit types */}
      <div>
        <SectionHeader
          title={tr("circuit.types", "Circuit types")}
          onRefresh={() => void vt.loadCircuitTypes()}
        />
        <ReferenceTable
          rows={vt.circuitTypes}
          tr={tr}
          countLabel={tr("circuit.columns.circuits", "Circuits")}
          countOf={(r: CircuitType) => r.circuitCount}
          onView={(r: CircuitType) =>
            r.id != null && void vt.loadCircuitType(r.id)
          }
        />
      </div>
    </div>
  );
};

// ─── Reusable reference table (name / slug / count) ──────────────────────────

interface RefRow {
  id?: number | null;
  name?: string | null;
  slug?: string | null;
}

function ReferenceTable<T extends RefRow>({
  rows,
  tr,
  countLabel,
  countOf,
  onView,
}: {
  rows: T[];
  tr: (key: string, def: string) => string;
  countLabel: string;
  countOf: (r: T) => number | null | undefined;
  onView?: (r: T) => void;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={headCls}>{tr("ref.name", "Name")}</th>
          <th className={headCls}>{tr("ref.slug", "Slug")}</th>
          <th className={headCls}>{countLabel}</th>
          {onView && <th className={headCls} />}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0
          ? emptyRow(onView ? 4 : 3, tr("empty", "No records."))
          : rows.map((r) => (
              <tr key={r.id ?? r.name} className={rowCls}>
                <td className={cellCls}>{r.name ?? "—"}</td>
                <td className={cellCls}>{r.slug ?? "—"}</td>
                <td className={cellCls}>{num(countOf(r))}</td>
                {onView && (
                  <td className={`${cellCls} whitespace-nowrap text-right`}>
                    <button
                      className={iconBtn}
                      title={tr("actions.view", "View")}
                      onClick={() => onView(r)}
                    >
                      <Eye size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
      </tbody>
    </table>
  );
}

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-[10px] uppercase tracking-wide text-[var(--color-textSecondary)]">
      {label}
    </dt>
    <dd className="text-[var(--color-text)]">{value}</dd>
  </div>
);

export default NetboxVirtualizationTab;
