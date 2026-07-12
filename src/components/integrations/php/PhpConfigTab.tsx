// PHP-FPM — "Configuration, Extensions & Composer" sub-tab (t42-php-c2).
//
// Binds all 45 config-category commands across four grouped, collapsible
// sections:
//   php.ini (10) · Modules/Extensions/PECL (11) · Composer (15) · Logs (9)
// Mounted only when the panel shell is connected, so `connectionId` is always a
// live PHP connection id — it is passed as the `id` arg to every command. Most
// commands additionally take a `version` (and php.ini commands a `sapi`); this
// tab owns a shared version+SAPI selector at the top. The version list is fetched
// read-only via `php_list_versions` (owned by the runtime category), defaulting
// to the marked default version.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileCog,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import {
  usePhpConfig,
  type PhpConfigManager,
  type PhpVersionOption,
} from "../../../hooks/integration/php/usePhpConfig";
import type { PhpTabProps } from "./registry";
import type {
  ComposerGlobalPackage,
  ComposerInfo,
  ComposerInstallRequest,
  ComposerPackage,
  ComposerProject,
  ComposerRunResult,
  ComposerUpdateRequest,
  FpmLogConfig,
  IniBackup,
  PeclPackage,
  PhpIniDirective,
  PhpIniFile,
  PhpIniScanDir,
  PhpLogConfig,
  PhpLogEntry,
  PhpLogReadRequest,
  PhpModule,
  RemovePackageRequest,
  RequirePackageRequest,
  SetIniDirectiveRequest,
} from "../../../types/php/config";

// ─── Shared styling (mirrors the panel shell + sibling tabs) ────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";
const dangerBtn =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-500 hover:bg-red-500/10 disabled:opacity-50";

/** Build the i18n key for a `config.*` fragment leaf. Pair with an English
 *  default at the call site so a missing key degrades gracefully pre-merge. */
const t9 = (key: string) => `integrations.php.config.${key}`;

const DEFAULT_SAPI = "fpm";

const SET_INI_TEMPLATE = (version: string, sapi: string): SetIniDirectiveRequest => ({
  version,
  sapi,
  key: "memory_limit",
  value: "256M",
});

const COMPOSER_INSTALL_TEMPLATE: ComposerInstallRequest = {
  project_path: "/var/www/app",
  no_dev: false,
  optimize_autoloader: false,
  no_scripts: false,
};

const COMPOSER_UPDATE_TEMPLATE: ComposerUpdateRequest = {
  project_path: "/var/www/app",
  packages: [],
  no_dev: false,
  with_dependencies: false,
};

const REQUIRE_TEMPLATE: RequirePackageRequest = {
  project_path: "/var/www/app",
  package: "vendor/package",
  dev: false,
};

const REMOVE_TEMPLATE: RemovePackageRequest = {
  project_path: "/var/www/app",
  package: "vendor/package",
  dev: false,
};

const LOG_READ_TEMPLATE: PhpLogReadRequest = {
  lines: 200,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Root tab: version + SAPI selector, then the four sections
// ═══════════════════════════════════════════════════════════════════════════════

const PhpConfigTab: React.FC<PhpTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const mgr = usePhpConfig();
  const { run, isLoading, error, clearError } = mgr;

  const [versions, setVersions] = useState<PhpVersionOption[]>([]);
  const [version, setVersion] = useState("");
  const [sapi, setSapi] = useState(DEFAULT_SAPI);

  const reloadVersions = useCallback(async () => {
    const list = await run((a) => a.listVersions(connectionId));
    if (list) {
      setVersions(list);
      setVersion(
        (prev) =>
          prev || list.find((v) => v.is_default)?.version || list[0]?.version || "",
      );
    }
  }, [run, connectionId]);

  useEffect(() => {
    void reloadVersions();
  }, [reloadVersions]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Version + SAPI selector */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label className={labelClass}>
            {t(t9("version"), "PHP version")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              list="php-config-versions"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="8.3"
            />
            <datalist id="php-config-versions">
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.is_default ? `${v.version} (default)` : v.version}
                </option>
              ))}
            </datalist>
            <button
              className={btnClass}
              onClick={() => void reloadVersions()}
              disabled={isLoading}
              title={t(t9("reloadVersions"), "Reload versions")}
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          </div>
        </div>
        <div className="min-w-[120px]">
          <label className={labelClass}>{t(t9("sapi"), "SAPI")}</label>
          <input
            className={inputClass}
            list="php-config-sapis"
            value={sapi}
            onChange={(e) => setSapi(e.target.value)}
            placeholder="fpm"
          />
          <datalist id="php-config-sapis">
            <option value="fpm" />
            <option value="cli" />
            <option value="apache2handler" />
            <option value="cgi" />
          </datalist>
        </div>
        <span className="pb-1 text-[10px] text-[var(--color-textSecondary)]">
          {versions.length} {t(t9("versionsLoaded"), "versions")}
        </span>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError}>
            <X size={12} />
          </button>
        </div>
      )}

      <IniSection mgr={mgr} id={connectionId} version={version} sapi={sapi} />
      <ModulesSection mgr={mgr} id={connectionId} version={version} sapi={sapi} />
      <ComposerSection mgr={mgr} id={connectionId} />
      <LogsSection mgr={mgr} id={connectionId} version={version} />
    </div>
  );
};

// ─── Collapsible titled group ───────────────────────────────────────────────---

const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-[var(--color-text)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-2">
          {children}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// php.ini (10)
// ═══════════════════════════════════════════════════════════════════════════════

const IniSection: React.FC<{
  mgr: PhpConfigManager;
  id: string;
  version: string;
  sapi: string;
}> = ({ mgr, id, version, sapi }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [file, setFile] = useState<PhpIniFile | null>(null);
  const [directives, setDirectives] = useState<PhpIniDirective[] | null>(null);
  const [scanDir, setScanDir] = useState<PhpIniScanDir | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<string[] | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [backup, setBackup] = useState<IniBackup | null>(null);

  const [key, setKey] = useState("");
  const [directive, setDirective] = useState<PhpIniDirective | null>(null);
  const [setValue, setSetValue] = useState("");
  const [setFilePath, setSetFilePath] = useState("");

  const [restoreBackup, setRestoreBackup] = useState("");
  const [restoreTarget, setRestoreTarget] = useState("");

  const ready = Boolean(version) && Boolean(sapi);

  return (
    <Group
      title={t(t9("ini.title"), "php.ini Configuration")}
      icon={<FileCog size={12} />}
      defaultOpen
    >
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!ready}
          onClick={() =>
            run((a) => a.getIniFile(id, version, sapi)).then(
              (f) => f && setFile(f),
            )
          }
        >
          {t(t9("ini.loadFile"), "Load php.ini")}
        </button>
        <button
          className={btnClass}
          disabled={!ready}
          onClick={() =>
            run((a) => a.listIniDirectives(id, version, sapi)).then(
              (d) => d && setDirectives(d),
            )
          }
        >
          {t(t9("ini.listDirectives"), "List directives")}
        </button>
        <button
          className={btnClass}
          disabled={!ready}
          onClick={() =>
            run((a) => a.getIniScanDir(id, version, sapi)).then(
              (s) => s && setScanDir(s),
            )
          }
        >
          {t(t9("ini.scanDir"), "Scan dir")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listLoadedIniFiles(id, version)).then(
              (f) => f && setLoadedFiles(f),
            )
          }
        >
          {t(t9("ini.loadedFiles"), "Loaded .ini files")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.validateIni(id, version)).then(
              (v) => v !== undefined && setValid(v),
            )
          }
        >
          {t(t9("ini.validate"), "Validate")}
        </button>
        <button
          className={btnClass}
          disabled={!ready}
          onClick={() =>
            run((a) => a.backupIni(id, version, sapi)).then(
              (b) => b && setBackup(b),
            )
          }
        >
          {t(t9("ini.backup"), "Backup")}
        </button>
      </div>

      {valid !== null && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("ini.validState"), "php.ini syntax")}:{" "}
          {valid
            ? t(t9("ini.ok"), "valid")
            : t(t9("ini.invalid"), "invalid")}
        </p>
      )}
      {backup && (
        <p className="break-all text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("ini.backupAt"), "Backup")}: {backup.backup_path} ·{" "}
          {backup.timestamp}
        </p>
      )}
      {scanDir && (
        <div>
          <p className="text-[11px] text-[var(--color-textSecondary)]">
            {scanDir.path}
          </p>
          <RowList items={scanDir.files.map((f) => ({ key: f, primary: f }))} />
        </div>
      )}
      {loadedFiles && (
        <RowList items={loadedFiles.map((f) => ({ key: f, primary: f }))} />
      )}
      {file && (
        <div>
          <p className="break-all text-[11px] text-[var(--color-textSecondary)]">
            {file.path}
          </p>
          <IniTable directives={file.directives} />
        </div>
      )}
      {directives && <IniTable directives={directives} />}

      {/* Get / set / remove a single directive */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("ini.directiveKey"), "Directive key")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="memory_limit"
            />
            <button
              className={btnClass}
              disabled={!ready || !key.trim()}
              onClick={() =>
                run((a) => a.getIniDirective(id, version, sapi, key.trim())).then(
                  (d) => d && setDirective(d),
                )
              }
            >
              {t(t9("ini.getDirective"), "Get")}
            </button>
            <button
              className={dangerBtn}
              disabled={!ready || !key.trim()}
              onClick={() =>
                run((a) =>
                  a.removeIniDirective(id, version, sapi, key.trim()),
                ).then(() => setDirective(null))
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
          {directive && (
            <p className="mt-1 break-all text-[11px] text-[var(--color-textSecondary)]">
              {directive.key} = {directive.local_value}
              {directive.source_file ? ` · ${directive.source_file}` : ""}
            </p>
          )}
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("ini.setDirective"), "Set directive")}
          </label>
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              placeholder={t(t9("ini.value"), "value (e.g. 256M)")}
            />
            <input
              className={inputClass}
              value={setFilePath}
              onChange={(e) => setSetFilePath(e.target.value)}
              placeholder={t(t9("ini.filePath"), "target .ini (optional, auto)")}
            />
            <button
              className={primaryBtn}
              disabled={!ready || !key.trim()}
              onClick={() => {
                const request: SetIniDirectiveRequest = {
                  ...SET_INI_TEMPLATE(version, sapi),
                  version,
                  sapi,
                  key: key.trim(),
                  value: setValue,
                  file_path: setFilePath.trim() || undefined,
                };
                void run((a) => a.setIniDirective(id, request));
              }}
            >
              {t(t9("ini.apply"), "Apply")}
            </button>
          </div>
        </div>
      </div>

      {/* Restore from a prior backup */}
      <div>
        <label className={labelClass}>
          {t(t9("ini.restore"), "Restore .ini from backup")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[260px]`}
            value={restoreBackup}
            onChange={(e) => setRestoreBackup(e.target.value)}
            placeholder={t(t9("ini.backupPath"), "backup path")}
          />
          <input
            className={`${inputClass} max-w-[260px]`}
            value={restoreTarget}
            onChange={(e) => setRestoreTarget(e.target.value)}
            placeholder={t(t9("ini.targetPath"), "target path")}
          />
          <button
            className={btnClass}
            disabled={!restoreBackup.trim() || !restoreTarget.trim()}
            onClick={() =>
              run((a) =>
                a.restoreIni(id, restoreBackup.trim(), restoreTarget.trim()),
              )
            }
          >
            {t(t9("ini.restoreBtn"), "Restore")}
          </button>
        </div>
      </div>
    </Group>
  );
};

const IniTable: React.FC<{ directives: PhpIniDirective[] }> = ({
  directives,
}) => {
  const { t } = useTranslation();
  return (
    <div className="max-h-56 overflow-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)]">
          <tr>
            <th className="px-1 py-0.5">{t(t9("ini.col.key"), "Key")}</th>
            <th className="px-1 py-0.5">{t(t9("ini.col.local"), "Local")}</th>
            <th className="px-1 py-0.5">{t(t9("ini.col.master"), "Master")}</th>
          </tr>
        </thead>
        <tbody>
          {directives.map((d) => (
            <tr key={d.key} className="border-t border-[var(--color-border)]">
              <td className="px-1 py-0.5 font-medium text-[var(--color-text)]">
                {d.key}
              </td>
              <td className="px-1 py-0.5 break-all">{d.local_value}</td>
              <td className="px-1 py-0.5 break-all text-[var(--color-textSecondary)]">
                {d.master_value ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Modules / Extensions / PECL (11)
// ═══════════════════════════════════════════════════════════════════════════════

const ModulesSection: React.FC<{
  mgr: PhpConfigManager;
  id: string;
  version: string;
  sapi: string;
}> = ({ mgr, id, version, sapi }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [modules, setModules] = useState<PhpModule[] | null>(null);
  const [available, setAvailable] = useState<string[] | null>(null);
  const [pecl, setPecl] = useState<PeclPackage[] | null>(null);
  const [module, setModule] = useState<PhpModule | null>(null);
  const [loaded, setLoaded] = useState<boolean | null>(null);

  const [name, setName] = useState("");
  const [method, setMethod] = useState("");
  const [peclName, setPeclName] = useState("");
  const [peclVersion, setPeclVersion] = useState("");

  const reloadModules = useCallback(
    () =>
      run((a) => a.listModules(id, version)).then((m) => m && setModules(m)),
    [run, id, version],
  );

  return (
    <Group
      title={t(t9("modules.title"), "Modules, Extensions & PECL")}
      icon={<Boxes size={12} />}
    >
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!version}
          onClick={reloadModules}
        >
          {t(t9("modules.list"), "List modules")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.listAvailableModules(id, version)).then(
              (m) => m && setAvailable(m),
            )
          }
        >
          {t(t9("modules.available"), "Available modules")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listPeclPackages(id)).then((p) => p && setPecl(p))
          }
        >
          {t(t9("modules.peclList"), "PECL packages")}
        </button>
      </div>

      {modules && (
        <div className="flex flex-wrap gap-1">
          {modules.map((m) => (
            <span
              key={m.name}
              className={`rounded border px-1 py-0.5 text-[10px] ${
                m.enabled
                  ? "border-green-500/40 text-green-500"
                  : "border-[var(--color-border)] text-[var(--color-textSecondary)]"
              }`}
              title={`${m.module_type}${m.version ? ` · ${m.version}` : ""}`}
            >
              {m.name}
            </span>
          ))}
        </div>
      )}
      {available && (
        <RowList items={available.map((m) => ({ key: m, primary: m }))} />
      )}
      {pecl && (
        <RowList
          items={pecl.map((p) => ({
            key: p.name,
            primary: p.name,
            secondary: `${p.version ?? ""} ${p.state ?? ""}`.trim() || undefined,
          }))}
        />
      )}

      {/* Per-module actions */}
      <div>
        <label className={labelClass}>
          {t(t9("modules.name"), "Module / extension name")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[200px]`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="redis"
          />
          <input
            className={`${inputClass} max-w-[140px]`}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder={t(t9("modules.method"), "install via (pecl/apt…)")}
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            className={btnClass}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) => a.getModule(id, version, name.trim())).then(
                (m) => m && setModule(m),
              )
            }
          >
            {t(t9("modules.get"), "Get")}
          </button>
          <button
            className={btnClass}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) => a.isModuleLoaded(id, version, name.trim())).then(
                (l) => l !== undefined && setLoaded(l),
              )
            }
          >
            {t(t9("modules.isLoaded"), "Is loaded?")}
          </button>
          <button
            className={btnClass}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) =>
                a.enableModule(id, {
                  version,
                  module_name: name.trim(),
                  sapi: sapi || undefined,
                }),
              ).then(reloadModules)
            }
          >
            {t(t9("modules.enable"), "Enable")}
          </button>
          <button
            className={btnClass}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) =>
                a.disableModule(id, {
                  version,
                  module_name: name.trim(),
                  sapi: sapi || undefined,
                }),
              ).then(reloadModules)
            }
          >
            {t(t9("modules.disable"), "Disable")}
          </button>
          <button
            className={primaryBtn}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) =>
                a.installModule(id, {
                  version,
                  module_name: name.trim(),
                  method: method.trim() || undefined,
                }),
              ).then(reloadModules)
            }
          >
            {t(t9("modules.install"), "Install")}
          </button>
          <button
            className={dangerBtn}
            disabled={!version || !name.trim()}
            onClick={() =>
              run((a) => a.uninstallModule(id, version, name.trim())).then(
                reloadModules,
              )
            }
          >
            <Trash2 size={12} />
            {t(t9("modules.uninstall"), "Uninstall")}
          </button>
        </div>
        {loaded !== null && (
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("modules.loadedState"), "Loaded")}:{" "}
            {loaded ? t(t9("modules.yes"), "yes") : t(t9("modules.no"), "no")}
          </p>
        )}
        {module && <Json value={module} />}
      </div>

      {/* PECL install / uninstall */}
      <div>
        <label className={labelClass}>
          {t(t9("modules.pecl"), "PECL package")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[200px]`}
            value={peclName}
            onChange={(e) => setPeclName(e.target.value)}
            placeholder="apcu"
          />
          <input
            className={`${inputClass} max-w-[140px]`}
            value={peclVersion}
            onChange={(e) => setPeclVersion(e.target.value)}
            placeholder={t(t9("modules.peclVersion"), "version (optional)")}
          />
          <button
            className={primaryBtn}
            disabled={!peclName.trim()}
            onClick={() =>
              run((a) =>
                a.installPeclPackage(
                  id,
                  peclName.trim(),
                  peclVersion.trim() || undefined,
                ),
              ).then(() =>
                run((aa) => aa.listPeclPackages(id)).then(
                  (p) => p && setPecl(p),
                ),
              )
            }
          >
            {t(t9("modules.peclInstall"), "Install PECL")}
          </button>
          <button
            className={dangerBtn}
            disabled={!peclName.trim()}
            onClick={() =>
              run((a) => a.uninstallPeclPackage(id, peclName.trim())).then(() =>
                run((aa) => aa.listPeclPackages(id)).then(
                  (p) => p && setPecl(p),
                ),
              )
            }
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Composer (15)
// ═══════════════════════════════════════════════════════════════════════════════

const ComposerSection: React.FC<{ mgr: PhpConfigManager; id: string }> = ({
  mgr,
  id,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [info, setInfo] = useState<ComposerInfo | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [globals, setGlobals] = useState<ComposerGlobalPackage[] | null>(null);
  const [project, setProject] = useState<ComposerProject | null>(null);
  const [outdated, setOutdated] = useState<ComposerPackage[] | null>(null);
  const [result, setResult] = useState<ComposerRunResult | null>(null);

  const [globalPkg, setGlobalPkg] = useState("");
  const [globalVersion, setGlobalVersion] = useState("");
  const [projectPath, setProjectPath] = useState("/var/www/app");
  const [optimize, setOptimize] = useState(false);

  const [installJson, setInstallJson] = useState(() =>
    JSON.stringify(COMPOSER_INSTALL_TEMPLATE, null, 2),
  );
  const [updateJson, setUpdateJson] = useState(() =>
    JSON.stringify(COMPOSER_UPDATE_TEMPLATE, null, 2),
  );
  const [requireJson, setRequireJson] = useState(() =>
    JSON.stringify(REQUIRE_TEMPLATE, null, 2),
  );
  const [removeJson, setRemoveJson] = useState(() =>
    JSON.stringify(REMOVE_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const runJson = useCallback(
    <T,>(json: string, call: (req: T) => void) => {
      let req: T;
      try {
        req = JSON.parse(json) as T;
      } catch (e) {
        setParseError((e as Error).message);
        return;
      }
      setParseError(null);
      call(req);
    },
    [],
  );

  return (
    <Group title={t(t9("composer.title"), "Composer")} icon={<Package size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getComposerInfo(id)).then((i) => i && setInfo(i))
          }
        >
          {t(t9("composer.info"), "Composer info")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.isComposerInstalled(id)).then(
              (v) => v !== undefined && setInstalled(v),
            )
          }
        >
          {t(t9("composer.isInstalled"), "Installed?")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listComposerGlobalPackages(id)).then(
              (g) => g && setGlobals(g),
            )
          }
        >
          {t(t9("composer.globals"), "Global packages")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.composerClearCache(id)).then(() => setResult(null))
          }
        >
          {t(t9("composer.clearCache"), "Clear cache")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.composerSelfUpdate(id)).then((r) => r && setResult(r))
          }
        >
          {t(t9("composer.selfUpdate"), "Self-update")}
        </button>
      </div>

      {info && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("composer.stat.version"), "Version")} value={info.version} />
          <Stat label={t(t9("composer.stat.php"), "PHP")} value={info.php_version} />
          <Stat label={t(t9("composer.stat.home"), "Home")} value={info.home_dir} />
          <Stat label={t(t9("composer.stat.cache"), "Cache")} value={info.cache_dir} />
        </div>
      )}
      {installed !== null && (
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          {t(t9("composer.installedState"), "Composer available")}:{" "}
          {installed ? t(t9("modules.yes"), "yes") : t(t9("modules.no"), "no")}
        </p>
      )}
      {globals && (
        <RowList
          items={globals.map((g) => ({
            key: g.name,
            primary: g.name,
            secondary: g.version,
          }))}
        />
      )}

      {/* Global require / remove */}
      <div>
        <label className={labelClass}>
          {t(t9("composer.globalPkg"), "Global package")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[220px]`}
            value={globalPkg}
            onChange={(e) => setGlobalPkg(e.target.value)}
            placeholder="laravel/installer"
          />
          <input
            className={`${inputClass} max-w-[140px]`}
            value={globalVersion}
            onChange={(e) => setGlobalVersion(e.target.value)}
            placeholder={t(t9("composer.version"), "version (optional)")}
          />
          <button
            className={primaryBtn}
            disabled={!globalPkg.trim()}
            onClick={() =>
              run((a) =>
                a.installComposerGlobalPackage(
                  id,
                  globalPkg.trim(),
                  globalVersion.trim() || undefined,
                ),
              ).then((r) => {
                if (r) setResult(r);
                void run((aa) => aa.listComposerGlobalPackages(id)).then(
                  (g) => g && setGlobals(g),
                );
              })
            }
          >
            {t(t9("composer.globalInstall"), "Install global")}
          </button>
          <button
            className={dangerBtn}
            disabled={!globalPkg.trim()}
            onClick={() =>
              run((a) =>
                a.removeComposerGlobalPackage(id, globalPkg.trim()),
              ).then((r) => {
                if (r) setResult(r);
                void run((aa) => aa.listComposerGlobalPackages(id)).then(
                  (g) => g && setGlobals(g),
                );
              })
            }
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Project-scoped: path + inspect + dump autoload */}
      <div>
        <label className={labelClass}>
          {t(t9("composer.projectPath"), "Project path")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[300px]`}
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="/var/www/app"
          />
          <button
            className={btnClass}
            disabled={!projectPath.trim()}
            onClick={() =>
              run((a) => a.getComposerProject(id, projectPath.trim())).then(
                (p) => p && setProject(p),
              )
            }
          >
            {t(t9("composer.loadProject"), "Load project")}
          </button>
          <button
            className={btnClass}
            disabled={!projectPath.trim()}
            onClick={() =>
              run((a) => a.composerValidate(id, projectPath.trim())).then(
                (r) => r && setResult(r),
              )
            }
          >
            {t(t9("composer.validate"), "Validate")}
          </button>
          <button
            className={btnClass}
            disabled={!projectPath.trim()}
            onClick={() =>
              run((a) => a.composerOutdated(id, projectPath.trim())).then(
                (o) => o && setOutdated(o),
              )
            }
          >
            {t(t9("composer.outdated"), "Outdated")}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={optimize}
              onChange={(e) => setOptimize(e.target.checked)}
            />
            {t(t9("composer.optimize"), "optimize")}
          </label>
          <button
            className={btnClass}
            disabled={!projectPath.trim()}
            onClick={() =>
              run((a) =>
                a.composerDumpAutoload(id, projectPath.trim(), optimize),
              ).then((r) => r && setResult(r))
            }
          >
            {t(t9("composer.dumpAutoload"), "Dump autoload")}
          </button>
        </div>
      </div>

      {project && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium text-[var(--color-text)]">
              {project.name ?? "—"}
              {project.php_requirement ? ` · PHP ${project.php_requirement}` : ""}
            </p>
            <RowList
              items={project.packages.map((p) => ({
                key: p.name,
                primary: p.name,
                secondary: p.version,
              }))}
            />
          </div>
          <div>
            <p className="text-[11px] font-medium text-[var(--color-text)]">
              {t(t9("composer.devPackages"), "Dev packages")}
            </p>
            <RowList
              items={project.dev_packages.map((p) => ({
                key: p.name,
                primary: p.name,
                secondary: p.version,
              }))}
            />
          </div>
        </div>
      )}
      {outdated && (
        <RowList
          items={outdated.map((p) => ({
            key: p.name,
            primary: p.name,
            secondary: p.version,
          }))}
        />
      )}

      {/* install / update / require / remove — JSON request bodies */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("composer.installReq"), "composer install (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={6}
            value={installJson}
            onChange={(e) => setInstallJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() =>
              runJson<ComposerInstallRequest>(installJson, (req) =>
                run((a) => a.composerInstall(id, req)).then((r) => {
                  if (r) setResult(r);
                  return r;
                }),
              )
            }
          >
            {t(t9("composer.install"), "Install")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("composer.updateReq"), "composer update (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={6}
            value={updateJson}
            onChange={(e) => setUpdateJson(e.target.value)}
          />
          <button
            className={`${btnClass} mt-1`}
            onClick={() =>
              runJson<ComposerUpdateRequest>(updateJson, (req) =>
                run((a) => a.composerUpdate(id, req)).then((r) => {
                  if (r) setResult(r);
                  return r;
                }),
              )
            }
          >
            {t(t9("composer.update"), "Update")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("composer.requireReq"), "composer require (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={5}
            value={requireJson}
            onChange={(e) => setRequireJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() =>
              runJson<RequirePackageRequest>(requireJson, (req) =>
                run((a) => a.composerRequire(id, req)).then((r) => {
                  if (r) setResult(r);
                  return r;
                }),
              )
            }
          >
            {t(t9("composer.require"), "Require")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("composer.removeReq"), "composer remove (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={5}
            value={removeJson}
            onChange={(e) => setRemoveJson(e.target.value)}
          />
          <button
            className={`${dangerBtn} mt-1`}
            onClick={() =>
              runJson<RemovePackageRequest>(removeJson, (req) =>
                run((a) => a.composerRemove(id, req)).then((r) => {
                  if (r) setResult(r);
                  return r;
                }),
              )
            }
          >
            {t(t9("composer.remove"), "Remove")}
          </button>
        </div>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}

      {result && (
        <div>
          <p className="text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("composer.result"), "Last result")} · exit {result.exit_code} ·{" "}
            {result.success
              ? t(t9("composer.success"), "success")
              : t(t9("composer.failed"), "failed")}
          </p>
          <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
            {[result.stdout, result.stderr].filter(Boolean).join("\n") || "—"}
          </pre>
        </div>
      )}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Logs (9)
// ═══════════════════════════════════════════════════════════════════════════════

const LogsSection: React.FC<{
  mgr: PhpConfigManager;
  id: string;
  version: string;
}> = ({ mgr, id, version }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [logConfig, setLogConfig] = useState<PhpLogConfig | null>(null);
  const [fpmLogConfig, setFpmLogConfig] = useState<FpmLogConfig | null>(null);
  const [entries, setEntries] = useState<PhpLogEntry[] | null>(null);
  const [tail, setTail] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);

  const [logPath, setLogPath] = useState("");
  const [tailLines, setTailLines] = useState("200");
  const [readJson, setReadJson] = useState(() =>
    JSON.stringify(LOG_READ_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group title={t(t9("logs.title"), "Logs")} icon={<Activity size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getLogConfig(id, version)).then(
              (c) => c && setLogConfig(c),
            )
          }
        >
          {t(t9("logs.config"), "PHP log config")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getFpmLogConfig(id, version)).then(
              (c) => c && setFpmLogConfig(c),
            )
          }
        >
          {t(t9("logs.fpmConfig"), "FPM log config")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getLogPath(id, version)).then(
              (p) => p !== undefined && setLogPath(p),
            )
          }
        >
          {t(t9("logs.errorLogPath"), "Error log path")}
        </button>
        <button
          className={btnClass}
          disabled={!version}
          onClick={() =>
            run((a) => a.getFpmLogPath(id, version)).then(
              (p) => p !== undefined && setLogPath(p),
            )
          }
        >
          {t(t9("logs.fpmLogPath"), "FPM log path")}
        </button>
      </div>

      {logConfig && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("logs.stat.errorLog"), "error_log")} value={logConfig.error_log} />
          <Stat
            label={t(t9("logs.stat.logErrors"), "log_errors")}
            value={String(logConfig.log_errors)}
          />
          <Stat
            label={t(t9("logs.stat.display"), "display_errors")}
            value={String(logConfig.display_errors)}
          />
          <Stat
            label={t(t9("logs.stat.reporting"), "error_reporting")}
            value={logConfig.error_reporting}
          />
        </div>
      )}
      {fpmLogConfig && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("logs.stat.fpmErrorLog"), "fpm error_log")} value={fpmLogConfig.error_log} />
          <Stat label={t(t9("logs.stat.level"), "log_level")} value={fpmLogConfig.log_level} />
          <Stat label={t(t9("logs.stat.facility"), "facility")} value={fpmLogConfig.syslog_facility} />
          <Stat label={t(t9("logs.stat.ident"), "ident")} value={fpmLogConfig.syslog_ident} />
        </div>
      )}

      {/* Path-scoped operations */}
      <div>
        <label className={labelClass}>
          {t(t9("logs.path"), "Log path")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[320px]`}
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="/var/log/php8.3-fpm.log"
          />
          <input
            className={`${inputClass} max-w-[100px]`}
            type="number"
            value={tailLines}
            onChange={(e) => setTailLines(e.target.value)}
            placeholder="lines"
          />
          <button
            className={btnClass}
            disabled={!logPath.trim()}
            onClick={() =>
              run((a) =>
                a.tailLog(id, logPath.trim(), Number(tailLines) || 200),
              ).then((tt) => tt !== undefined && setTail(tt))
            }
          >
            {t(t9("logs.tail"), "Tail")}
          </button>
          <button
            className={btnClass}
            disabled={!logPath.trim()}
            onClick={() =>
              run((a) => a.getLogSize(id, logPath.trim())).then(
                (s) => s !== undefined && setSize(s),
              )
            }
          >
            {t(t9("logs.size"), "Size")}
          </button>
          <button
            className={btnClass}
            disabled={!logPath.trim()}
            onClick={() => void run((a) => a.rotateLog(id, logPath.trim()))}
          >
            {t(t9("logs.rotate"), "Rotate")}
          </button>
          <button
            className={dangerBtn}
            disabled={!logPath.trim()}
            onClick={() => void run((a) => a.clearLog(id, logPath.trim()))}
          >
            <Trash2 size={12} />
            {t(t9("logs.clear"), "Clear")}
          </button>
        </div>
        {size !== null && (
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("logs.sizeBytes"), "Size")}: {size} {t(t9("logs.bytes"), "bytes")}
          </p>
        )}
        {tail && (
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
            {tail}
          </pre>
        )}
      </div>

      {/* Parsed read with filters (JSON request) */}
      <div>
        <label className={labelClass}>
          {t(t9("logs.readReq"), "Read parsed log (JSON request)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={5}
          value={readJson}
          onChange={(e) => setReadJson(e.target.value)}
        />
        <button
          className={`${primaryBtn} mt-1`}
          onClick={() => {
            let request: PhpLogReadRequest;
            try {
              request = JSON.parse(readJson) as PhpLogReadRequest;
            } catch (e) {
              setParseError((e as Error).message);
              return;
            }
            setParseError(null);
            void run((a) => a.readLog(id, request)).then(
              (r) => r && setEntries(r),
            );
          }}
        >
          {t(t9("logs.read"), "Read log")}
        </button>
        {parseError && <p className="mt-1 text-[11px] text-red-500">{parseError}</p>}
        {entries && (
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
            {entries
              .map(
                (e) =>
                  `[${e.level}] ${e.timestamp ?? ""} ${e.message}${
                    e.file ? ` (${e.file}:${e.line_number ?? "?"})` : ""
                  }`,
              )
              .join("\n") || "—"}
          </pre>
        )}
      </div>
    </Group>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const Stat: React.FC<{ label: string; value?: number | string | null }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] px-1.5 py-1">
    <div className="text-[10px] text-[var(--color-textSecondary)]">{label}</div>
    <div className="truncate text-[11px] font-medium text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

interface Row {
  key: string;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}

const RowList: React.FC<{ items: Row[] }> = ({ items }) => (
  <ul className="flex flex-col gap-0.5">
    {items.length === 0 && (
      <li className="px-1 py-1 text-[11px] text-[var(--color-textSecondary)]">
        —
      </li>
    )}
    {items.map((r) => (
      <li key={r.key}>
        <button
          onClick={r.onClick}
          disabled={!r.onClick}
          className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border)] px-1.5 py-1 text-left text-[11px] hover:bg-[var(--color-surfaceHover)] disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="font-medium text-[var(--color-text)]">
            {r.primary}
          </span>
          {r.secondary && (
            <span className="truncate text-[var(--color-textSecondary)]">
              {r.secondary}
            </span>
          )}
        </button>
      </li>
    ))}
  </ul>
);

const Json: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

export default PhpConfigTab;
