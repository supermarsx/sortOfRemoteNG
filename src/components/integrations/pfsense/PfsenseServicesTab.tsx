// PfsenseServicesTab — the "Services & System" category slice of the pfSense
// panel (t42-pfsense-c2). Binds all 46 commands of this category, grouped into
// eight sub-sections: DHCP, DNS, Services, System, Certificates, Users,
// Diagnostics, Backups. Mounted by the shell only when connected, so
// `connectionId` is always a live pfSense connection id.

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  HardDrive,
  Loader2,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Square,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PfsenseTabProps } from "./registry";
import { usePfsenseServices } from "../../../hooks/integration/pfsense/usePfsenseServices";
import type {
  BackupConfig,
  BackupEntry,
  CaCertificate,
  CertificateRequest,
  DhcpConfig,
  DhcpLease,
  DhcpRelay,
  DhcpStaticMapping,
  DnsCacheStats,
  DnsDomainOverride,
  DnsHostOverride,
  DnsLookupResult,
  DnsResolverConfig,
  GeneralConfig,
  ArpEntry,
  NdpEntry,
  PfsenseGroup,
  PfsenseService,
  PfsenseUser,
  PingResult,
  ServerCertificate,
  SystemInfo,
  SystemUpdate,
  TraceResult,
} from "../../../types/pfsense/services";

// ── shared presentational primitives ─────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtnCls =
  "flex items-center justify-center gap-2 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const dangerBtnCls =
  "flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-danger,#f87171)] hover:bg-[var(--color-dangerBg,#3a1a1a)] disabled:opacity-50";
const thCls =
  "px-2 py-1 text-left font-medium text-[var(--color-textSecondary)]";
const tdCls = "px-2 py-1 text-[var(--color-text)]";

const ErrorBar: React.FC<{ error: string | null; onDismiss: () => void }> = ({
  error,
  onDismiss,
}) =>
  error ? (
    <div className="mb-2 flex items-start justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]">
      <span className="flex items-center gap-1">
        <AlertTriangle size={13} /> {error}
      </span>
      <button onClick={onDismiss} className="opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  ) : null;

const SectionShell: React.FC<{
  title: string;
  loading: boolean;
  error: string | null;
  onDismiss: () => void;
  children: React.ReactNode;
}> = ({ title, loading, error, onDismiss, children }) => (
  <div className="flex flex-col gap-4 p-4">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {loading && (
        <Loader2 size={14} className="animate-spin text-primary" />
      )}
    </div>
    <ErrorBar error={error} onDismiss={onDismiss} />
    {children}
  </div>
);

/** A titled block within a section. */
const Block: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
      {title}
    </div>
    {children}
  </div>
);

function useT() {
  const { t } = useTranslation();
  return t;
}

// ── DHCP ─────────────────────────────────────────────────────────────────────

const emptyMapping = (iface: string): DhcpStaticMapping => ({
  id: "",
  mac: "",
  ipaddr: "",
  hostname: "",
  descr: "",
  arp_table_static_entry: false,
  gateway: "",
  domain: "",
  dns_servers: [],
  interface: iface,
});

const DhcpSection: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [iface, setIface] = useState("lan");
  const [config, setConfig] = useState<DhcpConfig | null>(null);
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [mappings, setMappings] = useState<DhcpStaticMapping[]>([]);
  const [relay, setRelay] = useState<DhcpRelay | null>(null);
  const [draft, setDraft] = useState<DhcpStaticMapping>(emptyMapping("lan"));
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    const c = await run(() => api.getDhcpConfig(connectionId, iface));
    if (c) setConfig(c);
  }, [api, connectionId, iface, run]);

  const loadLeases = useCallback(async () => {
    const l = await run(() => api.listDhcpLeases(connectionId));
    if (l) setLeases(l);
  }, [api, connectionId, run]);

  const loadMappings = useCallback(async () => {
    const m = await run(() => api.listDhcpStaticMappings(connectionId, iface));
    if (m) setMappings(m);
  }, [api, connectionId, iface, run]);

  const loadRelay = useCallback(async () => {
    const r = await run(() => api.getDhcpRelay(connectionId));
    if (r) setRelay(r);
  }, [api, connectionId, run]);

  const saveConfig = useCallback(async () => {
    if (!config) return;
    const c = await run(() =>
      api.updateDhcpConfig(connectionId, iface, config),
    );
    if (c) setConfig(c);
  }, [api, config, connectionId, iface, run]);

  const submitMapping = useCallback(async () => {
    const payload = { ...draft, interface: iface };
    const ok = editingId
      ? await run(() =>
          api.updateDhcpStaticMapping(
            connectionId,
            iface,
            editingId,
            payload,
          ),
        )
      : await run(() =>
          api.createDhcpStaticMapping(connectionId, iface, payload),
        );
    if (ok !== undefined) {
      setDraft(emptyMapping(iface));
      setEditingId(null);
      loadMappings();
    }
  }, [api, connectionId, draft, editingId, iface, loadMappings, run]);

  const removeMapping = useCallback(
    async (m: DhcpStaticMapping) => {
      const ok = await run(() =>
        api.deleteDhcpStaticMapping(connectionId, iface, m.id),
      );
      if (ok !== undefined) loadMappings();
    },
    [api, connectionId, iface, loadMappings, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.dhcp.title", "DHCP")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.pfsense.services.dhcp.interface", "Interface")}
          <input
            className={inputCls}
            value={iface}
            onChange={(e) => setIface(e.target.value)}
            placeholder="lan"
          />
        </label>
        <button className={btnCls} onClick={loadConfig}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.dhcp.loadConfig", "Load config")}
        </button>
        <button className={btnCls} onClick={loadMappings}>
          {t("integrations.pfsense.services.dhcp.loadMappings", "Mappings")}
        </button>
      </div>

      {config && (
        <Block
          title={t(
            "integrations.pfsense.services.dhcp.config",
            "Scope configuration",
          )}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) =>
                  setConfig({ ...config, enabled: e.target.checked })
                }
              />
              {t("integrations.pfsense.services.dhcp.enabled", "Enabled")}
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.dhcp.rangeFrom", "Range from")}
              <input
                className={inputCls}
                value={config.range_from}
                onChange={(e) =>
                  setConfig({ ...config, range_from: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.dhcp.rangeTo", "Range to")}
              <input
                className={inputCls}
                value={config.range_to}
                onChange={(e) =>
                  setConfig({ ...config, range_to: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.dhcp.domain", "Domain")}
              <input
                className={inputCls}
                value={config.domain}
                onChange={(e) =>
                  setConfig({ ...config, domain: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.dhcp.gateway", "Gateway")}
              <input
                className={inputCls}
                value={config.gateway}
                onChange={(e) =>
                  setConfig({ ...config, gateway: e.target.value })
                }
              />
            </label>
          </div>
          <button className={primaryBtnCls} onClick={saveConfig}>
            {t("integrations.pfsense.services.common.save", "Save")}
          </button>
        </Block>
      )}

      <Block
        title={t(
          "integrations.pfsense.services.dhcp.mappings",
          "Static mappings",
        )}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder="MAC"
            value={draft.mac}
            onChange={(e) => setDraft({ ...draft, mac: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="IP"
            value={draft.ipaddr}
            onChange={(e) => setDraft({ ...draft, ipaddr: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.pfsense.services.dhcp.hostname",
              "Hostname",
            )}
            value={draft.hostname}
            onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.pfsense.services.common.description",
              "Description",
            )}
            value={draft.descr}
            onChange={(e) => setDraft({ ...draft, descr: e.target.value })}
          />
          <button className={primaryBtnCls} onClick={submitMapping}>
            {editingId
              ? t("integrations.pfsense.services.common.update", "Update")
              : t("integrations.pfsense.services.common.add", "Add")}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>MAC</th>
              <th className={thCls}>IP</th>
              <th className={thCls}>
                {t("integrations.pfsense.services.dhcp.hostname", "Hostname")}
              </th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id || m.mac} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{m.mac}</td>
                <td className={tdCls}>{m.ipaddr}</td>
                <td className={tdCls}>{m.hostname}</td>
                <td className={`${tdCls} flex gap-1`}>
                  <button
                    className={btnCls}
                    onClick={() => {
                      setDraft(m);
                      setEditingId(m.id);
                    }}
                  >
                    {t("integrations.pfsense.services.common.edit", "Edit")}
                  </button>
                  <button
                    className={dangerBtnCls}
                    onClick={() => removeMapping(m)}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <div className="flex gap-2">
        <button className={btnCls} onClick={loadLeases}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.dhcp.loadLeases", "Load leases")}
        </button>
        <button className={btnCls} onClick={loadRelay}>
          {t("integrations.pfsense.services.dhcp.loadRelay", "DHCP relay")}
        </button>
      </div>

      {leases.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>IP</th>
              <th className={thCls}>MAC</th>
              <th className={thCls}>
                {t("integrations.pfsense.services.dhcp.hostname", "Hostname")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.common.status", "Status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {leases.map((l, i) => (
              <tr key={`${l.ip}-${i}`} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{l.ip}</td>
                <td className={tdCls}>{l.mac}</td>
                <td className={tdCls}>{l.hostname}</td>
                <td className={tdCls}>
                  {l.online
                    ? t("integrations.pfsense.services.dhcp.online", "online")
                    : l.state}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {relay && (
        <Block
          title={t("integrations.pfsense.services.dhcp.loadRelay", "DHCP relay")}
        >
          <div className="text-xs text-[var(--color-text)]">
            {relay.enabled
              ? t("integrations.pfsense.services.dhcp.enabled", "Enabled")
              : t("integrations.pfsense.services.dhcp.disabled", "Disabled")}
            {relay.server.length > 0 && ` — ${relay.server.join(", ")}`}
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ── DNS ──────────────────────────────────────────────────────────────────────

const emptyHostOverride = (): DnsHostOverride => ({
  id: "",
  host: "",
  domain: "",
  ip: "",
  descr: "",
  aliases: [],
});

const DnsSection: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [resolver, setResolver] = useState<DnsResolverConfig | null>(null);
  const [hosts, setHosts] = useState<DnsHostOverride[]>([]);
  const [domains, setDomains] = useState<DnsDomainOverride[]>([]);
  const [stats, setStats] = useState<DnsCacheStats | null>(null);
  const [draft, setDraft] = useState<DnsHostOverride>(emptyHostOverride());

  const loadResolver = useCallback(async () => {
    const r = await run(() => api.getDnsResolverConfig(connectionId));
    if (r) setResolver(r);
  }, [api, connectionId, run]);

  const saveResolver = useCallback(async () => {
    if (!resolver) return;
    const r = await run(() =>
      api.updateDnsResolverConfig(connectionId, resolver),
    );
    if (r) setResolver(r);
  }, [api, connectionId, resolver, run]);

  const loadHosts = useCallback(async () => {
    const h = await run(() => api.listDnsHostOverrides(connectionId));
    if (h) setHosts(h);
  }, [api, connectionId, run]);

  const loadDomains = useCallback(async () => {
    const d = await run(() => api.listDnsDomainOverrides(connectionId));
    if (d) setDomains(d);
  }, [api, connectionId, run]);

  const loadStats = useCallback(async () => {
    const s = await run(() => api.getDnsCacheStats(connectionId));
    if (s) setStats(s);
  }, [api, connectionId, run]);

  const flush = useCallback(async () => {
    await run(() => api.flushDnsCache(connectionId));
  }, [api, connectionId, run]);

  const addHost = useCallback(async () => {
    const ok = await run(() =>
      api.createDnsHostOverride(connectionId, draft),
    );
    if (ok !== undefined) {
      setDraft(emptyHostOverride());
      loadHosts();
    }
  }, [api, connectionId, draft, loadHosts, run]);

  const removeHost = useCallback(
    async (h: DnsHostOverride) => {
      const ok = await run(() =>
        api.deleteDnsHostOverride(connectionId, h.id),
      );
      if (ok !== undefined) loadHosts();
    },
    [api, connectionId, loadHosts, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.dns.title", "DNS Resolver")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap gap-2">
        <button className={btnCls} onClick={loadResolver}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.dns.loadResolver", "Resolver config")}
        </button>
        <button className={btnCls} onClick={loadHosts}>
          {t("integrations.pfsense.services.dns.hostOverrides", "Host overrides")}
        </button>
        <button className={btnCls} onClick={loadDomains}>
          {t(
            "integrations.pfsense.services.dns.domainOverrides",
            "Domain overrides",
          )}
        </button>
        <button className={btnCls} onClick={loadStats}>
          {t("integrations.pfsense.services.dns.cacheStats", "Cache stats")}
        </button>
        <button className={btnCls} onClick={flush}>
          {t("integrations.pfsense.services.dns.flush", "Flush cache")}
        </button>
      </div>

      {resolver && (
        <Block
          title={t(
            "integrations.pfsense.services.dns.loadResolver",
            "Resolver config",
          )}
        >
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={resolver.enabled}
                onChange={(e) =>
                  setResolver({ ...resolver, enabled: e.target.checked })
                }
              />
              {t("integrations.pfsense.services.dhcp.enabled", "Enabled")}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={resolver.dnssec}
                onChange={(e) =>
                  setResolver({ ...resolver, dnssec: e.target.checked })
                }
              />
              DNSSEC
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={resolver.forwarding}
                onChange={(e) =>
                  setResolver({ ...resolver, forwarding: e.target.checked })
                }
              />
              {t("integrations.pfsense.services.dns.forwarding", "Forwarding")}
            </label>
          </div>
          <button className={primaryBtnCls} onClick={saveResolver}>
            {t("integrations.pfsense.services.common.save", "Save")}
          </button>
        </Block>
      )}

      <Block
        title={t(
          "integrations.pfsense.services.dns.hostOverrides",
          "Host overrides",
        )}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.dns.host", "Host")}
            value={draft.host}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.dhcp.domain", "Domain")}
            value={draft.domain}
            onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="IP"
            value={draft.ip}
            onChange={(e) => setDraft({ ...draft, ip: e.target.value })}
          />
          <button className={primaryBtnCls} onClick={addHost}>
            {t("integrations.pfsense.services.common.add", "Add")}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>
                {t("integrations.pfsense.services.dns.host", "Host")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.dhcp.domain", "Domain")}
              </th>
              <th className={thCls}>IP</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.id || `${h.host}.${h.domain}`} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{h.host}</td>
                <td className={tdCls}>{h.domain}</td>
                <td className={tdCls}>{h.ip}</td>
                <td className={tdCls}>
                  <button className={dangerBtnCls} onClick={() => removeHost(h)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      {domains.length > 0 && (
        <Block
          title={t(
            "integrations.pfsense.services.dns.domainOverrides",
            "Domain overrides",
          )}
        >
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>
                  {t("integrations.pfsense.services.dhcp.domain", "Domain")}
                </th>
                <th className={thCls}>IP</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id || d.domain} className="border-t border-[var(--color-border)]">
                  <td className={tdCls}>{d.domain}</td>
                  <td className={tdCls}>{d.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {stats && (
        <Block
          title={t("integrations.pfsense.services.dns.cacheStats", "Cache stats")}
        >
          <div className="text-xs text-[var(--color-text)]">
            {t("integrations.pfsense.services.dns.totalEntries", "Total entries")}:{" "}
            {stats.total_entries} · RRset {stats.rrset_count} · msg{" "}
            {stats.msg_count}
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ── Services ─────────────────────────────────────────────────────────────────

const ServicesSection: React.FC<{ connectionId: string }> = ({
  connectionId,
}) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [services, setServices] = useState<PfsenseService[]>([]);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await run(() => api.listServices(connectionId));
    if (s) setServices(s);
  }, [api, connectionId, run]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (name: string, action: "start" | "stop" | "restart") => {
      const fn =
        action === "start"
          ? () => api.startService(connectionId, name)
          : action === "stop"
            ? () => api.stopService(connectionId, name)
            : () => api.restartService(connectionId, name);
      const ok = await run(fn);
      if (ok !== undefined) load();
    },
    [api, connectionId, load, run],
  );

  const showStatus = useCallback(
    async (name: string) => {
      const s = await run(() => api.getServiceStatus(connectionId, name));
      if (s)
        setStatusLine(
          `${s.name}: ${s.running ? "running" : "stopped"}${s.pid ? ` (pid ${s.pid})` : ""}`,
        );
    },
    [api, connectionId, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.services.title", "Services")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <button className={btnCls} onClick={load}>
        <RefreshCw size={13} />
        {t("integrations.pfsense.services.common.refresh", "Refresh")}
      </button>
      {statusLine && (
        <div className="text-xs text-[var(--color-textSecondary)]">
          {statusLine}
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t("integrations.pfsense.services.common.name", "Name")}
            </th>
            <th className={thCls}>
              {t("integrations.pfsense.services.common.description", "Description")}
            </th>
            <th className={thCls}>
              {t("integrations.pfsense.services.common.status", "Status")}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.name} className="border-t border-[var(--color-border)]">
              <td className={tdCls}>{s.name}</td>
              <td className={tdCls}>{s.descr}</td>
              <td className={tdCls}>
                <span
                  className={
                    s.status
                      ? "text-[var(--color-success,#4ade80)]"
                      : "text-[var(--color-textSecondary)]"
                  }
                >
                  {s.status
                    ? t("integrations.pfsense.services.services.running", "running")
                    : t("integrations.pfsense.services.services.stopped", "stopped")}
                </span>
              </td>
              <td className={`${tdCls} flex gap-1`}>
                <button
                  className={btnCls}
                  title={t("integrations.pfsense.services.services.start", "Start")}
                  onClick={() => act(s.name, "start")}
                >
                  <Play size={12} />
                </button>
                <button
                  className={btnCls}
                  title={t("integrations.pfsense.services.services.stop", "Stop")}
                  onClick={() => act(s.name, "stop")}
                >
                  <Square size={12} />
                </button>
                <button
                  className={btnCls}
                  title={t(
                    "integrations.pfsense.services.services.restart",
                    "Restart",
                  )}
                  onClick={() => act(s.name, "restart")}
                >
                  <RotateCw size={12} />
                </button>
                <button className={btnCls} onClick={() => showStatus(s.name)}>
                  {t("integrations.pfsense.services.common.status", "Status")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionShell>
  );
};

// ── System ───────────────────────────────────────────────────────────────────

const SystemSection: React.FC<{ connectionId: string }> = ({
  connectionId,
}) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [updates, setUpdates] = useState<SystemUpdate | null>(null);
  const [general, setGeneral] = useState<GeneralConfig | null>(null);

  const loadInfo = useCallback(async () => {
    const i = await run(() => api.getSystemInfo(connectionId));
    if (i) setInfo(i);
  }, [api, connectionId, run]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const loadUpdates = useCallback(async () => {
    const u = await run(() => api.getSystemUpdates(connectionId));
    if (u) setUpdates(u);
  }, [api, connectionId, run]);

  const loadGeneral = useCallback(async () => {
    const g = await run(() => api.getGeneralConfig(connectionId));
    if (g) setGeneral(g);
  }, [api, connectionId, run]);

  const saveGeneral = useCallback(async () => {
    if (!general) return;
    const g = await run(() => api.updateGeneralConfig(connectionId, general));
    if (g) setGeneral(g);
  }, [api, connectionId, general, run]);

  const doReboot = useCallback(async () => {
    if (!window.confirm(t("integrations.pfsense.services.system.confirmReboot", "Reboot the firewall now?")))
      return;
    await run(() => api.reboot(connectionId));
  }, [api, connectionId, run, t]);

  const doHalt = useCallback(async () => {
    if (!window.confirm(t("integrations.pfsense.services.system.confirmHalt", "Halt (power off) the firewall now?")))
      return;
    await run(() => api.halt(connectionId));
  }, [api, connectionId, run, t]);

  return (
    <SectionShell
      title={t("integrations.pfsense.services.system.title", "System")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap gap-2">
        <button className={btnCls} onClick={loadInfo}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.system.info", "System info")}
        </button>
        <button className={btnCls} onClick={loadUpdates}>
          {t("integrations.pfsense.services.system.updates", "Updates")}
        </button>
        <button className={btnCls} onClick={loadGeneral}>
          {t("integrations.pfsense.services.system.general", "General config")}
        </button>
        <button className={dangerBtnCls} onClick={doReboot}>
          <ShieldAlert size={13} />
          {t("integrations.pfsense.services.system.reboot", "Reboot")}
        </button>
        <button className={dangerBtnCls} onClick={doHalt}>
          <ShieldAlert size={13} />
          {t("integrations.pfsense.services.system.halt", "Halt")}
        </button>
      </div>

      {info && (
        <Block
          title={t("integrations.pfsense.services.system.info", "System info")}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--color-text)] md:grid-cols-3">
            <div>{t("integrations.pfsense.services.system.hostname", "Hostname")}: {info.hostname}</div>
            <div>{t("integrations.pfsense.services.system.version", "Version")}: {info.version}</div>
            <div>{t("integrations.pfsense.services.system.uptime", "Uptime")}: {info.uptime}</div>
            <div>CPU: {info.cpu_count} × {info.cpu_usage}</div>
            <div>{t("integrations.pfsense.services.system.memory", "Memory")}: {info.mem_used}/{info.mem_total}</div>
            <div>{t("integrations.pfsense.services.system.load", "Load")}: {info.load_avg.join(" ")}</div>
          </div>
        </Block>
      )}

      {updates && (
        <Block
          title={t("integrations.pfsense.services.system.updates", "Updates")}
        >
          <div className="text-xs text-[var(--color-text)]">
            {updates.update_available
              ? t(
                  "integrations.pfsense.services.system.updateAvailable",
                  "Update available",
                )
              : t(
                  "integrations.pfsense.services.system.upToDate",
                  "Up to date",
                )}{" "}
            — {updates.installed_version} → {updates.latest_version || updates.version}
          </div>
        </Block>
      )}

      {general && (
        <Block
          title={t("integrations.pfsense.services.system.general", "General config")}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.system.hostname", "Hostname")}
              <input
                className={inputCls}
                value={general.hostname}
                onChange={(e) =>
                  setGeneral({ ...general, hostname: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.dhcp.domain", "Domain")}
              <input
                className={inputCls}
                value={general.domain}
                onChange={(e) =>
                  setGeneral({ ...general, domain: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.pfsense.services.system.timezone", "Timezone")}
              <input
                className={inputCls}
                value={general.timezone}
                onChange={(e) =>
                  setGeneral({ ...general, timezone: e.target.value })
                }
              />
            </label>
          </div>
          <button className={primaryBtnCls} onClick={saveGeneral}>
            {t("integrations.pfsense.services.common.save", "Save")}
          </button>
        </Block>
      )}
    </SectionShell>
  );
};

// ── Certificates ─────────────────────────────────────────────────────────────

const emptyCertRequest = (): CertificateRequest => ({
  descr: "",
  key_length: 2048,
  digest_alg: "sha256",
  lifetime: 3650,
  country: "",
  state: "",
  city: "",
  organization: "",
  organizational_unit: "",
  common_name: "",
  alt_names: [],
  type: "server",
  ca_ref: "",
});

const CertificatesSection: React.FC<{ connectionId: string }> = ({
  connectionId,
}) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [cas, setCas] = useState<CaCertificate[]>([]);
  const [certs, setCerts] = useState<ServerCertificate[]>([]);
  const [draft, setDraft] = useState<CertificateRequest>(emptyCertRequest());

  const loadCas = useCallback(async () => {
    const c = await run(() => api.listCas(connectionId));
    if (c) setCas(c);
  }, [api, connectionId, run]);

  const loadCerts = useCallback(async () => {
    const c = await run(() => api.listCerts(connectionId));
    if (c) setCerts(c);
  }, [api, connectionId, run]);

  useEffect(() => {
    loadCas();
    loadCerts();
  }, [loadCas, loadCerts]);

  const create = useCallback(async () => {
    const c = await run(() => api.createCert(connectionId, draft));
    if (c) {
      setDraft(emptyCertRequest());
      loadCerts();
    }
  }, [api, connectionId, draft, loadCerts, run]);

  const remove = useCallback(
    async (c: ServerCertificate) => {
      const ok = await run(() => api.deleteCert(connectionId, c.refid));
      if (ok !== undefined) loadCerts();
    },
    [api, connectionId, loadCerts, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.certs.title", "Certificates")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex gap-2">
        <button className={btnCls} onClick={loadCas}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.certs.cas", "Certificate authorities")}
        </button>
        <button className={btnCls} onClick={loadCerts}>
          {t("integrations.pfsense.services.certs.certs", "Certificates")}
        </button>
      </div>

      <Block
        title={t("integrations.pfsense.services.certs.cas", "Certificate authorities")}
      >
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>
                {t("integrations.pfsense.services.common.description", "Description")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.certs.issuer", "Issuer")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.certs.validTo", "Valid to")}
              </th>
            </tr>
          </thead>
          <tbody>
            {cas.map((c) => (
              <tr key={c.refid || c.descr} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{c.descr}</td>
                <td className={tdCls}>{c.issuer}</td>
                <td className={tdCls}>{c.valid_to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <Block
        title={t("integrations.pfsense.services.certs.certs", "Certificates")}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t(
              "integrations.pfsense.services.common.description",
              "Description",
            )}
            value={draft.descr}
            onChange={(e) => setDraft({ ...draft, descr: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.pfsense.services.certs.commonName",
              "Common name",
            )}
            value={draft.common_name}
            onChange={(e) =>
              setDraft({ ...draft, common_name: e.target.value })
            }
          />
          <button className={primaryBtnCls} onClick={create}>
            {t("integrations.pfsense.services.certs.create", "Create")}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>
                {t("integrations.pfsense.services.common.description", "Description")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.certs.validTo", "Valid to")}
              </th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {certs.map((c) => (
              <tr key={c.refid || c.descr} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{c.descr}</td>
                <td className={tdCls}>{c.valid_to}</td>
                <td className={tdCls}>
                  <button className={dangerBtnCls} onClick={() => remove(c)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
    </SectionShell>
  );
};

// ── Users ────────────────────────────────────────────────────────────────────

const emptyUser = (): PfsenseUser => ({
  uid: 0,
  name: "",
  full_name: "",
  email: "",
  comment: "",
  disabled: false,
  scope: "user",
  groups: [],
  cert_refs: [],
  authorizedkeys: "",
  ipsecpsk: "",
  expires: "",
  dashboard_columns: 2,
  webguicss: "",
});

const UsersSection: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [users, setUsers] = useState<PfsenseUser[]>([]);
  const [groups, setGroups] = useState<PfsenseGroup[]>([]);
  const [draft, setDraft] = useState<PfsenseUser>(emptyUser());
  const [detail, setDetail] = useState<PfsenseUser | null>(null);

  const loadUsers = useCallback(async () => {
    const u = await run(() => api.listUsers(connectionId));
    if (u) setUsers(u);
  }, [api, connectionId, run]);

  const loadGroups = useCallback(async () => {
    const g = await run(() => api.listGroups(connectionId));
    if (g) setGroups(g);
  }, [api, connectionId, run]);

  useEffect(() => {
    loadUsers();
    loadGroups();
  }, [loadUsers, loadGroups]);

  const create = useCallback(async () => {
    const u = await run(() => api.createUser(connectionId, draft));
    if (u) {
      setDraft(emptyUser());
      loadUsers();
    }
  }, [api, connectionId, draft, loadUsers, run]);

  const remove = useCallback(
    async (u: PfsenseUser) => {
      const ok = await run(() => api.deleteUser(connectionId, u.name));
      if (ok !== undefined) loadUsers();
    },
    [api, connectionId, loadUsers, run],
  );

  const view = useCallback(
    async (name: string) => {
      const u = await run(() => api.getUser(connectionId, name));
      if (u) setDetail(u);
    },
    [api, connectionId, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.users.title", "Users & Groups")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex gap-2">
        <button className={btnCls} onClick={loadUsers}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.users.users", "Users")}
        </button>
        <button className={btnCls} onClick={loadGroups}>
          {t("integrations.pfsense.services.users.groups", "Groups")}
        </button>
      </div>

      {detail && (
        <div className="rounded border border-[var(--color-border)] p-2 text-xs text-[var(--color-text)]">
          {detail.name} · {detail.full_name} · {detail.email} ·{" "}
          {detail.groups.join(", ")}
        </div>
      )}

      <Block title={t("integrations.pfsense.services.users.users", "Users")}>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.common.name", "Name")}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.pfsense.services.users.fullName",
              "Full name",
            )}
            value={draft.full_name}
            onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.users.email", "Email")}
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
          <button className={primaryBtnCls} onClick={create}>
            {t("integrations.pfsense.services.common.add", "Add")}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>
                {t("integrations.pfsense.services.common.name", "Name")}
              </th>
              <th className={thCls}>
                {t("integrations.pfsense.services.users.fullName", "Full name")}
              </th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.name} className="border-t border-[var(--color-border)]">
                <td className={tdCls}>{u.name}</td>
                <td className={tdCls}>{u.full_name}</td>
                <td className={`${tdCls} flex gap-1`}>
                  <button className={btnCls} onClick={() => view(u.name)}>
                    {t("integrations.pfsense.services.common.view", "View")}
                  </button>
                  <button className={dangerBtnCls} onClick={() => remove(u)}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      {groups.length > 0 && (
        <Block title={t("integrations.pfsense.services.users.groups", "Groups")}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>
                  {t("integrations.pfsense.services.common.name", "Name")}
                </th>
                <th className={thCls}>
                  {t("integrations.pfsense.services.users.members", "Members")}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className="border-t border-[var(--color-border)]">
                  <td className={tdCls}>{g.name}</td>
                  <td className={tdCls}>{g.members.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
    </SectionShell>
  );
};

// ── Diagnostics ──────────────────────────────────────────────────────────────

const DiagnosticsSection: React.FC<{ connectionId: string }> = ({
  connectionId,
}) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [arp, setArp] = useState<ArpEntry[]>([]);
  const [ndp, setNdp] = useState<NdpEntry[]>([]);
  const [lookupHost, setLookupHost] = useState("");
  const [lookup, setLookup] = useState<DnsLookupResult | null>(null);
  const [pingHost, setPingHost] = useState("");
  const [ping, setPing] = useState<PingResult | null>(null);
  const [traceHost, setTraceHost] = useState("");
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [logName, setLogName] = useState("system");
  const [log, setLog] = useState<string[]>([]);
  const [pfinfo, setPfinfo] = useState<string | null>(null);

  const loadArp = useCallback(async () => {
    const a = await run(() => api.getArpTable(connectionId));
    if (a) setArp(a);
  }, [api, connectionId, run]);

  const loadNdp = useCallback(async () => {
    const n = await run(() => api.getNdpTable(connectionId));
    if (n) setNdp(n);
  }, [api, connectionId, run]);

  const doLookup = useCallback(async () => {
    const r = await run(() => api.dnsLookup(connectionId, lookupHost));
    if (r) setLookup(r);
  }, [api, connectionId, lookupHost, run]);

  const doPing = useCallback(async () => {
    const r = await run(() => api.diagPing(connectionId, pingHost, 3));
    if (r) setPing(r);
  }, [api, connectionId, pingHost, run]);

  const doTrace = useCallback(async () => {
    const r = await run(() => api.traceroute(connectionId, traceHost));
    if (r) setTrace(r);
  }, [api, connectionId, traceHost, run]);

  const loadLog = useCallback(async () => {
    const l = await run(() => api.getSystemLog(connectionId, logName, 50));
    if (l) setLog(l);
  }, [api, connectionId, logName, run]);

  const loadPfinfo = useCallback(async () => {
    const p = await run(() => api.getPfinfo(connectionId));
    if (p !== undefined) setPfinfo(JSON.stringify(p, null, 2));
  }, [api, connectionId, run]);

  return (
    <SectionShell
      title={t("integrations.pfsense.services.diag.title", "Diagnostics")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap gap-2">
        <button className={btnCls} onClick={loadArp}>
          {t("integrations.pfsense.services.diag.arp", "ARP table")}
        </button>
        <button className={btnCls} onClick={loadNdp}>
          {t("integrations.pfsense.services.diag.ndp", "NDP table")}
        </button>
        <button className={btnCls} onClick={loadPfinfo}>
          {t("integrations.pfsense.services.diag.pfinfo", "pfInfo")}
        </button>
      </div>

      <Block title={t("integrations.pfsense.services.diag.lookup", "DNS lookup")}>
        <div className="flex items-end gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.dns.host", "Host")}
            value={lookupHost}
            onChange={(e) => setLookupHost(e.target.value)}
          />
          <button className={primaryBtnCls} onClick={doLookup}>
            {t("integrations.pfsense.services.diag.run", "Run")}
          </button>
        </div>
        {lookup && (
          <div className="text-xs text-[var(--color-text)]">
            {lookup.query} ({lookup.type}) →{" "}
            {lookup.results.map((r) => r.value).join(", ")}
          </div>
        )}
      </Block>

      <Block title={t("integrations.pfsense.services.diag.ping", "Ping")}>
        <div className="flex items-end gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.dns.host", "Host")}
            value={pingHost}
            onChange={(e) => setPingHost(e.target.value)}
          />
          <button className={primaryBtnCls} onClick={doPing}>
            {t("integrations.pfsense.services.diag.run", "Run")}
          </button>
        </div>
        {ping && (
          <div className="text-xs text-[var(--color-text)]">
            {ping.received}/{ping.transmitted} · avg {ping.avg_rtt}ms · loss{" "}
            {ping.loss_pct}%
          </div>
        )}
      </Block>

      <Block title={t("integrations.pfsense.services.diag.traceroute", "Traceroute")}>
        <div className="flex items-end gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.pfsense.services.dns.host", "Host")}
            value={traceHost}
            onChange={(e) => setTraceHost(e.target.value)}
          />
          <button className={primaryBtnCls} onClick={doTrace}>
            {t("integrations.pfsense.services.diag.run", "Run")}
          </button>
        </div>
        {trace && (
          <div className="text-xs text-[var(--color-text)]">
            {trace.hops.length}{" "}
            {t("integrations.pfsense.services.diag.hops", "hops")}
          </div>
        )}
      </Block>

      <Block title={t("integrations.pfsense.services.diag.log", "System log")}>
        <div className="flex items-end gap-2">
          <input
            className={inputCls}
            value={logName}
            onChange={(e) => setLogName(e.target.value)}
            placeholder="system"
          />
          <button className={primaryBtnCls} onClick={loadLog}>
            {t("integrations.pfsense.services.diag.run", "Run")}
          </button>
        </div>
        {log.length > 0 && (
          <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-[11px] text-[var(--color-text)]">
            {log.join("\n")}
          </pre>
        )}
      </Block>

      {arp.length > 0 && (
        <Block title={t("integrations.pfsense.services.diag.arp", "ARP table")}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>IP</th>
                <th className={thCls}>MAC</th>
                <th className={thCls}>
                  {t("integrations.pfsense.services.diag.iface", "Interface")}
                </th>
              </tr>
            </thead>
            <tbody>
              {arp.map((a, i) => (
                <tr key={`${a.ip}-${i}`} className="border-t border-[var(--color-border)]">
                  <td className={tdCls}>{a.ip}</td>
                  <td className={tdCls}>{a.mac}</td>
                  <td className={tdCls}>{a.interface}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {ndp.length > 0 && (
        <Block title={t("integrations.pfsense.services.diag.ndp", "NDP table")}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>IPv6</th>
                <th className={thCls}>MAC</th>
              </tr>
            </thead>
            <tbody>
              {ndp.map((n, i) => (
                <tr key={`${n.ipv6}-${i}`} className="border-t border-[var(--color-border)]">
                  <td className={tdCls}>{n.ipv6}</td>
                  <td className={tdCls}>{n.mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {pfinfo && (
        <Block title={t("integrations.pfsense.services.diag.pfinfo", "pfInfo")}>
          <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-[11px] text-[var(--color-text)]">
            {pfinfo}
          </pre>
        </Block>
      )}
    </SectionShell>
  );
};

// ── Backups ──────────────────────────────────────────────────────────────────

const emptyBackupConfig = (): BackupConfig => ({
  area: "",
  no_rrd: false,
  no_packages: false,
  encrypt: false,
  encrypt_password: "",
  skip_captive_portal: false,
});

const BackupsSection: React.FC<{ connectionId: string }> = ({
  connectionId,
}) => {
  const t = useT();
  const { api, loading, error, clearError, run } = usePfsenseServices();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [draft, setDraft] = useState<BackupConfig>(emptyBackupConfig());

  const load = useCallback(async () => {
    const b = await run(() => api.listBackups(connectionId));
    if (b) setBackups(b);
  }, [api, connectionId, run]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    const b = await run(() => api.createBackup(connectionId, draft));
    if (b) {
      setDraft(emptyBackupConfig());
      load();
    }
  }, [api, connectionId, draft, load, run]);

  const remove = useCallback(
    async (b: BackupEntry) => {
      const ok = await run(() => api.deleteBackup(connectionId, b.id));
      if (ok !== undefined) load();
    },
    [api, connectionId, load, run],
  );

  return (
    <SectionShell
      title={t("integrations.pfsense.services.backups.title", "Backups")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnCls} onClick={load}>
          <RefreshCw size={13} />
          {t("integrations.pfsense.services.common.refresh", "Refresh")}
        </button>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={draft.encrypt}
            onChange={(e) => setDraft({ ...draft, encrypt: e.target.checked })}
          />
          {t("integrations.pfsense.services.backups.encrypt", "Encrypt")}
        </label>
        {draft.encrypt && (
          <input
            className={inputCls}
            type="password"
            placeholder={t(
              "integrations.pfsense.services.backups.password",
              "Password",
            )}
            value={draft.encrypt_password}
            onChange={(e) =>
              setDraft({ ...draft, encrypt_password: e.target.value })
            }
          />
        )}
        <button className={primaryBtnCls} onClick={create}>
          {t("integrations.pfsense.services.backups.create", "Create backup")}
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t("integrations.pfsense.services.backups.filename", "Filename")}
            </th>
            <th className={thCls}>
              {t("integrations.pfsense.services.backups.timestamp", "Timestamp")}
            </th>
            <th className={thCls}>
              {t("integrations.pfsense.services.system.version", "Version")}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.id || b.filename} className="border-t border-[var(--color-border)]">
              <td className={tdCls}>{b.filename}</td>
              <td className={tdCls}>{b.timestamp}</td>
              <td className={tdCls}>{b.version}</td>
              <td className={tdCls}>
                <button className={dangerBtnCls} onClick={() => remove(b)}>
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionShell>
  );
};

// ── Tab shell ────────────────────────────────────────────────────────────────

type SectionKey =
  | "dhcp"
  | "dns"
  | "services"
  | "system"
  | "certs"
  | "users"
  | "diagnostics"
  | "backups";

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  fallback: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  Component: React.FC<{ connectionId: string }>;
}[] = [
  {
    key: "dhcp",
    labelKey: "integrations.pfsense.services.dhcp.title",
    fallback: "DHCP",
    icon: Network,
    Component: DhcpSection,
  },
  {
    key: "dns",
    labelKey: "integrations.pfsense.services.dns.title",
    fallback: "DNS Resolver",
    icon: Network,
    Component: DnsSection,
  },
  {
    key: "services",
    labelKey: "integrations.pfsense.services.services.title",
    fallback: "Services",
    icon: RotateCw,
    Component: ServicesSection,
  },
  {
    key: "system",
    labelKey: "integrations.pfsense.services.system.title",
    fallback: "System",
    icon: HardDrive,
    Component: SystemSection,
  },
  {
    key: "certs",
    labelKey: "integrations.pfsense.services.certs.title",
    fallback: "Certificates",
    icon: ShieldAlert,
    Component: CertificatesSection,
  },
  {
    key: "users",
    labelKey: "integrations.pfsense.services.users.title",
    fallback: "Users & Groups",
    icon: UsersIcon,
    Component: UsersSection,
  },
  {
    key: "diagnostics",
    labelKey: "integrations.pfsense.services.diag.title",
    fallback: "Diagnostics",
    icon: Network,
    Component: DiagnosticsSection,
  },
  {
    key: "backups",
    labelKey: "integrations.pfsense.services.backups.title",
    fallback: "Backups",
    icon: HardDrive,
    Component: BackupsSection,
  },
];

const PfsenseServicesTab: React.FC<PfsenseTabProps> = ({ connectionId }) => {
  const t = useT();
  const [active, setActive] = useState<SectionKey>("dhcp");
  const current = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];
  const Active = current.Component;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2 py-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                active === s.key
                  ? "bg-[var(--color-surfaceHover)] text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)]"
              }`}
            >
              <Icon size={13} />
              {t(s.labelKey, s.fallback)}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Active connectionId={connectionId} />
      </div>
    </div>
  );
};

export default PfsenseServicesTab;
