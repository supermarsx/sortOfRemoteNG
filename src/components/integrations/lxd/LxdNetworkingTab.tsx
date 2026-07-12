// LxdNetworkingTab — "Networking" sub-tab for the LXD / Incus panel (t42 c3).
//
// Binds all 25 networking commands (via `useLxdNetworking`) across six sections:
// Networks, ACLs, Forwards, Zones, Load balancers, Peers. Forwards / load
// balancers / peers are network-scoped, so those sections drive off a network
// picker; Networks / ACLs / Zones are global collections. The tab instantiates
// its own category hook and gates every fetch on `connected` (props from the
// panel shell's `LxdTabProps`).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Network,
  Shield,
  ArrowRightLeft,
  Globe,
  Scale,
  Link2,
  RefreshCw,
  Trash2,
  Plus,
  Pencil,
  Activity,
  Loader2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LxdTabProps } from "./registry";
import { useLxdNetworking } from "../../../hooks/integration/lxd/useLxdNetworking";
import type {
  CreateNetworkAclRequest,
  CreateNetworkForwardRequest,
  CreateNetworkRequest,
} from "../../../types/lxd/networking";

type Section =
  | "networks"
  | "acls"
  | "forwards"
  | "zones"
  | "loadBalancers"
  | "peers";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const thClass =
  "px-2 py-1.5 text-left text-xs font-semibold text-[var(--color-textSecondary)]";
const tdClass = "px-2 py-1.5 text-xs text-[var(--color-text)] align-top";
const iconBtn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtn =
  "inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60";

const dash = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/** Parse a JSON string into an object, or throw a friendly error. */
function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

const LxdNetworkingTab: React.FC<LxdTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const net = useLxdNetworking(connected);
  const [section, setSection] = useState<Section>("networks");

  const sections = useMemo(
    () => [
      {
        key: "networks" as const,
        icon: Network,
        label: t("integrations.lxd.networking.sections.networks", "Networks"),
      },
      {
        key: "acls" as const,
        icon: Shield,
        label: t("integrations.lxd.networking.sections.acls", "ACLs"),
      },
      {
        key: "forwards" as const,
        icon: ArrowRightLeft,
        label: t("integrations.lxd.networking.sections.forwards", "Forwards"),
      },
      {
        key: "zones" as const,
        icon: Globe,
        label: t("integrations.lxd.networking.sections.zones", "Zones"),
      },
      {
        key: "loadBalancers" as const,
        icon: Scale,
        label: t(
          "integrations.lxd.networking.sections.loadBalancers",
          "Load balancers",
        ),
      },
      {
        key: "peers" as const,
        icon: Link2,
        label: t("integrations.lxd.networking.sections.peers", "Peers"),
      },
    ],
    [t],
  );

  if (!connected) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-textSecondary)]">
        {t(
          "integrations.lxd.networking.notConnected",
          "Connect to an LXD server to manage networking.",
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Section nav */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2 py-1">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {s.label}
            </button>
          );
        })}
      </div>

      {net.error && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
          <span className="truncate">{net.error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {section === "networks" && <NetworksSection net={net} />}
        {section === "acls" && <AclsSection net={net} />}
        {section === "forwards" && <ForwardsSection net={net} />}
        {section === "zones" && <ZonesSection net={net} />}
        {section === "loadBalancers" && <LoadBalancersSection net={net} />}
        {section === "peers" && <PeersSection net={net} />}
      </div>
    </div>
  );
};

type Net = ReturnType<typeof useLxdNetworking>;

// ─── Shared bits ────────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{
  title: string;
  onRefresh: () => void;
  loading: boolean;
  right?: React.ReactNode;
}> = ({ title, onRefresh, loading, right }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      <div className="flex items-center gap-2">
        {right}
        <button onClick={onRefresh} disabled={loading} className={iconBtn}>
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.lxd.networking.refresh", "Refresh")}
        </button>
      </div>
    </div>
  );
};

const EmptyRow: React.FC<{ colSpan: number; text: string }> = ({
  colSpan,
  text,
}) => (
  <tr>
    <td
      colSpan={colSpan}
      className="px-2 py-4 text-center text-xs text-[var(--color-textSecondary)]"
    >
      {text}
    </td>
  </tr>
);

/** Picker for network-scoped sections (forwards / load balancers / peers). */
const NetworkPicker: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  return (
    <select
      className={`${inputClass} max-w-xs`}
      value={net.selectedNetwork ?? ""}
      onChange={(e) => net.selectNetwork(e.target.value || null)}
    >
      <option value="">
        {t("integrations.lxd.networking.selectNetwork", "Select a network…")}
      </option>
      {net.networks.map((n) => (
        <option key={n.name} value={n.name}>
          {n.name}
        </option>
      ))}
    </select>
  );
};

// ─── Networks ───────────────────────────────────────────────────────────────────

const NetworksSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateNetworkRequest>({
    name: "",
    type: "bridge",
    description: "",
  });
  const [detail, setDetail] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!form.name.trim()) return;
    const req: CreateNetworkRequest = {
      name: form.name.trim(),
      type: form.type?.trim() || undefined,
      description: form.description?.trim() || undefined,
    };
    const ok = await net.createNetwork(req);
    if (ok) {
      setCreating(false);
      setForm({ name: "", type: "bridge", description: "" });
    }
  }, [form, net]);

  return (
    <div>
      <SectionHeader
        title={t("integrations.lxd.networking.sections.networks", "Networks")}
        onRefresh={net.refreshNetworks}
        loading={net.isLoading}
        right={
          <button onClick={() => setCreating((v) => !v)} className={iconBtn}>
            <Plus size={12} />
            {t("integrations.lxd.networking.create", "Create")}
          </button>
        }
      />

      {creating && (
        <div className="mb-3 rounded border border-[var(--color-border)] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.networking.fields.name", "Name")}
              </label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.networking.fields.type", "Type")}
              </label>
              <input
                className={inputClass}
                value={form.type ?? ""}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                placeholder="bridge"
              />
            </div>
            <div>
              <label className={labelClass}>
                {t(
                  "integrations.lxd.networking.fields.description",
                  "Description",
                )}
              </label>
              <input
                className={inputClass}
                value={form.description ?? ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={submit}
              disabled={net.isLoading || !form.name.trim()}
              className={primaryBtn}
            >
              {t("integrations.lxd.networking.create", "Create")}
            </button>
            <button onClick={() => setCreating(false)} className={iconBtn}>
              {t("integrations.lxd.networking.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.name", "Name")}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.type", "Type")}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.managed", "Managed")}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.status", "Status")}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.usedBy", "Used by")}
            </th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {net.networks.length === 0 ? (
            <EmptyRow
              colSpan={6}
              text={t("integrations.lxd.networking.empty.networks", "No networks.")}
            />
          ) : (
            net.networks.map((n) => (
              <React.Fragment key={n.name}>
                <tr className="border-b border-[var(--color-border)]/50">
                  <td className={`${tdClass} font-medium`}>{n.name}</td>
                  <td className={tdClass}>{dash(n.type)}</td>
                  <td className={tdClass}>
                    {n.managed === true
                      ? t("integrations.lxd.networking.yes", "Yes")
                      : n.managed === false
                        ? t("integrations.lxd.networking.no", "No")
                        : "—"}
                  </td>
                  <td className={tdClass}>{dash(n.status)}</td>
                  <td className={tdClass}>{n.used_by?.length ?? 0}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1">
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.state",
                          "State",
                        )}
                        className={iconBtn}
                        onClick={() => {
                          setDetail(detail === n.name ? null : n.name);
                          if (detail !== n.name) {
                            void net.loadNetworkState(n.name);
                            void net.loadLeases(n.name);
                          }
                        }}
                      >
                        <Activity size={12} />
                      </button>
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.rename",
                          "Rename",
                        )}
                        className={iconBtn}
                        onClick={() => {
                          const nn = window.prompt(
                            t(
                              "integrations.lxd.networking.prompt.rename",
                              "New name",
                            ),
                            n.name,
                          );
                          if (nn && nn !== n.name)
                            void net.renameNetwork(n.name, nn);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.delete",
                          "Delete",
                        )}
                        className={iconBtn}
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                "integrations.lxd.networking.confirm.deleteNetwork",
                                "Delete network {{name}}?",
                                { name: n.name },
                              ),
                            )
                          )
                            void net.deleteNetwork(n.name);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
                {detail === n.name && (
                  <tr>
                    <td colSpan={6} className="bg-[var(--color-surfaceHover)] p-3">
                      <NetworkDetail net={net} name={n.name} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

/** Drilldown for one network: live state, DHCP leases, and an inline
 *  config-patch editor (binds `lxd_get_network_state`, `lxd_list_network_leases`,
 *  `lxd_patch_network`, `lxd_update_network`). */
const NetworkDetail: React.FC<{ net: Net; name: string }> = ({ net, name }) => {
  const { t } = useTranslation();
  const [patch, setPatch] = useState("");
  const [patchErr, setPatchErr] = useState<string | null>(null);
  const state = net.networkState;

  const applyPatch = useCallback(async () => {
    setPatchErr(null);
    let body: unknown;
    try {
      body = parseJsonObject(patch);
    } catch {
      setPatchErr(
        t("integrations.lxd.networking.invalidJson", "Invalid JSON."),
      );
      return;
    }
    const ok = await net.patchNetwork(name, body);
    if (ok) setPatch("");
  }, [patch, name, net, t]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <h4 className="mb-1 text-xs font-semibold text-[var(--color-textSecondary)]">
          {t("integrations.lxd.networking.detail.state", "State")}
        </h4>
        {state ? (
          <ul className="space-y-0.5 text-xs text-[var(--color-text)]">
            <li>MTU: {dash(state.mtu)}</li>
            <li>HW: {dash(state.hwaddr)}</li>
            <li>
              {t("integrations.lxd.networking.fields.status", "Status")}:{" "}
              {dash(state.state)}
            </li>
            <li>
              {t("integrations.lxd.networking.fields.type", "Type")}:{" "}
              {dash(state.type)}
            </li>
            {(state.addresses ?? []).map((a, i) => (
              <li key={i} className="text-[var(--color-textSecondary)]">
                {dash(a.family)} {dash(a.address)}/{dash(a.netmask)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--color-textSecondary)]">—</p>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold text-[var(--color-textSecondary)]">
          {t("integrations.lxd.networking.detail.leases", "DHCP leases")} (
          {net.leases.length})
        </h4>
        <ul className="max-h-32 space-y-0.5 overflow-auto text-xs text-[var(--color-text)]">
          {net.leases.length === 0 ? (
            <li className="text-[var(--color-textSecondary)]">—</li>
          ) : (
            net.leases.map((l, i) => (
              <li key={i}>
                {dash(l.hostname)} — {dash(l.address)} ({dash(l.hwaddr)})
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="md:col-span-2">
        <label className={labelClass}>
          {t(
            "integrations.lxd.networking.detail.patch",
            "Patch config (JSON, e.g. {\"config\":{\"ipv4.address\":\"…\"}})",
          )}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={2}
          value={patch}
          onChange={(e) => setPatch(e.target.value)}
          placeholder={'{"config":{"ipv4.nat":"true"}}'}
        />
        {patchErr && <p className="mt-1 text-xs text-red-500">{patchErr}</p>}
        <button
          onClick={applyPatch}
          disabled={net.isLoading || !patch.trim()}
          className={`${primaryBtn} mt-2`}
        >
          {t("integrations.lxd.networking.detail.applyPatch", "Apply patch")}
        </button>
      </div>
    </div>
  );
};

// ─── ACLs ───────────────────────────────────────────────────────────────────────

const AclsSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateNetworkAclRequest>({
    name: "",
    description: "",
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [bodyErr, setBodyErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!form.name.trim()) return;
    const ok = await net.createAcl({
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
    });
    if (ok) {
      setCreating(false);
      setForm({ name: "", description: "" });
    }
  }, [form, net]);

  const applyUpdate = useCallback(
    async (name: string) => {
      setBodyErr(null);
      let parsed: unknown;
      try {
        parsed = parseJsonObject(body);
      } catch {
        setBodyErr(
          t("integrations.lxd.networking.invalidJson", "Invalid JSON."),
        );
        return;
      }
      const ok = await net.updateAcl(name, parsed);
      if (ok) {
        setEditing(null);
        setBody("");
      }
    },
    [body, net, t],
  );

  return (
    <div>
      <SectionHeader
        title={t("integrations.lxd.networking.sections.acls", "ACLs")}
        onRefresh={net.refreshAcls}
        loading={net.isLoading}
        right={
          <button onClick={() => setCreating((v) => !v)} className={iconBtn}>
            <Plus size={12} />
            {t("integrations.lxd.networking.create", "Create")}
          </button>
        }
      />

      {creating && (
        <div className="mb-3 rounded border border-[var(--color-border)] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                {t("integrations.lxd.networking.fields.name", "Name")}
              </label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t(
                  "integrations.lxd.networking.fields.description",
                  "Description",
                )}
              </label>
              <input
                className={inputClass}
                value={form.description ?? ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={submit}
              disabled={net.isLoading || !form.name.trim()}
              className={primaryBtn}
            >
              {t("integrations.lxd.networking.create", "Create")}
            </button>
            <button onClick={() => setCreating(false)} className={iconBtn}>
              {t("integrations.lxd.networking.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.name", "Name")}
            </th>
            <th className={thClass}>
              {t(
                "integrations.lxd.networking.fields.description",
                "Description",
              )}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.rules", "Rules")}
            </th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {net.acls.length === 0 ? (
            <EmptyRow
              colSpan={4}
              text={t("integrations.lxd.networking.empty.acls", "No ACLs.")}
            />
          ) : (
            net.acls.map((a) => (
              <React.Fragment key={a.name}>
                <tr className="border-b border-[var(--color-border)]/50">
                  <td className={`${tdClass} font-medium`}>{a.name}</td>
                  <td className={tdClass}>{dash(a.description)}</td>
                  <td className={tdClass}>
                    {t("integrations.lxd.networking.acl.ingress", "in")}{" "}
                    {a.ingress?.length ?? 0} /{" "}
                    {t("integrations.lxd.networking.acl.egress", "out")}{" "}
                    {a.egress?.length ?? 0}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1">
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.edit",
                          "Edit",
                        )}
                        className={iconBtn}
                        onClick={async () => {
                          if (editing === a.name) {
                            setEditing(null);
                            return;
                          }
                          const full = await net.getAcl(a.name);
                          setEditing(a.name);
                          setBody(
                            JSON.stringify(
                              {
                                description: full?.description ?? a.description,
                                ingress: full?.ingress ?? a.ingress ?? [],
                                egress: full?.egress ?? a.egress ?? [],
                                config: full?.config ?? a.config ?? {},
                              },
                              null,
                              2,
                            ),
                          );
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.delete",
                          "Delete",
                        )}
                        className={iconBtn}
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                "integrations.lxd.networking.confirm.deleteAcl",
                                "Delete ACL {{name}}?",
                                { name: a.name },
                              ),
                            )
                          )
                            void net.deleteAcl(a.name);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === a.name && (
                  <tr>
                    <td colSpan={4} className="bg-[var(--color-surfaceHover)] p-3">
                      <label className={labelClass}>
                        {t(
                          "integrations.lxd.networking.acl.editBody",
                          "ACL body (JSON)",
                        )}
                      </label>
                      <textarea
                        className={`${inputClass} font-mono`}
                        rows={8}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                      />
                      {bodyErr && (
                        <p className="mt-1 text-xs text-red-500">{bodyErr}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => applyUpdate(a.name)}
                          disabled={net.isLoading}
                          className={primaryBtn}
                        >
                          {t("integrations.lxd.networking.save", "Save")}
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className={iconBtn}
                        >
                          <X size={12} />
                          {t("integrations.lxd.networking.cancel", "Cancel")}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

// ─── Forwards ───────────────────────────────────────────────────────────────────

const ForwardsSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [listen, setListen] = useState("");
  const [desc, setDesc] = useState("");
  const selected = net.selectedNetwork;

  const submit = useCallback(async () => {
    if (!selected || !listen.trim()) return;
    const req: CreateNetworkForwardRequest = {
      network: selected,
      listenAddress: listen.trim(),
      description: desc.trim() || undefined,
    };
    const ok = await net.createForward(req);
    if (ok) {
      setCreating(false);
      setListen("");
      setDesc("");
    }
  }, [selected, listen, desc, net]);

  return (
    <div>
      <SectionHeader
        title={t("integrations.lxd.networking.sections.forwards", "Forwards")}
        onRefresh={() => selected && net.refreshForwards(selected)}
        loading={net.isLoading}
        right={
          <>
            <NetworkPicker net={net} />
            <button
              onClick={() => setCreating((v) => !v)}
              disabled={!selected}
              className={iconBtn}
            >
              <Plus size={12} />
              {t("integrations.lxd.networking.create", "Create")}
            </button>
          </>
        }
      />

      {!selected ? (
        <p className="p-3 text-center text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.lxd.networking.pickNetwork",
            "Pick a network to view its forwards.",
          )}
        </p>
      ) : (
        <>
          {creating && (
            <div className="mb-3 rounded border border-[var(--color-border)] p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    {t(
                      "integrations.lxd.networking.fields.listenAddress",
                      "Listen address",
                    )}
                  </label>
                  <input
                    className={inputClass}
                    value={listen}
                    onChange={(e) => setListen(e.target.value)}
                    placeholder="192.0.2.1"
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    {t(
                      "integrations.lxd.networking.fields.description",
                      "Description",
                    )}
                  </label>
                  <input
                    className={inputClass}
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={submit}
                  disabled={net.isLoading || !listen.trim()}
                  className={primaryBtn}
                >
                  {t("integrations.lxd.networking.create", "Create")}
                </button>
                <button onClick={() => setCreating(false)} className={iconBtn}>
                  {t("integrations.lxd.networking.cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className={thClass}>
                  {t(
                    "integrations.lxd.networking.fields.listenAddress",
                    "Listen address",
                  )}
                </th>
                <th className={thClass}>
                  {t(
                    "integrations.lxd.networking.fields.description",
                    "Description",
                  )}
                </th>
                <th className={thClass}>
                  {t("integrations.lxd.networking.fields.ports", "Ports")}
                </th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {net.forwards.length === 0 ? (
                <EmptyRow
                  colSpan={4}
                  text={t(
                    "integrations.lxd.networking.empty.forwards",
                    "No forwards.",
                  )}
                />
              ) : (
                net.forwards.map((f) => (
                  <tr
                    key={f.listen_address ?? Math.random()}
                    className="border-b border-[var(--color-border)]/50"
                  >
                    <td className={`${tdClass} font-medium`}>
                      {dash(f.listen_address)}
                    </td>
                    <td className={tdClass}>{dash(f.description)}</td>
                    <td className={tdClass}>{f.ports?.length ?? 0}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      <button
                        title={t(
                          "integrations.lxd.networking.actions.delete",
                          "Delete",
                        )}
                        className={iconBtn}
                        onClick={() => {
                          const addr = f.listen_address;
                          if (!addr) return;
                          if (
                            window.confirm(
                              t(
                                "integrations.lxd.networking.confirm.deleteForward",
                                "Delete forward {{addr}}?",
                                { addr },
                              ),
                            )
                          )
                            void net.deleteForward(selected, addr);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

// ─── Zones ──────────────────────────────────────────────────────────────────────

const ZonesSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader
        title={t("integrations.lxd.networking.sections.zones", "Zones")}
        onRefresh={net.refreshZones}
        loading={net.isLoading}
      />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.name", "Name")}
            </th>
            <th className={thClass}>
              {t(
                "integrations.lxd.networking.fields.description",
                "Description",
              )}
            </th>
            <th className={thClass}>
              {t("integrations.lxd.networking.fields.usedBy", "Used by")}
            </th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {net.zones.length === 0 ? (
            <EmptyRow
              colSpan={4}
              text={t("integrations.lxd.networking.empty.zones", "No zones.")}
            />
          ) : (
            net.zones.map((z) => (
              <tr
                key={z.name}
                className="border-b border-[var(--color-border)]/50"
              >
                <td className={`${tdClass} font-medium`}>{z.name}</td>
                <td className={tdClass}>{dash(z.description)}</td>
                <td className={tdClass}>{z.used_by?.length ?? 0}</td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    title={t(
                      "integrations.lxd.networking.actions.delete",
                      "Delete",
                    )}
                    className={iconBtn}
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            "integrations.lxd.networking.confirm.deleteZone",
                            "Delete zone {{name}}?",
                            { name: z.name },
                          ),
                        )
                      )
                        void net.deleteZone(z.name);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

// ─── Load balancers ─────────────────────────────────────────────────────────────

const LoadBalancersSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  const selected = net.selectedNetwork;
  return (
    <div>
      <SectionHeader
        title={t(
          "integrations.lxd.networking.sections.loadBalancers",
          "Load balancers",
        )}
        onRefresh={() => selected && net.refreshLoadBalancers(selected)}
        loading={net.isLoading}
        right={<NetworkPicker net={net} />}
      />
      {!selected ? (
        <p className="p-3 text-center text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.lxd.networking.pickNetwork",
            "Pick a network to view its load balancers.",
          )}
        </p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className={thClass}>
                {t(
                  "integrations.lxd.networking.fields.listenAddress",
                  "Listen address",
                )}
              </th>
              <th className={thClass}>
                {t(
                  "integrations.lxd.networking.fields.description",
                  "Description",
                )}
              </th>
              <th className={thClass}>
                {t("integrations.lxd.networking.fields.backends", "Backends")}
              </th>
              <th className={thClass}>
                {t("integrations.lxd.networking.fields.ports", "Ports")}
              </th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {net.loadBalancers.length === 0 ? (
              <EmptyRow
                colSpan={5}
                text={t(
                  "integrations.lxd.networking.empty.loadBalancers",
                  "No load balancers.",
                )}
              />
            ) : (
              net.loadBalancers.map((lb) => (
                <tr
                  key={lb.listen_address ?? Math.random()}
                  className="border-b border-[var(--color-border)]/50"
                >
                  <td className={`${tdClass} font-medium`}>
                    {dash(lb.listen_address)}
                  </td>
                  <td className={tdClass}>{dash(lb.description)}</td>
                  <td className={tdClass}>{lb.backends?.length ?? 0}</td>
                  <td className={tdClass}>{lb.ports?.length ?? 0}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <button
                      title={t(
                        "integrations.lxd.networking.actions.delete",
                        "Delete",
                      )}
                      className={iconBtn}
                      onClick={() => {
                        const addr = lb.listen_address;
                        if (!addr) return;
                        if (
                          window.confirm(
                            t(
                              "integrations.lxd.networking.confirm.deleteLoadBalancer",
                              "Delete load balancer {{addr}}?",
                              { addr },
                            ),
                          )
                        )
                          void net.deleteLoadBalancer(selected, addr);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Peers ──────────────────────────────────────────────────────────────────────

const PeersSection: React.FC<{ net: Net }> = ({ net }) => {
  const { t } = useTranslation();
  const selected = net.selectedNetwork;
  return (
    <div>
      <SectionHeader
        title={t("integrations.lxd.networking.sections.peers", "Peers")}
        onRefresh={() => selected && net.refreshPeers(selected)}
        loading={net.isLoading}
        right={<NetworkPicker net={net} />}
      />
      {!selected ? (
        <p className="p-3 text-center text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.lxd.networking.pickNetwork",
            "Pick a network to view its peers.",
          )}
        </p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className={thClass}>
                {t("integrations.lxd.networking.fields.name", "Name")}
              </th>
              <th className={thClass}>
                {t(
                  "integrations.lxd.networking.fields.targetProject",
                  "Target project",
                )}
              </th>
              <th className={thClass}>
                {t(
                  "integrations.lxd.networking.fields.targetNetwork",
                  "Target network",
                )}
              </th>
              <th className={thClass}>
                {t("integrations.lxd.networking.fields.status", "Status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {net.peers.length === 0 ? (
              <EmptyRow
                colSpan={4}
                text={t(
                  "integrations.lxd.networking.empty.peers",
                  "No peers.",
                )}
              />
            ) : (
              net.peers.map((p) => (
                <tr
                  key={p.name ?? Math.random()}
                  className="border-b border-[var(--color-border)]/50"
                >
                  <td className={`${tdClass} font-medium`}>{dash(p.name)}</td>
                  <td className={tdClass}>{dash(p.target_project)}</td>
                  <td className={tdClass}>{dash(p.target_network)}</td>
                  <td className={tdClass}>{dash(p.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default LxdNetworkingTab;
