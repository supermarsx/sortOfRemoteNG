// VmwDesktopHostTab — "host" category sub-tab for the VMware Workstation panel
// (t42-vmwaredesktop-c2). Binds all 35 host-level commands across six grouped
// sections: Shared folders, Virtual networking, VMDK / disks, OVF / OVA, VMX
// file, and Preferences. Filesystem paths (OVF source/target, VMX discovery)
// use `@tauri-apps/plugin-dialog`.
//
// The panel shell passes `{ connected, summary }` (VmwDesktopTabProps). Actions
// funnel through `useVmwDesktopHost().run` for shared busy/error handling; the
// last action result is surfaced in a per-section notice line.

import React, { useCallback, useState } from "react";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  FolderSymlink,
  Network,
  HardDrive,
  Package,
  FileCog,
  SlidersHorizontal,
  ChevronRight,
  RefreshCw,
  Plus,
  Trash2,
  FolderOpen,
  Loader2,
} from "lucide-react";
import type { VmwDesktopTabProps } from "../../../types/vmwareDesktop";
import type {
  SharedFolder,
  VirtualNetwork,
  NatPortForward,
  DhcpLease,
  VmdkInfo,
  VmxFile,
  VmwPreferences,
} from "../../../types/vmwareDesktop/host";
import type { VmDisk } from "../../../types/vmwareDesktop";
import { useVmwDesktopHost } from "../../../hooks/integration/vmwareDesktop/useVmwDesktopHost";

// ─── Small styled primitives ──────────────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-inputBackground)] px-2 py-1 text-sm text-[var(--color-text)]";
const labelCls =
  "flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]";
const btnCls =
  "app-bar-button inline-flex items-center gap-1 px-2.5 py-1 text-xs disabled:opacity-50";

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}> = ({ label, value, onChange, placeholder, type = "text", className }) => (
  <label className={`${labelCls} ${className ?? ""}`}>
    {label}
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    />
  </label>
);

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ icon, title, open, onToggle, children }) => (
  <div className="rounded-md border border-[var(--color-border)]">
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--color-text)]"
    >
      <ChevronRight
        className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      />
      {icon}
      {title}
    </button>
    {open && (
      <div className="border-t border-[var(--color-border)] px-3 py-3">
        {children}
      </div>
    )}
  </div>
);

const Notice: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <p className="mt-2 whitespace-pre-wrap break-all text-xs text-[var(--color-textSecondary)]">
      {text}
    </p>
  ) : null;

// ─── Tab ──────────────────────────────────────────────────────────────────────

const VmwDesktopHostTab: React.FC<VmwDesktopTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const { api, busy, error, run } = useVmwDesktopHost();

  // Which sections are expanded.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sharedFolders: true,
  });
  const toggle = useCallback(
    (key: string) =>
      setOpenSections((s) => ({ ...s, [key]: !s[key] })),
    [],
  );

  // Shared target VM path used by folder / disk / VMX / OVF-export sections.
  const [vmxPath, setVmxPath] = useState("");

  const pickVmx = useCallback(async () => {
    const sel = await openDialog({
      multiple: false,
      filters: [{ name: "VMware VM", extensions: ["vmx"] }],
    });
    if (typeof sel === "string") setVmxPath(sel);
  }, []);

  // ── Shared folders state ──
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([]);
  const [sfName, setSfName] = useState("");
  const [sfHostPath, setSfHostPath] = useState("");
  const [sfWritable, setSfWritable] = useState(true);
  const [sfNotice, setSfNotice] = useState<string | null>(null);

  const loadSharedFolders = useCallback(async () => {
    const list = await run(() => api.listSharedFolders(vmxPath));
    if (list) {
      setSharedFolders(list);
      setSfNotice(t("integrations.vmwareDesktop.host.notice.loaded", "Loaded."));
    }
  }, [api, run, vmxPath, t]);

  // ── Networking state ──
  const [networks, setNetworks] = useState<VirtualNetwork[]>([]);
  const [netName, setNetName] = useState("");
  const [netType, setNetType] = useState("nat");
  const [netSubnet, setNetSubnet] = useState("");
  const [netMask, setNetMask] = useState("");
  const [netNotice, setNetNotice] = useState<string | null>(null);
  // Port forwards
  const [pfNetwork, setPfNetwork] = useState("");
  const [portForwards, setPortForwards] = useState<NatPortForward[]>([]);
  const [pfProtocol, setPfProtocol] = useState("tcp");
  const [pfHostPort, setPfHostPort] = useState("");
  const [pfGuestIp, setPfGuestIp] = useState("");
  const [pfGuestPort, setPfGuestPort] = useState("");
  const [pfDesc, setPfDesc] = useState("");
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [pfNotice, setPfNotice] = useState<string | null>(null);

  const loadNetworks = useCallback(async () => {
    const list = await run(() => api.listNetworks());
    if (list) {
      setNetworks(list);
      setNetNotice(
        t("integrations.vmwareDesktop.host.notice.count", "{{n}} item(s).", {
          n: list.length,
        }),
      );
    }
  }, [api, run, t]);

  // ── VMDK / disks state ──
  const [vmdkPath, setVmdkPath] = useState("");
  const [vmdkSize, setVmdkSize] = useState("");
  const [vmdkDiskType, setVmdkDiskType] = useState("");
  const [vmdkAdapter, setVmdkAdapter] = useState("");
  const [vmdkInfo, setVmdkInfo] = useState<VmdkInfo | null>(null);
  const [vmdkExpandSize, setVmdkExpandSize] = useState("");
  const [vmdkConvertType, setVmdkConvertType] = useState("");
  const [vmdkConvertDest, setVmdkConvertDest] = useState("");
  const [vmdkRenameDest, setVmdkRenameDest] = useState("");
  const [vmdkNotice, setVmdkNotice] = useState<string | null>(null);
  // Disks attached to a VM
  const [vmDisks, setVmDisks] = useState<VmDisk[]>([]);
  const [addDiskVmdk, setAddDiskVmdk] = useState("");
  const [addDiskController, setAddDiskController] = useState("scsi");
  const [addDiskMode, setAddDiskMode] = useState("");
  const [rmDiskController, setRmDiskController] = useState("scsi");
  const [rmDiskBus, setRmDiskBus] = useState("");
  const [rmDiskUnit, setRmDiskUnit] = useState("");
  const [diskNotice, setDiskNotice] = useState<string | null>(null);

  // ── OVF state ──
  const [ovfSource, setOvfSource] = useState("");
  const [ovfDestDir, setOvfDestDir] = useState("");
  const [ovfName, setOvfName] = useState("");
  const [ovfExportDest, setOvfExportDest] = useState("");
  const [ovfFormat, setOvfFormat] = useState("ovf");
  const [ovfNotice, setOvfNotice] = useState<string | null>(null);

  // ── VMX state ──
  const [vmxDir, setVmxDir] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [parsedVmx, setParsedVmx] = useState<VmxFile | null>(null);
  const [vmxKey, setVmxKey] = useState("");
  const [vmxValue, setVmxValue] = useState("");
  const [vmxRemoveKeys, setVmxRemoveKeys] = useState("");
  const [vmxNotice, setVmxNotice] = useState<string | null>(null);

  // ── Preferences state ──
  const [prefs, setPrefs] = useState<VmwPreferences | null>(null);
  const [defaultVmDir, setDefaultVmDir] = useState("");
  const [prefKey, setPrefKey] = useState("");
  const [prefValue, setPrefValue] = useState("");
  const [prefNotice, setPrefNotice] = useState<string | null>(null);

  const okMsg = t("integrations.vmwareDesktop.host.notice.done", "Done.");

  if (!connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <Network className="h-10 w-10 text-[var(--color-textMuted)]" />
        <p className="text-sm text-[var(--color-text)]">
          {t(
            "integrations.vmwareDesktop.host.notConnected",
            "Connect to a VMware Workstation host to manage networking, storage, and configuration.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Global busy / error banner */}
      <div className="flex items-center gap-3">
        {busy && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("integrations.vmwareDesktop.host.working", "Working…")}
          </span>
        )}
        {error && (
          <span className="text-xs text-red-500" role="alert">
            {error}
          </span>
        )}
      </div>

      {/* Shared target VM */}
      <div className="flex items-end gap-2">
        <Field
          label={t("integrations.vmwareDesktop.host.vmxPath", "Target VM (.vmx path)")}
          value={vmxPath}
          onChange={setVmxPath}
          placeholder="C:\\VMs\\web01\\web01.vmx"
          className="flex-1"
        />
        <button onClick={() => void pickVmx()} className={btnCls}>
          <FolderOpen className="h-3.5 w-3.5" />
          {t("integrations.vmwareDesktop.host.browse", "Browse")}
        </button>
      </div>

      {/* ═══ Shared folders ═══ */}
      <Section
        icon={<FolderSymlink className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.sharedFolders.title", "Shared folders")}
        open={!!openSections.sharedFolders}
        onToggle={() => toggle("sharedFolders")}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmxPath}
            onClick={() =>
              void run(() => api.enableSharedFolders(vmxPath)).then((r) =>
                r !== undefined ? setSfNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.sharedFolders.enable", "Enable")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmxPath}
            onClick={() =>
              void run(() => api.disableSharedFolders(vmxPath)).then((r) =>
                r !== undefined ? setSfNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.sharedFolders.disable", "Disable")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmxPath}
            onClick={() => void loadSharedFolders()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.sharedFolders.list", "List")}
          </button>
        </div>

        {sharedFolders.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textSecondary)]">
                <tr>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.name", "Name")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.hostPath", "Host path")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.writable", "Writable")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.enabled", "Enabled")}</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="text-[var(--color-text)]">
                {sharedFolders.map((f) => (
                  <tr key={f.name} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-3">{f.name}</td>
                    <td className="py-1 pr-3">{f.hostPath}</td>
                    <td className="py-1 pr-3">{String(f.writable)}</td>
                    <td className="py-1 pr-3">{String(f.enabled)}</td>
                    <td className="py-1">
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api.removeSharedFolder(vmxPath, f.name),
                          ).then((r) =>
                            r !== undefined ? void loadSharedFolders() : undefined,
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={t("integrations.vmwareDesktop.host.col.name", "Name")} value={sfName} onChange={setSfName} />
          <Field label={t("integrations.vmwareDesktop.host.col.hostPath", "Host path")} value={sfHostPath} onChange={setSfHostPath} />
          <label className="flex items-center gap-2 pt-5 text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={sfWritable} onChange={(e) => setSfWritable(e.target.checked)} />
            {t("integrations.vmwareDesktop.host.col.writable", "Writable")}
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmxPath || !sfName || !sfHostPath}
            onClick={() =>
              void run(() =>
                api.addSharedFolder(vmxPath, sfName, sfHostPath, sfWritable),
              ).then((r) => (r !== undefined ? void loadSharedFolders() : undefined))
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.sharedFolders.add", "Add folder")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmxPath || !sfName || !sfHostPath}
            onClick={() =>
              void run(() =>
                api.setSharedFolderState(vmxPath, sfName, sfHostPath, sfWritable),
              ).then((r) => (r !== undefined ? void loadSharedFolders() : undefined))
            }
          >
            {t("integrations.vmwareDesktop.host.sharedFolders.setState", "Set state")}
          </button>
        </div>
        <Notice text={sfNotice} />
      </Section>

      {/* ═══ Virtual networking ═══ */}
      <Section
        icon={<Network className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.networking.title", "Virtual networking")}
        open={!!openSections.networking}
        onToggle={() => toggle("networking")}
      >
        <div className="flex flex-wrap gap-2">
          <button className={btnCls} disabled={busy} onClick={() => void loadNetworks()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.networking.list", "List networks")}
          </button>
          <button
            className={btnCls}
            disabled={busy}
            onClick={() =>
              void run(() => api.readNetworkingConfig()).then((cfg) =>
                cfg
                  ? setNetNotice(
                      Object.entries(cfg)
                        .map(([k, v]) => `${k} = ${v}`)
                        .join("\n") || okMsg,
                    )
                  : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.networking.readConfig", "Read networking.conf")}
          </button>
        </div>

        {networks.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-textSecondary)]">
                <tr>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.name", "Name")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.type", "Type")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.subnet", "Subnet")}</th>
                  <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.mask", "Mask")}</th>
                  <th className="py-1 pr-3">DHCP</th>
                  <th className="py-1 pr-3">NAT</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="text-[var(--color-text)]">
                {networks.map((n) => (
                  <tr key={n.name} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-3">{n.name}</td>
                    <td className="py-1 pr-3">{n.networkType}</td>
                    <td className="py-1 pr-3">{n.subnet ?? "—"}</td>
                    <td className="py-1 pr-3">{n.subnetMask ?? "—"}</td>
                    <td className="py-1 pr-3">{n.dhcpEnabled == null ? "—" : String(n.dhcpEnabled)}</td>
                    <td className="py-1 pr-3">{n.natEnabled == null ? "—" : String(n.natEnabled)}</td>
                    <td className="py-1">
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.deleteNetwork(n.name)).then((r) =>
                            r !== undefined ? void loadNetworks() : undefined,
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field label={t("integrations.vmwareDesktop.host.col.name", "Name")} value={netName} onChange={setNetName} placeholder="vmnet8" />
          <Field label={t("integrations.vmwareDesktop.host.col.type", "Type")} value={netType} onChange={setNetType} placeholder="nat" />
          <Field label={t("integrations.vmwareDesktop.host.col.subnet", "Subnet")} value={netSubnet} onChange={setNetSubnet} placeholder="192.168.100.0" />
          <Field label={t("integrations.vmwareDesktop.host.col.mask", "Mask")} value={netMask} onChange={setNetMask} placeholder="255.255.255.0" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !netName || !netType}
            onClick={() =>
              void run(() =>
                api.createNetwork(netName, netType, netSubnet || null, netMask || null),
              ).then((r) => (r !== undefined ? void loadNetworks() : undefined))
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.networking.create", "Create")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !netName || !netType}
            onClick={() =>
              void run(() =>
                api.updateNetwork(netName, netType, netSubnet || null, netMask || null),
              ).then((r) => (r !== undefined ? void loadNetworks() : undefined))
            }
          >
            {t("integrations.vmwareDesktop.host.networking.update", "Update")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !netName}
            onClick={() =>
              void run(() => api.getNetwork(netName)).then((n) =>
                n ? setNetNotice(JSON.stringify(n, null, 2)) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.networking.get", "Get details")}
          </button>
        </div>
        <Notice text={netNotice} />

        {/* Port forwards */}
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-text)]">
            {t("integrations.vmwareDesktop.host.networking.portForwards", "NAT port forwarding")}
          </p>
          <div className="flex items-end gap-2">
            <Field
              label={t("integrations.vmwareDesktop.host.col.network", "Network")}
              value={pfNetwork}
              onChange={setPfNetwork}
              placeholder="vmnet8"
              className="flex-1"
            />
            <button
              className={btnCls}
              disabled={busy || !pfNetwork}
              onClick={() =>
                void run(() => api.listPortForwards(pfNetwork)).then((l) => {
                  if (l) {
                    setPortForwards(l);
                    setPfNotice(
                      t("integrations.vmwareDesktop.host.notice.count", "{{n}} item(s).", { n: l.length }),
                    );
                  }
                })
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("integrations.vmwareDesktop.host.networking.listForwards", "List")}
            </button>
            <button
              className={btnCls}
              disabled={busy || !pfNetwork}
              onClick={() =>
                void run(() => api.getDhcpLeases(pfNetwork)).then((l) => {
                  if (l) {
                    setLeases(l);
                    setPfNotice(
                      t("integrations.vmwareDesktop.host.notice.count", "{{n}} item(s).", { n: l.length }),
                    );
                  }
                })
              }
            >
              {t("integrations.vmwareDesktop.host.networking.dhcpLeases", "DHCP leases")}
            </button>
          </div>

          {portForwards.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--color-textSecondary)]">
                  <tr>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.protocol", "Proto")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.hostPort", "Host port")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.guest", "Guest")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.desc", "Description")}</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="text-[var(--color-text)]">
                  {portForwards.map((p) => (
                    <tr key={`${p.protocol}-${p.hostPort}`} className="border-t border-[var(--color-border)]">
                      <td className="py-1 pr-3">{p.protocol}</td>
                      <td className="py-1 pr-3">{p.hostPort}</td>
                      <td className="py-1 pr-3">{p.guestIp}:{p.guestPort}</td>
                      <td className="py-1 pr-3">{p.description ?? "—"}</td>
                      <td className="py-1">
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api.deletePortForward(pfNetwork, p.protocol, p.hostPort),
                            ).then((r) =>
                              r !== undefined
                                ? void run(() => api.listPortForwards(pfNetwork)).then(
                                    (l) => (l ? setPortForwards(l) : undefined),
                                  )
                                : undefined,
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {leases.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--color-textSecondary)]">
                  <tr>
                    <th className="py-1 pr-3">MAC</th>
                    <th className="py-1 pr-3">IP</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.hostname", "Hostname")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.expires", "Expires")}</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--color-text)]">
                  {leases.map((l) => (
                    <tr key={l.macAddress} className="border-t border-[var(--color-border)]">
                      <td className="py-1 pr-3">{l.macAddress}</td>
                      <td className="py-1 pr-3">{l.ipAddress}</td>
                      <td className="py-1 pr-3">{l.hostname ?? "—"}</td>
                      <td className="py-1 pr-3">{l.expires ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Field label={t("integrations.vmwareDesktop.host.col.protocol", "Proto")} value={pfProtocol} onChange={setPfProtocol} placeholder="tcp" />
            <Field label={t("integrations.vmwareDesktop.host.col.hostPort", "Host port")} value={pfHostPort} onChange={setPfHostPort} type="number" />
            <Field label={t("integrations.vmwareDesktop.host.col.guestIp", "Guest IP")} value={pfGuestIp} onChange={setPfGuestIp} />
            <Field label={t("integrations.vmwareDesktop.host.col.guestPort", "Guest port")} value={pfGuestPort} onChange={setPfGuestPort} type="number" />
            <Field label={t("integrations.vmwareDesktop.host.col.desc", "Description")} value={pfDesc} onChange={setPfDesc} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={btnCls}
              disabled={busy || !pfNetwork || !pfHostPort || !pfGuestIp || !pfGuestPort}
              onClick={() =>
                void run(() =>
                  api.setPortForward(
                    pfNetwork,
                    pfProtocol,
                    Number(pfHostPort),
                    pfGuestIp,
                    Number(pfGuestPort),
                    pfDesc || null,
                  ),
                ).then((r) =>
                  r !== undefined
                    ? void run(() => api.listPortForwards(pfNetwork)).then((l) =>
                        l ? setPortForwards(l) : undefined,
                      )
                    : undefined,
                )
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t("integrations.vmwareDesktop.host.networking.setForward", "Set forward")}
            </button>
          </div>
          <Notice text={pfNotice} />
        </div>
      </Section>

      {/* ═══ VMDK / disks ═══ */}
      <Section
        icon={<HardDrive className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.vmdk.title", "VMDK / disks")}
        open={!!openSections.vmdk}
        onToggle={() => toggle("vmdk")}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field label={t("integrations.vmwareDesktop.host.vmdk.path", "VMDK path")} value={vmdkPath} onChange={setVmdkPath} className="sm:col-span-2" />
          <Field label={t("integrations.vmwareDesktop.host.vmdk.sizeMb", "Size (MB)")} value={vmdkSize} onChange={setVmdkSize} type="number" />
          <Field label={t("integrations.vmwareDesktop.host.vmdk.diskType", "Disk type")} value={vmdkDiskType} onChange={setVmdkDiskType} placeholder="monolithicSparse" />
          <Field label={t("integrations.vmwareDesktop.host.vmdk.adapter", "Adapter")} value={vmdkAdapter} onChange={setVmdkAdapter} placeholder="lsilogic" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmdkPath || !vmdkSize}
            onClick={() =>
              void run(() =>
                api.createVmdk(vmdkPath, Number(vmdkSize), vmdkDiskType || null, vmdkAdapter || null),
              ).then((info) => (info ? setVmdkInfo(info) : undefined))
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.vmdk.create", "Create")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmdkPath}
            onClick={() =>
              void run(() => api.getVmdkInfo(vmdkPath)).then((info) =>
                info ? setVmdkInfo(info) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.info", "Info")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmdkPath}
            onClick={() =>
              void run(() => api.defragmentVmdk(vmdkPath)).then((r) =>
                r !== undefined ? setVmdkNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.defragment", "Defragment")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmdkPath}
            onClick={() =>
              void run(() => api.shrinkVmdk(vmdkPath)).then((r) =>
                r !== undefined ? setVmdkNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.shrink", "Shrink")}
          </button>
        </div>

        {vmdkInfo && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-inputBackground)] p-2 text-xs text-[var(--color-text)]">
            {JSON.stringify(vmdkInfo, null, 2)}
          </pre>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={t("integrations.vmwareDesktop.host.vmdk.expandTo", "Expand to (MB)")} value={vmdkExpandSize} onChange={setVmdkExpandSize} type="number" />
          <Field label={t("integrations.vmwareDesktop.host.vmdk.convertType", "Convert to type")} value={vmdkConvertType} onChange={setVmdkConvertType} placeholder="monolithicFlat" />
          <Field label={t("integrations.vmwareDesktop.host.vmdk.convertDest", "Convert dest (optional)")} value={vmdkConvertDest} onChange={setVmdkConvertDest} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmdkPath || !vmdkExpandSize}
            onClick={() =>
              void run(() => api.expandVmdk(vmdkPath, Number(vmdkExpandSize))).then((r) =>
                r !== undefined ? setVmdkNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.expand", "Expand")}
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmdkPath || !vmdkConvertType}
            onClick={() =>
              void run(() =>
                api.convertVmdk(vmdkPath, vmdkConvertType, vmdkConvertDest || null),
              ).then((r) => (r !== undefined ? setVmdkNotice(okMsg) : undefined))
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.convert", "Convert")}
          </button>
          <Field label={t("integrations.vmwareDesktop.host.vmdk.renameDest", "Rename to")} value={vmdkRenameDest} onChange={setVmdkRenameDest} />
          <button
            className={`${btnCls} self-end`}
            disabled={busy || !vmdkPath || !vmdkRenameDest}
            onClick={() =>
              void run(() => api.renameVmdk(vmdkPath, vmdkRenameDest)).then((r) =>
                r !== undefined ? setVmdkNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmdk.rename", "Rename")}
          </button>
        </div>
        <Notice text={vmdkNotice} />

        {/* Disks attached to a VM */}
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-text)]">
            {t("integrations.vmwareDesktop.host.vmdk.vmDisks", "Disks on target VM")}
          </p>
          <button
            className={btnCls}
            disabled={busy || !vmxPath}
            onClick={() =>
              void run(() => api.listVmDisks(vmxPath)).then((d) =>
                d ? setVmDisks(d) : undefined,
              )
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.vmdk.listDisks", "List disks")}
          </button>

          {vmDisks.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--color-textSecondary)]">
                  <tr>
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.file", "File")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.type", "Type")}</th>
                    <th className="py-1 pr-3">{t("integrations.vmwareDesktop.host.col.controller", "Controller")}</th>
                    <th className="py-1 pr-3">Bus/Unit</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="text-[var(--color-text)]">
                  {vmDisks.map((d) => (
                    <tr key={`${d.controllerType}-${d.controllerBus}-${d.unitNumber}`} className="border-t border-[var(--color-border)]">
                      <td className="py-1 pr-3">{d.index}</td>
                      <td className="py-1 pr-3">{d.fileName}</td>
                      <td className="py-1 pr-3">{d.diskType}</td>
                      <td className="py-1 pr-3">{d.controllerType}</td>
                      <td className="py-1 pr-3">{d.controllerBus}:{d.unitNumber}</td>
                      <td className="py-1">
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api.removeDiskFromVm(
                                vmxPath,
                                d.controllerType,
                                d.controllerBus,
                                d.unitNumber,
                              ),
                            ).then((r) =>
                              r !== undefined
                                ? void run(() => api.listVmDisks(vmxPath)).then((x) =>
                                    x ? setVmDisks(x) : undefined,
                                  )
                                : undefined,
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label={t("integrations.vmwareDesktop.host.vmdk.attachPath", "VMDK to attach")} value={addDiskVmdk} onChange={setAddDiskVmdk} />
            <Field label={t("integrations.vmwareDesktop.host.col.controller", "Controller")} value={addDiskController} onChange={setAddDiskController} placeholder="scsi" />
            <Field label={t("integrations.vmwareDesktop.host.vmdk.mode", "Mode (optional)")} value={addDiskMode} onChange={setAddDiskMode} placeholder="persistent" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={btnCls}
              disabled={busy || !vmxPath || !addDiskVmdk}
              onClick={() =>
                void run(() =>
                  api.addDiskToVm(
                    vmxPath,
                    addDiskVmdk,
                    addDiskController || null,
                    null,
                    null,
                    addDiskMode || null,
                  ),
                ).then((r) =>
                  r !== undefined
                    ? void run(() => api.listVmDisks(vmxPath)).then((x) =>
                        x ? setVmDisks(x) : undefined,
                      )
                    : undefined,
                )
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t("integrations.vmwareDesktop.host.vmdk.addDisk", "Add disk")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label={t("integrations.vmwareDesktop.host.col.controller", "Controller")} value={rmDiskController} onChange={setRmDiskController} placeholder="scsi" />
            <Field label={t("integrations.vmwareDesktop.host.vmdk.bus", "Bus")} value={rmDiskBus} onChange={setRmDiskBus} type="number" />
            <Field label={t("integrations.vmwareDesktop.host.vmdk.unit", "Unit")} value={rmDiskUnit} onChange={setRmDiskUnit} type="number" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={btnCls}
              disabled={busy || !vmxPath || rmDiskBus === "" || rmDiskUnit === ""}
              onClick={() =>
                void run(() =>
                  api.removeDiskFromVm(
                    vmxPath,
                    rmDiskController,
                    Number(rmDiskBus),
                    Number(rmDiskUnit),
                  ),
                ).then((r) =>
                  r !== undefined
                    ? void run(() => api.listVmDisks(vmxPath)).then((x) =>
                        x ? setVmDisks(x) : undefined,
                      )
                    : undefined,
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("integrations.vmwareDesktop.host.vmdk.removeDisk", "Remove disk")}
            </button>
          </div>
          <Notice text={diskNotice} />
        </div>
      </Section>

      {/* ═══ OVF / OVA ═══ */}
      <Section
        icon={<Package className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.ovf.title", "OVF / OVA import & export")}
        open={!!openSections.ovf}
        onToggle={() => toggle("ovf")}
      >
        <p className="mb-2 text-xs font-medium text-[var(--color-text)]">
          {t("integrations.vmwareDesktop.host.ovf.import", "Import")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-end gap-2 sm:col-span-2">
            <Field label={t("integrations.vmwareDesktop.host.ovf.source", "Source (.ovf/.ova)")} value={ovfSource} onChange={setOvfSource} className="flex-1" />
            <button
              className={btnCls}
              onClick={async () => {
                const sel = await openDialog({
                  multiple: false,
                  filters: [{ name: "OVF / OVA", extensions: ["ovf", "ova"] }],
                });
                if (typeof sel === "string") setOvfSource(sel);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("integrations.vmwareDesktop.host.ovf.destDir", "Destination dir")} value={ovfDestDir} onChange={setOvfDestDir} className="flex-1" />
            <button
              className={btnCls}
              onClick={async () => {
                const sel = await openDialog({ directory: true, multiple: false });
                if (typeof sel === "string") setOvfDestDir(sel);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label={t("integrations.vmwareDesktop.host.ovf.name", "Name (optional)")} value={ovfName} onChange={setOvfName} />
          <button
            className={btnCls}
            disabled={busy || !ovfSource || !ovfDestDir}
            onClick={() =>
              void run(() =>
                api.importOvf(ovfSource, ovfDestDir, ovfName || null),
              ).then((vmx) =>
                vmx
                  ? setOvfNotice(
                      t("integrations.vmwareDesktop.host.ovf.imported", "Imported: {{path}}", { path: vmx }),
                    )
                  : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.ovf.doImport", "Import")}
          </button>
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-[var(--color-text)]">
          {t("integrations.vmwareDesktop.host.ovf.export", "Export (uses target VM above)")}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-1 items-end gap-2">
            <Field label={t("integrations.vmwareDesktop.host.ovf.exportDest", "Export to")} value={ovfExportDest} onChange={setOvfExportDest} className="flex-1" />
            <button
              className={btnCls}
              onClick={async () => {
                const sel = await saveDialog({
                  filters: [{ name: "OVF / OVA", extensions: ["ovf", "ova"] }],
                });
                if (typeof sel === "string") setOvfExportDest(sel);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
          <Field label={t("integrations.vmwareDesktop.host.ovf.format", "Format")} value={ovfFormat} onChange={setOvfFormat} placeholder="ovf" />
          <button
            className={btnCls}
            disabled={busy || !vmxPath || !ovfExportDest}
            onClick={() =>
              void run(() =>
                api.exportOvf(vmxPath, ovfExportDest, ovfFormat || null),
              ).then((r) => (r !== undefined ? setOvfNotice(okMsg) : undefined))
            }
          >
            {t("integrations.vmwareDesktop.host.ovf.doExport", "Export")}
          </button>
        </div>
        <Notice text={ovfNotice} />
      </Section>

      {/* ═══ VMX file ═══ */}
      <Section
        icon={<FileCog className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.vmx.title", "VMX file editor")}
        open={!!openSections.vmx}
        onToggle={() => toggle("vmx")}
      >
        <div className="flex items-end gap-2">
          <Field label={t("integrations.vmwareDesktop.host.vmx.dir", "Discover in directory")} value={vmxDir} onChange={setVmxDir} className="flex-1" />
          <button
            className={btnCls}
            onClick={async () => {
              const sel = await openDialog({ directory: true, multiple: false });
              if (typeof sel === "string") setVmxDir(sel);
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            className={btnCls}
            disabled={busy || !vmxDir}
            onClick={() =>
              void run(() => api.discoverVmxFiles(vmxDir)).then((files) =>
                files ? setDiscovered(files) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmx.discover", "Discover")}
          </button>
        </div>
        {discovered.length > 0 && (
          <ul className="mt-2 max-h-32 overflow-auto text-xs text-[var(--color-text)]">
            {discovered.map((f) => (
              <li key={f}>
                <button
                  className="text-left hover:text-primary"
                  onClick={() => setVmxPath(f)}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmxPath}
            onClick={() =>
              void run(() => api.parseVmx(vmxPath)).then((f) =>
                f ? setParsedVmx(f) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.vmx.parse", "Parse target VMX")}
          </button>
        </div>
        {parsedVmx && (
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--color-inputBackground)] p-2 text-xs text-[var(--color-text)]">
            {parsedVmx.entries.map((e) => `${e.key} = ${e.value}`).join("\n")}
          </pre>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("integrations.vmwareDesktop.host.vmx.key", "Key")} value={vmxKey} onChange={setVmxKey} placeholder="memsize" />
          <Field label={t("integrations.vmwareDesktop.host.vmx.value", "Value")} value={vmxValue} onChange={setVmxValue} placeholder="4096" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !vmxPath || !vmxKey}
            onClick={() =>
              void run(() =>
                api.updateVmxKeys(vmxPath, { [vmxKey]: vmxValue }),
              ).then((r) => (r !== undefined ? setVmxNotice(okMsg) : undefined))
            }
          >
            {t("integrations.vmwareDesktop.host.vmx.setKey", "Set key")}
          </button>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <Field
            label={t("integrations.vmwareDesktop.host.vmx.removeKeys", "Remove keys (comma-separated)")}
            value={vmxRemoveKeys}
            onChange={setVmxRemoveKeys}
            className="flex-1"
          />
          <button
            className={btnCls}
            disabled={busy || !vmxPath || !vmxRemoveKeys.trim()}
            onClick={() =>
              void run(() =>
                api.removeVmxKeys(
                  vmxPath,
                  vmxRemoveKeys
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean),
                ),
              ).then((r) => (r !== undefined ? setVmxNotice(okMsg) : undefined))
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.vmx.doRemoveKeys", "Remove")}
          </button>
        </div>
        <Notice text={vmxNotice} />
      </Section>

      {/* ═══ Preferences ═══ */}
      <Section
        icon={<SlidersHorizontal className="h-4 w-4 text-primary" />}
        title={t("integrations.vmwareDesktop.host.prefs.title", "Preferences")}
        open={!!openSections.prefs}
        onToggle={() => toggle("prefs")}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy}
            onClick={() =>
              void run(() => api.readPreferences()).then((p) =>
                p ? setPrefs(p) : undefined,
              )
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("integrations.vmwareDesktop.host.prefs.read", "Read preferences")}
          </button>
          <button
            className={btnCls}
            disabled={busy}
            onClick={() =>
              void run(() => api.getDefaultVmDir()).then((d) =>
                d != null ? setDefaultVmDir(d) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.prefs.defaultDir", "Default VM dir")}
          </button>
        </div>
        {defaultVmDir && (
          <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.vmwareDesktop.host.prefs.defaultDir", "Default VM dir")}: {defaultVmDir}
          </p>
        )}
        {prefs && (
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--color-inputBackground)] p-2 text-xs text-[var(--color-text)]">
            {JSON.stringify(prefs, null, 2)}
          </pre>
        )}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("integrations.vmwareDesktop.host.vmx.key", "Key")} value={prefKey} onChange={setPrefKey} placeholder="pref.defaultVMPath" />
          <Field label={t("integrations.vmwareDesktop.host.vmx.value", "Value")} value={prefValue} onChange={setPrefValue} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btnCls}
            disabled={busy || !prefKey}
            onClick={() =>
              void run(() => api.setPreference(prefKey, prefValue)).then((r) =>
                r !== undefined ? setPrefNotice(okMsg) : undefined,
              )
            }
          >
            {t("integrations.vmwareDesktop.host.prefs.set", "Set preference")}
          </button>
        </div>
        <Notice text={prefNotice} />
      </Section>
    </div>
  );
};

export default VmwDesktopHostTab;
