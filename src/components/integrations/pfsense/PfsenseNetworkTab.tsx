// pfSense — "Network & Firewall" sub-tab (t42-pfsense-c1).
//
// Binds all 49 Network & Firewall commands across five sections:
//   Interfaces (9) · Firewall (13) · NAT (13) · Routing (6) · VPN (8)
// Lists load via `list_*`; row "View" fetches the single entity via the
// matching `get_*`; "Add"/"Edit" open a JSON editor that maps to `create_*` /
// `update_*`; "Delete" maps to `delete_*`; apply/flush actions map to the
// `apply_*` / `flush_*` commands. Mounted only when connected, so `connectionId`
// is always a live pfSense connection id (passed as `id` to every command).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Eye,
  Pencil,
  Play,
  Zap,
  X,
  Save,
} from "lucide-react";

import {
  usePfsenseNetwork,
  type UsePfsenseNetwork,
} from "../../../hooks/integration/pfsense/usePfsenseNetwork";
import type { PfsenseTabProps } from "./registry";
import {
  NEW_FIREWALL_ALIAS,
  NEW_FIREWALL_RULE,
  NEW_INTERFACE_CONFIG,
  NEW_NAT_1TO1,
  NEW_NAT_OUTBOUND,
  NEW_NAT_PORT_FORWARD,
  NEW_OPENVPN_SERVER,
  NEW_STATIC_ROUTE,
  type FirewallAlias,
  type FirewallRule,
  type Gateway,
  type IfStats,
  type InterfaceConfig,
  type IpsecTunnel,
  type Nat1to1,
  type NatOutbound,
  type NatPortForward,
  type NetworkInterface,
  type OpenVpnClient,
  type OpenVpnServer,
  type RoutingTableEntry,
  type StaticRoute,
  type WireGuardTunnel,
} from "../../../types/pfsense/network";

// ── shared styling tokens ────────────────────────────────────────────────────
const CELL = "px-2 py-1 text-left align-top";
const HEAD =
  "px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]";
const BTN =
  "flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-50";
const ICON_BTN =
  "rounded p-1 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] disabled:opacity-40";

function yn(v: boolean): string {
  return v ? "✓" : "—";
}

// ── column + list primitives ─────────────────────────────────────────────────

interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
}

interface ResourceListProps<T> {
  title: string;
  columns: Column<T>[];
  rowKey: (row: T, i: number) => string;
  load: () => Promise<T[] | undefined>;
  /** get_* — fetch and display the single entity. */
  onView?: (row: T) => void;
  /** update_* — open editor seeded with the row. */
  onEdit?: (row: T) => void;
  /** delete_* — reloads on success. */
  onDelete?: (row: T) => Promise<unknown>;
  /** create_* — open editor with a fresh template. */
  onCreate?: () => void;
  /** apply_* / flush_* buttons rendered in the toolbar. */
  extraActions?: React.ReactNode;
  /** Auto-load on mount (default true). */
  autoLoad?: boolean;
  /** Hands the parent a reload fn so create/edit can refresh this list. */
  onReady?: (reload: () => void) => void;
}

function ResourceList<T>({
  title,
  columns,
  rowKey,
  load,
  onView,
  onEdit,
  onDelete,
  onCreate,
  extraActions,
  autoLoad = true,
  onReady,
}: ResourceListProps<T>) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await load();
      if (r) setRows(r);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [load]);

  useEffect(() => {
    onReady?.(() => void reload());
  }, [onReady, reload]);

  useEffect(() => {
    if (autoLoad) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actionCol = Boolean(onView || onEdit || onDelete);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--color-text)]">
          {title}
          <span className="ml-2 text-xs font-normal text-[var(--color-textSecondary)]">
            {loaded ? rows.length : ""}
          </span>
        </h4>
        <div className="flex items-center gap-1">
          {extraActions}
          {onCreate && (
            <button className={BTN} onClick={onCreate}>
              <Plus size={12} />
              {t("integrations.pfsense.network.add", "Add")}
            </button>
          )}
          <button className={BTN} onClick={() => void reload()} disabled={loading}>
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t("integrations.pfsense.network.refresh", "Refresh")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full border-collapse text-xs text-[var(--color-text)]">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <tr>
              {columns.map((c) => (
                <th key={c.header} className={HEAD}>
                  {c.header}
                </th>
              ))}
              {actionCol && (
                <th className={`${HEAD} text-right`}>
                  {t("integrations.pfsense.network.actions", "Actions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-3 text-center text-[var(--color-textSecondary)]"
                  colSpan={columns.length + (actionCol ? 1 : 0)}
                >
                  {loading
                    ? t("integrations.pfsense.network.loading", "Loading…")
                    : t("integrations.pfsense.network.empty", "No entries")}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surfaceHover)]"
                >
                  {columns.map((c) => (
                    <td key={c.header} className={CELL}>
                      {c.render(row)}
                    </td>
                  ))}
                  {actionCol && (
                    <td className={`${CELL} text-right`}>
                      <div className="flex justify-end gap-0.5">
                        {onView && (
                          <button
                            className={ICON_BTN}
                            title={t(
                              "integrations.pfsense.network.view",
                              "View",
                            )}
                            onClick={() => onView(row)}
                          >
                            <Eye size={13} />
                          </button>
                        )}
                        {onEdit && (
                          <button
                            className={ICON_BTN}
                            title={t(
                              "integrations.pfsense.network.edit",
                              "Edit",
                            )}
                            onClick={() => onEdit(row)}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            className={ICON_BTN}
                            title={t(
                              "integrations.pfsense.network.delete",
                              "Delete",
                            )}
                            onClick={async () => {
                              await onDelete(row);
                              void reload();
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── JSON editor + detail modals ──────────────────────────────────────────────

interface JsonEditorModalProps<T> {
  title: string;
  initial: T;
  onCancel: () => void;
  onSave: (value: T) => Promise<void>;
}

function JsonEditorModal<T>({
  title,
  initial,
  onCancel,
  onSave,
}: JsonEditorModalProps<T>) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h3>
          <button className={ICON_BTN} onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <textarea
            className="h-80 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          {err && (
            <p className="mt-2 text-xs text-[var(--color-danger,#f87171)]">
              {err}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2">
          <button className={BTN} onClick={onCancel}>
            {t("integrations.pfsense.network.cancel", "Cancel")}
          </button>
          <button
            className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            {t("integrations.pfsense.network.save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  title,
  data,
  onClose,
}: {
  title: string;
  data: unknown;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h3>
          <button className={ICON_BTN} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <pre className="whitespace-pre-wrap break-words rounded bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end border-t border-[var(--color-border)] px-4 py-2">
          <button className={BTN} onClick={onClose}>
            {t("integrations.pfsense.network.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── modal orchestration hook (shared by every section) ───────────────────────

interface EditorState<T> {
  title: string;
  initial: T;
  save: (value: T) => Promise<void>;
}

function useModals(net: UsePfsenseNetwork) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<EditorState<unknown> | null>(null);
  const [detail, setDetail] = useState<{ title: string; data: unknown } | null>(
    null,
  );

  const openEditor = useCallback(<T,>(state: EditorState<T>) => {
    setEditor(state as EditorState<unknown>);
  }, []);

  const showDetail = useCallback((title: string, data: unknown) => {
    setDetail({ title, data });
  }, []);

  /** Wrap a get_* fetch: run it and pop the result into the detail modal. */
  const view = useCallback(
    async (title: string, fetch: (id: string) => Promise<unknown>) => {
      const data = await net.run((id) => fetch(id));
      if (data !== undefined) setDetail({ title, data });
    },
    [net],
  );

  const node = (
    <>
      {editor && (
        <JsonEditorModal
          title={editor.title}
          initial={editor.initial}
          onCancel={() => setEditor(null)}
          onSave={async (value) => {
            await editor.save(value);
            setEditor(null);
          }}
        />
      )}
      {detail && (
        <DetailModal
          title={detail.title}
          data={detail.data}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );

  return { openEditor, showDetail, view, node, t };
}

// ── Interfaces section ───────────────────────────────────────────────────────

function InterfacesSection({ net }: { net: UsePfsenseNetwork }) {
  const { api, run } = net;
  const { openEditor, view, node, t } = useModals(net);
  const reloadRef = useRef<() => void>(() => {});

  const applyBtns = (
    <>
      <button
        className={BTN}
        onClick={() => void run((id) => api.applyInterfaces(id))}
      >
        <Play size={12} />
        {t("integrations.pfsense.network.applyInterfaces", "Apply")}
      </button>
      <button
        className={BTN}
        onClick={() => void run((id) => api.applyInterfaceChanges(id))}
      >
        <Zap size={12} />
        {t("integrations.pfsense.network.applyChanges", "Apply changes")}
      </button>
    </>
  );

  return (
    <div>
      <ResourceList<NetworkInterface>
        title={t("integrations.pfsense.network.interfaces", "Interfaces")}
        rowKey={(r) => r.name}
        load={() => run((id) => api.listInterfaces(id))}
        onReady={(fn) => (reloadRef.current = fn)}
        extraActions={applyBtns}
        columns={[
          { header: t("integrations.pfsense.network.col.name", "Name"), render: (r) => r.name },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr || r.if_descr },
          { header: t("integrations.pfsense.network.col.ip", "IPv4"), render: (r) => (r.ipaddr ? `${r.ipaddr}/${r.subnet}` : "—") },
          { header: t("integrations.pfsense.network.col.enabled", "On"), render: (r) => yn(r.enabled) },
        ]}
        onView={(r) =>
          void view(
            t("integrations.pfsense.network.interface", "Interface"),
            (id) => api.getInterface(id, r.name),
          )
        }
        onEdit={(r) =>
          openEditor<InterfaceConfig>({
            title: `${t("integrations.pfsense.network.editInterface", "Edit interface")} — ${r.name}`,
            initial: {
              ...NEW_INTERFACE_CONFIG,
              name: r.name,
              descr: r.descr,
              enabled: r.enabled,
              ipaddr: r.ipaddr,
              subnet: r.subnet,
              gateway: r.gateway,
              ipaddrv6: r.ipaddrv6,
              subnetv6: r.subnetv6,
              gatewayv6: r.gatewayv6,
              mtu: r.mtu,
              mss: r.mss,
              media: r.media,
              spoofmac: r.spoofmac,
              blockpriv: r.blockpriv,
              blockbogons: r.blockbogons,
            },
            save: async (v) => {
              await run((id) => api.updateInterface(id, r.name, v));
              reloadRef.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteInterface(id, r.name))}
        onCreate={() =>
          openEditor<InterfaceConfig>({
            title: t("integrations.pfsense.network.newInterface", "New interface"),
            initial: { ...NEW_INTERFACE_CONFIG },
            save: async (v) => {
              await run((id) => api.createInterface(id, v));
              reloadRef.current();
            },
          })
        }
      />

      <ResourceList<IfStats>
        title={t("integrations.pfsense.network.interfaceStats", "Interface statistics")}
        rowKey={(r) => r.interface}
        load={() => run((id) => api.listInterfaceStats(id))}
        extraActions={
          <button
            className={BTN}
            onClick={() =>
              void view(
                t("integrations.pfsense.network.interfaceStats", "Interface statistics"),
                (id) => api.getInterfaceStats(id),
              )
            }
          >
            <Eye size={12} />
            {t("integrations.pfsense.network.snapshot", "Snapshot")}
          </button>
        }
        columns={[
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.bytesIn", "Bytes in"), render: (r) => r.bytes_in },
          { header: t("integrations.pfsense.network.col.bytesOut", "Bytes out"), render: (r) => r.bytes_out },
          { header: t("integrations.pfsense.network.col.status", "Status"), render: (r) => r.status },
        ]}
      />
      {node}
    </div>
  );
}

// ── Firewall section ─────────────────────────────────────────────────────────

function FirewallSection({ net }: { net: UsePfsenseNetwork }) {
  const { api, run } = net;
  const { openEditor, view, node, t } = useModals(net);
  const rulesReload = useRef<() => void>(() => {});
  const aliasReload = useRef<() => void>(() => {});

  return (
    <div>
      <ResourceList<FirewallRule>
        title={t("integrations.pfsense.network.firewallRules", "Firewall rules")}
        rowKey={(r, i) => r.tracker || `rule-${i}`}
        load={() => run((id) => api.listFirewallRules(id))}
        onReady={(fn) => (rulesReload.current = fn)}
        extraActions={
          <button
            className={BTN}
            onClick={() => void run((id) => api.applyFirewallRules(id))}
          >
            <Play size={12} />
            {t("integrations.pfsense.network.apply", "Apply")}
          </button>
        }
        columns={[
          { header: t("integrations.pfsense.network.col.type", "Action"), render: (r) => r.type },
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.proto", "Proto"), render: (r) => r.protocol },
          { header: t("integrations.pfsense.network.col.source", "Source"), render: (r) => `${r.source}${r.source_port ? ":" + r.source_port : ""}` },
          { header: t("integrations.pfsense.network.col.dest", "Destination"), render: (r) => `${r.destination}${r.destination_port ? ":" + r.destination_port : ""}` },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onView={(r) =>
          void view(
            t("integrations.pfsense.network.firewallRule", "Firewall rule"),
            (id) => api.getFirewallRule(id, r.tracker),
          )
        }
        onEdit={(r) =>
          openEditor<FirewallRule>({
            title: `${t("integrations.pfsense.network.editRule", "Edit rule")} — ${r.tracker}`,
            initial: { ...r },
            save: async (v) => {
              await run((id) => api.updateFirewallRule(id, r.tracker, v));
              rulesReload.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteFirewallRule(id, r.tracker))}
        onCreate={() =>
          openEditor<FirewallRule>({
            title: t("integrations.pfsense.network.newRule", "New firewall rule"),
            initial: { ...NEW_FIREWALL_RULE },
            save: async (v) => {
              await run((id) => api.createFirewallRule(id, v));
              rulesReload.current();
            },
          })
        }
      />

      <ResourceList<FirewallAlias>
        title={t("integrations.pfsense.network.aliases", "Aliases")}
        rowKey={(r) => r.name}
        load={() => run((id) => api.listFirewallAliases(id))}
        onReady={(fn) => (aliasReload.current = fn)}
        columns={[
          { header: t("integrations.pfsense.network.col.name", "Name"), render: (r) => r.name },
          { header: t("integrations.pfsense.network.col.type", "Type"), render: (r) => r.type },
          { header: t("integrations.pfsense.network.col.entries", "Entries"), render: (r) => r.address.join(", ") },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onView={(r) =>
          void view(
            t("integrations.pfsense.network.alias", "Alias"),
            (id) => api.getFirewallAlias(id, r.name),
          )
        }
        onEdit={(r) =>
          openEditor<FirewallAlias>({
            title: `${t("integrations.pfsense.network.editAlias", "Edit alias")} — ${r.name}`,
            initial: { ...r },
            save: async (v) => {
              await run((id) => api.updateFirewallAlias(id, r.name, v));
              aliasReload.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteFirewallAlias(id, r.name))}
        onCreate={() =>
          openEditor<FirewallAlias>({
            title: t("integrations.pfsense.network.newAlias", "New alias"),
            initial: { ...NEW_FIREWALL_ALIAS },
            save: async (v) => {
              await run((id) => api.createFirewallAlias(id, v));
              aliasReload.current();
            },
          })
        }
      />

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">
            {t("integrations.pfsense.network.states", "State table")}
          </h4>
          <div className="flex gap-1">
            <button
              className={BTN}
              onClick={() =>
                void view(
                  t("integrations.pfsense.network.states", "State table"),
                  (id) => api.getFirewallStates(id),
                )
              }
            >
              <Eye size={12} />
              {t("integrations.pfsense.network.viewStates", "View states")}
            </button>
            <button
              className={BTN}
              onClick={() => void run((id) => api.flushFirewallStates(id))}
            >
              <Trash2 size={12} />
              {t("integrations.pfsense.network.flushStates", "Flush states")}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.pfsense.network.statesHint",
            "View the live pf state table or flush all connection states.",
          )}
        </p>
      </section>
      {node}
    </div>
  );
}

// ── NAT section ──────────────────────────────────────────────────────────────

function NatSection({ net }: { net: UsePfsenseNetwork }) {
  const { api, run } = net;
  const { openEditor, node, t } = useModals(net);
  const pfReload = useRef<() => void>(() => {});
  const obReload = useRef<() => void>(() => {});
  const oneReload = useRef<() => void>(() => {});

  const applyBtn = (
    <button className={BTN} onClick={() => void run((id) => api.applyNat(id))}>
      <Play size={12} />
      {t("integrations.pfsense.network.apply", "Apply")}
    </button>
  );

  return (
    <div>
      <ResourceList<NatPortForward>
        title={t("integrations.pfsense.network.portForwards", "Port forwards")}
        rowKey={(r, i) => r.id || `pf-${i}`}
        load={() => run((id) => api.listNatPortForwards(id))}
        onReady={(fn) => (pfReload.current = fn)}
        extraActions={applyBtn}
        columns={[
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.proto", "Proto"), render: (r) => r.protocol },
          { header: t("integrations.pfsense.network.col.dest", "Destination"), render: (r) => `${r.destination}${r.destination_port ? ":" + r.destination_port : ""}` },
          { header: t("integrations.pfsense.network.col.target", "Target"), render: (r) => `${r.target}${r.local_port ? ":" + r.local_port : ""}` },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onEdit={(r) =>
          openEditor<NatPortForward>({
            title: `${t("integrations.pfsense.network.editForward", "Edit port forward")} — ${r.id}`,
            initial: { ...r },
            save: async (v) => {
              await run((id) => api.updateNatPortForward(id, r.id, v));
              pfReload.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteNatPortForward(id, r.id))}
        onCreate={() =>
          openEditor<NatPortForward>({
            title: t("integrations.pfsense.network.newForward", "New port forward"),
            initial: { ...NEW_NAT_PORT_FORWARD },
            save: async (v) => {
              await run((id) => api.createNatPortForward(id, v));
              pfReload.current();
            },
          })
        }
      />

      <ResourceList<NatOutbound>
        title={t("integrations.pfsense.network.outbound", "Outbound NAT")}
        rowKey={(r, i) => r.id || `ob-${i}`}
        load={() => run((id) => api.listNatOutbound(id))}
        onReady={(fn) => (obReload.current = fn)}
        columns={[
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.source", "Source"), render: (r) => r.source },
          { header: t("integrations.pfsense.network.col.dest", "Destination"), render: (r) => r.destination },
          { header: t("integrations.pfsense.network.col.translation", "Translation"), render: (r) => r.translation_address },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onEdit={(r) =>
          openEditor<NatOutbound>({
            title: `${t("integrations.pfsense.network.editOutbound", "Edit outbound NAT")} — ${r.id}`,
            initial: { ...r },
            save: async (v) => {
              await run((id) => api.updateNatOutbound(id, r.id, v));
              obReload.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteNatOutbound(id, r.id))}
        onCreate={() =>
          openEditor<NatOutbound>({
            title: t("integrations.pfsense.network.newOutbound", "New outbound NAT"),
            initial: { ...NEW_NAT_OUTBOUND },
            save: async (v) => {
              await run((id) => api.createNatOutbound(id, v));
              obReload.current();
            },
          })
        }
      />

      <ResourceList<Nat1to1>
        title={t("integrations.pfsense.network.oneToOne", "1:1 NAT")}
        rowKey={(r, i) => r.id || `1to1-${i}`}
        load={() => run((id) => api.listNat1to1(id))}
        onReady={(fn) => (oneReload.current = fn)}
        columns={[
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.external", "External"), render: (r) => r.external },
          { header: t("integrations.pfsense.network.col.source", "Internal"), render: (r) => r.source },
          { header: t("integrations.pfsense.network.col.dest", "Destination"), render: (r) => r.destination },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onEdit={(r) =>
          openEditor<Nat1to1>({
            title: `${t("integrations.pfsense.network.editOneToOne", "Edit 1:1 NAT")} — ${r.id}`,
            initial: { ...r },
            save: async (v) => {
              await run((id) => api.updateNat1to1(id, r.id, v));
              oneReload.current();
            },
          })
        }
        onDelete={(r) => run((id) => api.deleteNat1to1(id, r.id))}
        onCreate={() =>
          openEditor<Nat1to1>({
            title: t("integrations.pfsense.network.newOneToOne", "New 1:1 NAT"),
            initial: { ...NEW_NAT_1TO1 },
            save: async (v) => {
              await run((id) => api.createNat1to1(id, v));
              oneReload.current();
            },
          })
        }
      />
      {node}
    </div>
  );
}

// ── Routing section ──────────────────────────────────────────────────────────

function RoutingSection({ net }: { net: UsePfsenseNetwork }) {
  const { api, run } = net;
  const { openEditor, view, node, t } = useModals(net);
  const routeReload = useRef<() => void>(() => {});

  return (
    <div>
      <ResourceList<StaticRoute>
        title={t("integrations.pfsense.network.routes", "Static routes")}
        rowKey={(r, i) => r.id || `route-${i}`}
        load={() => run((id) => api.listRoutes(id))}
        onReady={(fn) => (routeReload.current = fn)}
        columns={[
          { header: t("integrations.pfsense.network.col.network", "Network"), render: (r) => r.network },
          { header: t("integrations.pfsense.network.col.gateway", "Gateway"), render: (r) => r.gateway },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
          { header: t("integrations.pfsense.network.col.disabled", "Disabled"), render: (r) => yn(r.disabled) },
        ]}
        onDelete={(r) => run((id) => api.deleteRoute(id, r.id))}
        onCreate={() =>
          openEditor<StaticRoute>({
            title: t("integrations.pfsense.network.newRoute", "New static route"),
            initial: { ...NEW_STATIC_ROUTE },
            save: async (v) => {
              await run((id) => api.createRoute(id, v));
              routeReload.current();
            },
          })
        }
      />

      <ResourceList<Gateway>
        title={t("integrations.pfsense.network.gateways", "Gateways")}
        rowKey={(r, i) => r.name || `gw-${i}`}
        load={() => run((id) => api.listGateways(id))}
        extraActions={
          <button
            className={BTN}
            onClick={() =>
              void view(
                t("integrations.pfsense.network.gatewayStatus", "Gateway status"),
                (id) => api.getGatewayStatus(id),
              )
            }
          >
            <Eye size={12} />
            {t("integrations.pfsense.network.status", "Status")}
          </button>
        }
        columns={[
          { header: t("integrations.pfsense.network.col.name", "Name"), render: (r) => r.name },
          { header: t("integrations.pfsense.network.col.interface", "Interface"), render: (r) => r.interface },
          { header: t("integrations.pfsense.network.col.gateway", "Gateway"), render: (r) => r.gateway },
          { header: t("integrations.pfsense.network.col.monitor", "Monitor"), render: (r) => r.monitor },
          { header: t("integrations.pfsense.network.col.default", "Default"), render: (r) => yn(r.default_gw) },
        ]}
      />

      <ResourceList<RoutingTableEntry>
        title={t("integrations.pfsense.network.routingTable", "Routing table")}
        rowKey={(r, i) => `${r.destination}-${i}`}
        load={() => run((id) => api.getRoutingTable(id))}
        autoLoad={false}
        columns={[
          { header: t("integrations.pfsense.network.col.dest", "Destination"), render: (r) => r.destination },
          { header: t("integrations.pfsense.network.col.gateway", "Gateway"), render: (r) => r.gateway },
          { header: t("integrations.pfsense.network.col.flags", "Flags"), render: (r) => r.flags },
          { header: t("integrations.pfsense.network.col.netif", "Interface"), render: (r) => r.netif },
        ]}
      />
      {node}
    </div>
  );
}

// ── VPN section ──────────────────────────────────────────────────────────────

function VpnSection({ net }: { net: UsePfsenseNetwork }) {
  const { api, run } = net;
  const { openEditor, view, showDetail, node, t } = useModals(net);
  const ovpnReload = useRef<() => void>(() => {});

  return (
    <div>
      <ResourceList<OpenVpnServer>
        title={t("integrations.pfsense.network.openvpnServers", "OpenVPN servers")}
        rowKey={(r, i) => String(r.vpnid) || `ovpn-${i}`}
        load={() => run((id) => api.listOpenvpnServers(id))}
        onReady={(fn) => (ovpnReload.current = fn)}
        columns={[
          { header: t("integrations.pfsense.network.col.vpnid", "ID"), render: (r) => r.vpnid },
          { header: t("integrations.pfsense.network.col.mode", "Mode"), render: (r) => r.mode },
          { header: t("integrations.pfsense.network.col.proto", "Proto"), render: (r) => r.protocol },
          { header: t("integrations.pfsense.network.col.port", "Port"), render: (r) => r.local_port },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
        onView={(r) =>
          void view(
            t("integrations.pfsense.network.openvpnServer", "OpenVPN server"),
            (id) => api.getOpenvpnServer(id, r.vpnid),
          )
        }
        onDelete={(r) => run((id) => api.deleteOpenvpnServer(id, r.vpnid))}
        onCreate={() =>
          openEditor<OpenVpnServer>({
            title: t("integrations.pfsense.network.newOpenvpnServer", "New OpenVPN server"),
            initial: { ...NEW_OPENVPN_SERVER },
            save: async (v) => {
              await run((id) => api.createOpenvpnServer(id, v));
              ovpnReload.current();
            },
          })
        }
      />

      <ResourceList<OpenVpnClient>
        title={t("integrations.pfsense.network.openvpnClients", "OpenVPN clients")}
        rowKey={(r, i) => String(r.vpnid) || `ovpnc-${i}`}
        load={() => run((id) => api.listOpenvpnClients(id))}
        columns={[
          { header: t("integrations.pfsense.network.col.vpnid", "ID"), render: (r) => r.vpnid },
          { header: t("integrations.pfsense.network.col.server", "Server"), render: (r) => `${r.server_addr}:${r.server_port}` },
          { header: t("integrations.pfsense.network.col.proto", "Proto"), render: (r) => r.protocol },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
      />

      <ResourceList<IpsecTunnel>
        title={t("integrations.pfsense.network.ipsec", "IPsec tunnels")}
        rowKey={(r, i) => String(r.ikeid) || `ipsec-${i}`}
        load={() => run((id) => api.listIpsecTunnels(id))}
        onView={(r) =>
          showDetail(t("integrations.pfsense.network.ipsecTunnel", "IPsec tunnel"), r)
        }
        columns={[
          { header: t("integrations.pfsense.network.col.ikeid", "IKE ID"), render: (r) => r.ikeid },
          { header: t("integrations.pfsense.network.col.remote", "Remote gateway"), render: (r) => r.phase1.remote_gateway },
          { header: t("integrations.pfsense.network.col.p2", "Phase 2"), render: (r) => r.phase2.length },
          { header: t("integrations.pfsense.network.col.enabled", "On"), render: (r) => yn(r.enabled) },
          { header: t("integrations.pfsense.network.col.descr", "Description"), render: (r) => r.descr },
        ]}
      />

      <ResourceList<WireGuardTunnel>
        title={t("integrations.pfsense.network.wireguard", "WireGuard tunnels")}
        rowKey={(r, i) => r.id || `wg-${i}`}
        load={() => run((id) => api.listWireguardTunnels(id))}
        onView={(r) =>
          void view(
            `${t("integrations.pfsense.network.wireguardPeers", "WireGuard peers")} — ${r.name}`,
            (id) => api.listWireguardPeers(id, r.id),
          )
        }
        columns={[
          { header: t("integrations.pfsense.network.col.name", "Name"), render: (r) => r.name },
          { header: t("integrations.pfsense.network.col.port", "Listen port"), render: (r) => r.listen_port },
          { header: t("integrations.pfsense.network.col.addresses", "Addresses"), render: (r) => r.addresses.join(", ") },
          { header: t("integrations.pfsense.network.col.enabled", "On"), render: (r) => yn(r.enabled) },
        ]}
      />
      {node}
    </div>
  );
}

// ── tab shell (section switcher) ─────────────────────────────────────────────

type SectionKey = "interfaces" | "firewall" | "nat" | "routing" | "vpn";

const PfsenseNetworkTab: React.FC<PfsenseTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const net = usePfsenseNetwork(connectionId);
  const [section, setSection] = useState<SectionKey>("interfaces");

  const sections: { key: SectionKey; label: string }[] = useMemo(
    () => [
      { key: "interfaces", label: t("integrations.pfsense.network.interfaces", "Interfaces") },
      { key: "firewall", label: t("integrations.pfsense.network.firewall", "Firewall") },
      { key: "nat", label: t("integrations.pfsense.network.nat", "NAT") },
      { key: "routing", label: t("integrations.pfsense.network.routing", "Routing") },
      { key: "vpn", label: t("integrations.pfsense.network.vpn", "VPN") },
    ],
    [t],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-3 pt-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-t px-3 py-1.5 text-xs ${
              section === s.key
                ? "bg-[var(--color-surfaceHover)] font-semibold text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {net.error && (
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-1.5 text-xs text-[var(--color-danger,#f87171)]">
          <span>{net.error}</span>
          <button className={ICON_BTN} onClick={() => net.setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {section === "interfaces" && <InterfacesSection net={net} />}
        {section === "firewall" && <FirewallSection net={net} />}
        {section === "nat" && <NatSection net={net} />}
        {section === "routing" && <RoutingSection net={net} />}
        {section === "vpn" && <VpnSection net={net} />}
      </div>
    </div>
  );
};

export default PfsenseNetworkTab;
