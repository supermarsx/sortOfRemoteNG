// Caddy integration panel (t42-caddy).
//
// Full panel for the sorng-caddy crate — binds all 34 `caddy_*` commands
// registered in `sorng-caddy/src/commands.rs` through `useCaddy()` / `caddyApi`.
// Connect form maps to `caddy_connect` (admin API URL + optional API key OR
// basic auth + TLS skip-verify + timeout); sub-tabs cover config (raw + path
// GET/SET/PATCH/DELETE, load, stop), Caddyfile adapt, HTTP servers, routes,
// TLS (app, automation, automate-domains, certificates) and the reverse-proxy /
// file-server / redirect convenience helpers.

import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  FileCode2,
  FileText,
  Loader2,
  Network,
  Plug,
  RefreshCw,
  Route as RouteIcon,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCaddy, type CaddyManager } from "../../hooks/integration/useCaddy";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { generateId } from "../../utils/core/id";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import type {
  CaddyCertificate,
  CaddyRoute,
  CaddyServer,
} from "../../types/caddy";

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

/** Collapsible raw-JSON viewer used by the "view / detail" actions. */
const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

/** Parse JSON from a textarea, alerting on failure. Returns `undefined` on error. */
function parseJson<T>(raw: string, onInvalid: () => void): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    onInvalid();
    return undefined;
  }
}

type TabKey = "config" | "caddyfile" | "servers" | "routes" | "tls" | "proxy";

// ─── Connect form ────────────────────────────────────────────────────────────

interface ConnectState {
  adminUrl: string;
  authMode: "none" | "apiKey" | "basic";
  apiKey: string;
  username: string;
  password: string;
  tlsSkipVerify: boolean;
  timeoutSecs: string;
  name: string;
}

const emptyConnect: ConnectState = {
  adminUrl: "http://localhost:2019",
  authMode: "none",
  apiKey: "",
  username: "",
  password: "",
  tlsSkipVerify: false,
  timeoutSecs: "30",
  name: "",
};

const ConnectForm: React.FC<{ mgr: CaddyManager; instanceId?: string }> = ({
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
      adminUrl: inst.host ?? f.adminUrl,
      authMode: (inst.fields?.authMode as ConnectState["authMode"]) ?? "none",
      username: inst.fields?.username ?? "",
      tlsSkipVerify: inst.fields?.tlsSkipVerify === "true",
      timeoutSecs: inst.fields?.timeoutSecs ?? "30",
    }));
    store.readSecret(inst).then((secret) => {
      if (!secret) return;
      setForm((f) =>
        f.authMode === "basic"
          ? { ...f, password: secret }
          : { ...f, apiKey: secret },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof ConnectState>(k: K, v: ConnectState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const doConnect = useCallback(async () => {
    const id = savedId ?? instanceId ?? generateId();
    await mgr.connect(id, {
      admin_url: form.adminUrl.trim(),
      api_key: form.authMode === "apiKey" ? form.apiKey : undefined,
      username: form.authMode === "basic" ? form.username : undefined,
      password: form.authMode === "basic" ? form.password : undefined,
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
      form.authMode === "basic"
        ? form.password || undefined
        : form.authMode === "apiKey"
          ? form.apiKey || undefined
          : undefined;
    if (savedId) {
      await store.updateInstance(savedId, {
        name: form.name || form.adminUrl,
        host: form.adminUrl,
        fields,
        secret,
      });
    } else {
      const created = await store.createInstance({
        integrationKey: "caddy",
        name: form.name || form.adminUrl,
        host: form.adminUrl,
        fields,
        secret,
      });
      setSavedId(created.id);
    }
  }, [store, form, savedId]);

  return (
    <div className={card}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label={t("integrations.caddy.adminUrl", "Admin API URL")}>
          <input
            className={field}
            value={form.adminUrl}
            onChange={(e) => set("adminUrl", e.target.value)}
            placeholder="http://localhost:2019"
          />
        </Labeled>
        <Labeled label={t("integrations.caddy.authMode", "Authentication")}>
          <select
            className={field}
            value={form.authMode}
            onChange={(e) =>
              set("authMode", e.target.value as ConnectState["authMode"])
            }
          >
            <option value="none">
              {t("integrations.caddy.authNone", "None")}
            </option>
            <option value="apiKey">
              {t("integrations.caddy.authApiKey", "API key")}
            </option>
            <option value="basic">
              {t("integrations.caddy.authBasic", "Basic (user / password)")}
            </option>
          </select>
        </Labeled>
        {form.authMode === "apiKey" && (
          <Labeled label={t("integrations.caddy.apiKey", "API key")}>
            <input
              className={field}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </Labeled>
        )}
        {form.authMode === "basic" && (
          <>
            <Labeled label={t("integrations.caddy.username", "Username")}>
              <input
                className={field}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Labeled>
            <Labeled label={t("integrations.caddy.password", "Password")}>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Labeled>
          </>
        )}
        <Labeled label={t("integrations.caddy.timeout", "Timeout (seconds)")}>
          <input
            className={field}
            value={form.timeoutSecs}
            onChange={(e) => set("timeoutSecs", e.target.value)}
            inputMode="numeric"
          />
        </Labeled>
        <Labeled label={t("integrations.caddy.instanceName", "Saved name")}>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("integrations.caddy.instanceNameHint", "optional label")}
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
            "integrations.caddy.tlsSkipVerify",
            "Skip TLS verification (self-signed admin endpoint)",
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={doConnect}
          disabled={mgr.isConnecting || !form.adminUrl}
        >
          {mgr.isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plug size={12} />
          )}
          {t("integrations.caddy.connect", "Connect")}
        </button>
        <button className={btn} onClick={doSave} disabled={!form.adminUrl}>
          {t("integrations.caddy.save", "Save instance")}
        </button>
      </div>
    </div>
  );
};

// ─── Config tab ──────────────────────────────────────────────────────────────

const ConfigTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<unknown>(null);
  const [path, setPath] = useState("apps/http/servers");
  const [pathValue, setPathValue] = useState("");
  const [loadBody, setLoadBody] = useState("");
  const [connections, setConnections] = useState<string[] | null>(null);

  const call = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        setDetail(await mgr.run(op));
      } catch {
        /* surfaced via mgr.error */
      }
    },
    [mgr],
  );

  const getFull = () => call(() => mgr.api.getFullConfig(cid));
  const getRaw = () => call(() => mgr.api.getRawConfig(cid));
  const getPath = () => call(() => mgr.api.getConfigPath(cid, path));

  const mutatePath = useCallback(
    async (kind: "set" | "patch" | "delete") => {
      try {
        if (kind === "delete") {
          await mgr.run(() => mgr.api.deleteConfigPath(cid, path));
        } else {
          const value = parseJson<unknown>(pathValue, () =>
            window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
          );
          if (value === undefined && pathValue.trim() !== "") return;
          const parsed = pathValue.trim() === "" ? null : value;
          if (kind === "set") await mgr.run(() => mgr.api.setConfigPath(cid, path, parsed));
          else await mgr.run(() => mgr.api.patchConfigPath(cid, path, parsed));
        }
        await getPath();
      } catch {
        /* surfaced */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mgr, cid, path, pathValue, t],
  );

  const loadConfig = useCallback(async () => {
    const value = parseJson<unknown>(loadBody, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (value === undefined) return;
    try {
      await mgr.run(() => mgr.api.loadConfig(cid, value));
      setDetail({ ok: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, loadBody, t]);

  const stopServer = useCallback(async () => {
    if (
      !window.confirm(
        t(
          "integrations.caddy.stopServerConfirm",
          "Stop the Caddy server (unload all config)?",
        ),
      )
    )
      return;
    try {
      await mgr.run(() => mgr.api.stopServer(cid));
      setDetail({ stopped: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, t]);

  const listConnections = () =>
    void mgr
      .run(() => mgr.api.listConnections())
      .then(setConnections)
      .catch(() => {});

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={getFull} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.caddy.getFullConfig", "Full config")}
        </button>
        <button className={btn} onClick={getRaw} disabled={mgr.isLoading}>
          {t("integrations.caddy.getRawConfig", "Raw config")}
        </button>
        <button className={btn} onClick={() => void mgr.api.ping(cid).then(setDetail)}>
          {t("integrations.caddy.ping", "Ping")}
        </button>
        <button className={btn} onClick={listConnections}>
          {t("integrations.caddy.listConnections", "Active connections")}
        </button>
        <button
          className={`${btn} text-red-500`}
          onClick={stopServer}
          disabled={mgr.isLoading}
        >
          <Trash2 size={12} />
          {t("integrations.caddy.stopServer", "Stop server")}
        </button>
      </div>

      {connections && (
        <div className={card}>
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.caddy.listConnections", "Active connections")}:{" "}
          </span>
          <span className="text-xs text-[var(--color-text)]">
            {connections.length ? connections.join(", ") : "—"}
          </span>
        </div>
      )}

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.configPath", "Config path")}
        </h4>
        <Labeled label={t("integrations.caddy.path", "Path")}>
          <input
            className={field}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="apps/http/servers/srv0"
          />
        </Labeled>
        <div className="mt-2">
          <Labeled label={t("integrations.caddy.value", "Value (JSON)")}>
            <textarea
              className={`${field} font-mono`}
              rows={3}
              value={pathValue}
              onChange={(e) => setPathValue(e.target.value)}
              placeholder='{"listen":[":443"]}'
            />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} onClick={getPath} disabled={mgr.isLoading}>
            {t("integrations.caddy.getPath", "GET")}
          </button>
          <button className={btn} onClick={() => void mutatePath("set")} disabled={mgr.isLoading}>
            {t("integrations.caddy.setPath", "SET (PUT)")}
          </button>
          <button className={btn} onClick={() => void mutatePath("patch")} disabled={mgr.isLoading}>
            {t("integrations.caddy.patchPath", "PATCH")}
          </button>
          <button className={`${btn} text-red-500`} onClick={() => void mutatePath("delete")} disabled={mgr.isLoading}>
            {t("integrations.caddy.deletePath", "DELETE")}
          </button>
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.loadConfig", "Load full config (replace)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={5}
          value={loadBody}
          onChange={(e) => setLoadBody(e.target.value)}
          placeholder='{"apps":{"http":{"servers":{}}}}'
        />
        <button className={`${btn} mt-2`} onClick={loadConfig} disabled={mgr.isLoading || !loadBody}>
          {t("integrations.caddy.load", "Load")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Caddyfile tab ───────────────────────────────────────────────────────────

const CaddyfileTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [src, setSrc] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<
    { file?: string; line?: number; directive?: string; message: string }[]
  >([]);

  const adapt = useCallback(async () => {
    try {
      const res = await mgr.run(() => mgr.api.adaptCaddyfile(cid, src));
      setResult(res.config);
      setWarnings(res.warnings ?? []);
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, src]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.adaptCaddyfile", "Adapt a Caddyfile to JSON")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={8}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          placeholder={"example.com {\n  reverse_proxy localhost:8080\n}"}
        />
        <button className={`${btn} mt-2`} onClick={adapt} disabled={mgr.isLoading || !src}>
          <FileCode2 size={12} />
          {t("integrations.caddy.adapt", "Adapt")}
        </button>
      </div>
      {warnings.length > 0 && (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-600">
          {warnings.map((w, i) => (
            <div key={i}>
              {w.file ? `${w.file}:` : ""}
              {w.line ?? "?"} {w.directive ? `[${w.directive}] ` : ""}
              {w.message}
            </div>
          ))}
        </div>
      )}
      <JsonView value={result} />
    </div>
  );
};

// ─── Servers tab ─────────────────────────────────────────────────────────────

const ServersTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<[string, CaddyServer][]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [form, setForm] = useState({ name: "", body: "" });

  const refresh = useCallback(async () => {
    try {
      const map = await mgr.run(() => mgr.api.listServers(cid));
      setRows(Object.entries(map ?? {}));
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
        setDetail(await mgr.run(() => mgr.api.getServer(cid, name)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid],
  );

  const save = useCallback(async () => {
    if (!form.name) return;
    const server = parseJson<CaddyServer>(form.body, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (server === undefined) return;
    try {
      await mgr.run(() => mgr.api.setServer(cid, form.name, server));
      setForm({ name: "", body: "" });
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, form, refresh, t]);

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t("integrations.caddy.deleteServerConfirm", "Delete this server?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteServer(cid, name));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.caddy.refresh", "Refresh")}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.caddy.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.listen", "Listen")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.routes", "Routes")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, srv]) => (
              <tr key={name} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{name}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">{(srv.listen ?? []).join(", ")}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{srv.routes?.length ?? 0}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(name)}>
                      {t("integrations.caddy.view", "View")}
                    </button>
                    <button className={btn} onClick={() => void remove(name)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.caddy.noServers", "No servers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.setServer", "Create / replace server (JSON)")}
        </h4>
        <Labeled label={t("integrations.caddy.name", "Name")}>
          <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="srv0" />
        </Labeled>
        <div className="mt-2">
          <Labeled label={t("integrations.caddy.serverJson", "Server (JSON)")}>
            <textarea
              className={`${field} font-mono`}
              rows={4}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder='{"listen":[":443"],"routes":[]}'
            />
          </Labeled>
        </div>
        <button className={`${btn} mt-2`} onClick={save} disabled={mgr.isLoading || !form.name}>
          {t("integrations.caddy.save", "Save")}
        </button>
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Routes tab ──────────────────────────────────────────────────────────────

const RoutesTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({
  mgr,
  cid,
}) => {
  const { t } = useTranslation();
  const [server, setServer] = useState("srv0");
  const [rows, setRows] = useState<CaddyRoute[]>([]);
  const [detail, setDetail] = useState<unknown>(null);
  const [addBody, setAddBody] = useState("");
  const [editIndex, setEditIndex] = useState("");
  const [editBody, setEditBody] = useState("");
  const [allBody, setAllBody] = useState("");

  const refresh = useCallback(async () => {
    if (!server) return;
    try {
      setRows(await mgr.run(() => mgr.api.listRoutes(cid, server)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, server]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const view = useCallback(
    async (index: number) => {
      try {
        setDetail(await mgr.run(() => mgr.api.getRoute(cid, server, index)));
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, server],
  );

  const add = useCallback(async () => {
    const route = parseJson<CaddyRoute>(addBody, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (route === undefined) return;
    try {
      await mgr.run(() => mgr.api.addRoute(cid, server, route));
      setAddBody("");
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, server, addBody, refresh, t]);

  const setAt = useCallback(async () => {
    if (editIndex === "") return;
    const route = parseJson<CaddyRoute>(editBody, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (route === undefined) return;
    try {
      await mgr.run(() => mgr.api.setRoute(cid, server, Number(editIndex), route));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, server, editIndex, editBody, refresh, t]);

  const setAll = useCallback(async () => {
    const routes = parseJson<CaddyRoute[]>(allBody, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (routes === undefined) return;
    try {
      await mgr.run(() => mgr.api.setAllRoutes(cid, server, routes));
      await refresh();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, server, allBody, refresh, t]);

  const remove = useCallback(
    async (index: number) => {
      if (!window.confirm(t("integrations.caddy.deleteRouteConfirm", "Delete this route?"))) return;
      try {
        await mgr.run(() => mgr.api.deleteRoute(cid, server, index));
        await refresh();
      } catch {
        /* surfaced */
      }
    },
    [mgr, cid, server, refresh, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Labeled label={t("integrations.caddy.server", "Server")}>
          <input
            className={field}
            style={{ width: 160 }}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="srv0"
          />
        </Labeled>
        <button className={`${btn} self-end`} onClick={refresh} disabled={mgr.isLoading || !server}>
          <RefreshCw size={12} />
          {t("integrations.caddy.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">#</th>
              <th className="px-2 py-1">{t("integrations.caddy.match", "Match")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.handlers", "Handlers")}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r["@id"] ?? i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{i}</td>
                <td className="px-2 py-1 font-mono text-[var(--color-textSecondary)]">
                  {(r.match ?? [])
                    .map((m) => (m.host ?? m.path ?? []).join(","))
                    .filter(Boolean)
                    .join(" | ") || "*"}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {(r.handle ?? []).map((h) => h.handler).join(", ")}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => void view(i)}>
                      {t("integrations.caddy.view", "View")}
                    </button>
                    <button
                      className={btn}
                      onClick={() => {
                        setEditIndex(String(i));
                        setEditBody(JSON.stringify(r, null, 2));
                      }}
                    >
                      {t("integrations.caddy.edit", "Edit")}
                    </button>
                    <button className={btn} onClick={() => void remove(i)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.caddy.noRoutes", "No routes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.addRoute", "Append route (JSON)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          value={addBody}
          onChange={(e) => setAddBody(e.target.value)}
          placeholder='{"match":[{"host":["example.com"]}],"handle":[{"handler":"static_response","body":"hi"}]}'
        />
        <button className={`${btn} mt-2`} onClick={add} disabled={mgr.isLoading || !addBody}>
          {t("integrations.caddy.add", "Append")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.setRoute", "Replace route at index (JSON)")}
        </h4>
        <div className="flex items-center gap-2">
          <Labeled label={t("integrations.caddy.index", "Index")}>
            <input
              className={field}
              style={{ width: 80 }}
              inputMode="numeric"
              value={editIndex}
              onChange={(e) => setEditIndex(e.target.value)}
            />
          </Labeled>
        </div>
        <textarea
          className={`${field} mt-2 font-mono`}
          rows={4}
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
        />
        <button className={`${btn} mt-2`} onClick={setAt} disabled={mgr.isLoading || editIndex === ""}>
          {t("integrations.caddy.replace", "Replace")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.setAllRoutes", "Replace all routes (JSON array)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          value={allBody}
          onChange={(e) => setAllBody(e.target.value)}
          placeholder="[]"
        />
        <button className={`${btn} mt-2`} onClick={setAll} disabled={mgr.isLoading || !allBody}>
          {t("integrations.caddy.replaceAll", "Replace all")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── TLS tab ─────────────────────────────────────────────────────────────────

const TlsTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<unknown>(null);
  const [tlsAppBody, setTlsAppBody] = useState("");
  const [automationBody, setAutomationBody] = useState("");
  const [domains, setDomains] = useState("");
  const [certs, setCerts] = useState<CaddyCertificate[]>([]);

  const call = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        setDetail(await mgr.run(op));
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  const loadDomains = useCallback(async () => {
    try {
      const d = await mgr.run(() => mgr.api.listAutomateDomains(cid));
      setDomains((d ?? []).join(", "));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  const loadCerts = useCallback(async () => {
    try {
      setCerts(await mgr.run(() => mgr.api.listTlsCertificates(cid)));
    } catch {
      /* surfaced */
    }
  }, [mgr, cid]);

  useEffect(() => {
    void loadDomains();
    void loadCerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const saveDomains = useCallback(async () => {
    const list = domains
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await mgr.run(() => mgr.api.setAutomateDomains(cid, list));
      await loadDomains();
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, domains, loadDomains]);

  const saveTlsApp = useCallback(async () => {
    const app = parseJson<Parameters<typeof mgr.api.setTlsApp>[1]>(tlsAppBody, () =>
      window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (app === undefined) return;
    try {
      await mgr.run(() => mgr.api.setTlsApp(cid, app));
      setDetail({ ok: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, tlsAppBody, t]);

  const saveAutomation = useCallback(async () => {
    const automation = parseJson<Parameters<typeof mgr.api.setTlsAutomation>[1]>(
      automationBody,
      () => window.alert(t("integrations.caddy.invalidJson", "Invalid JSON")),
    );
    if (automation === undefined) return;
    try {
      await mgr.run(() => mgr.api.setTlsAutomation(cid, automation));
      setDetail({ ok: true });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, automationBody, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => void call(() => mgr.api.getTlsApp(cid))} disabled={mgr.isLoading}>
          {t("integrations.caddy.getTlsApp", "TLS app")}
        </button>
        <button className={btn} onClick={() => void call(() => mgr.api.getTlsAutomation(cid))} disabled={mgr.isLoading}>
          {t("integrations.caddy.getTlsAutomation", "TLS automation")}
        </button>
        <button className={btn} onClick={loadCerts} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.caddy.reloadCerts", "Reload certificates")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.automateDomains", "Automated (managed) domains")}
        </h4>
        <Labeled label={t("integrations.caddy.domainsCsv", "Domains (comma-separated)")}>
          <input className={field} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, www.example.com" />
        </Labeled>
        <div className="mt-2 flex gap-2">
          <button className={btn} onClick={loadDomains} disabled={mgr.isLoading}>
            {t("integrations.caddy.reload", "Reload")}
          </button>
          <button className={btn} onClick={saveDomains} disabled={mgr.isLoading}>
            {t("integrations.caddy.save", "Save")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.caddy.subjects", "Subjects (SANs)")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.issuer", "Issuer")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.managed", "Managed")}</th>
              <th className="px-2 py-1">{t("integrations.caddy.notAfter", "Expires")}</th>
            </tr>
          </thead>
          <tbody>
            {certs.map((c, i) => (
              <tr key={c.fingerprint ?? i} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-text)]">{(c.sans ?? []).join(", ")}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{c.issuer ?? "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{c.managed ? "✓" : "—"}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{c.not_after ?? "—"}</td>
              </tr>
            ))}
            {certs.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.caddy.noCerts", "No certificates")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.setTlsApp", "Replace TLS app (JSON)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          value={tlsAppBody}
          onChange={(e) => setTlsAppBody(e.target.value)}
          placeholder='{"certificates":{"automate":["example.com"]}}'
        />
        <button className={`${btn} mt-2`} onClick={saveTlsApp} disabled={mgr.isLoading || !tlsAppBody}>
          {t("integrations.caddy.save", "Save")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.setTlsAutomation", "Replace TLS automation (JSON)")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={4}
          value={automationBody}
          onChange={(e) => setAutomationBody(e.target.value)}
          placeholder='{"policies":[{"subjects":["example.com"]}]}'
        />
        <button className={`${btn} mt-2`} onClick={saveAutomation} disabled={mgr.isLoading || !automationBody}>
          {t("integrations.caddy.save", "Save")}
        </button>
      </div>

      <JsonView value={detail} />
    </div>
  );
};

// ─── Proxy / convenience tab ─────────────────────────────────────────────────

const ProxyTab: React.FC<{ mgr: CaddyManager; cid: string }> = ({ mgr, cid }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<unknown>(null);
  const [rp, setRp] = useState({
    server: "srv0",
    hosts: "",
    upstreams: "",
    tls: false,
    healthCheckPath: "",
    loadBalancing: "",
    stripPrefix: "",
  });
  const [fs, setFs] = useState({
    server: "srv0",
    hosts: "",
    root: "",
    browse: false,
    tls: false,
    indexNames: "",
  });
  const [rd, setRd] = useState({ server: "srv0", hosts: "", target: "", permanent: false });

  const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const createRp = useCallback(async () => {
    try {
      await mgr.run(() =>
        mgr.api.createReverseProxy(cid, rp.server, {
          server_name: rp.server || undefined,
          hosts: csv(rp.hosts),
          upstreams: csv(rp.upstreams),
          tls: rp.tls,
          health_check_path: rp.healthCheckPath || undefined,
          load_balancing: rp.loadBalancing || undefined,
          strip_prefix: rp.stripPrefix || undefined,
        }),
      );
      setDetail({ reverseProxy: "created" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, rp]);

  const createFs = useCallback(async () => {
    try {
      await mgr.run(() =>
        mgr.api.createFileServer(cid, fs.server, {
          server_name: fs.server || undefined,
          hosts: csv(fs.hosts),
          root: fs.root,
          browse: fs.browse,
          tls: fs.tls,
          index_names: fs.indexNames ? csv(fs.indexNames) : undefined,
        }),
      );
      setDetail({ fileServer: "created" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, fs]);

  const createRd = useCallback(async () => {
    try {
      await mgr.run(() =>
        mgr.api.createRedirect(cid, rd.server, {
          server_name: rd.server || undefined,
          hosts: csv(rd.hosts),
          target: rd.target,
          permanent: rd.permanent,
        }),
      );
      setDetail({ redirect: "created" });
    } catch {
      /* surfaced */
    }
  }, [mgr, cid, rd]);

  const getUpstreams = () =>
    void mgr
      .run(() => mgr.api.getUpstreams(cid))
      .then(setDetail)
      .catch(() => {});

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={getUpstreams} disabled={mgr.isLoading}>
        <Network size={12} />
        {t("integrations.caddy.getUpstreams", "Reverse-proxy upstreams")}
      </button>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.createReverseProxy", "Create reverse proxy")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.caddy.server", "Server")}>
            <input className={field} value={rp.server} onChange={(e) => setRp((s) => ({ ...s, server: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.caddy.hostsCsv", "Hosts (comma-separated)")}>
            <input className={field} value={rp.hosts} onChange={(e) => setRp((s) => ({ ...s, hosts: e.target.value }))} placeholder="example.com" />
          </Labeled>
          <Labeled label={t("integrations.caddy.upstreamsCsv", "Upstreams (comma-separated)")}>
            <input className={field} value={rp.upstreams} onChange={(e) => setRp((s) => ({ ...s, upstreams: e.target.value }))} placeholder="localhost:8080" />
          </Labeled>
          <Labeled label={t("integrations.caddy.healthCheckPath", "Health check path")}>
            <input className={field} value={rp.healthCheckPath} onChange={(e) => setRp((s) => ({ ...s, healthCheckPath: e.target.value }))} placeholder="/healthz" />
          </Labeled>
          <Labeled label={t("integrations.caddy.loadBalancing", "Load balancing policy")}>
            <input className={field} value={rp.loadBalancing} onChange={(e) => setRp((s) => ({ ...s, loadBalancing: e.target.value }))} placeholder="round_robin" />
          </Labeled>
          <Labeled label={t("integrations.caddy.stripPrefix", "Strip path prefix")}>
            <input className={field} value={rp.stripPrefix} onChange={(e) => setRp((s) => ({ ...s, stripPrefix: e.target.value }))} />
          </Labeled>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input type="checkbox" checked={rp.tls} onChange={(e) => setRp((s) => ({ ...s, tls: e.target.checked }))} />
          {t("integrations.caddy.enableTls", "Enable automatic HTTPS")}
        </label>
        <button className={`${btn} mt-2`} onClick={createRp} disabled={mgr.isLoading || !rp.hosts || !rp.upstreams}>
          {t("integrations.caddy.create", "Create")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.createFileServer", "Create file server")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.caddy.server", "Server")}>
            <input className={field} value={fs.server} onChange={(e) => setFs((s) => ({ ...s, server: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.caddy.hostsCsv", "Hosts (comma-separated)")}>
            <input className={field} value={fs.hosts} onChange={(e) => setFs((s) => ({ ...s, hosts: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.caddy.root", "Root directory")}>
            <input className={field} value={fs.root} onChange={(e) => setFs((s) => ({ ...s, root: e.target.value }))} placeholder="/var/www" />
          </Labeled>
          <Labeled label={t("integrations.caddy.indexNamesCsv", "Index files (comma-separated)")}>
            <input className={field} value={fs.indexNames} onChange={(e) => setFs((s) => ({ ...s, indexNames: e.target.value }))} placeholder="index.html" />
          </Labeled>
        </div>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={fs.browse} onChange={(e) => setFs((s) => ({ ...s, browse: e.target.checked }))} />
            {t("integrations.caddy.browse", "Enable directory browsing")}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={fs.tls} onChange={(e) => setFs((s) => ({ ...s, tls: e.target.checked }))} />
            {t("integrations.caddy.enableTls", "Enable automatic HTTPS")}
          </label>
        </div>
        <button className={`${btn} mt-2`} onClick={createFs} disabled={mgr.isLoading || !fs.hosts || !fs.root}>
          {t("integrations.caddy.create", "Create")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.caddy.createRedirect", "Create redirect")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.caddy.server", "Server")}>
            <input className={field} value={rd.server} onChange={(e) => setRd((s) => ({ ...s, server: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.caddy.hostsCsv", "Hosts (comma-separated)")}>
            <input className={field} value={rd.hosts} onChange={(e) => setRd((s) => ({ ...s, hosts: e.target.value }))} />
          </Labeled>
          <Labeled label={t("integrations.caddy.target", "Target URL")}>
            <input className={field} value={rd.target} onChange={(e) => setRd((s) => ({ ...s, target: e.target.value }))} placeholder="https://example.com" />
          </Labeled>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input type="checkbox" checked={rd.permanent} onChange={(e) => setRd((s) => ({ ...s, permanent: e.target.checked }))} />
          {t("integrations.caddy.permanent", "Permanent (301)")}
        </label>
        <button className={`${btn} mt-2`} onClick={createRd} disabled={mgr.isLoading || !rd.hosts || !rd.target}>
          {t("integrations.caddy.create", "Create")}
        </button>
      </div>

      <JsonView value={detail} />
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
  { key: "config", labelKey: "integrations.caddy.tabConfig", labelDefault: "Config", icon: FileText },
  { key: "caddyfile", labelKey: "integrations.caddy.tabCaddyfile", labelDefault: "Caddyfile", icon: FileCode2 },
  { key: "servers", labelKey: "integrations.caddy.tabServers", labelDefault: "Servers", icon: ServerCog },
  { key: "routes", labelKey: "integrations.caddy.tabRoutes", labelDefault: "Routes", icon: RouteIcon },
  { key: "tls", labelKey: "integrations.caddy.tabTls", labelDefault: "TLS", icon: ShieldCheck },
  { key: "proxy", labelKey: "integrations.caddy.tabProxy", labelDefault: "Proxy", icon: Network },
];

const CaddyPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useCaddy();
  const [tab, setTab] = useState<TabKey>("config");

  if (!isOpen) return null;

  const cid = mgr.connectionId;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Boxes className="h-5 w-5 text-primary" />
          {t("integrations.caddy.title", "Caddy")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isConnected
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${mgr.isConnected ? "bg-green-500" : "bg-[var(--color-textMuted)]"}`} />
            {mgr.isConnected
              ? mgr.summary?.admin_url ?? t("integrations.caddy.connected", "Connected")
              : t("integrations.caddy.disconnected", "Disconnected")}
          </span>
          {mgr.summary?.version && (
            <span className="text-[var(--color-textMuted)]">v{mgr.summary.version}</span>
          )}
          {mgr.isConnected && (
            <button className={btn} onClick={() => void mgr.disconnect()}>
              {t("integrations.caddy.disconnect", "Disconnect")}
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
            {tab === "config" && <ConfigTab mgr={mgr} cid={cid} />}
            {tab === "caddyfile" && <CaddyfileTab mgr={mgr} cid={cid} />}
            {tab === "servers" && <ServersTab mgr={mgr} cid={cid} />}
            {tab === "routes" && <RoutesTab mgr={mgr} cid={cid} />}
            {tab === "tls" && <TlsTab mgr={mgr} cid={cid} />}
            {tab === "proxy" && <ProxyTab mgr={mgr} cid={cid} />}
          </div>
        </>
      )}
    </div>
  );
};

export default CaddyPanel;

/** Registry descriptor for the Caddy integration (category: web).
 *  The Wave-4 web integrator appends this to `registry.web.ts`. */
export const caddyDescriptor: IntegrationDescriptor = {
  key: "caddy",
  label: "Caddy",
  category: "web-server",
  icon: Boxes,
  importPanel: () => import("./CaddyPanel"),
};
