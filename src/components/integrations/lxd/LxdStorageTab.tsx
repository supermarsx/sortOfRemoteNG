// LxdStorageTab — "Storage & Cluster" sub-tab for the LXD panel (t42 c4).
//
// Binds all 38 commands of the c4 slice (storage pools / volumes / volume
// snapshots / buckets / server & cluster / operations / warnings) through
// `useLxdStorage`. Every command is reachable from a control here; reads land in
// the Inspector panel (raw JSON) and mutations append to the activity log.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Boxes,
  Camera,
  ChevronDown,
  ChevronRight,
  Database,
  HardDrive,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LxdTabProps } from "./registry";
import { useLxdStorage } from "../../../hooks/integration/lxd/useLxdStorage";
import type {
  StorageBucket,
  StorageBucketKey,
  StorageVolume,
  StorageVolumeSnapshot,
} from "../../../types/lxd/storage";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtnClass =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50";
const dangerBtnClass =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-500 disabled:opacity-50";

/** Collapsible section wrapper. */
const Section: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}> = ({ id, title, icon, open, onToggle, children }) => (
  <div className="border-b border-[var(--color-border)]">
    <button
      type="button"
      onClick={() => onToggle(id)}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
    >
      {open ? (
        <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />
      ) : (
        <ChevronRight size={14} className="text-[var(--color-textSecondary)]" />
      )}
      {icon}
      {title}
    </button>
    {open && <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>}
  </div>
);

const LxdStorageTab: React.FC<LxdTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const s = useLxdStorage();

  const [open, setOpen] = useState<Record<string, boolean>>({
    server: true,
    pools: true,
    volumes: false,
    buckets: false,
    operations: false,
    warnings: false,
  });
  const toggle = useCallback(
    (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] })),
    [],
  );

  // Inspector (raw JSON of the last read) + activity log (last mutations).
  const [detail, setDetail] = useState<{ label: string; body: unknown } | null>(
    null,
  );
  const [log, setLog] = useState<string[]>([]);
  const note = useCallback((msg: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 30));
  }, []);
  const show = useCallback((label: string, body: unknown) => {
    setDetail({ label, body });
  }, []);

  /** Wrap an action: run it, surface a note, swallow the rethrow (error state is
   *  already set by the hook's `run`). */
  const act = useCallback(
    async <T,>(label: string, op: () => Promise<T>): Promise<T | undefined> => {
      try {
        const res = await op();
        note(`${label} ✓`);
        return res;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        note(`${label} ✗ ${msg}`);
        return undefined;
      }
    },
    [note],
  );

  // ── Selection-scoped local state ──────────────────────────────────────────────
  const [selectedPool, setSelectedPool] = useState<string>("");
  const [volumes, setVolumes] = useState<StorageVolume[]>([]);
  const [customOnly, setCustomOnly] = useState(false);
  const [selectedVolume, setSelectedVolume] = useState<StorageVolume | null>(
    null,
  );
  const [snapshots, setSnapshots] = useState<StorageVolumeSnapshot[]>([]);
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [bucketKeys, setBucketKeys] = useState<StorageBucketKey[]>([]);

  // ── Form state ────────────────────────────────────────────────────────────────
  const [poolForm, setPoolForm] = useState({ name: "", driver: "dir", description: "" });
  const [poolDesc, setPoolDesc] = useState("");
  const [volForm, setVolForm] = useState({
    name: "",
    volumeType: "custom",
    contentType: "filesystem",
    description: "",
  });
  const [renameTo, setRenameTo] = useState("");
  const [patchText, setPatchText] = useState("{\n  \"description\": \"\"\n}");
  const [snapForm, setSnapForm] = useState({ name: "", expiresAt: "" });
  const [bucketForm, setBucketForm] = useState({ name: "", description: "" });
  const [cfgForm, setCfgForm] = useState({ key: "", value: "" });
  const [removeForce, setRemoveForce] = useState(false);
  const [waitTimeout, setWaitTimeout] = useState("30");

  // Auto-load the top-level lists once connected.
  useEffect(() => {
    if (!connected) return;
    void act("list pools", () => s.refreshPools());
    void act("get server / cluster", () => s.refreshServerCluster());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const selectedPoolConfig = useMemo(
    () => s.pools.find((p) => p.name === selectedPool)?.config ?? {},
    [s.pools, selectedPool],
  );

  // ── Pool actions ──────────────────────────────────────────────────────────────
  const loadVolumes = useCallback(
    async (pool: string, custom: boolean) => {
      const list = await act(`list volumes (${pool})`, () =>
        custom
          ? s.api.listCustomVolumes(pool)
          : s.api.listStorageVolumes(pool),
      );
      setVolumes(list ?? []);
      setSelectedVolume(null);
      setSnapshots([]);
    },
    [act, s.api],
  );

  const loadBuckets = useCallback(
    async (pool: string) => {
      const list = await act(`list buckets (${pool})`, () =>
        s.api.listStorageBuckets(pool),
      );
      setBuckets(list ?? []);
      setBucketKeys([]);
    },
    [act, s.api],
  );

  const selectPool = useCallback(
    (name: string) => {
      setSelectedPool(name);
      setPoolDesc(s.pools.find((p) => p.name === name)?.description ?? "");
      setOpen((o) => ({ ...o, volumes: true, buckets: true }));
      void loadVolumes(name, customOnly);
      void loadBuckets(name);
    },
    [s.pools, customOnly, loadVolumes, loadBuckets],
  );

  const loadSnapshots = useCallback(
    async (pool: string, volume: string) => {
      const list = await act(`list snapshots (${volume})`, () =>
        s.api.listVolumeSnapshots(pool, volume),
      );
      setSnapshots(list ?? []);
    },
    [act, s.api],
  );

  const gated = !connected;

  return (
    <div className="flex flex-col text-[var(--color-text)]">
      {!connected && (
        <div className="p-4 text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.lxd.storage.notConnected",
            "Connect to an LXD server to manage storage and cluster resources.",
          )}
        </div>
      )}

      {/* ── Server & Cluster ─────────────────────────────────────────────────── */}
      <Section
        id="server"
        title={t("integrations.lxd.storage.serverCluster", "Server & Cluster")}
        icon={<Server size={14} className="text-primary" />}
        open={open.server}
        onToggle={toggle}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={btnClass}
            disabled={gated}
            onClick={() => act("get server / cluster", () => s.refreshServerCluster())}
          >
            <RefreshCw size={12} />
            {t("integrations.lxd.storage.refresh", "Refresh")}
          </button>
          <button
            className={btnClass}
            disabled={gated}
            onClick={() =>
              act("get server", () => s.api.getServer()).then(
                (r) => r && show("server", r),
              )
            }
          >
            <Server size={12} />
            {t("integrations.lxd.storage.getServer", "Server info")}
          </button>
          <button
            className={btnClass}
            disabled={gated}
            onClick={() =>
              act("get server resources", () => s.api.getServerResources()).then(
                (r) => r && show("serverResources", r),
              )
            }
          >
            <HardDrive size={12} />
            {t("integrations.lxd.storage.getServerResources", "Hardware resources")}
          </button>
          <button
            className={btnClass}
            disabled={gated}
            onClick={() =>
              act("get cluster", () => s.api.getCluster()).then(
                (r) => r && show("cluster", r),
              )
            }
          >
            <Boxes size={12} />
            {t("integrations.lxd.storage.getCluster", "Cluster info")}
          </button>
        </div>

        {/* Update server config (single key/value) */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className={labelClass}>
              {t("integrations.lxd.storage.configKey", "Config key")}
            </label>
            <input
              className={inputClass}
              value={cfgForm.key}
              placeholder="core.https_address"
              onChange={(e) => setCfgForm((f) => ({ ...f, key: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t("integrations.lxd.storage.configValue", "Value")}
            </label>
            <input
              className={inputClass}
              value={cfgForm.value}
              onChange={(e) => setCfgForm((f) => ({ ...f, value: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <button
              className={primaryBtnClass}
              disabled={gated || !cfgForm.key}
              onClick={() =>
                act("update server config", () =>
                  s.api.updateServerConfig({ [cfgForm.key]: cfgForm.value }),
                )
              }
            >
              <Save size={12} />
              {t("integrations.lxd.storage.applyConfig", "Apply")}
            </button>
          </div>
        </div>

        {/* Cluster members */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-textSecondary)]">
              {t("integrations.lxd.storage.members", "Cluster members")}
            </span>
            <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={removeForce}
                onChange={(e) => setRemoveForce(e.target.checked)}
              />
              {t("integrations.lxd.storage.force", "Force remove")}
            </label>
          </div>
          {s.members.length === 0 ? (
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.lxd.storage.noMembers", "No cluster members (standalone server).")}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
              {s.members.map((m) => (
                <li
                  key={m.serverName ?? m.url ?? Math.random()}
                  className="flex items-center justify-between gap-2 px-2 py-1"
                >
                  <span className="truncate text-xs">
                    {m.serverName ?? "—"}
                    <span className="ml-2 text-[var(--color-textSecondary)]">
                      {m.status ?? ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      className={btnClass}
                      disabled={gated || !m.serverName}
                      title={t("integrations.lxd.storage.memberInfo", "Member info")}
                      onClick={() =>
                        act("get member", () =>
                          s.api.getClusterMember(m.serverName as string),
                        ).then((r) => r && show(`member:${m.serverName}`, r))
                      }
                    >
                      <Database size={12} />
                    </button>
                    <button
                      className={btnClass}
                      disabled={gated || !m.serverName}
                      title={t("integrations.lxd.storage.evacuate", "Evacuate")}
                      onClick={() =>
                        act("evacuate member", () =>
                          s.api.evacuateClusterMember(m.serverName as string),
                        ).then((r) => r && show("operation", r))
                      }
                    >
                      <Play size={12} />
                    </button>
                    <button
                      className={btnClass}
                      disabled={gated || !m.serverName}
                      title={t("integrations.lxd.storage.restore", "Restore")}
                      onClick={() =>
                        act("restore member", () =>
                          s.api.restoreClusterMember(m.serverName as string),
                        ).then((r) => r && show("operation", r))
                      }
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className={dangerBtnClass}
                      disabled={gated || !m.serverName}
                      title={t("integrations.lxd.storage.removeMember", "Remove member")}
                      onClick={() =>
                        act("remove member", () =>
                          s.api.removeClusterMember(
                            m.serverName as string,
                            removeForce,
                          ),
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* ── Storage pools ─────────────────────────────────────────────────────── */}
      <Section
        id="pools"
        title={t("integrations.lxd.storage.pools", "Storage Pools")}
        icon={<HardDrive size={14} className="text-primary" />}
        open={open.pools}
        onToggle={toggle}
      >
        <button
          className={btnClass}
          disabled={gated}
          onClick={() => act("list pools", () => s.refreshPools())}
        >
          <RefreshCw size={12} />
          {t("integrations.lxd.storage.refresh", "Refresh")}
        </button>

        {/* Create pool */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            className={inputClass}
            placeholder={t("integrations.lxd.storage.poolName", "Pool name")}
            value={poolForm.name}
            onChange={(e) => setPoolForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className={inputClass}
            placeholder={t("integrations.lxd.storage.driver", "Driver (dir/zfs/btrfs…)")}
            value={poolForm.driver}
            onChange={(e) => setPoolForm((f) => ({ ...f, driver: e.target.value }))}
          />
          <input
            className={inputClass}
            placeholder={t("integrations.lxd.storage.description", "Description")}
            value={poolForm.description}
            onChange={(e) =>
              setPoolForm((f) => ({ ...f, description: e.target.value }))
            }
          />
          <button
            className={primaryBtnClass}
            disabled={gated || !poolForm.name || !poolForm.driver}
            onClick={() =>
              act("create pool", () =>
                s.api.createStoragePool({
                  name: poolForm.name,
                  driver: poolForm.driver,
                  description: poolForm.description || undefined,
                }),
              ).then(() => s.refreshPools())
            }
          >
            <Plus size={12} />
            {t("integrations.lxd.storage.create", "Create")}
          </button>
        </div>

        {s.pools.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {s.pools.map((p) => (
              <li key={p.name} className="px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <button
                    className={`truncate text-left text-xs ${
                      selectedPool === p.name ? "font-semibold text-primary" : ""
                    }`}
                    onClick={() => selectPool(p.name)}
                  >
                    {p.name}
                    <span className="ml-2 text-[var(--color-textSecondary)]">
                      {p.driver ?? ""}
                    </span>
                  </button>
                  <span className="flex shrink-0 gap-1">
                    <button
                      className={btnClass}
                      disabled={gated}
                      title={t("integrations.lxd.storage.poolInfo", "Pool info")}
                      onClick={() =>
                        act("get pool", () => s.api.getStoragePool(p.name)).then(
                          (r) => r && show(`pool:${p.name}`, r),
                        )
                      }
                    >
                      <Database size={12} />
                    </button>
                    <button
                      className={btnClass}
                      disabled={gated}
                      title={t("integrations.lxd.storage.usage", "Usage")}
                      onClick={() =>
                        act("get pool resources", () =>
                          s.api.getStoragePoolResources(p.name),
                        ).then((r) => r && show(`poolResources:${p.name}`, r))
                      }
                    >
                      <Activity size={12} />
                    </button>
                    <button
                      className={dangerBtnClass}
                      disabled={gated}
                      title={t("integrations.lxd.storage.delete", "Delete")}
                      onClick={() =>
                        act("delete pool", () =>
                          s.api.deleteStoragePool(p.name),
                        ).then(() => s.refreshPools())
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Update selected pool description */}
        {selectedPool && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              className={inputClass}
              placeholder={t(
                "integrations.lxd.storage.updateDescription",
                "Description for {{name}}",
                { name: selectedPool },
              )}
              value={poolDesc}
              onChange={(e) => setPoolDesc(e.target.value)}
            />
            <button
              className={btnClass}
              disabled={gated}
              onClick={() =>
                act("update pool", () =>
                  s.api.updateStoragePool(
                    selectedPool,
                    selectedPoolConfig,
                    poolDesc || undefined,
                  ),
                ).then(() => s.refreshPools())
              }
            >
              <Save size={12} />
              {t("integrations.lxd.storage.updatePool", "Update pool")}
            </button>
          </div>
        )}
      </Section>

      {/* ── Volumes & snapshots ───────────────────────────────────────────────── */}
      <Section
        id="volumes"
        title={t("integrations.lxd.storage.volumes", "Volumes & Snapshots")}
        icon={<Boxes size={14} className="text-primary" />}
        open={open.volumes}
        onToggle={toggle}
      >
        {!selectedPool ? (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.selectPool", "Select a storage pool above.")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-textSecondary)]">
                {t("integrations.lxd.storage.pool", "Pool")}: <b>{selectedPool}</b>
              </span>
              <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={customOnly}
                  onChange={(e) => {
                    setCustomOnly(e.target.checked);
                    void loadVolumes(selectedPool, e.target.checked);
                  }}
                />
                {t("integrations.lxd.storage.customOnly", "Custom volumes only")}
              </label>
              <button
                className={btnClass}
                disabled={gated}
                onClick={() => loadVolumes(selectedPool, customOnly)}
              >
                <RefreshCw size={12} />
                {t("integrations.lxd.storage.refresh", "Refresh")}
              </button>
            </div>

            {/* Create volume */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                className={inputClass}
                placeholder={t("integrations.lxd.storage.volumeName", "Volume name")}
                value={volForm.name}
                onChange={(e) => setVolForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder={t("integrations.lxd.storage.volumeType", "Type")}
                value={volForm.volumeType}
                onChange={(e) =>
                  setVolForm((f) => ({ ...f, volumeType: e.target.value }))
                }
              />
              <input
                className={inputClass}
                placeholder={t("integrations.lxd.storage.contentType", "Content type")}
                value={volForm.contentType}
                onChange={(e) =>
                  setVolForm((f) => ({ ...f, contentType: e.target.value }))
                }
              />
              <button
                className={primaryBtnClass}
                disabled={gated || !volForm.name}
                onClick={() =>
                  act("create volume", () =>
                    s.api.createStorageVolume({
                      pool: selectedPool,
                      name: volForm.name,
                      volumeType: volForm.volumeType || undefined,
                      contentType: volForm.contentType || undefined,
                      description: volForm.description || undefined,
                    }),
                  ).then(() => loadVolumes(selectedPool, customOnly))
                }
              >
                <Plus size={12} />
                {t("integrations.lxd.storage.create", "Create")}
              </button>
            </div>

            {volumes.length > 0 && (
              <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
                {volumes.map((v) => (
                  <li key={`${v.volumeType}/${v.name}`} className="px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        className={`truncate text-left text-xs ${
                          selectedVolume?.name === v.name &&
                          selectedVolume?.volumeType === v.volumeType
                            ? "font-semibold text-primary"
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedVolume(v);
                          setRenameTo("");
                          void loadSnapshots(selectedPool, v.name);
                        }}
                      >
                        {v.name}
                        <span className="ml-2 text-[var(--color-textSecondary)]">
                          {v.volumeType ?? ""}
                        </span>
                      </button>
                      <span className="flex shrink-0 gap-1">
                        <button
                          className={btnClass}
                          disabled={gated}
                          title={t("integrations.lxd.storage.volumeInfo", "Volume info")}
                          onClick={() =>
                            act("get volume", () =>
                              s.api.getStorageVolume(
                                selectedPool,
                                v.volumeType ?? "custom",
                                v.name,
                              ),
                            ).then((r) => r && show(`volume:${v.name}`, r))
                          }
                        >
                          <Database size={12} />
                        </button>
                        <button
                          className={dangerBtnClass}
                          disabled={gated}
                          title={t("integrations.lxd.storage.delete", "Delete")}
                          onClick={() =>
                            act("delete volume", () =>
                              s.api.deleteStorageVolume(selectedPool, v.name),
                            ).then(() => loadVolumes(selectedPool, customOnly))
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Selected-volume actions: rename, patch, snapshots */}
            {selectedVolume && (
              <div className="space-y-3 rounded border border-[var(--color-border)] p-2">
                <p className="text-xs font-medium text-[var(--color-textSecondary)]">
                  {t("integrations.lxd.storage.volume", "Volume")}:{" "}
                  <b>{selectedVolume.name}</b>
                </p>

                {/* Rename */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    className={inputClass}
                    placeholder={t("integrations.lxd.storage.newName", "New name")}
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                  />
                  <button
                    className={btnClass}
                    disabled={gated || !renameTo}
                    onClick={() =>
                      act("rename volume", () =>
                        s.api.renameStorageVolume(
                          selectedPool,
                          selectedVolume.name,
                          renameTo,
                        ),
                      ).then((r) => {
                        if (r) show("operation", r);
                        return loadVolumes(selectedPool, customOnly);
                      })
                    }
                  >
                    {t("integrations.lxd.storage.rename", "Rename")}
                  </button>
                </div>

                {/* Patch (raw JSON) */}
                <div>
                  <label className={labelClass}>
                    {t("integrations.lxd.storage.patchJson", "Patch (JSON)")}
                  </label>
                  <textarea
                    className={`${inputClass} font-mono`}
                    rows={3}
                    value={patchText}
                    onChange={(e) => setPatchText(e.target.value)}
                  />
                  <button
                    className={`${btnClass} mt-1`}
                    disabled={gated}
                    onClick={() => {
                      let patch: unknown;
                      try {
                        patch = JSON.parse(patchText);
                      } catch {
                        note("update volume ✗ invalid JSON");
                        return;
                      }
                      void act("update volume", () =>
                        s.api.updateStorageVolume(
                          selectedPool,
                          selectedVolume.name,
                          patch,
                        ),
                      );
                    }}
                  >
                    <Save size={12} />
                    {t("integrations.lxd.storage.applyPatch", "Apply patch")}
                  </button>
                </div>

                {/* Volume snapshots */}
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Camera size={12} className="text-[var(--color-textSecondary)]" />
                    <span className="text-xs font-medium text-[var(--color-textSecondary)]">
                      {t("integrations.lxd.storage.snapshots", "Snapshots")}
                    </span>
                    <button
                      className={btnClass}
                      disabled={gated}
                      onClick={() =>
                        loadSnapshots(selectedPool, selectedVolume.name)
                      }
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      className={inputClass}
                      placeholder={t("integrations.lxd.storage.snapshotName", "Snapshot name")}
                      value={snapForm.name}
                      onChange={(e) =>
                        setSnapForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                    <input
                      className={inputClass}
                      placeholder={t("integrations.lxd.storage.expiresAt", "Expires (ISO 8601)")}
                      value={snapForm.expiresAt}
                      onChange={(e) =>
                        setSnapForm((f) => ({ ...f, expiresAt: e.target.value }))
                      }
                    />
                    <button
                      className={primaryBtnClass}
                      disabled={gated || !snapForm.name}
                      onClick={() =>
                        act("create snapshot", () =>
                          s.api.createVolumeSnapshot(
                            selectedPool,
                            selectedVolume.name,
                            snapForm.name,
                            snapForm.expiresAt || undefined,
                          ),
                        ).then((r) => {
                          if (r) show("operation", r);
                          return loadSnapshots(selectedPool, selectedVolume.name);
                        })
                      }
                    >
                      <Plus size={12} />
                      {t("integrations.lxd.storage.create", "Create")}
                    </button>
                  </div>
                  {snapshots.length > 0 && (
                    <ul className="mt-2 divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
                      {snapshots.map((sn) => (
                        <li
                          key={sn.name}
                          className="flex items-center justify-between px-2 py-1 text-xs"
                        >
                          <span className="truncate">{sn.name}</span>
                          <button
                            className={dangerBtnClass}
                            disabled={gated}
                            onClick={() =>
                              act("delete snapshot", () =>
                                s.api.deleteVolumeSnapshot(
                                  selectedPool,
                                  selectedVolume.name,
                                  sn.name,
                                ),
                              ).then((r) => {
                                if (r) show("operation", r);
                                return loadSnapshots(
                                  selectedPool,
                                  selectedVolume.name,
                                );
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Buckets ───────────────────────────────────────────────────────────── */}
      <Section
        id="buckets"
        title={t("integrations.lxd.storage.buckets", "Buckets (S3)")}
        icon={<Database size={14} className="text-primary" />}
        open={open.buckets}
        onToggle={toggle}
      >
        {!selectedPool ? (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.selectPool", "Select a storage pool above.")}
          </p>
        ) : (
          <>
            <button
              className={btnClass}
              disabled={gated}
              onClick={() => loadBuckets(selectedPool)}
            >
              <RefreshCw size={12} />
              {t("integrations.lxd.storage.refresh", "Refresh")}
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                className={inputClass}
                placeholder={t("integrations.lxd.storage.bucketName", "Bucket name")}
                value={bucketForm.name}
                onChange={(e) =>
                  setBucketForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <input
                className={inputClass}
                placeholder={t("integrations.lxd.storage.description", "Description")}
                value={bucketForm.description}
                onChange={(e) =>
                  setBucketForm((f) => ({ ...f, description: e.target.value }))
                }
              />
              <button
                className={primaryBtnClass}
                disabled={gated || !bucketForm.name}
                onClick={() =>
                  act("create bucket", () =>
                    s.api.createStorageBucket({
                      pool: selectedPool,
                      name: bucketForm.name,
                      description: bucketForm.description || undefined,
                    }),
                  ).then(() => loadBuckets(selectedPool))
                }
              >
                <Plus size={12} />
                {t("integrations.lxd.storage.create", "Create")}
              </button>
            </div>

            {buckets.length > 0 && (
              <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
                {buckets.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center justify-between gap-2 px-2 py-1"
                  >
                    <span className="truncate text-xs">{b.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        className={btnClass}
                        disabled={gated}
                        title={t("integrations.lxd.storage.bucketInfo", "Bucket info")}
                        onClick={() =>
                          act("get bucket", () =>
                            s.api.getStorageBucket(selectedPool, b.name),
                          ).then((r) => r && show(`bucket:${b.name}`, r))
                        }
                      >
                        <Database size={12} />
                      </button>
                      <button
                        className={btnClass}
                        disabled={gated}
                        title={t("integrations.lxd.storage.keys", "Access keys")}
                        onClick={() =>
                          act("list bucket keys", () =>
                            s.api.listBucketKeys(selectedPool, b.name),
                          ).then((r) => {
                            setBucketKeys(r ?? []);
                            if (r) show(`bucketKeys:${b.name}`, r);
                          })
                        }
                      >
                        <Activity size={12} />
                      </button>
                      <button
                        className={dangerBtnClass}
                        disabled={gated}
                        title={t("integrations.lxd.storage.delete", "Delete")}
                        onClick={() =>
                          act("delete bucket", () =>
                            s.api.deleteStorageBucket(selectedPool, b.name),
                          ).then(() => loadBuckets(selectedPool))
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {bucketKeys.length > 0 && (
              <p className="text-xs text-[var(--color-textSecondary)]">
                {t("integrations.lxd.storage.keyCount", "{{count}} access key(s) — see Inspector.", {
                  count: bucketKeys.length,
                })}
              </p>
            )}
          </>
        )}
      </Section>

      {/* ── Operations ────────────────────────────────────────────────────────── */}
      <Section
        id="operations"
        title={t("integrations.lxd.storage.operations", "Operations")}
        icon={<Activity size={14} className="text-primary" />}
        open={open.operations}
        onToggle={toggle}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={btnClass}
            disabled={gated}
            onClick={() => act("list operations", () => s.refreshOperations())}
          >
            <RefreshCw size={12} />
            {t("integrations.lxd.storage.refresh", "Refresh")}
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.waitTimeout", "Wait timeout (s)")}
            <input
              className={`${inputClass} w-16`}
              type="number"
              value={waitTimeout}
              onChange={(e) => setWaitTimeout(e.target.value)}
            />
          </label>
        </div>
        {s.operations.length === 0 ? (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.noOperations", "No active operations.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {s.operations.map((op) => (
              <li
                key={op.id ?? Math.random()}
                className="flex items-center justify-between gap-2 px-2 py-1"
              >
                <span className="truncate text-xs">
                  {op.description ?? op.id ?? "—"}
                  <span className="ml-2 text-[var(--color-textSecondary)]">
                    {op.status ?? ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    className={btnClass}
                    disabled={gated || !op.id}
                    title={t("integrations.lxd.storage.operationInfo", "Operation info")}
                    onClick={() =>
                      act("get operation", () =>
                        s.api.getOperation(op.id as string),
                      ).then((r) => r && show(`operation:${op.id}`, r))
                    }
                  >
                    <Database size={12} />
                  </button>
                  <button
                    className={btnClass}
                    disabled={gated || !op.id}
                    title={t("integrations.lxd.storage.wait", "Wait")}
                    onClick={() =>
                      act("wait operation", () =>
                        s.api.waitOperation(
                          op.id as string,
                          Number(waitTimeout) || undefined,
                        ),
                      ).then((r) => r && show(`operation:${op.id}`, r))
                    }
                  >
                    <Loader2 size={12} />
                  </button>
                  <button
                    className={dangerBtnClass}
                    disabled={gated || !op.id}
                    title={t("integrations.lxd.storage.cancel", "Cancel")}
                    onClick={() =>
                      act("cancel operation", () =>
                        s.api.cancelOperation(op.id as string),
                      ).then(() => s.refreshOperations())
                    }
                  >
                    <Ban size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Warnings ──────────────────────────────────────────────────────────── */}
      <Section
        id="warnings"
        title={t("integrations.lxd.storage.warnings", "Warnings")}
        icon={<AlertTriangle size={14} className="text-primary" />}
        open={open.warnings}
        onToggle={toggle}
      >
        <button
          className={btnClass}
          disabled={gated}
          onClick={() => act("list warnings", () => s.refreshWarnings())}
        >
          <RefreshCw size={12} />
          {t("integrations.lxd.storage.refresh", "Refresh")}
        </button>
        {s.warnings.length === 0 ? (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.noWarnings", "No warnings.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {s.warnings.map((w) => (
              <li
                key={w.uuid ?? Math.random()}
                className="flex items-center justify-between gap-2 px-2 py-1"
              >
                <span className="truncate text-xs">
                  {w.message ?? w.uuid ?? "—"}
                  <span className="ml-2 text-[var(--color-textSecondary)]">
                    {w.severity ?? ""} · {w.status ?? ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    className={btnClass}
                    disabled={gated || !w.uuid}
                    title={t("integrations.lxd.storage.warningInfo", "Warning info")}
                    onClick={() =>
                      act("get warning", () =>
                        s.api.getWarning(w.uuid as string),
                      ).then((r) => r && show(`warning:${w.uuid}`, r))
                    }
                  >
                    <Database size={12} />
                  </button>
                  <button
                    className={btnClass}
                    disabled={gated || !w.uuid}
                    title={t("integrations.lxd.storage.acknowledge", "Acknowledge")}
                    onClick={() =>
                      act("acknowledge warning", () =>
                        s.api.acknowledgeWarning(w.uuid as string),
                      ).then(() => s.refreshWarnings())
                    }
                  >
                    <Save size={12} />
                  </button>
                  <button
                    className={dangerBtnClass}
                    disabled={gated || !w.uuid}
                    title={t("integrations.lxd.storage.delete", "Delete")}
                    onClick={() =>
                      act("delete warning", () =>
                        s.api.deleteWarning(w.uuid as string),
                      ).then(() => s.refreshWarnings())
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Inspector + activity log ──────────────────────────────────────────── */}
      {(detail || s.error) && (
        <div className="border-t border-[var(--color-border)] p-4">
          {s.error && (
            <p className="mb-2 text-xs text-red-500">{s.error}</p>
          )}
          {detail && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-textSecondary)]">
                  {t("integrations.lxd.storage.inspector", "Inspector")}: {detail.label}
                </span>
                <button
                  className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  onClick={() => setDetail(null)}
                >
                  {t("integrations.lxd.storage.close", "Close")}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[11px] leading-tight text-[var(--color-text)]">
                {JSON.stringify(detail.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
      {log.length > 0 && (
        <div className="border-t border-[var(--color-border)] p-4">
          <span className="text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.lxd.storage.activity", "Activity")}
          </span>
          <ul className="mt-1 max-h-32 overflow-auto text-[11px] text-[var(--color-textSecondary)]">
            {log.map((line, i) => (
              <li key={i} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LxdStorageTab;
