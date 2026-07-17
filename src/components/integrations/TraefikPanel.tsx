// Traefik integration panel (t42-traefik).
//
// Full panel for the sorng-traefik crate — binds every one of the 27 Traefik
// commands registered in the Tauri handler (sorng-commands-webservers) through
// `useTraefik()` / `traefikApi`. Connect form maps to `traefik_connect`; the
// sub-tabs cover overview/health, routers, services, middlewares, entrypoints
// and TLS certificates (each list + get-by-name), plus the raw dynamic config.

import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  DoorOpen,
  Layers,
  Loader2,
  Network,
  Plug,
  RefreshCw,
  Route,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTraefik, type TraefikManager } from "../../hooks/integration/useTraefik";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  ProviderSummary,
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikOverview,
  TraefikRouter,
  TraefikService,
  TraefikTcpMiddleware,
  TraefikTcpRouter,
  TraefikTcpService,
  TraefikTlsCertificate,
  TraefikUdpRouter,
  TraefikUdpService,
  TraefikVersion,
} from "../../types/traefik";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

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

/** Renders a fetched single resource (a get-by-name result) as pretty JSON. */
const DetailView: React.FC<{ title: string; value: unknown; onClear: () => void }> = ({
  title,
  value,
  onClear,
}) => {
  const { t } = useTranslation();
  return (
    <div className={card}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--color-text)]">{title}</h4>
        <button className={btn} onClick={onClear}>
          {t("integrations.traefik.close", "Close")}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
};

type TabKey =
  | "overview"
  | "routers"
  | "services"
  | "middlewares"
  | "entrypoints"
  | "tls";

type L47Proto = "http" | "tcp" | "udp";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  apiUrl: string;
  authMode: "none" | "basic" | "apiKey";
  username: string;
  password: string;
  apiKey: string;
  tlsSkipVerify: boolean;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  apiUrl: "",
  authMode: "none",
  username: "",
  password: "",
  apiKey: "",
  tlsSkipVerify: false,
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{ mgr: TraefikManager; instanceId?: string }> = ({
  mgr,
  instanceId,
}) => {
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
      apiUrl: inst.host ?? "",
      authMode: (inst.fields?.authMode as ConnectState["authMode"]) ?? "none",
      username: inst.fields?.username ?? "",
      tlsSkipVerify: inst.fields?.tlsSkipVerify === "true",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (!secret) return;
      setForm((f) =>
        f.authMode === "apiKey"
          ? { ...f, apiKey: secret }
          : { ...f, password: secret },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? instanceId ?? generateId();
    await mgr.connect(id, {
      api_url: form.apiUrl.trim(),
      username: form.authMode === "basic" ? form.username : undefined,
      password: form.authMode === "basic" ? form.password : undefined,
      api_key: form.authMode === "apiKey" ? form.apiKey : undefined,
      tls_skip_verify: form.tlsSkipVerify,
      timeout_secs: form.timeoutSecs ? Number(form.timeoutSecs) : undefined,
    });
  }, [mgr, form, savedId, instanceId]);

  const doSave = useCallback(async () => {
    const fields: Record<string, string> = {
      authMode: form.authMode,
      username: form.username,
      tlsSkipVerify: String(form.tlsSkipVerify),
      timeoutSecs: form.timeoutSecs,
    };
    const secret =
      form.authMode === "apiKey"
        ? form.apiKey || undefined
        : form.authMode === "basic"
          ? form.password || undefined
          : undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.apiUrl,
        host: form.apiUrl,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "traefik",
        name: form.name || form.apiUrl,
        host: form.apiUrl,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.traefik.apiUrl", "API URL")}>
          <input
            className={field}
            value={form.apiUrl}
            onChange={(e) => set("apiUrl", e.target.value)}
            placeholder="http://traefik.lab.local:8080"
          />
        </Labeled>
        <Labeled label={t("integrations.traefik.authMode", "Authentication")}>
          <select
            className={field}
            value={form.authMode}
            onChange={(e) =>
              set("authMode", e.target.value as ConnectState["authMode"])
            }
          >
            <option value="none">
              {t("integrations.traefik.authNone", "None")}
            </option>
            <option value="basic">
              {t("integrations.traefik.authBasic", "Basic (user / password)")}
            </option>
            <option value="apiKey">
              {t("integrations.traefik.authApiKey", "API key")}
            </option>
          </select>
        </Labeled>
        {form.authMode === "basic" && (
          <>
            <Labeled label={t("integrations.traefik.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.traefik.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Labeled>
          </>
        )}
        {form.authMode === "apiKey" && (
          <Labeled label={t("integrations.traefik.apiKey", "API key")}>
            <input
              className={field}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </Labeled>
        )}
        <Labeled label={t("integrations.traefik.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.traefik.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.apiUrl}
          />
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={form.tlsSkipVerify}
            onChange={(e) => set("tlsSkipVerify", e.target.checked)}
          />
          {t(
            "integrations.traefik.tlsSkipVerify",
            "Skip TLS certificate verification",
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.apiUrl}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.traefik.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.apiUrl}>
          {t("integrations.traefik.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Overview tab (overview + version + ping + raw config + connections) ──────

const OverviewTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<TraefikOverview | null>(null);
  const [version, setVersion] = useState<TraefikVersion | null>(null);
  const [connections, setConnections] = useState<string[]>([]);
  const [rawConfig, setRawConfig] = useState<unknown | null>(null);
  const [pinged, setPinged] = useState<string>("");

  const refresh = useCallback(async () => {
    const safe = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        /* surfaced via mgr.error */
      }
    };
    await mgr.run(async () => {
      await Promise.all([
        safe(async () => setOverview(await mgr.api.getOverview(cid))),
        safe(async () => setVersion(await mgr.api.getVersion(cid))),
        safe(async () => setConnections(await mgr.api.listConnections())),
      ]);
    });
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doPing = useCallback(async () => {
    try {
      const s = await mgr.run(() => mgr.api.ping(cid));
      setPinged(
        `${s.api_url}${s.version ? ` · v${s.version}` : ""} · ${new Date().toLocaleTimeString()}`,
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const loadRaw = useCallback(async () => {
    try {
      const r = await mgr.run(() => mgr.api.getRawConfig(cid));
      setRawConfig(r.json);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const providerCard = (label: string, p?: ProviderSummary) =>
    p ? (
      <div key={label} className={card}>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
          {label}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-[var(--color-textSecondary)]">
          <span>
            {t("integrations.traefik.routers", "Routers")}: {p.routers.total}
          </span>
          <span>
            {t("integrations.traefik.services", "Services")}: {p.services.total}
          </span>
          <span>
            {t("integrations.traefik.middlewares", "Middlewares")}:{" "}
            {p.middlewares.total}
          </span>
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.traefik.refresh", "Refresh")}
        </button>
        <button className={btn} onClick={doPing} disabled={mgr.isLoading}>
          {t("integrations.traefik.ping", "Ping")}
        </button>
        <button className={btn} onClick={loadRaw} disabled={mgr.isLoading}>
          {t("integrations.traefik.rawConfig", "Raw config")}
        </button>
        {pinged && (
          <span className="text-xs text-[var(--color-textSecondary)]">
            {pinged}
          </span>
        )}
      </div>

      {version && (
        <div className={card}>
          <div className="text-sm font-semibold text-[var(--color-text)]">
            Traefik v{version.version}
            {version.codename ? ` · ${version.codename}` : ""}
          </div>
          {version.start_date && (
            <div className="text-[10px] text-[var(--color-textMuted)]">
              {t("integrations.traefik.startDate", "Started")}:{" "}
              {version.start_date}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {providerCard(t("integrations.traefik.http", "HTTP"), overview?.http)}
        {providerCard(t("integrations.traefik.tcp", "TCP"), overview?.tcp)}
        {providerCard(t("integrations.traefik.udp", "UDP"), overview?.udp)}
      </div>

      {overview?.providers && overview.providers.length > 0 && (
        <div className={card}>
          <h4 className="mb-1 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.traefik.providers", "Providers")}
          </h4>
          <div className="text-xs text-[var(--color-textSecondary)]">
            {overview.providers.join(", ")}
          </div>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-1 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.traefik.activeConnections", "Active connections")}
        </h4>
        <div className="text-xs text-[var(--color-textSecondary)]">
          {connections.length > 0 ? connections.join(", ") : "—"}
        </div>
      </div>

      {rawConfig != null && (
        <DetailView
          title={t("integrations.traefik.rawConfig", "Raw config")}
          value={rawConfig}
          onClear={() => setRawConfig(null)}
        />
      )}
    </div>
  );
};

// ─── Routers tab (http / tcp / udp: list + get) ──────────────────────────────

const RoutersTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [proto, setProto] = useState<L47Proto>("http");
  const [rows, setRows] = useState<
    (TraefikRouter | TraefikTcpRouter | TraefikUdpRouter)[]
  >([]);
  const [detail, setDetail] = useState<{ name: string; value: unknown } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const list = await mgr.run(() =>
        proto === "http"
          ? mgr.api.listHttpRouters(cid)
          : proto === "tcp"
            ? mgr.api.listTcpRouters(cid)
            : mgr.api.listUdpRouters(cid),
      );
      setRows(list);
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, proto]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        const value = await mgr.run(() =>
          proto === "http"
            ? mgr.api.getHttpRouter(cid, name)
            : proto === "tcp"
              ? mgr.api.getTcpRouter(cid, name)
              : mgr.api.getUdpRouter(cid, name),
        );
        setDetail({ name, value });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, proto],
  );

  return (
    <div className="flex flex-col gap-3">
      <ProtoBar proto={proto} setProto={setProto} withUdp onRefresh={refresh} mgr={mgr} />
      <ResourceTable
        rows={rows as unknown as Record<string, unknown>[]}
        cols={[
          { key: "name", label: t("integrations.traefik.name", "Name") },
          { key: "rule", label: t("integrations.traefik.rule", "Rule") },
          { key: "service", label: t("integrations.traefik.service", "Service") },
          { key: "status", label: t("integrations.traefik.status", "Status") },
        ]}
        onView={view}
        emptyLabel={t("integrations.traefik.noRouters", "No routers")}
      />
      {detail && (
        <DetailView
          title={`${t("integrations.traefik.router", "Router")}: ${detail.name}`}
          value={detail.value}
          onClear={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ─── Services tab (http / tcp / udp: list + get) ─────────────────────────────

const ServicesTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [proto, setProto] = useState<L47Proto>("http");
  const [rows, setRows] = useState<
    (TraefikService | TraefikTcpService | TraefikUdpService)[]
  >([]);
  const [detail, setDetail] = useState<{ name: string; value: unknown } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const list = await mgr.run<
        TraefikService[] | TraefikTcpService[] | TraefikUdpService[]
      >(() =>
        proto === "http"
          ? mgr.api.listHttpServices(cid)
          : proto === "tcp"
            ? mgr.api.listTcpServices(cid)
            : mgr.api.listUdpServices(cid),
      );
      setRows(list);
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, proto]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        const value = await mgr.run<
          TraefikService | TraefikTcpService | TraefikUdpService
        >(() =>
          proto === "http"
            ? mgr.api.getHttpService(cid, name)
            : proto === "tcp"
              ? mgr.api.getTcpService(cid, name)
              : mgr.api.getUdpService(cid, name),
        );
        setDetail({ name, value });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, proto],
  );

  return (
    <div className="flex flex-col gap-3">
      <ProtoBar proto={proto} setProto={setProto} withUdp onRefresh={refresh} mgr={mgr} />
      <ResourceTable
        rows={rows as unknown as Record<string, unknown>[]}
        cols={[
          { key: "name", label: t("integrations.traefik.name", "Name") },
          { key: "type", label: t("integrations.traefik.type", "Type") },
          { key: "provider", label: t("integrations.traefik.provider", "Provider") },
          { key: "status", label: t("integrations.traefik.status", "Status") },
        ]}
        onView={view}
        emptyLabel={t("integrations.traefik.noServices", "No services")}
      />
      {detail && (
        <DetailView
          title={`${t("integrations.traefik.service", "Service")}: ${detail.name}`}
          value={detail.value}
          onClear={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ─── Middlewares tab (http / tcp: list + get) ────────────────────────────────

const MiddlewaresTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [proto, setProto] = useState<L47Proto>("http");
  const [rows, setRows] = useState<
    (TraefikMiddleware | TraefikTcpMiddleware)[]
  >([]);
  const [detail, setDetail] = useState<{ name: string; value: unknown } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const list = await mgr.run(() =>
        proto === "tcp"
          ? mgr.api.listTcpMiddlewares(cid)
          : mgr.api.listHttpMiddlewares(cid),
      );
      setRows(list);
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, proto]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        const value = await mgr.run(() =>
          proto === "tcp"
            ? mgr.api.getTcpMiddleware(cid, name)
            : mgr.api.getHttpMiddleware(cid, name),
        );
        setDetail({ name, value });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, proto],
  );

  return (
    <div className="flex flex-col gap-3">
      <ProtoBar proto={proto} setProto={setProto} onRefresh={refresh} mgr={mgr} />
      <ResourceTable
        rows={rows as unknown as Record<string, unknown>[]}
        cols={[
          { key: "name", label: t("integrations.traefik.name", "Name") },
          { key: "type", label: t("integrations.traefik.type", "Type") },
          { key: "provider", label: t("integrations.traefik.provider", "Provider") },
          { key: "status", label: t("integrations.traefik.status", "Status") },
        ]}
        onView={view}
        emptyLabel={t("integrations.traefik.noMiddlewares", "No middlewares")}
      />
      {detail && (
        <DetailView
          title={`${t("integrations.traefik.middleware", "Middleware")}: ${detail.name}`}
          value={detail.value}
          onClear={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ─── Entrypoints tab (list + get) ────────────────────────────────────────────

const EntrypointsTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TraefikEntryPoint[]>([]);
  const [detail, setDetail] = useState<{ name: string; value: unknown } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listEntrypoints(cid)));
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail({ name, value: await mgr.run(() => mgr.api.getEntrypoint(cid, name)) });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.traefik.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.traefik.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.traefik.address", "Address")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((ep) => (
              <tr key={ep.name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{ep.name}</td>
                <td className="px-2 py-1 font-mono">{ep.address}</td>
                <td className="px-2 py-1 text-right">
                  <button className={btn} onClick={() => void view(ep.name)}>
                    {t("integrations.traefik.details", "Details")}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={3}>
                  {t("integrations.traefik.noEntrypoints", "No entrypoints")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detail && (
        <DetailView
          title={`${t("integrations.traefik.entrypoint", "Entrypoint")}: ${detail.name}`}
          value={detail.value}
          onClear={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ─── TLS tab (list + get certificate) ────────────────────────────────────────

const TlsTab: React.FC<{ mgr: TraefikManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TraefikTlsCertificate[]>([]);
  const [detail, setDetail] = useState<{ name: string; value: unknown } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listTlsCertificates(cid)));
      setDetail(null);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useCallback(
    async (name: string) => {
      try {
        setDetail({
          name,
          value: await mgr.run(() => mgr.api.getTlsCertificate(cid, name)),
        });
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.traefik.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.traefik.subject", "Subject")}</th>
              <th className="px-2 py-1">{t("integrations.traefik.sans", "SANs")}</th>
              <th className="px-2 py-1">{t("integrations.traefik.notAfter", "Not after")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((certificate, i) => {
              const primary = certificate.subject ?? certificate.sans[0] ?? String(i);
              return (
                <tr key={primary + i} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 text-[var(--color-text)]">
                    {certificate.subject ?? "—"}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {certificate.sans.join(", ")}
                  </td>
                  <td className="px-2 py-1">{certificate.not_after ?? "—"}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className={btn}
                      onClick={() => void view(certificate.sans[0] ?? primary)}
                    >
                      {t("integrations.traefik.details", "Details")}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.traefik.noCertificates", "No certificates")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detail && (
        <DetailView
          title={`${t("integrations.traefik.certificate", "Certificate")}: ${detail.name}`}
          value={detail.value}
          onClear={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ─── Shared sub-components for routers/services/middlewares ───────────────────

const ProtoBar: React.FC<{
  proto: L47Proto;
  setProto: (p: L47Proto) => void;
  withUdp?: boolean;
  onRefresh: () => void;
  mgr: TraefikManager;
}> = ({ proto, setProto, withUdp, onRefresh, mgr }) => {
  const { t } = useTranslation();
  const protos: L47Proto[] = withUdp ? ["http", "tcp", "udp"] : ["http", "tcp"];
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex overflow-hidden rounded border border-[var(--color-border)]">
        {protos.map((p) => (
          <button
            key={p}
            onClick={() => setProto(p)}
            className={`px-3 py-1 text-xs ${
              proto === p
                ? "bg-primary/20 text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>
      <button className={btn} onClick={onRefresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.traefik.refresh", "Refresh")}
      </button>
    </div>
  );
};

interface ColSpec {
  key: string;
  label: string;
}

const ResourceTable: React.FC<{
  rows: Record<string, unknown>[];
  cols: ColSpec[];
  onView: (name: string) => void;
  emptyLabel: string;
}> = ({ rows, cols, onView, emptyLabel }) => {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[var(--color-textMuted)]">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-1">
                {c.label}
              </th>
            ))}
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const name = typeof row.name === "string" ? row.name : "";
            return (
              <tr key={name || i} className="border-t border-[var(--color-border)]">
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 ${c.key === "name" ? "text-[var(--color-text)]" : "font-mono text-[var(--color-textSecondary)]"}`}
                  >
                    {row[c.key] != null ? String(row[c.key]) : "—"}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  {name && (
                    <button className={btn} onClick={() => onView(name)}>
                      {t("integrations.traefik.details", "Details")}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td
                className="px-2 py-3 text-[var(--color-textMuted)]"
                colSpan={cols.length + 1}
              >
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// ─── Panel shell ─────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "overview", labelKey: "integrations.traefik.tabOverview", labelDefault: "Overview", icon: Network },
  { key: "routers", labelKey: "integrations.traefik.tabRouters", labelDefault: "Routers", icon: Route },
  { key: "services", labelKey: "integrations.traefik.tabServices", labelDefault: "Services", icon: Boxes },
  { key: "middlewares", labelKey: "integrations.traefik.tabMiddlewares", labelDefault: "Middlewares", icon: Layers },
  { key: "entrypoints", labelKey: "integrations.traefik.tabEntrypoints", labelDefault: "Entrypoints", icon: DoorOpen },
  { key: "tls", labelKey: "integrations.traefik.tabTls", labelDefault: "TLS", icon: ShieldCheck },
];

const TraefikPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useTraefik();
  const [tab, setTab] = useState<TabKey>("overview");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Waypoints className="h-5 w-5 text-primary" />
          {t("integrations.traefik.title", "Traefik")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`}
            />
            {mgr.isConnected
              ? mgr.summary?.api_url ??
                t("integrations.traefik.connected", "Connected")
              : t("integrations.traefik.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">
              v{mgr.summary.version}
            </span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.traefik.disconnect", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isConnected || !cid ? (
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
            {tab === "overview" && <OverviewTab mgr={mgr} cid={cid} />}
            {tab === "routers" && <RoutersTab mgr={mgr} cid={cid} />}
            {tab === "services" && <ServicesTab mgr={mgr} cid={cid} />}
            {tab === "middlewares" && <MiddlewaresTab mgr={mgr} cid={cid} />}
            {tab === "entrypoints" && <EntrypointsTab mgr={mgr} cid={cid} />}
            {tab === "tls" && <TlsTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default TraefikPanel;

/** Registry descriptor for the Traefik integration (category: web).
 *  The Wave-4 web integrator appends this to `registry.web.ts`. */
export const traefikDescriptor: IntegrationDescriptor = {
  key: "traefik",
  label: "Traefik",
  category: "web-server",
  icon: Waypoints,
  importPanel: () => import("./TraefikPanel"),
};
