// PhpPanel — the PHP-FPM integration panel SHELL (t42 §4b, crate lead t42-php-L).
// Owns the connect/config form + connection lifecycle and a registry-driven
// sub-tab bar. The command surface itself (versions/FPM pools/process/opcache/
// sessions and php.ini/extensions/composer/logs) is bound by the per-category tab
// modules, which register themselves in `./registry.ts`; this shell never changes
// per-category.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FileCode2, Loader2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import type { PhpConnectionConfig } from "../../../types/php";
import { usePhpConnection } from "../../../hooks/integration/php/usePhpConnection";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { phpCategoryTabs } from "./registry";

/** The secret blob stored in the OS vault packs both SSH secrets (the store has
 *  one secret slot per instance); both are sent to the backend at connect time. */
interface PhpSecret {
  password: string;
  key: string;
}

const DEFAULT_SSH_PORT = 22;
const DEFAULT_TIMEOUT_SECS = 30;

const emptyForm = {
  name: "",
  host: "",
  port: String(DEFAULT_SSH_PORT),
  sshUser: "",
  sshPassword: "",
  sshKey: "",
  phpBin: "",
  fpmBin: "",
  composerBin: "",
  configDir: "",
  fpmPoolDir: "",
  timeoutSecs: String(DEFAULT_TIMEOUT_SECS),
};

type FormState = typeof emptyForm;

const PhpPanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const {
    isLoading: storeLoading,
    instancesFor,
    createInstance,
    updateInstance,
    readSecret,
  } = useIntegrationConfigStore();
  const {
    connectionId,
    summary,
    connecting,
    error,
    connect,
    disconnect,
    setError,
  } = usePhpConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(
    phpCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("php").find((i) => i.id === instanceId);
    if (!instance) return;
    let cancelled = false;
    (async () => {
      const secretRaw = await readSecret(instance);
      let secret: PhpSecret = { password: "", key: "" };
      if (secretRaw) {
        try {
          secret = JSON.parse(secretRaw) as PhpSecret;
        } catch {
          // Legacy / opaque secret — treat the whole string as the password.
          secret = { password: secretRaw, key: "" };
        }
      }
      if (cancelled) return;
      const fields = instance.fields ?? {};
      setForm({
        name: instance.name,
        host: instance.host ?? "",
        port: fields.port ?? String(DEFAULT_SSH_PORT),
        sshUser: fields.sshUser ?? "",
        sshPassword: secret.password,
        sshKey: secret.key,
        phpBin: fields.phpBin ?? "",
        fpmBin: fields.fpmBin ?? "",
        composerBin: fields.composerBin ?? "",
        configDir: fields.configDir ?? "",
        fpmPoolDir: fields.fpmPoolDir ?? "",
        timeoutSecs: fields.timeoutSecs ?? String(DEFAULT_TIMEOUT_SECS),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, storeLoading, instancesFor, readSecret]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const buildConfig = useCallback((): PhpConnectionConfig => {
    const port = Number.parseInt(form.port, 10);
    const timeoutSecs = Number.parseInt(form.timeoutSecs, 10);
    const trimmed = (v: string) => {
      const s = v.trim();
      return s.length > 0 ? s : undefined;
    };
    return {
      host: form.host.trim(),
      port: Number.isFinite(port) ? port : DEFAULT_SSH_PORT,
      ssh_user: trimmed(form.sshUser),
      ssh_password: form.sshPassword.length > 0 ? form.sshPassword : undefined,
      ssh_key: form.sshKey.length > 0 ? form.sshKey : undefined,
      php_bin: trimmed(form.phpBin),
      fpm_bin: trimmed(form.fpmBin),
      composer_bin: trimmed(form.composerBin),
      config_dir: trimmed(form.configDir),
      fpm_pool_dir: trimmed(form.fpmPoolDir),
      timeout_secs: Number.isFinite(timeoutSecs)
        ? timeoutSecs
        : DEFAULT_TIMEOUT_SECS,
    };
  }, [form]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const config = buildConfig();
      const secret = JSON.stringify({
        password: form.sshPassword,
        key: form.sshKey,
      } satisfies PhpSecret);
      const fields = {
        port: String(config.port ?? DEFAULT_SSH_PORT),
        sshUser: config.ssh_user ?? "",
        phpBin: config.php_bin ?? "",
        fpmBin: config.fpm_bin ?? "",
        composerBin: config.composer_bin ?? "",
        configDir: config.config_dir ?? "",
        fpmPoolDir: config.fpm_pool_dir ?? "",
        timeoutSecs: String(config.timeout_secs ?? DEFAULT_TIMEOUT_SECS),
      };
      const name = form.name.trim() || form.host.trim() || "PHP-FPM";

      // Persist host + creds (encrypted) and use the instance id as the stable
      // connection id, so reconnecting a saved instance reuses its id.
      let id = instanceId ?? null;
      if (id) {
        await updateInstance(id, {
          integrationKey: "php",
          name,
          host: config.host,
          fields,
          secret,
        });
      } else {
        const created = await createInstance({
          integrationKey: "php",
          name,
          host: config.host,
          fields,
          secret,
        });
        id = created.id;
      }

      await connect(id, config);
      setActiveTab(phpCategoryTabs[0]?.categoryKey ?? null);
    } catch {
      // `connect` already surfaced the error via the hook; persistence failures
      // fall through here too and leave the form editable.
    }
  }, [
    buildConfig,
    form,
    instanceId,
    createInstance,
    updateInstance,
    connect,
    setError,
  ]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = phpCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <FileCode2 className="h-5 w-5 text-primary" />
          {t("integrations.php.title", "PHP-FPM")}
          {summary && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {summary.host}
              {summary.default_version ? ` · PHP ${summary.default_version}` : ""}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.php.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.php.disconnect", "Disconnect")}
          </button>
        )}
      </div>

      {error && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      {!connected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.php.connectHint",
                "Manage PHP versions, PHP-FPM pools, extensions and Composer on a server over SSH.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.php.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="web-host-01"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-[3] flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.php.fields.host", "Host")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.host}
                  onChange={(e) => setField("host", e.target.value)}
                  placeholder="server.example.com"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t("integrations.php.fields.port", "SSH port")}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.port}
                  onChange={(e) => setField("port", e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.php.fields.sshUser", "SSH username")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.sshUser}
                onChange={(e) => setField("sshUser", e.target.value)}
                autoComplete="off"
                placeholder="root"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.php.fields.sshPassword", "SSH password")}
              <input
                type="password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.sshPassword}
                onChange={(e) => setField("sshPassword", e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.php.fields.sshKey",
                "SSH private key (optional)",
              )}
              <textarea
                className="min-h-[64px] rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
                value={form.sshKey}
                onChange={(e) => setField("sshKey", e.target.value)}
                autoComplete="off"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                spellCheck={false}
              />
            </label>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="self-start text-xs text-primary underline-offset-2 hover:underline"
            >
              {showAdvanced
                ? t("integrations.php.hideAdvanced", "Hide advanced")
                : t("integrations.php.showAdvanced", "Advanced (binary paths)")}
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-3 rounded border border-[var(--color-border)] p-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.phpBin", "php binary")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.phpBin}
                    onChange={(e) => setField("phpBin", e.target.value)}
                    placeholder="php"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.fpmBin", "php-fpm binary")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.fpmBin}
                    onChange={(e) => setField("fpmBin", e.target.value)}
                    placeholder="php-fpm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.composerBin", "composer binary")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.composerBin}
                    onChange={(e) => setField("composerBin", e.target.value)}
                    placeholder="composer"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.configDir", "PHP config dir")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.configDir}
                    onChange={(e) => setField("configDir", e.target.value)}
                    placeholder="/etc/php"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.fpmPoolDir", "FPM pool.d dir")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.fpmPoolDir}
                    onChange={(e) => setField("fpmPoolDir", e.target.value)}
                    placeholder="/etc/php/8.3/fpm/pool.d"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                  {t("integrations.php.fields.timeoutSecs", "Timeout (s)")}
                  <input
                    className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                    value={form.timeoutSecs}
                    onChange={(e) => setField("timeoutSecs", e.target.value)}
                    inputMode="numeric"
                  />
                </label>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={connecting || !form.host.trim() || !form.sshUser.trim()}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.php.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {phpCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {phpCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(`integrations.php.tabs.${tab.categoryKey}`, tab.label)}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  }
                >
                  {ActiveTab && connectionId && (
                    <ActiveTab connectionId={connectionId} />
                  )}
                </Suspense>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-textSecondary)]">
              <RefreshCw className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                {t(
                  "integrations.php.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              {summary && (
                <p className="text-xs">
                  {summary.host}
                  {summary.default_version
                    ? ` · PHP ${summary.default_version}`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PhpPanel;
