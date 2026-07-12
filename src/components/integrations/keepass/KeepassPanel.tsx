// KeePass integration panel — shell (t42-keepass-L, category = vault).
//
// KeePass has NO network host: the "connection" is a local `.kdbx` file opened
// with a composite key (master password + optional key file). This shell owns:
//   - the open-database connect form (.kdbx picker via @tauri-apps/plugin-dialog,
//     master password = the secret, optional key file), persisting non-secret
//     config + the master password via `useIntegrationConfigStore`;
//   - the registry-driven sub-tab bar (from `./registry.ts`) that category execs
//     (t42-keepass-c1 `database`, t42-keepass-c2 `tools`) plug their management
//     tabs into. The shell routes the open database's id (`dbId`) to the active tab.
//
// The open/create invoke is inline here (not via the hooks barrel) so the shell
// compiles standalone before the category slices land.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  KeyRound,
  FolderOpen,
  Lock,
  Loader2,
  ShieldCheck,
  FileKey2,
} from "lucide-react";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../../types/integrations/registry";
import type {
  KeePassDatabase,
  OpenDatabaseRequest,
} from "../../../types/keepass";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { FeatureErrorBoundary } from "../../app/FeatureErrorBoundary";
import { keepassTabs, type KeepassTabDescriptor } from "./registry";

const INTEGRATION_KEY = "keepass";

/** Cache one lazy component per registered sub-tab, keyed by categoryKey, so the
 *  identity is stable across renders (React.lazy requirement). */
const lazyTabCache = new Map<
  string,
  React.LazyExoticComponent<React.ComponentType<{ dbId: string }>>
>();

function getLazyTab(descriptor: KeepassTabDescriptor) {
  let cached = lazyTabCache.get(descriptor.categoryKey);
  if (!cached) {
    cached = React.lazy(descriptor.importTab);
    lazyTabCache.set(descriptor.categoryKey, cached);
  }
  return cached;
}

export const KeepassPanel: React.FC<IntegrationPanelProps> = ({
  onClose,
  instanceId,
}) => {
  const { t } = useTranslation();
  const { instancesFor, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();

  const [kdbxPath, setKdbxPath] = useState("");
  const [keyFilePath, setKeyFilePath] = useState("");
  const [password, setPassword] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [name, setName] = useState("");

  const [database, setDatabase] = useState<KeePassDatabase | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(
    keepassTabs[0]?.categoryKey ?? null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a saved instance (path/key file/name + the vaulted master pw).
  useEffect(() => {
    if (!instanceId) return;
    const inst = instancesFor(INTEGRATION_KEY).find((i) => i.id === instanceId);
    if (!inst) return;
    setName(inst.name);
    setKdbxPath(inst.fields?.kdbxPath ?? "");
    setKeyFilePath(inst.fields?.keyFilePath ?? "");
    setReadOnly(inst.fields?.readOnly === "true");
    void readSecret(inst).then((secret) => {
      if (secret) setPassword(secret);
    });
  }, [instanceId, instancesFor, readSecret]);

  const pickKdbx = useCallback(async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "KeePass Database", extensions: ["kdbx"] }],
    });
    if (typeof selected === "string") {
      setKdbxPath(selected);
      if (!name) {
        const base = selected.split(/[/\\]/).pop() ?? selected;
        setName(base.replace(/\.kdbx$/i, ""));
      }
    }
  }, [name]);

  const pickKeyFile = useCallback(async () => {
    const selected = await openFileDialog({ multiple: false });
    if (typeof selected === "string") setKeyFilePath(selected);
  }, []);

  const persistInstance = useCallback(async () => {
    const fields: Record<string, string> = { kdbxPath };
    if (keyFilePath) fields.keyFilePath = keyFilePath;
    if (readOnly) fields.readOnly = "true";
    const instanceName = name || kdbxPath.split(/[/\\]/).pop() || "KeePass";
    try {
      const existing = instancesFor(INTEGRATION_KEY).find(
        (i) => i.id === instanceId,
      );
      if (existing) {
        await updateInstance(existing.id, {
          name: instanceName,
          fields,
          secret: password || undefined,
        });
      } else {
        await createInstance({
          integrationKey: INTEGRATION_KEY,
          name: instanceName,
          fields,
          secret: password || undefined,
        });
      }
    } catch {
      // Persistence is best-effort (vault may be unavailable); the database is
      // already open, so don't block the session on a failed save.
    }
  }, [
    kdbxPath,
    keyFilePath,
    readOnly,
    name,
    password,
    instanceId,
    instancesFor,
    createInstance,
    updateInstance,
  ]);

  const handleOpen = useCallback(async () => {
    if (!kdbxPath) {
      setError(t("integrations.keepass.errorNoPath", "Select a .kdbx file"));
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const req: OpenDatabaseRequest = {
        filePath: kdbxPath,
        password: password || undefined,
        keyFilePath: keyFilePath || undefined,
        readOnly,
      };
      const db = await invoke<KeePassDatabase>("keepass_open_database", { req });
      setDatabase(db);
      setActiveTab(keepassTabs[0]?.categoryKey ?? null);
      await persistInstance();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    } finally {
      setIsConnecting(false);
    }
  }, [kdbxPath, password, keyFilePath, readOnly, persistInstance, t]);

  const handleClose = useCallback(async () => {
    if (!database) return;
    try {
      await invoke("keepass_close_database", {
        dbId: database.id,
        saveFirst: false,
      });
    } catch {
      // Non-fatal — drop the in-memory session regardless.
    }
    setDatabase(null);
  }, [database]);

  const ActiveTab = useMemo(() => {
    if (!activeTab) return null;
    const descriptor = keepassTabs.find((d) => d.categoryKey === activeTab);
    return descriptor ? getLazyTab(descriptor) : null;
  }, [activeTab]);

  // ── Connect form (no database open yet) ─────────────────────────────────────
  if (!database) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-6">
        <div className="mx-auto w-full max-w-md">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
            <KeyRound className="h-5 w-5 text-primary" />
            {t("integrations.keepass.openTitle", "Open KeePass database")}
          </h2>
          <p className="mb-4 text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.keepass.openSubtitle",
              "Open a local .kdbx file with its master password.",
            )}
          </p>

          <label className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.keepass.databaseFile", "Database file (.kdbx)")}
          </label>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={kdbxPath}
              onChange={(e) => setKdbxPath(e.target.value)}
              placeholder={t(
                "integrations.keepass.databaseFilePlaceholder",
                "/path/to/vault.kdbx",
              )}
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              data-testid="keepass-kdbx-path"
            />
            <button
              type="button"
              onClick={pickKdbx}
              className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              title={t("integrations.keepass.browse", "Browse")}
            >
              <FolderOpen size={14} />
            </button>
          </div>

          <label className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.keepass.masterPassword", "Master password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5 text-sm text-[var(--color-text)]"
            data-testid="keepass-master-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleOpen();
            }}
          />

          <label className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.keepass.keyFile", "Key file (optional)")}
          </label>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={keyFilePath}
              onChange={(e) => setKeyFilePath(e.target.value)}
              placeholder={t(
                "integrations.keepass.keyFilePlaceholder",
                "/path/to/key.keyx",
              )}
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              data-testid="keepass-key-file"
            />
            <button
              type="button"
              onClick={pickKeyFile}
              className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
              title={t("integrations.keepass.browse", "Browse")}
            >
              <FileKey2 size={14} />
            </button>
          </div>

          <label className="mb-4 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            {t("integrations.keepass.readOnly", "Open read-only")}
          </label>

          {error && (
            <div
              className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400"
              data-testid="keepass-error"
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpen}
              disabled={isConnecting || !kdbxPath}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              data-testid="keepass-open"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {t("integrations.keepass.open", "Open")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="app-bar-button px-3 py-1.5 text-sm"
            >
              {t("integrations.keepass.cancel", "Cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Open database: header + registry-driven sub-tabs ────────────────────────
  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium text-[var(--color-text)]">
            {database.name || database.filePath}
          </span>
          <span className="shrink-0 text-xs text-[var(--color-textMuted)]">
            {database.entryCount}{" "}
            {t("integrations.keepass.entries", "entries")}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
          title={t("integrations.keepass.closeDatabase", "Close database")}
        >
          <Lock size={14} />
          {t("integrations.keepass.closeDatabase", "Close database")}
        </button>
      </div>

      {keepassTabs.length > 0 && (
        <div
          className="flex gap-1 border-b border-[var(--color-border)] px-2"
          role="tablist"
        >
          {keepassTabs.map((tab) => (
            <button
              key={tab.categoryKey}
              role="tab"
              aria-selected={activeTab === tab.categoryKey}
              onClick={() => setActiveTab(tab.categoryKey)}
              className={`px-3 py-1.5 text-sm ${
                activeTab === tab.categoryKey
                  ? "border-b-2 border-primary text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)]"
              }`}
              data-testid={`keepass-tab-${tab.categoryKey}`}
            >
              {t(tab.labelKey, tab.labelDefault)}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {ActiveTab ? (
          <FeatureErrorBoundary
            boundaryKey={`keepass:${activeTab}:${database.id}`}
            title={t("integrations.keepass.tabCrashed", "Panel crashed")}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              }
            >
              <ActiveTab dbId={database.id} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-sm text-[var(--color-textSecondary)]">
            <ShieldCheck className="h-8 w-8 text-[var(--color-textMuted)]" />
            {t(
              "integrations.keepass.noTabs",
              "Database open. Management tabs load here as they are added.",
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Top-level integration descriptor. NOTE: exported only — the wave integrator
 *  appends it to `registry.vault.ts` (disjoint-append discipline, §3). */
export const keepassDescriptor: IntegrationDescriptor = {
  key: INTEGRATION_KEY,
  label: "KeePass",
  category: "vault",
  icon: KeyRound,
  importPanel: () => import("./KeepassPanel"),
};

export default KeepassPanel;
