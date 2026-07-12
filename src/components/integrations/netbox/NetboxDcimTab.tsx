// NetBox DCIM tab (t42-netbox-c1).
//
// Physical-infrastructure management surface: Sites, Racks, Devices (with the
// Types / Manufacturers / Platforms / Roles reference catalogs), Interfaces and
// Cables. Binds all 46 DCIM `netbox_*` commands through `useNetboxDcim` /
// `netboxDcimApi`. A category tab per the shell contract — mounted only once the
// shell holds a live connection, so `connectionId` is always usable.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Cable as CableIcon,
  Cpu,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { NetboxTabProps } from "../../../types/netbox";
import type {
  Cable,
  Device,
  Interface,
  NbJson,
  NbPayload,
  Rack,
  Site,
} from "../../../types/netbox/dcim";
import { useNetboxDcim } from "../../../hooks/integration/netbox/useNetboxDcim";

// ─── Shared primitives ─────────────────────────────────────────────────────────

type GroupKey = "sites" | "racks" | "devices" | "interfaces" | "cables";

/** Best-effort display string for a NetBox nested ref / choice object. */
function refLabel(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const pick = o.display ?? o.name ?? o.label ?? o.model ?? o.value ?? o.slug;
    if (pick != null) return String(pick);
  }
  return "—";
}

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

/** Side drawer showing a formatted JSON payload (detail / trace / elevation …). */
const JsonDrawer: React.FC<{
  title: string;
  data: NbJson;
  onClose: () => void;
}> = ({ title, data, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {title}
        </span>
        <button
          onClick={onClose}
          className={btnCls}
          title={t("integrations.netbox.dcim.actions.close", "Close")}
        >
          <X size={14} />
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-[var(--color-textSecondary)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

type EditorMode = "create" | "update" | "patch";

/** JSON payload editor for create / PUT / PATCH. */
const JsonEditorModal: React.FC<{
  title: string;
  mode: EditorMode;
  initial: NbPayload;
  onSubmit: (mode: EditorMode, data: NbPayload) => void | Promise<void>;
  onClose: () => void;
}> = ({ title, mode, initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (m: EditorMode) => {
      let parsed: NbPayload;
      try {
        parsed = text.trim() ? (JSON.parse(text) as NbPayload) : {};
      } catch (e) {
        setParseError((e as Error).message);
        return;
      }
      setParseError(null);
      setBusy(true);
      try {
        await onSubmit(m, parsed);
      } finally {
        setBusy(false);
      }
    },
    [text, onSubmit],
  );

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {title}
          </span>
          <button onClick={onClose} className={btnCls}>
            <X size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <span className="text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.netbox.dcim.editor.hint",
              "Edit the JSON payload sent to NetBox.",
            )}
          </span>
          <textarea
            className={`${inputCls} min-h-[16rem] flex-1 font-mono`}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          {parseError && (
            <p className="text-xs text-[var(--color-error,#ef4444)]">
              {parseError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <button onClick={onClose} className={btnCls} disabled={busy}>
            {t("integrations.netbox.dcim.actions.cancel", "Cancel")}
          </button>
          {mode === "create" ? (
            <button
              onClick={() => submit("create")}
              className={primaryBtnCls}
              disabled={busy}
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {t("integrations.netbox.dcim.actions.create", "Create")}
            </button>
          ) : (
            <>
              <button
                onClick={() => submit("patch")}
                className={btnCls}
                disabled={busy}
                title={t(
                  "integrations.netbox.dcim.actions.patchHint",
                  "Partial update (PATCH)",
                )}
              >
                {t("integrations.netbox.dcim.actions.patch", "Patch")}
              </button>
              <button
                onClick={() => submit("update")}
                className={primaryBtnCls}
                disabled={busy}
                title={t(
                  "integrations.netbox.dcim.actions.updateHint",
                  "Full update (PUT)",
                )}
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t("integrations.netbox.dcim.actions.update", "Save")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** Small header row: title + refresh + optional "New". */
const SectionBar: React.FC<{
  count?: number;
  isLoading: boolean;
  onRefresh: () => void;
  onNew?: () => void;
  children?: React.ReactNode;
}> = ({ count, isLoading, onRefresh, onNew, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {count != null && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.netbox.dcim.count", "{{count}} items", { count })}
          </span>
        )}
        <button onClick={onRefresh} className={btnCls} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.netbox.dcim.actions.refresh", "Refresh")}
        </button>
        {onNew && (
          <button onClick={onNew} className={primaryBtnCls}>
            <Plus size={12} />
            {t("integrations.netbox.dcim.actions.new", "New")}
          </button>
        )}
      </div>
    </div>
  );
};

/** Shared per-row action state used across every section. */
interface RowUi {
  drawer: { title: string; data: NbJson } | null;
  editor: {
    title: string;
    mode: EditorMode;
    initial: NbPayload;
    submit: (mode: EditorMode, data: NbPayload) => void | Promise<void>;
  } | null;
}

// ─── Sites ─────────────────────────────────────────────────────────────────────

const SitesSection: React.FC<{ dcim: ReturnType<typeof useNetboxDcim> }> = ({
  dcim,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = dcim;
  const [rows, setRows] = useState<Site[]>([]);
  const [region, setRegion] = useState("");
  const [group, setGroup] = useState("");
  const [ui, setUi] = useState<RowUi>({ drawer: null, editor: null });

  const load = useCallback(async () => {
    const res = await run((id) => api.listSites(id));
    if (res) setRows(res.results);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadByRegion = useCallback(async () => {
    if (!region.trim()) return load();
    const res = await run((id) => api.listSitesByRegion(id, region.trim()));
    if (res) setRows(res.results);
  }, [run, api, region, load]);

  const loadByGroup = useCallback(async () => {
    if (!group.trim()) return load();
    const res = await run((id) => api.listSitesByGroup(id, group.trim()));
    if (res) setRows(res.results);
  }, [run, api, group, load]);

  const view = useCallback(
    async (siteId: number) => {
      const res = await run((id) => api.getSite(id, siteId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Site #${siteId}`, data: res },
        }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (siteId: number) => {
      await run((id) => api.deleteSite(id, siteId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (site: Site | null) => {
      const isNew = site == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t("integrations.netbox.dcim.editor.newSite", "New site")
            : t("integrations.netbox.dcim.editor.editSite", "Edit site"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? { name: "", slug: "", status: "active" }
            : (site as unknown as NbPayload),
          submit: async (mode, data) => {
            if (mode === "create") await run((id) => api.createSite(id, data));
            else if (mode === "patch")
              await run((id) => api.partialUpdateSite(id, site!.id!, data));
            else await run((id) => api.updateSite(id, site!.id!, data));
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      >
        <input
          className={inputCls}
          placeholder={t("integrations.netbox.dcim.filters.region", "Region")}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadByRegion()}
        />
        <button onClick={loadByRegion} className={btnCls}>
          {t("integrations.netbox.dcim.actions.apply", "Apply")}
        </button>
        <input
          className={inputCls}
          placeholder={t("integrations.netbox.dcim.filters.group", "Group")}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadByGroup()}
        />
        <button onClick={loadByGroup} className={btnCls}>
          {t("integrations.netbox.dcim.actions.apply", "Apply")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t("integrations.netbox.dcim.fields.name", "Name"),
          t("integrations.netbox.dcim.fields.status", "Status"),
          t("integrations.netbox.dcim.fields.region", "Region"),
          t("integrations.netbox.dcim.fields.devices", "Devices"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            r.name ?? "—",
            refLabel(r.status),
            refLabel(r.region),
            String(r.deviceCount ?? 0),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Racks ─────────────────────────────────────────────────────────────────────

const RacksSection: React.FC<{ dcim: ReturnType<typeof useNetboxDcim> }> = ({
  dcim,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = dcim;
  const [rows, setRows] = useState<Rack[]>([]);
  const [siteId, setSiteId] = useState("");
  const [ui, setUi] = useState<RowUi>({ drawer: null, editor: null });

  const load = useCallback(async () => {
    const sid = siteId.trim() ? Number(siteId.trim()) : null;
    const res = await run((id) =>
      api.listRacks(id, Number.isFinite(sid as number) ? sid : null),
    );
    if (res) setRows(res.results);
  }, [run, api, siteId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCallback(
    async (rackId: number) => {
      const res = await run((id) => api.getRack(id, rackId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Rack #${rackId}`, data: res },
        }));
    },
    [run, api],
  );

  const elevation = useCallback(
    async (rackId: number) => {
      const res = await run((id) => api.getRackElevation(id, rackId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: {
            title: t("integrations.netbox.dcim.actions.elevation", "Elevation"),
            data: res,
          },
        }));
    },
    [run, api, t],
  );

  const reservations = useCallback(
    async (rackId: number) => {
      const res = await run((id) => api.listRackReservations(id, rackId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: {
            title: t(
              "integrations.netbox.dcim.actions.reservations",
              "Reservations",
            ),
            data: res.results,
          },
        }));
    },
    [run, api, t],
  );

  const remove = useCallback(
    async (rackId: number) => {
      await run((id) => api.deleteRack(id, rackId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (rack: Rack | null) => {
      const isNew = rack == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t("integrations.netbox.dcim.editor.newRack", "New rack")
            : t("integrations.netbox.dcim.editor.editRack", "Edit rack"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? { name: "", site: null, status: "active" }
            : (rack as unknown as NbPayload),
          submit: async (mode, data) => {
            if (mode === "create") await run((id) => api.createRack(id, data));
            else if (mode === "patch")
              await run((id) => api.partialUpdateRack(id, rack!.id!, data));
            else await run((id) => api.updateRack(id, rack!.id!, data));
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      >
        <input
          className={inputCls}
          placeholder={t("integrations.netbox.dcim.filters.siteId", "Site ID")}
          value={siteId}
          inputMode="numeric"
          onChange={(e) => setSiteId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t("integrations.netbox.dcim.actions.apply", "Apply")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t("integrations.netbox.dcim.fields.name", "Name"),
          t("integrations.netbox.dcim.fields.site", "Site"),
          t("integrations.netbox.dcim.fields.status", "Status"),
          t("integrations.netbox.dcim.fields.devices", "Devices"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            r.name ?? "—",
            refLabel(r.site),
            refLabel(r.status),
            String(r.deviceCount ?? 0),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
          extra:
            r.id != null
              ? [
                  {
                    label: t(
                      "integrations.netbox.dcim.actions.elevation",
                      "Elevation",
                    ),
                    onClick: () => elevation(r.id!),
                  },
                  {
                    label: t(
                      "integrations.netbox.dcim.actions.reservations",
                      "Reservations",
                    ),
                    onClick: () => reservations(r.id!),
                  },
                ]
              : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Devices (+ reference catalogs) ─────────────────────────────────────────────

type DeviceSub = "devices" | "types" | "manufacturers" | "platforms" | "roles";

const DevicesSection: React.FC<{ dcim: ReturnType<typeof useNetboxDcim> }> = ({
  dcim,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = dcim;
  const [sub, setSub] = useState<DeviceSub>("devices");
  const [rows, setRows] = useState<Device[]>([]);
  const [refs, setRefs] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<{ kind: "site" | "rack"; id: string }>({
    kind: "site",
    id: "",
  });
  const [ui, setUi] = useState<RowUi>({ drawer: null, editor: null });

  const loadDevices = useCallback(async () => {
    const params: Array<[string, string]> = search.trim()
      ? [["q", search.trim()]]
      : [];
    const res = await run((id) => api.listDevices(id, params));
    if (res) setRows(res.results);
  }, [run, api, search]);

  const loadScoped = useCallback(async () => {
    const n = Number(scope.id.trim());
    if (!Number.isFinite(n)) return loadDevices();
    const res = await run((id) =>
      scope.kind === "site"
        ? api.listDevicesBySite(id, n)
        : api.listDevicesByRack(id, n),
    );
    if (res) setRows(res.results);
  }, [run, api, scope, loadDevices]);

  const loadRefs = useCallback(
    async (which: DeviceSub) => {
      const res = await run((id) => {
        switch (which) {
          case "types":
            return api.listDeviceTypes(id);
          case "manufacturers":
            return api.listManufacturers(id);
          case "platforms":
            return api.listPlatforms(id);
          case "roles":
            return api.listDeviceRoles(id);
          default:
            return api.listDeviceTypes(id);
        }
      });
      if (res) setRefs(res.results as Array<Record<string, unknown>>);
    },
    [run, api],
  );

  useEffect(() => {
    if (sub === "devices") void loadDevices();
    else void loadRefs(sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const viewDevice = useCallback(
    async (deviceId: number) => {
      const res = await run((id) => api.getDevice(id, deviceId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Device #${deviceId}`, data: res },
        }));
    },
    [run, api],
  );

  const renderConfig = useCallback(
    async (deviceId: number) => {
      const res = await run((id) => api.renderDeviceConfig(id, deviceId));
      if (res !== undefined)
        setUi((s) => ({
          ...s,
          drawer: {
            title: t(
              "integrations.netbox.dcim.actions.renderConfig",
              "Rendered config",
            ),
            data: res,
          },
        }));
    },
    [run, api, t],
  );

  const removeDevice = useCallback(
    async (deviceId: number) => {
      await run((id) => api.deleteDevice(id, deviceId));
      void loadDevices();
    },
    [run, api, loadDevices],
  );

  const openEditor = useCallback(
    (device: Device | null) => {
      const isNew = device == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t("integrations.netbox.dcim.editor.newDevice", "New device")
            : t("integrations.netbox.dcim.editor.editDevice", "Edit device"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? { name: "", device_type: null, role: null, site: null }
            : (device as unknown as NbPayload),
          submit: async (mode, data) => {
            if (mode === "create") await run((id) => api.createDevice(id, data));
            else if (mode === "patch")
              await run((id) => api.partialUpdateDevice(id, device!.id!, data));
            else await run((id) => api.updateDevice(id, device!.id!, data));
            setUi((x) => ({ ...x, editor: null }));
            void loadDevices();
          },
        },
      }));
    },
    [run, api, loadDevices, t],
  );

  const viewRef = useCallback(
    async (which: DeviceSub, refId: number) => {
      const res = await run((id) => {
        switch (which) {
          case "types":
            return api.getDeviceType(id, refId);
          case "manufacturers":
            return api.getManufacturer(id, refId);
          case "platforms":
            return api.getPlatform(id, refId);
          case "roles":
            return api.getDeviceRole(id, refId);
          default:
            return api.getDeviceType(id, refId);
        }
      });
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: refLabel(res), data: res },
        }));
    },
    [run, api],
  );

  const subTabs: Array<{ key: DeviceSub; label: string }> = [
    { key: "devices", label: t("integrations.netbox.dcim.groups.devices", "Devices") },
    {
      key: "types",
      label: t("integrations.netbox.dcim.refs.types", "Device types"),
    },
    {
      key: "manufacturers",
      label: t("integrations.netbox.dcim.refs.manufacturers", "Manufacturers"),
    },
    {
      key: "platforms",
      label: t("integrations.netbox.dcim.refs.platforms", "Platforms"),
    },
    {
      key: "roles",
      label: t("integrations.netbox.dcim.refs.roles", "Device roles"),
    },
  ];

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setSub(st.key)}
            className={`border-b-2 px-2 py-1 text-xs ${
              sub === st.key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {sub === "devices" ? (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadDevices}
            onNew={() => openEditor(null)}
          >
            <input
              className={inputCls}
              placeholder={t("integrations.netbox.dcim.filters.search", "Search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadDevices()}
            />
            <button onClick={loadDevices} className={btnCls}>
              {t("integrations.netbox.dcim.actions.apply", "Apply")}
            </button>
            <select
              className={inputCls}
              value={scope.kind}
              onChange={(e) =>
                setScope((s) => ({
                  ...s,
                  kind: e.target.value as "site" | "rack",
                }))
              }
            >
              <option value="site">
                {t("integrations.netbox.dcim.filters.bySite", "By site ID")}
              </option>
              <option value="rack">
                {t("integrations.netbox.dcim.filters.byRack", "By rack ID")}
              </option>
            </select>
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder="ID"
              value={scope.id}
              onChange={(e) => setScope((s) => ({ ...s, id: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && loadScoped()}
            />
            <button onClick={loadScoped} className={btnCls}>
              {t("integrations.netbox.dcim.actions.apply", "Apply")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t("integrations.netbox.dcim.fields.name", "Name"),
              t("integrations.netbox.dcim.fields.type", "Type"),
              t("integrations.netbox.dcim.fields.site", "Site"),
              t("integrations.netbox.dcim.fields.status", "Status"),
            ]}
            rows={rows.map((r) => ({
              id: r.id ?? 0,
              cells: [
                r.name ?? "—",
                refLabel(r.deviceType),
                refLabel(r.site),
                refLabel(r.status),
              ],
              onView: r.id != null ? () => viewDevice(r.id!) : undefined,
              onEdit: () => openEditor(r),
              onDelete: r.id != null ? () => removeDevice(r.id!) : undefined,
              extra:
                r.id != null
                  ? [
                      {
                        label: t(
                          "integrations.netbox.dcim.actions.renderConfig",
                          "Config",
                        ),
                        onClick: () => renderConfig(r.id!),
                      },
                    ]
                  : undefined,
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={refs.length}
            isLoading={isLoading}
            onRefresh={() => loadRefs(sub)}
          />
          <DataTable
            columns={[
              t("integrations.netbox.dcim.fields.name", "Name"),
              t("integrations.netbox.dcim.fields.slug", "Slug"),
            ]}
            rows={refs.map((r) => ({
              id: (r.id as number) ?? 0,
              cells: [refLabel(r), String(r.slug ?? "—")],
              onView:
                r.id != null ? () => viewRef(sub, r.id as number) : undefined,
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── Interfaces ────────────────────────────────────────────────────────────────

const InterfacesSection: React.FC<{
  dcim: ReturnType<typeof useNetboxDcim>;
}> = ({ dcim }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = dcim;
  const [rows, setRows] = useState<Interface[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [ui, setUi] = useState<RowUi>({ drawer: null, editor: null });

  const load = useCallback(async () => {
    const n = deviceId.trim() ? Number(deviceId.trim()) : null;
    const res = await run((id) =>
      api.listInterfaces(id, Number.isFinite(n as number) ? n : null),
    );
    if (res) setRows(res.results);
  }, [run, api, deviceId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCallback(
    async (ifaceId: number) => {
      const res = await run((id) => api.getInterface(id, ifaceId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Interface #${ifaceId}`, data: res },
        }));
    },
    [run, api],
  );

  const connections = useCallback(async () => {
    const res = await run((id) => api.listInterfaceConnections(id));
    if (res)
      setUi((s) => ({
        ...s,
        drawer: {
          title: t(
            "integrations.netbox.dcim.actions.connections",
            "Connections",
          ),
          data: res.results,
        },
      }));
  }, [run, api, t]);

  const remove = useCallback(
    async (ifaceId: number) => {
      await run((id) => api.deleteInterface(id, ifaceId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (iface: Interface | null) => {
      const isNew = iface == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t("integrations.netbox.dcim.editor.newInterface", "New interface")
            : t(
                "integrations.netbox.dcim.editor.editInterface",
                "Edit interface",
              ),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? { device: null, name: "", type: "1000base-t" }
            : (iface as unknown as NbPayload),
          submit: async (mode, data) => {
            if (mode === "create")
              await run((id) => api.createInterface(id, data));
            else if (mode === "patch")
              await run((id) =>
                api.partialUpdateInterface(id, iface!.id!, data),
              );
            else await run((id) => api.updateInterface(id, iface!.id!, data));
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      >
        <input
          className={inputCls}
          inputMode="numeric"
          placeholder={t(
            "integrations.netbox.dcim.filters.deviceId",
            "Device ID",
          )}
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t("integrations.netbox.dcim.actions.apply", "Apply")}
        </button>
        <button onClick={connections} className={btnCls}>
          <Network size={12} />
          {t("integrations.netbox.dcim.actions.connections", "Connections")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t("integrations.netbox.dcim.fields.name", "Name"),
          t("integrations.netbox.dcim.fields.device", "Device"),
          t("integrations.netbox.dcim.fields.type", "Type"),
          t("integrations.netbox.dcim.fields.enabled", "Enabled"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            r.name ?? "—",
            refLabel(r.device),
            refLabel(r.type),
            r.enabled ? "✓" : "✗",
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Cables ────────────────────────────────────────────────────────────────────

const CablesSection: React.FC<{ dcim: ReturnType<typeof useNetboxDcim> }> = ({
  dcim,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = dcim;
  const [rows, setRows] = useState<Cable[]>([]);
  const [search, setSearch] = useState("");
  const [ui, setUi] = useState<RowUi>({ drawer: null, editor: null });

  const load = useCallback(async () => {
    const params: Array<[string, string]> = search.trim()
      ? [["q", search.trim()]]
      : [];
    const res = await run((id) => api.listCables(id, params));
    if (res) setRows(res.results);
  }, [run, api, search]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCallback(
    async (cableId: number) => {
      const res = await run((id) => api.getCable(id, cableId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.label ?? `Cable #${cableId}`, data: res },
        }));
    },
    [run, api],
  );

  const trace = useCallback(
    async (cableId: number) => {
      const res = await run((id) => api.traceCable(id, cableId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: {
            title: t("integrations.netbox.dcim.actions.trace", "Trace"),
            data: res,
          },
        }));
    },
    [run, api, t],
  );

  const remove = useCallback(
    async (cableId: number) => {
      await run((id) => api.deleteCable(id, cableId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (cable: Cable | null) => {
      const isNew = cable == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t("integrations.netbox.dcim.editor.newCable", "New cable")
            : t("integrations.netbox.dcim.editor.editCable", "Edit cable"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? { a_terminations: [], b_terminations: [], status: "connected" }
            : (cable as unknown as NbPayload),
          submit: async (mode, data) => {
            // Cables have no partial-update command; PATCH falls back to PUT.
            if (mode === "create") await run((id) => api.createCable(id, data));
            else await run((id) => api.updateCable(id, cable!.id!, data));
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      >
        <input
          className={inputCls}
          placeholder={t("integrations.netbox.dcim.filters.search", "Search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t("integrations.netbox.dcim.actions.apply", "Apply")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t("integrations.netbox.dcim.fields.label", "Label"),
          t("integrations.netbox.dcim.fields.type", "Type"),
          t("integrations.netbox.dcim.fields.status", "Status"),
          t("integrations.netbox.dcim.fields.length", "Length"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            r.label || `#${r.id ?? "—"}`,
            refLabel(r.type),
            refLabel(r.status),
            r.length != null ? `${r.length} ${refLabel(r.lengthUnit)}` : "—",
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
          extra:
            r.id != null
              ? [
                  {
                    label: t("integrations.netbox.dcim.actions.trace", "Trace"),
                    onClick: () => trace(r.id!),
                  },
                ]
              : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Generic table + section layout ─────────────────────────────────────────────

interface TableRow {
  id: number;
  cells: string[];
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extra?: Array<{ label: string; onClick: () => void }>;
}

const DataTable: React.FC<{ columns: string[]; rows: TableRow[] }> = ({
  columns,
  rows,
}) => {
  const { t } = useTranslation();
  if (rows.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
        {t("integrations.netbox.dcim.empty", "No records.")}
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface)]">
          <tr className="text-left text-xs text-[var(--color-textMuted)]">
            {columns.map((c) => (
              <th key={c} className="px-3 py-1.5 font-medium">
                {c}
              </th>
            ))}
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
            >
              {r.cells.map((cell, i) => (
                <td
                  key={i}
                  className="px-3 py-1.5 text-[var(--color-text)]"
                  onClick={r.onView}
                  role={r.onView ? "button" : undefined}
                >
                  {cell}
                </td>
              ))}
              <td className="px-3 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {r.extra?.map((x) => (
                    <button
                      key={x.label}
                      onClick={x.onClick}
                      className={btnCls}
                    >
                      {x.label}
                    </button>
                  ))}
                  {r.onEdit && (
                    <button onClick={r.onEdit} className={btnCls}>
                      {t("integrations.netbox.dcim.actions.edit", "Edit")}
                    </button>
                  )}
                  {r.onDelete && (
                    <button
                      onClick={r.onDelete}
                      className={btnCls}
                      title={t(
                        "integrations.netbox.dcim.actions.delete",
                        "Delete",
                      )}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SectionLayout: React.FC<{
  ui: RowUi;
  setUi: React.Dispatch<React.SetStateAction<RowUi>>;
  error: string | null;
  children: React.ReactNode;
}> = ({ ui, setUi, error, children }) => (
  <div className="relative flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {error}
        </p>
      )}
      {children}
    </div>
    {ui.drawer && (
      <JsonDrawer
        title={ui.drawer.title}
        data={ui.drawer.data}
        onClose={() => setUi((s) => ({ ...s, drawer: null }))}
      />
    )}
    {ui.editor && (
      <JsonEditorModal
        title={ui.editor.title}
        mode={ui.editor.mode}
        initial={ui.editor.initial}
        onSubmit={ui.editor.submit}
        onClose={() => setUi((s) => ({ ...s, editor: null }))}
      />
    )}
  </div>
);

// ─── Root tab ──────────────────────────────────────────────────────────────────

const GROUPS: Array<{ key: GroupKey; icon: typeof Building2 }> = [
  { key: "sites", icon: Building2 },
  { key: "racks", icon: Server },
  { key: "devices", icon: Cpu },
  { key: "interfaces", icon: Network },
  { key: "cables", icon: CableIcon },
];

const NetboxDcimTab: React.FC<NetboxTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const dcim = useNetboxDcim(connectionId);
  const [group, setGroup] = useState<GroupKey>("sites");

  const groupLabel = useMemo(
    () => ({
      sites: t("integrations.netbox.dcim.groups.sites", "Sites"),
      racks: t("integrations.netbox.dcim.groups.racks", "Racks"),
      devices: t("integrations.netbox.dcim.groups.devices", "Devices"),
      interfaces: t("integrations.netbox.dcim.groups.interfaces", "Interfaces"),
      cables: t("integrations.netbox.dcim.groups.cables", "Cables"),
    }),
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3">
        {GROUPS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setGroup(key)}
            className={`flex items-center gap-1 border-b-2 px-3 py-2 text-sm ${
              group === key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon size={14} />
            {groupLabel[key]}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {group === "sites" && <SitesSection dcim={dcim} />}
        {group === "racks" && <RacksSection dcim={dcim} />}
        {group === "devices" && <DevicesSection dcim={dcim} />}
        {group === "interfaces" && <InterfacesSection dcim={dcim} />}
        {group === "cables" && <CablesSection dcim={dcim} />}
      </div>
    </div>
  );
};

export default NetboxDcimTab;
