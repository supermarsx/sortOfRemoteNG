// VmwDesktopVmsTab — "VMs & Guest" sub-tab for the VMware Workstation panel
// (t42-vmwaredesktop-c1).
//
// Binds ALL 44 `vmwd_*` commands of the vms/guest category through
// `useVmwDesktopVms()`, grouped into four sub-sections: Lifecycle & Hardware,
// Power, Snapshots, and Guest & Tools. A single selected VM (vmx path) is shared
// across the sections; batch power operates over inventory check-boxes. Rendered
// lazily by the panel shell (registry-driven) and receives `VmwDesktopTabProps`.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Loader2,
  Play,
  Square,
  RotateCcw,
  PauseCircle,
  PlayCircle,
  Moon,
  Trash2,
  Copy,
  Camera,
  HardDrive,
  Network,
  Disc,
  Boxes,
  Terminal,
  FileCode,
  FolderTree,
  Cpu,
  Wrench,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVmwDesktopVms } from "../../../hooks/integration/vmwareDesktop/useVmwDesktopVms";
import type {
  PowerAction,
  SnapshotInfo,
  VmDetail,
  VmPowerState,
  VmSummary,
  VmwDesktopTabProps,
} from "../../../types/vmwareDesktop";
import type {
  BatchPowerResult,
  GuestEnvVar,
  GuestExecResult,
  GuestProcess,
  SnapshotTree,
  ToolsStatus,
} from "../../../types/vmwareDesktop/vms";

// ─── Shared UI helpers ────────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";
const th = "px-2 py-1 text-left font-medium text-[var(--color-textSecondary)]";
const td = "px-2 py-1 text-[var(--color-text)]";

const Labeled: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
    <span>{label}</span>
    {children}
  </label>
);

const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className={card}>
    <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
      {icon}
      {title}
    </div>
    <div className="flex flex-col gap-3">{children}</div>
  </div>
);

/** Small monospace output box for command results. */
const Output: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  children ? (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs text-[var(--color-text)]">
      {children}
    </pre>
  ) : null;

function numOrNull(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const POWER_ACTIONS: PowerAction[] = [
  "start",
  "stop",
  "suspend",
  "reset",
  "pause",
  "unpause",
  "shutdown",
  "reboot",
];

type SectionKey = "lifecycle" | "power" | "snapshots" | "guest";
type Mgr = ReturnType<typeof useVmwDesktopVms>;

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle & Hardware
// ═══════════════════════════════════════════════════════════════════════════════

const LifecycleSection: React.FC<{
  mgr: Mgr;
  vmx: string;
  onDeleted: () => void;
  onCreated: (vmxPath: string) => void;
}> = ({ mgr, vmx, onDeleted, onCreated }) => {
  const { t } = useTranslation();
  const { run, api } = mgr;
  const [detail, setDetail] = useState<VmDetail | null>(null);

  // Create VM
  const [cName, setCName] = useState("");
  const [cGuestOs, setCGuestOs] = useState("otherlinux-64");
  const [cCpus, setCCpus] = useState("");
  const [cMem, setCMem] = useState("");
  const [cDisk, setCDisk] = useState("");
  const [cDiskType, setCDiskType] = useState("");
  const [cIso, setCIso] = useState("");
  const [cNet, setCNet] = useState("");
  const [cFirmware, setCFirmware] = useState("");
  const [cTarget, setCTarget] = useState("");

  // Update VM
  const [uName, setUName] = useState("");
  const [uCpus, setUCpus] = useState("");
  const [uCores, setUCores] = useState("");
  const [uMem, setUMem] = useState("");
  const [uAnnotation, setUAnnotation] = useState("");
  const [uFirmware, setUFirmware] = useState("");
  const [uNested, setUNested] = useState(false);
  const [uSideChannel, setUSideChannel] = useState(false);
  const [uSecureBoot, setUSecureBoot] = useState(false);
  const [uVtpm, setUVtpm] = useState(false);

  // Clone
  const [clDest, setClDest] = useState("");
  const [clType, setClType] = useState("full");
  const [clSnap, setClSnap] = useState("");
  const [clDir, setClDir] = useState("");

  // Register / unregister
  const [regPath, setRegPath] = useState("");
  const [unregId, setUnregId] = useState("");
  const [regResult, setRegResult] = useState("");

  // NIC
  const [nicIndex, setNicIndex] = useState("0");
  const [nicNet, setNicNet] = useState("");
  const [nicAdapter, setNicAdapter] = useState("");
  const [nicMac, setNicMac] = useState("");
  const [nicVnet, setNicVnet] = useState("");
  const [nicConnected, setNicConnected] = useState(true);
  const [nicStartConnected, setNicStartConnected] = useState(true);

  // CD-ROM
  const [cdIndex, setCdIndex] = useState("0");
  const [cdDevice, setCdDevice] = useState("cdrom-image");
  const [cdFile, setCdFile] = useState("");
  const [cdConnected, setCdConnected] = useState(true);

  const loadDetail = useCallback(async () => {
    if (!vmx) return;
    try {
      setDetail(await run(() => api.getVm(vmx)));
    } catch {
      /* surfaced via mgr.error */
    }
  }, [api, run, vmx]);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Group title={t("integrations.vmwareDesktop.vms.detail.title", "VM details")} icon={<Boxes size={14} />}>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => void loadDetail()} disabled={!vmx || mgr.isLoading}>
            <RefreshCw size={12} />
            {t("integrations.vmwareDesktop.vms.inventory.loadDetail", "Load details")}
          </button>
          <span className="truncate text-xs text-[var(--color-textSecondary)]">{vmx || "—"}</span>
        </div>
        {detail && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.power", "Power state")}</span>
            <span>{detail.powerState}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.guestOs", "Guest OS")}</span>
            <span>{detail.guestOs ?? "—"}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.cpus", "vCPUs")}</span>
            <span>{detail.numCpus ?? "—"}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.memory", "Memory (MB)")}</span>
            <span>{detail.memoryMb ?? "—"}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.firmware", "Firmware")}</span>
            <span>{detail.firmware ?? "—"}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.tools", "VMware Tools")}</span>
            <span>{detail.toolsStatus ?? "—"}</span>
            <span className="text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.detail.ip", "IP address")}</span>
            <span>{detail.ipAddress ?? "—"}</span>
          </div>
        )}
        {detail && (
          <div className="text-xs text-[var(--color-textSecondary)]">
            <div className="flex items-center gap-1"><Network size={12} />{t("integrations.vmwareDesktop.vms.detail.nics", "Network adapters")}: {detail.nics.length}</div>
            <div className="flex items-center gap-1"><HardDrive size={12} />{t("integrations.vmwareDesktop.vms.detail.disks", "Disks")}: {detail.disks.length}</div>
            <div className="flex items-center gap-1"><Disc size={12} />{t("integrations.vmwareDesktop.vms.detail.cdroms", "CD/DVD drives")}: {detail.cdroms.length}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={btn}
            disabled={!vmx || mgr.isLoading}
            onClick={() => {
              if (!vmx) return;
              if (!window.confirm(t("integrations.vmwareDesktop.vms.lifecycle.deleteConfirm", "Delete this VM and its files? This cannot be undone."))) return;
              void run(() => api.deleteVm(vmx)).then(onDeleted).catch(() => {});
            }}
          >
            <Trash2 size={12} />
            {t("integrations.vmwareDesktop.vms.lifecycle.delete", "Delete VM")}
          </button>
        </div>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.createTitle", "Create VM")} icon={<Boxes size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.name", "Name")}>
            <input className={field} value={cName} onChange={(e) => setCName(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.guestOs", "Guest OS ID")}>
            <input className={field} value={cGuestOs} onChange={(e) => setCGuestOs(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.cpus", "vCPUs")}>
            <input className={field} inputMode="numeric" value={cCpus} onChange={(e) => setCCpus(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.memory", "Memory (MB)")}>
            <input className={field} inputMode="numeric" value={cMem} onChange={(e) => setCMem(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.diskSize", "Disk size (MB)")}>
            <input className={field} inputMode="numeric" value={cDisk} onChange={(e) => setCDisk(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.diskType", "Disk type")}>
            <input className={field} value={cDiskType} onChange={(e) => setCDiskType(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.iso", "ISO path")}>
            <input className={field} value={cIso} onChange={(e) => setCIso(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.network", "Network type")}>
            <input className={field} value={cNet} onChange={(e) => setCNet(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.firmware", "Firmware (bios/efi)")}>
            <input className={field} value={cFirmware} onChange={(e) => setCFirmware(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.targetDir", "Target directory")}>
            <input className={field} value={cTarget} onChange={(e) => setCTarget(e.target.value)} />
          </Labeled>
        </div>
        <button
          className={btn}
          disabled={!cName || !cGuestOs || mgr.isLoading}
          onClick={() =>
            void run(() =>
              api.createVm({
                name: cName,
                guestOs: cGuestOs,
                numCpus: numOrNull(cCpus),
                memoryMb: numOrNull(cMem),
                diskSizeMb: numOrNull(cDisk),
                diskType: cDiskType.trim() || null,
                isoPath: cIso.trim() || null,
                networkType: cNet.trim() || null,
                firmware: cFirmware.trim() || null,
                targetDir: cTarget.trim() || null,
              }),
            )
              .then((d) => onCreated(d.vmxPath))
              .catch(() => {})
          }
        >
          {t("integrations.vmwareDesktop.vms.lifecycle.create", "Create")}
        </button>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.updateTitle", "Update VM")} icon={<Cpu size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.name", "Name")}>
            <input className={field} value={uName} onChange={(e) => setUName(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.cpus", "vCPUs")}>
            <input className={field} inputMode="numeric" value={uCpus} onChange={(e) => setUCpus(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.coresPerSocket", "Cores per socket")}>
            <input className={field} inputMode="numeric" value={uCores} onChange={(e) => setUCores(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.memory", "Memory (MB)")}>
            <input className={field} inputMode="numeric" value={uMem} onChange={(e) => setUMem(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.firmware", "Firmware (bios/efi)")}>
            <input className={field} value={uFirmware} onChange={(e) => setUFirmware(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.annotation", "Annotation")}>
            <input className={field} value={uAnnotation} onChange={(e) => setUAnnotation(e.target.value)} />
          </Labeled>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={uNested} onChange={(e) => setUNested(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.nestedVirt", "Nested virtualization")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={uSideChannel} onChange={(e) => setUSideChannel(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.sideChannel", "Side-channel mitigations")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={uSecureBoot} onChange={(e) => setUSecureBoot(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.secureBoot", "UEFI Secure Boot")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={uVtpm} onChange={(e) => setUVtpm(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.vtpm", "vTPM")}</label>
        </div>
        <button
          className={btn}
          disabled={!vmx || mgr.isLoading}
          onClick={() =>
            void run(() =>
              api.updateVm({
                vmxPath: vmx,
                name: uName.trim() || null,
                numCpus: numOrNull(uCpus),
                coresPerSocket: numOrNull(uCores),
                memoryMb: numOrNull(uMem),
                annotation: uAnnotation.trim() || null,
                firmware: uFirmware.trim() || null,
                nestedVirt: uNested,
                sideChannelMitigations: uSideChannel,
                uefiSecureBoot: uSecureBoot,
                vtpm: uVtpm,
              }),
            ).catch(() => {})
          }
        >
          {t("integrations.vmwareDesktop.vms.lifecycle.update", "Apply changes")}
        </button>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.cloneTitle", "Clone VM")} icon={<Copy size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.destName", "Destination name")}>
            <input className={field} value={clDest} onChange={(e) => setClDest(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.cloneType", "Clone type (full/linked)")}>
            <select className={field} value={clType} onChange={(e) => setClType(e.target.value)}>
              <option value="full">full</option>
              <option value="linked">linked</option>
            </select>
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.snapshotName", "Snapshot name (optional)")}>
            <input className={field} value={clSnap} onChange={(e) => setClSnap(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.destDir", "Destination directory")}>
            <input className={field} value={clDir} onChange={(e) => setClDir(e.target.value)} />
          </Labeled>
        </div>
        <button
          className={btn}
          disabled={!vmx || !clDest || mgr.isLoading}
          onClick={() =>
            void run(() =>
              api.cloneVm({
                sourceVmx: vmx,
                destName: clDest,
                cloneType: clType,
                snapshotName: clSnap.trim() || null,
                destDir: clDir.trim() || null,
              }),
            )
              .then((d) => onCreated(d.vmxPath))
              .catch(() => {})
          }
        >
          {t("integrations.vmwareDesktop.vms.lifecycle.clone", "Clone")}
        </button>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.registerTitle", "Register / Unregister")} icon={<Boxes size={14} />}>
        <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.vmxPath", "VMX path")}>
          <input className={field} value={regPath} onChange={(e) => setRegPath(e.target.value)} placeholder={vmx} />
        </Labeled>
        <div className="flex items-center gap-2">
          <button
            className={btn}
            disabled={mgr.isLoading || !(regPath || vmx)}
            onClick={() => void run(() => api.registerVm(regPath.trim() || vmx)).then(setRegResult).catch(() => {})}
          >
            {t("integrations.vmwareDesktop.vms.lifecycle.register", "Register")}
          </button>
        </div>
        <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.vmId", "VM id")}>
          <input className={field} value={unregId} onChange={(e) => setUnregId(e.target.value)} />
        </Labeled>
        <button
          className={btn}
          disabled={mgr.isLoading || !unregId}
          onClick={() => void run(() => api.unregisterVm(unregId.trim())).catch(() => {})}
        >
          {t("integrations.vmwareDesktop.vms.lifecycle.unregister", "Unregister")}
        </button>
        <Output>{regResult}</Output>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.nicTitle", "Configure NIC")} icon={<Network size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.nicIndex", "NIC index")}>
            <input className={field} inputMode="numeric" value={nicIndex} onChange={(e) => setNicIndex(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.network", "Network type")}>
            <input className={field} value={nicNet} onChange={(e) => setNicNet(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.adapterType", "Adapter type")}>
            <input className={field} value={nicAdapter} onChange={(e) => setNicAdapter(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.macAddress", "MAC address")}>
            <input className={field} value={nicMac} onChange={(e) => setNicMac(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.vnet", "vnet")}>
            <input className={field} value={nicVnet} onChange={(e) => setNicVnet(e.target.value)} />
          </Labeled>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={nicConnected} onChange={(e) => setNicConnected(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.connected", "Connected")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={nicStartConnected} onChange={(e) => setNicStartConnected(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.startConnected", "Connect at power on")}</label>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={btn}
            disabled={!vmx || mgr.isLoading}
            onClick={() =>
              void run(() =>
                api.configureNic({
                  vmxPath: vmx,
                  nicIndex: numOrNull(nicIndex) ?? 0,
                  networkType: nicNet.trim() || null,
                  adapterType: nicAdapter.trim() || null,
                  macAddress: nicMac.trim() || null,
                  vnet: nicVnet.trim() || null,
                  connected: nicConnected,
                  startConnected: nicStartConnected,
                }),
              ).catch(() => {})
            }
          >
            {t("integrations.vmwareDesktop.vms.lifecycle.configureNic", "Apply NIC")}
          </button>
          <button
            className={btn}
            disabled={!vmx || mgr.isLoading}
            onClick={() => void run(() => api.removeNic(vmx, numOrNull(nicIndex) ?? 0)).catch(() => {})}
          >
            {t("integrations.vmwareDesktop.vms.lifecycle.removeNic", "Remove NIC")}
          </button>
        </div>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.lifecycle.cdromTitle", "Configure CD/DVD")} icon={<Disc size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.cdromIndex", "CD/DVD index")}>
            <input className={field} inputMode="numeric" value={cdIndex} onChange={(e) => setCdIndex(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.deviceType", "Device type")}>
            <input className={field} value={cdDevice} onChange={(e) => setCdDevice(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.lifecycle.fileName", "Backing file / device")}>
            <input className={field} value={cdFile} onChange={(e) => setCdFile(e.target.value)} />
          </Labeled>
        </div>
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]"><input type="checkbox" checked={cdConnected} onChange={(e) => setCdConnected(e.target.checked)} />{t("integrations.vmwareDesktop.vms.lifecycle.connected", "Connected")}</label>
        <button
          className={btn}
          disabled={!vmx || !cdDevice || mgr.isLoading}
          onClick={() =>
            void run(() =>
              api.configureCdrom({
                vmxPath: vmx,
                cdromIndex: numOrNull(cdIndex) ?? 0,
                deviceType: cdDevice,
                fileName: cdFile.trim() || null,
                connected: cdConnected,
              }),
            ).catch(() => {})
          }
        >
          {t("integrations.vmwareDesktop.vms.lifecycle.configureCdrom", "Apply CD/DVD")}
        </button>
      </Group>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Power
// ═══════════════════════════════════════════════════════════════════════════════

const PowerSection: React.FC<{
  mgr: Mgr;
  vmx: string;
  batchTargets: string[];
}> = ({ mgr, vmx, batchTargets }) => {
  const { t } = useTranslation();
  const { run, api } = mgr;
  const [gui, setGui] = useState(true);
  const [hard, setHard] = useState(false);
  const [state, setState] = useState<VmPowerState | null>(null);
  const [action, setAction] = useState<PowerAction>("start");
  const [batch, setBatch] = useState<BatchPowerResult | null>(null);

  const disabled = !vmx || mgr.isLoading;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Group title={t("integrations.vmwareDesktop.vms.sections.power", "Power")} icon={<Play size={14} />}>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={gui} onChange={(e) => setGui(e.target.checked)} />{t("integrations.vmwareDesktop.vms.power.gui", "Show GUI")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} />{t("integrations.vmwareDesktop.vms.power.hard", "Hard")}</label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.startVm(vmx, gui)).catch(() => {})}><Play size={12} />{t("integrations.vmwareDesktop.vms.power.start", "Start")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.stopVm(vmx, hard)).catch(() => {})}><Square size={12} />{t("integrations.vmwareDesktop.vms.power.stop", "Stop")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.resetVm(vmx, hard)).catch(() => {})}><RotateCcw size={12} />{t("integrations.vmwareDesktop.vms.power.reset", "Reset")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.suspendVm(vmx, hard)).catch(() => {})}><Moon size={12} />{t("integrations.vmwareDesktop.vms.power.suspend", "Suspend")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.pauseVm(vmx)).catch(() => {})}><PauseCircle size={12} />{t("integrations.vmwareDesktop.vms.power.pause", "Pause")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.unpauseVm(vmx)).catch(() => {})}><PlayCircle size={12} />{t("integrations.vmwareDesktop.vms.power.unpause", "Resume")}</button>
        </div>
        <div className="flex items-center gap-2">
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.getPowerState(vmx)).then(setState).catch(() => {})}>{t("integrations.vmwareDesktop.vms.power.getState", "Get power state")}</button>
          {state && <span className="text-xs text-[var(--color-text)]">{t("integrations.vmwareDesktop.vms.power.state", "Power state")}: {state}</span>}
        </div>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.power.batchTitle", "Batch power")} icon={<Boxes size={14} />}>
        <p className="text-xs text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.power.batchHint", "Select VMs in the inventory, choose an action, then run.")}</p>
        <div className="flex items-center gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.power.action", "Action")}>
            <select className={field} value={action} onChange={(e) => setAction(e.target.value as PowerAction)}>
              {POWER_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`integrations.vmwareDesktop.vms.power.actions.${a}`, a)}
                </option>
              ))}
            </select>
          </Labeled>
          <button
            className={btn}
            disabled={mgr.isLoading || batchTargets.length === 0}
            onClick={() => void run(() => api.batchPower(batchTargets, action)).then(setBatch).catch(() => {})}
          >
            {t("integrations.vmwareDesktop.vms.power.run", "Run on selected")} ({batchTargets.length})
          </button>
        </div>
        {batch && (
          <Output>
            {`${t("integrations.vmwareDesktop.vms.power.succeeded", "Succeeded")}: ${batch.succeeded.length}\n` +
              batch.succeeded.map((s) => `  ✓ ${s}`).join("\n") +
              (batch.failed.length
                ? `\n${t("integrations.vmwareDesktop.vms.power.failed", "Failed")}: ${batch.failed.length}\n` +
                  batch.failed.map((f) => `  ✗ ${f.vmxPath}: ${f.error}`).join("\n")
                : "")}
          </Output>
        )}
      </Group>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

const SnapshotsSection: React.FC<{ mgr: Mgr; vmx: string }> = ({ mgr, vmx }) => {
  const { t } = useTranslation();
  const { run, api } = mgr;
  const [list, setList] = useState<SnapshotInfo[]>([]);
  const [tree, setTree] = useState<SnapshotTree | null>(null);
  const [detail, setDetail] = useState<SnapshotInfo | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [captureMemory, setCaptureMemory] = useState(true);
  const [quiesce, setQuiesce] = useState(false);
  const [deleteChildren, setDeleteChildren] = useState(false);

  const disabled = !vmx || mgr.isLoading;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Group title={t("integrations.vmwareDesktop.vms.snapshots.title", "Snapshots")} icon={<Camera size={14} />}>
        <div className="flex items-center gap-2">
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.listSnapshots(vmx)).then(setList).catch(() => {})}><RefreshCw size={12} />{t("integrations.vmwareDesktop.vms.snapshots.list", "List")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.getSnapshotTree(vmx)).then(setTree).catch(() => {})}><FolderTree size={12} />{t("integrations.vmwareDesktop.vms.snapshots.tree", "Show tree")}</button>
        </div>
        {tree?.currentSnapshot && (
          <p className="text-xs text-[var(--color-textSecondary)]">{t("integrations.vmwareDesktop.vms.snapshots.current", "Current")}: {tree.currentSnapshot}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={th}>{t("integrations.vmwareDesktop.vms.snapshots.colName", "Name")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.snapshots.colCurrent", "Current")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.snapshots.colDescription", "Description")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td className={td} colSpan={4}>{t("integrations.vmwareDesktop.vms.snapshots.empty", "No snapshots.")}</td></tr>
              )}
              {list.map((s) => (
                <tr key={s.name} className="border-t border-[var(--color-border)]">
                  <td className={td}>{s.displayName ?? s.name}</td>
                  <td className={td}>{s.isCurrent ? "●" : ""}</td>
                  <td className={td}>{s.description ?? ""}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <button className={btn} disabled={disabled} onClick={() => void run(() => api.getSnapshot(vmx, s.name)).then(setDetail).catch(() => {})}>{t("integrations.vmwareDesktop.vms.snapshots.get", "Get")}</button>
                      <button className={btn} disabled={disabled} onClick={() => void run(() => api.revertToSnapshot(vmx, s.name)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.snapshots.revert", "Revert")}</button>
                      <button className={btn} disabled={disabled} onClick={() => void run(() => api.deleteSnapshot(vmx, s.name, deleteChildren)).then(() => setList((l) => l.filter((x) => x.name !== s.name))).catch(() => {})}>{t("integrations.vmwareDesktop.vms.snapshots.delete", "Delete")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]"><input type="checkbox" checked={deleteChildren} onChange={(e) => setDeleteChildren(e.target.checked)} />{t("integrations.vmwareDesktop.vms.snapshots.deleteChildren", "Delete children")}</label>
        {detail && <Output>{JSON.stringify(detail, null, 2)}</Output>}
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.snapshots.createTitle", "Create snapshot")} icon={<Camera size={14} />}>
        <Labeled label={t("integrations.vmwareDesktop.vms.snapshots.name", "Name")}>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Labeled label={t("integrations.vmwareDesktop.vms.snapshots.description", "Description")}>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Labeled>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={captureMemory} onChange={(e) => setCaptureMemory(e.target.checked)} />{t("integrations.vmwareDesktop.vms.snapshots.captureMemory", "Capture memory")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={quiesce} onChange={(e) => setQuiesce(e.target.checked)} />{t("integrations.vmwareDesktop.vms.snapshots.quiesce", "Quiesce filesystem")}</label>
        </div>
        <button
          className={btn}
          disabled={disabled || !name}
          onClick={() => void run(() => api.createSnapshot({ vmxPath: vmx, name, description: description.trim() || null, captureMemory, quiesceFilesystem: quiesce })).then(() => setName("")).catch(() => {})}
        >
          {t("integrations.vmwareDesktop.vms.snapshots.create", "Create")}
        </button>
      </Group>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Guest & Tools
// ═══════════════════════════════════════════════════════════════════════════════

const GuestSection: React.FC<{ mgr: Mgr; vmx: string }> = ({ mgr, vmx }) => {
  const { t } = useTranslation();
  const { run, api } = mgr;
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  // exec / script
  const [program, setProgram] = useState("");
  const [args, setArgs] = useState("");
  const [wait, setWait] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [interpreter, setInterpreter] = useState("/bin/bash");
  const [scriptText, setScriptText] = useState("");
  const [exec, setExec] = useState<GuestExecResult | null>(null);

  // files
  const [hostPath, setHostPath] = useState("");
  const [guestPath, setGuestPath] = useState("");
  const [path, setPath] = useState("");
  const [oldPath, setOldPath] = useState("");
  const [newPath, setNewPath] = useState("");
  const [listing, setListing] = useState<string[] | null>(null);
  const [fileMsg, setFileMsg] = useState("");

  // processes
  const [procs, setProcs] = useState<GuestProcess[]>([]);
  const [pid, setPid] = useState("");

  // variables
  const [varType, setVarType] = useState("guestVar");
  const [varName, setVarName] = useState("");
  const [varValue, setVarValue] = useState("");
  const [envVars, setEnvVars] = useState<GuestEnvVar[] | null>(null);
  const [varMsg, setVarMsg] = useState("");

  // tools
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [ip, setIp] = useState("");

  const authReady = !!vmx && !!user;
  const disabled = !authReady || mgr.isLoading;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Group title={t("integrations.vmwareDesktop.vms.guest.authTitle", "Guest credentials")} icon={<Wrench size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.user", "Guest username")}>
            <input className={field} autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.password", "Guest password")}>
            <input className={field} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Labeled>
        </div>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.toolsTitle", "VMware Tools")} icon={<Wrench size={14} />}>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} disabled={!vmx || mgr.isLoading} onClick={() => void run(() => api.getToolsStatus(vmx)).then(setTools).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.toolsStatus", "Tools status")}</button>
          <button className={btn} disabled={!vmx || mgr.isLoading} onClick={() => void run(() => api.installTools(vmx)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.installTools", "Install tools")}</button>
          <button className={btn} disabled={!vmx || mgr.isLoading} onClick={() => void run(() => api.getIpAddress(vmx)).then(setIp).catch(() => {})}><Globe size={12} />{t("integrations.vmwareDesktop.vms.guest.getIp", "Get IP address")}</button>
        </div>
        {tools && <span className="text-xs text-[var(--color-text)]">installed={String(tools.installed)} running={String(tools.running)} {tools.version ?? ""}</span>}
        {ip && <span className="text-xs text-[var(--color-text)]">IP: {ip}</span>}
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.execTitle", "Run program")} icon={<Terminal size={14} />}>
        <Labeled label={t("integrations.vmwareDesktop.vms.guest.program", "Program")}>
          <input className={field} value={program} onChange={(e) => setProgram(e.target.value)} />
        </Labeled>
        <Labeled label={t("integrations.vmwareDesktop.vms.guest.arguments", "Arguments (space-separated)")}>
          <input className={field} value={args} onChange={(e) => setArgs(e.target.value)} />
        </Labeled>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} />{t("integrations.vmwareDesktop.vms.guest.wait", "Wait for exit")}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />{t("integrations.vmwareDesktop.vms.guest.interactive", "Interactive")}</label>
        </div>
        <button
          className={btn}
          disabled={disabled || !program}
          onClick={() =>
            void run(() =>
              api.execInGuest({
                vmxPath: vmx,
                guestUser: user,
                guestPass: pass,
                program,
                arguments: args.trim() ? args.trim().split(/\s+/) : [],
                wait,
                interactive,
              }),
            ).then(setExec).catch(() => {})
          }
        >
          {t("integrations.vmwareDesktop.vms.guest.run", "Run")}
        </button>
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.scriptTitle", "Run script")} icon={<FileCode size={14} />}>
        <Labeled label={t("integrations.vmwareDesktop.vms.guest.interpreter", "Interpreter")}>
          <input className={field} value={interpreter} onChange={(e) => setInterpreter(e.target.value)} />
        </Labeled>
        <Labeled label={t("integrations.vmwareDesktop.vms.guest.script", "Script")}>
          <textarea className={`${field} font-mono`} rows={4} value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
        </Labeled>
        <button
          className={btn}
          disabled={disabled || !interpreter || !scriptText}
          onClick={() => void run(() => api.runScriptInGuest({ vmxPath: vmx, guestUser: user, guestPass: pass, interpreter, scriptText })).then(setExec).catch(() => {})}
        >
          {t("integrations.vmwareDesktop.vms.guest.runScript", "Run script")}
        </button>
        {exec && (
          <Output>
            {`${t("integrations.vmwareDesktop.vms.guest.exitCode", "Exit code")}: ${exec.exitCode ?? "—"}\n${t("integrations.vmwareDesktop.vms.guest.stdout", "stdout")}:\n${exec.stdout ?? ""}\n${t("integrations.vmwareDesktop.vms.guest.stderr", "stderr")}:\n${exec.stderr ?? ""}`}
          </Output>
        )}
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.filesTitle", "Files & directories")} icon={<HardDrive size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.hostPath", "Host path")}>
            <input className={field} value={hostPath} onChange={(e) => setHostPath(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.guestPath", "Guest path")}>
            <input className={field} value={guestPath} onChange={(e) => setGuestPath(e.target.value)} />
          </Labeled>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={disabled || !hostPath || !guestPath} onClick={() => void run(() => api.copyToGuest(vmx, user, pass, hostPath, guestPath)).then(() => setFileMsg("copied → guest")).catch(() => {})}><Copy size={12} />{t("integrations.vmwareDesktop.vms.guest.copyTo", "Copy to guest")}</button>
          <button className={btn} disabled={disabled || !hostPath || !guestPath} onClick={() => void run(() => api.copyFromGuest(vmx, user, pass, guestPath, hostPath)).then(() => setFileMsg("copied ← guest")).catch(() => {})}><Copy size={12} />{t("integrations.vmwareDesktop.vms.guest.copyFrom", "Copy from guest")}</button>
        </div>
        <Labeled label={t("integrations.vmwareDesktop.vms.guest.path", "Path")}>
          <input className={field} value={path} onChange={(e) => setPath(e.target.value)} />
        </Labeled>
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.createDirectoryInGuest(vmx, user, pass, path)).then(() => setFileMsg("mkdir ok")).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.createDir", "Create directory")}</button>
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.deleteDirectoryInGuest(vmx, user, pass, path)).then(() => setFileMsg("rmdir ok")).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.deleteDir", "Delete directory")}</button>
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.deleteFileInGuest(vmx, user, pass, path)).then(() => setFileMsg("rm ok")).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.deleteFile", "Delete file")}</button>
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.fileExistsInGuest(vmx, user, pass, path)).then((b) => setFileMsg(`file exists: ${b}`)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.fileExists", "File exists?")}</button>
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.directoryExistsInGuest(vmx, user, pass, path)).then((b) => setFileMsg(`dir exists: ${b}`)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.dirExists", "Directory exists?")}</button>
          <button className={btn} disabled={disabled || !path} onClick={() => void run(() => api.listDirectoryInGuest(vmx, user, pass, path)).then(setListing).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.listDir", "List directory")}</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.oldPath", "Old path")}>
            <input className={field} value={oldPath} onChange={(e) => setOldPath(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.newPath", "New path")}>
            <input className={field} value={newPath} onChange={(e) => setNewPath(e.target.value)} />
          </Labeled>
        </div>
        <button className={btn} disabled={disabled || !oldPath || !newPath} onClick={() => void run(() => api.renameFileInGuest(vmx, user, pass, oldPath, newPath)).then(() => setFileMsg("renamed")).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.rename", "Rename")}</button>
        {fileMsg && <span className="text-xs text-[var(--color-text)]">{fileMsg}</span>}
        {listing && <Output>{listing.join("\n")}</Output>}
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.procTitle", "Processes")} icon={<Cpu size={14} />}>
        <div className="flex items-center gap-2">
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.listProcessesInGuest(vmx, user, pass)).then(setProcs).catch(() => {})}><RefreshCw size={12} />{t("integrations.vmwareDesktop.vms.guest.listProcs", "List processes")}</button>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.pid", "PID")}>
            <input className={field} inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value)} />
          </Labeled>
          <button className={btn} disabled={disabled || !pid} onClick={() => void run(() => api.killProcessInGuest(vmx, user, pass, numOrNull(pid) ?? 0)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.kill", "Kill process")}</button>
        </div>
        {procs.length > 0 && (
          <div className="max-h-48 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={th}>{t("integrations.vmwareDesktop.vms.guest.colPid", "PID")}</th>
                  <th className={th}>{t("integrations.vmwareDesktop.vms.guest.colName", "Name")}</th>
                  <th className={th}>{t("integrations.vmwareDesktop.vms.guest.colOwner", "Owner")}</th>
                </tr>
              </thead>
              <tbody>
                {procs.map((p) => (
                  <tr key={p.pid} className="border-t border-[var(--color-border)]">
                    <td className={td}>{p.pid}</td>
                    <td className={td}>{p.name}</td>
                    <td className={td}>{p.owner ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Group>

      <Group title={t("integrations.vmwareDesktop.vms.guest.varsTitle", "Environment & variables")} icon={<Terminal size={14} />}>
        <div className="grid grid-cols-3 gap-2">
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.varType", "Variable type")}>
            <select className={field} value={varType} onChange={(e) => setVarType(e.target.value)}>
              <option value="guestVar">guestVar</option>
              <option value="guestEnv">guestEnv</option>
              <option value="runtimeConfig">runtimeConfig</option>
            </select>
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.varName", "Name")}>
            <input className={field} value={varName} onChange={(e) => setVarName(e.target.value)} />
          </Labeled>
          <Labeled label={t("integrations.vmwareDesktop.vms.guest.varValue", "Value")}>
            <input className={field} value={varValue} onChange={(e) => setVarValue(e.target.value)} />
          </Labeled>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={disabled || !varName} onClick={() => void run(() => api.readVariable(vmx, user, pass, varType, varName)).then((v) => setVarMsg(`${varName} = ${v}`)).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.readVar", "Read")}</button>
          <button className={btn} disabled={disabled || !varName} onClick={() => void run(() => api.writeVariable(vmx, user, pass, varType, varName, varValue)).then(() => setVarMsg("written")).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.writeVar", "Write")}</button>
          <button className={btn} disabled={disabled} onClick={() => void run(() => api.listEnvVars(vmx, user, pass)).then(setEnvVars).catch(() => {})}>{t("integrations.vmwareDesktop.vms.guest.listEnv", "List env vars")}</button>
        </div>
        {varMsg && <span className="text-xs text-[var(--color-text)]">{varMsg}</span>}
        {envVars && <Output>{envVars.map((v) => `${v.name}=${v.value}`).join("\n")}</Output>}
      </Group>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Root tab
// ═══════════════════════════════════════════════════════════════════════════════

const SECTIONS: { key: SectionKey; labelKey: string; label: string }[] = [
  { key: "lifecycle", labelKey: "integrations.vmwareDesktop.vms.sections.lifecycle", label: "Lifecycle & Hardware" },
  { key: "power", labelKey: "integrations.vmwareDesktop.vms.sections.power", label: "Power" },
  { key: "snapshots", labelKey: "integrations.vmwareDesktop.vms.sections.snapshots", label: "Snapshots" },
  { key: "guest", labelKey: "integrations.vmwareDesktop.vms.sections.guest", label: "Guest & Tools" },
];

const VmwDesktopVmsTab: React.FC<VmwDesktopTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const mgr = useVmwDesktopVms();
  const { run, api, error, isLoading } = mgr;

  const [vms, setVms] = useState<VmSummary[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<SectionKey>("lifecycle");

  const refresh = useCallback(async () => {
    try {
      const list = await run(() => api.listVms());
      setVms(list);
      setSelected((cur) => cur || list[0]?.vmxPath || "");
    } catch {
      /* surfaced via mgr.error */
    }
  }, [api, run]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const toggleChecked = useCallback((vmxPath: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(vmxPath)) next.delete(vmxPath);
      else next.add(vmxPath);
      return next;
    });
  }, []);

  const batchTargets = useMemo(() => Array.from(checked), [checked]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
        {t("integrations.vmwareDesktop.notConnected", "Connect to a VMware Workstation host to manage VMs.")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Inventory */}
      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <button className={btn} onClick={() => void refresh()} disabled={isLoading}>
            {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t("integrations.vmwareDesktop.vms.inventory.refresh", "Refresh")}
          </button>
          <span className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.vms.inventory.selected", "Selected VM")}: {selected || t("integrations.vmwareDesktop.vms.inventory.none", "No VM selected")}
          </span>
        </div>
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={th} />
                <th className={th}>{t("integrations.vmwareDesktop.vms.inventory.colName", "Name")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.inventory.colState", "State")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.inventory.colGuest", "Guest OS")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.inventory.colCpu", "vCPU")}</th>
                <th className={th}>{t("integrations.vmwareDesktop.vms.inventory.colMem", "Memory (MB)")}</th>
              </tr>
            </thead>
            <tbody>
              {vms.length === 0 && (
                <tr><td className={td} colSpan={6}>{t("integrations.vmwareDesktop.vms.inventory.empty", "No VMs found. Refresh to load the inventory.")}</td></tr>
              )}
              {vms.map((vm) => (
                <tr
                  key={vm.id || vm.vmxPath}
                  className={`cursor-pointer border-t border-[var(--color-border)] ${selected === vm.vmxPath ? "bg-[var(--color-surface)]" : ""}`}
                  onClick={() => setSelected(vm.vmxPath)}
                >
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checked.has(vm.vmxPath)} onChange={() => toggleChecked(vm.vmxPath)} />
                  </td>
                  <td className={td}>{vm.name}</td>
                  <td className={td}>{vm.powerState}</td>
                  <td className={td}>{vm.guestOs ?? "—"}</td>
                  <td className={td}>{vm.numCpus ?? "—"}</td>
                  <td className={td}>{vm.memoryMb ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500" role="alert">{error}</p>
      )}

      {/* Section tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`border-b-2 px-3 py-1.5 text-sm ${section === s.key ? "border-primary text-[var(--color-text)]" : "border-transparent text-[var(--color-textSecondary)]"}`}
          >
            {t(s.labelKey, s.label)}
          </button>
        ))}
      </div>

      {/* Active section */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "lifecycle" && (
          <LifecycleSection
            mgr={mgr}
            vmx={selected}
            onDeleted={() => {
              setSelected("");
              void refresh();
            }}
            onCreated={(vmxPath) => {
              setSelected(vmxPath);
              void refresh();
            }}
          />
        )}
        {section === "power" && <PowerSection mgr={mgr} vmx={selected} batchTargets={batchTargets} />}
        {section === "snapshots" && <SnapshotsSection mgr={mgr} vmx={selected} />}
        {section === "guest" && <GuestSection mgr={mgr} vmx={selected} />}
      </div>
    </div>
  );
};

export default VmwDesktopVmsTab;
