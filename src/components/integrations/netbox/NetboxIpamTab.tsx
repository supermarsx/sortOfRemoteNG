// NetboxIpamTab — IPAM category tab for the NetBox integration (t42 `c2`).
//
// A single, resource-agnostic console over the nine IPAM sections. All 38 IPAM
// commands are reachable from here:
//   • IP addresses      list / get / create / update / delete
//   • Prefixes          list / get / create / update / delete
//                       + available-IPs, create-available-IP, available-prefixes
//   • VRFs              list / get / create / update / delete
//   • VLANs             list / get / create / update / partial-update / delete
//                       + list-by-site, list-by-group
//   • VLAN groups       list / get / create / update / delete
//   • Aggregates        list / get
//   • RIRs              list / get
//   • IPAM roles        list / get
//   • Services          list
//
// Create/update/patch bodies are edited as raw JSON: NetBox write payloads are
// deeply polymorphic (brief refs by id, status slugs, custom fields), so a JSON
// editor binds every writable field of every resource without nine bespoke
// forms. Reads render as a sortable-free table plus a JSON inspector drawer.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Globe,
  Layers,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ServerCog,
  SplitSquareHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NetboxTabProps, PaginatedResponse } from "../../../types/netbox";
import {
  netboxIpamApi,
  useNetboxIpam,
  type NetboxBody,
  type NetboxListParams,
} from "../../../hooks/integration/netbox/useNetboxIpam";

type Row = Record<string, unknown>;

/** Render a NetBox field that may be a brief object, a scalar, or null. */
function netboxLabel(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (Array.isArray(v)) return v.map(netboxLabel).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const pick = o.display ?? o.label ?? o.name ?? o.value ?? o.prefix;
    return pick != null ? String(pick) : "";
  }
  return String(v);
}

interface Column {
  key: string;
  labelKey: string;
  labelDefault: string;
  get: (row: Row) => string;
}

const col = (
  key: string,
  labelDefault: string,
  get: (row: Row) => string,
): Column => ({
  key,
  labelKey: `integrations.netbox.ipam.col.${key}`,
  labelDefault,
  get,
});

const text = (k: string) => (row: Row) => netboxLabel(row[k]);

/** A managed IPAM section: its list loader plus whichever write/detail commands
 *  the NetBox API exposes for that resource. `id` is bound to the connection. */
interface Section {
  key: string;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number }>;
  columns: Column[];
  supportsParams: boolean;
  list: (
    id: string,
    params: NetboxListParams,
  ) => Promise<PaginatedResponse<unknown> | unknown[]>;
  get?: (id: string, rowId: number) => Promise<unknown>;
  create?: (id: string, data: NetboxBody) => Promise<unknown>;
  update?: (id: string, rowId: number, data: NetboxBody) => Promise<unknown>;
  patch?: (id: string, rowId: number, data: NetboxBody) => Promise<unknown>;
  del?: (id: string, rowId: number) => Promise<unknown>;
  /** Prefix-only available-IP / available-prefix helpers. */
  prefixHelpers?: boolean;
  /** VLAN-only by-site / by-group filters. */
  vlanFilters?: boolean;
}

const SECTIONS: Section[] = [
  {
    key: "ip",
    labelKey: "integrations.netbox.ipam.sections.ip",
    labelDefault: "IP Addresses",
    icon: Globe,
    supportsParams: true,
    list: netboxIpamApi.listIpAddresses,
    get: netboxIpamApi.getIpAddress,
    create: netboxIpamApi.createIpAddress,
    update: netboxIpamApi.updateIpAddress,
    del: netboxIpamApi.deleteIpAddress,
    columns: [
      col("address", "Address", text("address")),
      col("status", "Status", text("status")),
      col("dnsName", "DNS name", text("dnsName")),
      col("vrf", "VRF", text("vrf")),
      col("tenant", "Tenant", text("tenant")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "prefix",
    labelKey: "integrations.netbox.ipam.sections.prefix",
    labelDefault: "Prefixes",
    icon: Network,
    supportsParams: true,
    prefixHelpers: true,
    list: netboxIpamApi.listPrefixes,
    get: netboxIpamApi.getPrefix,
    create: netboxIpamApi.createPrefix,
    update: netboxIpamApi.updatePrefix,
    del: netboxIpamApi.deletePrefix,
    columns: [
      col("prefix", "Prefix", text("prefix")),
      col("status", "Status", text("status")),
      col("vrf", "VRF", text("vrf")),
      col("site", "Site", text("site")),
      col("vlan", "VLAN", text("vlan")),
      col("role", "Role", text("role")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "vrf",
    labelKey: "integrations.netbox.ipam.sections.vrf",
    labelDefault: "VRFs",
    icon: Route,
    supportsParams: false,
    list: (id) => netboxIpamApi.listVrfs(id),
    get: netboxIpamApi.getVrf,
    create: netboxIpamApi.createVrf,
    update: netboxIpamApi.updateVrf,
    del: netboxIpamApi.deleteVrf,
    columns: [
      col("name", "Name", text("name")),
      col("rd", "RD", text("rd")),
      col("tenant", "Tenant", text("tenant")),
      col("prefixCount", "Prefixes", text("prefixCount")),
      col("ipaddressCount", "IPs", text("ipaddressCount")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "vlan",
    labelKey: "integrations.netbox.ipam.sections.vlan",
    labelDefault: "VLANs",
    icon: Layers,
    supportsParams: true,
    vlanFilters: true,
    list: netboxIpamApi.listVlans,
    get: netboxIpamApi.getVlan,
    create: netboxIpamApi.createVlan,
    update: netboxIpamApi.updateVlan,
    patch: netboxIpamApi.partialUpdateVlan,
    del: netboxIpamApi.deleteVlan,
    columns: [
      col("vid", "VID", text("vid")),
      col("name", "Name", text("name")),
      col("status", "Status", text("status")),
      col("site", "Site", text("site")),
      col("group", "Group", text("group")),
      col("role", "Role", text("role")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "vlanGroup",
    labelKey: "integrations.netbox.ipam.sections.vlanGroup",
    labelDefault: "VLAN Groups",
    icon: Boxes,
    supportsParams: false,
    list: (id) => netboxIpamApi.listVlanGroups(id),
    get: netboxIpamApi.getVlanGroup,
    create: netboxIpamApi.createVlanGroup,
    update: netboxIpamApi.updateVlanGroup,
    del: netboxIpamApi.deleteVlanGroup,
    columns: [
      col("name", "Name", text("name")),
      col("slug", "Slug", text("slug")),
      col("scopeType", "Scope type", text("scopeType")),
      col("vlanCount", "VLANs", text("vlanCount")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "aggregate",
    labelKey: "integrations.netbox.ipam.sections.aggregate",
    labelDefault: "Aggregates",
    icon: SplitSquareHorizontal,
    supportsParams: false,
    list: (id) => netboxIpamApi.listAggregates(id),
    get: netboxIpamApi.getAggregate,
    columns: [
      col("prefix", "Prefix", text("prefix")),
      col("rir", "RIR", text("rir")),
      col("tenant", "Tenant", text("tenant")),
      col("dateAdded", "Date added", text("dateAdded")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "rir",
    labelKey: "integrations.netbox.ipam.sections.rir",
    labelDefault: "RIRs",
    icon: Globe,
    supportsParams: false,
    list: (id) => netboxIpamApi.listRirs(id),
    get: netboxIpamApi.getRir,
    columns: [
      col("name", "Name", text("name")),
      col("slug", "Slug", text("slug")),
      col("isPrivate", "Private", text("isPrivate")),
      col("aggregateCount", "Aggregates", text("aggregateCount")),
      col("description", "Description", text("description")),
    ],
  },
  {
    key: "role",
    labelKey: "integrations.netbox.ipam.sections.role",
    labelDefault: "Roles",
    icon: Tags,
    supportsParams: false,
    list: (id) => netboxIpamApi.listIpamRoles(id),
    get: netboxIpamApi.getIpamRole,
    columns: [
      col("name", "Name", text("name")),
      col("slug", "Slug", text("slug")),
      col("weight", "Weight", text("weight")),
      col("prefixCount", "Prefixes", text("prefixCount")),
      col("vlanCount", "VLANs", text("vlanCount")),
    ],
  },
  {
    key: "service",
    labelKey: "integrations.netbox.ipam.sections.service",
    labelDefault: "Services",
    icon: ServerCog,
    supportsParams: true,
    list: netboxIpamApi.listServices,
    columns: [
      col("name", "Name", text("name")),
      col("protocol", "Protocol", text("protocol")),
      col("ports", "Ports", text("ports")),
      col("device", "Device", text("device")),
      col("virtualMachine", "VM", text("virtualMachine")),
      col("description", "Description", text("description")),
    ],
  },
];

/** JSON editor modal state (create / update / patch / create-available-IP). */
interface EditorState {
  title: string;
  json: string;
  submit: (body: NetboxBody) => Promise<unknown>;
}

/** Read-only JSON inspector drawer (detail fetches + prefix helper results). */
interface InspectorState {
  title: string;
  data: unknown;
}

type VlanFilterMode = "all" | "site" | "group";

const btn =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50";

const NetboxIpamTab: React.FC<NetboxTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const {
    api,
    items,
    total,
    loading,
    busy,
    error,
    loadList,
    run,
    clearError,
  } = useNetboxIpam();

  const [activeKey, setActiveKey] = useState<string>(SECTIONS[0].key);
  const section = useMemo(
    () => SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0],
    [activeKey],
  );

  const [query, setQuery] = useState("");
  const [vlanMode, setVlanMode] = useState<VlanFilterMode>("all");
  const [vlanFilterId, setVlanFilterId] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const buildParams = useCallback((): NetboxListParams => {
    const p: NetboxListParams = [["limit", "100"]];
    const q = query.trim();
    if (q) p.push(["q", q]);
    return p;
  }, [query]);

  /** Load the active section honoring the current search / VLAN filter. */
  const reload = useCallback(() => {
    if (section.vlanFilters && vlanMode !== "all") {
      const n = Number(vlanFilterId.trim());
      if (!Number.isFinite(n)) return;
      return loadList(() =>
        vlanMode === "site"
          ? api.listVlansBySite(connectionId, n)
          : api.listVlansByGroup(connectionId, n),
      );
    }
    return loadList(() => section.list(connectionId, buildParams()));
  }, [section, vlanMode, vlanFilterId, api, connectionId, buildParams, loadList]);

  // On section change (or reconnect) reset filters and load defaults.
  useEffect(() => {
    setQuery("");
    setVlanMode("all");
    setVlanFilterId("");
    loadList(() => section.list(connectionId, [["limit", "100"]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, connectionId]);

  const rows = items as Row[];

  const openInspect = useCallback(
    async (title: string, action: () => Promise<unknown>) => {
      const data = await run(action);
      if (data !== null) setInspector({ title, data });
    },
    [run],
  );

  const onView = useCallback(
    (row: Row) => {
      const rowId = Number(row.id);
      if (section.get && Number.isFinite(rowId)) {
        void openInspect(
          `${section.labelDefault} #${rowId}`,
          () => section.get!(connectionId, rowId),
        );
      } else {
        setInspector({ title: t("integrations.netbox.ipam.inspector.row", "Row"), data: row });
      }
    },
    [section, connectionId, openInspect, t],
  );

  const onDelete = useCallback(
    async (row: Row) => {
      const rowId = Number(row.id);
      if (!section.del || !Number.isFinite(rowId)) return;
      const label = netboxLabel(row.name ?? row.address ?? row.prefix ?? row.id);
      if (
        !window.confirm(
          t("integrations.netbox.ipam.confirmDelete", "Delete {{item}}?", {
            item: label,
          }),
        )
      )
        return;
      const ok = await run(() => section.del!(connectionId, rowId));
      if (ok !== null) void reload();
    },
    [section, connectionId, run, reload, t],
  );

  const closeEditor = useCallback(() => setEditor(null), []);

  const submitEditor = useCallback(async () => {
    if (!editor) return;
    let body: NetboxBody;
    try {
      body = JSON.parse(editor.json) as NetboxBody;
    } catch {
      window.alert(
        t("integrations.netbox.ipam.invalidJson", "Request body is not valid JSON."),
      );
      return;
    }
    const res = await run(() => editor.submit(body));
    if (res !== null) {
      setEditor(null);
      void reload();
    }
  }, [editor, run, reload, t]);

  const openCreate = useCallback(() => {
    if (!section.create) return;
    setEditor({
      title: t("integrations.netbox.ipam.editor.createTitle", "Create {{section}}", {
        section: t(section.labelKey, section.labelDefault),
      }),
      json: "{\n  \n}",
      submit: (body) => section.create!(connectionId, body),
    });
  }, [section, connectionId, t]);

  const openEdit = useCallback(
    (row: Row, mode: "update" | "patch") => {
      const rowId = Number(row.id);
      if (!Number.isFinite(rowId)) return;
      const fn = mode === "patch" ? section.patch : section.update;
      if (!fn) return;
      setEditor({
        title:
          mode === "patch"
            ? t("integrations.netbox.ipam.editor.patchTitle", "Patch #{{id}}", { id: rowId })
            : t("integrations.netbox.ipam.editor.editTitle", "Edit #{{id}}", { id: rowId }),
        json: JSON.stringify(row, null, 2),
        submit: (body) => fn(connectionId, rowId, body),
      });
    },
    [section, connectionId, t],
  );

  // Prefix helpers ----------------------------------------------------------
  const onAvailableIps = useCallback(
    (row: Row) => {
      const pid = Number(row.id);
      if (!Number.isFinite(pid)) return;
      void openInspect(
        t("integrations.netbox.ipam.prefix.availableIps", "Available IPs"),
        () => api.getAvailableIps(connectionId, pid),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const onAvailablePrefixes = useCallback(
    (row: Row) => {
      const pid = Number(row.id);
      if (!Number.isFinite(pid)) return;
      void openInspect(
        t("integrations.netbox.ipam.prefix.availablePrefixes", "Available prefixes"),
        () => api.getAvailablePrefixes(connectionId, pid),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const onCreateAvailableIp = useCallback(
    (row: Row) => {
      const pid = Number(row.id);
      if (!Number.isFinite(pid)) return;
      setEditor({
        title: t(
          "integrations.netbox.ipam.prefix.newAvailableIp",
          "Claim next available IP in {{prefix}}",
          { prefix: netboxLabel(row.prefix) },
        ),
        json: "{\n  \n}",
        submit: (body) => api.createAvailableIp(connectionId, pid, body),
      });
    },
    [api, connectionId, t],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Section selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = s.key === activeKey;
          return (
            <button
              key={s.key}
              onClick={() => setActiveKey(s.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary text-white"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {t(s.labelKey, s.labelDefault)}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <button onClick={() => void reload()} className={btn} disabled={loading}>
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.netbox.ipam.refresh", "Refresh")}
        </button>

        {section.supportsParams && (
          <div className="flex items-center gap-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void reload()}
              placeholder={t("integrations.netbox.ipam.searchPlaceholder", "Search…")}
              className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
            />
          </div>
        )}

        {section.vlanFilters && (
          <div className="flex items-center gap-1">
            <select
              value={vlanMode}
              onChange={(e) => setVlanMode(e.target.value as VlanFilterMode)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-1.5 py-1 text-xs text-[var(--color-text)]"
            >
              <option value="all">{t("integrations.netbox.ipam.vlan.all", "All")}</option>
              <option value="site">{t("integrations.netbox.ipam.vlan.bySite", "By site id")}</option>
              <option value="group">{t("integrations.netbox.ipam.vlan.byGroup", "By group id")}</option>
            </select>
            {vlanMode !== "all" && (
              <>
                <input
                  value={vlanFilterId}
                  onChange={(e) => setVlanFilterId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void reload()}
                  inputMode="numeric"
                  placeholder="id"
                  className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
                />
                <button onClick={() => void reload()} className={btn}>
                  {t("integrations.netbox.ipam.vlan.apply", "Apply")}
                </button>
              </>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {total != null && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.netbox.ipam.count", "{{n}} items", { n: total })}
            </span>
          )}
          {section.create && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
            >
              <Plus size={12} />
              {t("integrations.netbox.ipam.new", "New")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{error}</span>
          <button onClick={clearError} className="shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-[var(--color-textSecondary)]">
            {t("integrations.netbox.ipam.empty", "No records.")}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)]">
              <tr className="border-b border-[var(--color-border)]">
                {section.columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {t(c.labelKey, c.labelDefault)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">
                  {t("integrations.netbox.ipam.col.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={netboxLabel(row.id) || i}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                >
                  {section.columns.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 text-[var(--color-text)]">
                      {c.get(row)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onView(row)}
                        className={btn}
                        title={t("integrations.netbox.ipam.view", "View")}
                      >
                        {t("integrations.netbox.ipam.view", "View")}
                      </button>
                      {section.prefixHelpers && (
                        <>
                          <button onClick={() => onAvailableIps(row)} className={btn}>
                            {t("integrations.netbox.ipam.prefix.ips", "IPs")}
                          </button>
                          <button onClick={() => onCreateAvailableIp(row)} className={btn}>
                            {t("integrations.netbox.ipam.prefix.newIp", "+IP")}
                          </button>
                          <button onClick={() => onAvailablePrefixes(row)} className={btn}>
                            {t("integrations.netbox.ipam.prefix.subnets", "Subnets")}
                          </button>
                        </>
                      )}
                      {section.update && (
                        <button
                          onClick={() => openEdit(row, "update")}
                          className={btn}
                          title={t("integrations.netbox.ipam.edit", "Edit")}
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {section.patch && (
                        <button
                          onClick={() => openEdit(row, "patch")}
                          className={btn}
                          title={t("integrations.netbox.ipam.patch", "Patch")}
                        >
                          {t("integrations.netbox.ipam.patch", "Patch")}
                        </button>
                      )}
                      {section.del && (
                        <button
                          onClick={() => void onDelete(row)}
                          className={btn}
                          title={t("integrations.netbox.ipam.delete", "Delete")}
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
        )}
      </div>

      {/* JSON editor modal */}
      {editor && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
          <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {editor.title}
              </h3>
              <button onClick={closeEditor} className="text-[var(--color-textSecondary)]">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <textarea
                value={editor.json}
                onChange={(e) => setEditor({ ...editor, json: e.target.value })}
                spellCheck={false}
                className="h-64 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]"
              />
              <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
                {t(
                  "integrations.netbox.ipam.editor.hint",
                  "Raw NetBox JSON body. Reference related objects by numeric id.",
                )}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
              <button onClick={closeEditor} className={btn}>
                {t("integrations.netbox.ipam.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void submitEditor()}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t("integrations.netbox.ipam.save", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspector drawer */}
      {inspector && (
        <div className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
              {inspector.title}
            </h3>
            <button
              onClick={() => setInspector(null)}
              className="text-[var(--color-textSecondary)]"
            >
              <X size={16} />
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-[var(--color-text)]">
            {JSON.stringify(inspector.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default NetboxIpamTab;
