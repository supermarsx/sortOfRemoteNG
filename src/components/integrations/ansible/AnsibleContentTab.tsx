// AnsibleContentTab — "Roles, Galaxy & Vault" sub-tab for the Ansible panel
// (t42-ansible-c1).
//
// Binds all 28 commands of the content slice (roles 5 / vault 6 / galaxy 9 /
// config & modules 8) through `useAnsibleContent`. Reads land in the Inspector
// (raw JSON), mutations append to the activity log. `connectionId` is the live
// control-node session id passed as the `id` arg (the path-based commands
// `roles_list`, `role_inspect`, `role_dependencies`, `config_parse_file`,
// `vault_is_encrypted` take a filesystem path instead).

import React, { useCallback, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Cog,
  FolderTree,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AnsibleTabProps } from "./registry";
import { useAnsibleContent } from "../../../hooks/integration/ansible/useAnsibleContent";
import type {
  GalaxyInstallOptions,
  GalaxySearchOptions,
  RoleInitOptions,
  RoleInitType,
  VaultEncryptStringOptions,
  VaultRekeyOptions,
} from "../../../types/ansible/content";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtnClass =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50";
const dangerBtnClass =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-500 disabled:opacity-50";

/** Collapsible section wrapper. */
const Section: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}> = ({ id, title, icon, open, onToggle, children }) => (
  <div className="border-b border-[var(--color-border)]">
    <button
      type="button"
      onClick={() => onToggle(id)}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
    >
      {open ? (
        <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />
      ) : (
        <ChevronRight size={14} className="text-[var(--color-textSecondary)]" />
      )}
      {icon}
      {title}
    </button>
    {open && <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>}
  </div>
);

const AnsibleContentTab: React.FC<AnsibleTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const c = useAnsibleContent(connectionId);
  const id = connectionId;

  const [open, setOpen] = useState<Record<string, boolean>>({
    roles: true,
    vault: false,
    galaxy: false,
    config: false,
  });
  const toggle = useCallback(
    (sid: string) => setOpen((o) => ({ ...o, [sid]: !o[sid] })),
    [],
  );

  const [detail, setDetail] = useState<{ label: string; body: unknown } | null>(
    null,
  );
  const [log, setLog] = useState<string[]>([]);
  const note = useCallback((msg: string) => {
    setLog((l) =>
      [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 30),
    );
  }, []);
  const show = useCallback(
    (label: string, body: unknown) => setDetail({ label, body }),
    [],
  );

  const act = useCallback(
    async <T,>(label: string, op: () => Promise<T>): Promise<T | undefined> => {
      try {
        const res = await op();
        note(`${label} ✓`);
        return res;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        note(`${label} ✗ ${msg}`);
        return undefined;
      }
    },
    [note],
  );

  const opt = (s: string) => (s.trim() ? s.trim() : undefined);

  // ── Roles ──────────────────────────────────────────────────────────────────────
  const [rolesPath, setRolesPath] = useState("");
  const [rolePath, setRolePath] = useState("");
  const [depRoleName, setDepRoleName] = useState("");
  const [initName, setInitName] = useState("");
  const [initPath, setInitPath] = useState("");
  const [initType, setInitType] = useState<RoleInitType>("Default");

  // ── Vault ──────────────────────────────────────────────────────────────────────
  const [vaultFile, setVaultFile] = useState("");
  const [vaultPwFile, setVaultPwFile] = useState("");
  const [vaultId, setVaultId] = useState("");
  const [rekeyNewPwFile, setRekeyNewPwFile] = useState("");
  const [encStrVar, setEncStrVar] = useState("");
  const [encStrPlain, setEncStrPlain] = useState("");

  // ── Galaxy ─────────────────────────────────────────────────────────────────────
  const [gxRoleName, setGxRoleName] = useState("");
  const [gxRoleVersion, setGxRoleVersion] = useState("");
  const [gxRolesPath, setGxRolesPath] = useState("");
  const [gxCollName, setGxCollName] = useState("");
  const [gxCollVersion, setGxCollVersion] = useState("");
  const [gxCollPath, setGxCollPath] = useState("");
  const [gxSearchQuery, setGxSearchQuery] = useState("");
  const [gxReqPath, setGxReqPath] = useState("");
  const [gxReqForce, setGxReqForce] = useState(false);

  // ── Config & modules ────────────────────────────────────────────────────────────
  const [cfgKey, setCfgKey] = useState("");
  const [cfgFilePath, setCfgFilePath] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [pluginType, setPluginType] = useState("callback");

  return (
    <div className="flex flex-col text-[var(--color-text)]">
      {/* ── Roles ─────────────────────────────────────────────────────────────── */}
      <Section
        id="roles"
        title={t("integrations.ansible.content.roles.title", "Roles")}
        icon={<FolderTree size={14} className="text-primary" />}
        open={open.roles}
        onToggle={toggle}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={rolesPath}
            placeholder={t(
              "integrations.ansible.content.roles.rolesPath",
              "Roles directory",
            )}
            onChange={(e) => setRolesPath(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!rolesPath}
            onClick={() => act("roles list", () => c.refreshRoles(rolesPath))}
          >
            <RefreshCw size={12} />
            {t("integrations.ansible.content.roles.list", "List")}
          </button>
        </div>
        {c.roles.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {c.roles.map((role) => (
              <li
                key={role.path}
                className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
              >
                <button
                  className="truncate text-left hover:text-primary"
                  onClick={() => {
                    setRolePath(role.path);
                    show(`role:${role.name}`, role);
                  }}
                >
                  {role.name}
                </button>
                <button
                  className={btnClass}
                  onClick={() =>
                    act("role install deps", () =>
                      c.api.roleInstallDeps(id, role.path),
                    ).then((res) => res && show("installDeps", res))
                  }
                >
                  {t("integrations.ansible.content.roles.installDeps", "Deps")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={rolePath}
            placeholder={t(
              "integrations.ansible.content.roles.rolePath",
              "Single role path (inspect)",
            )}
            onChange={(e) => setRolePath(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!rolePath}
            onClick={() =>
              act("role inspect", () => c.api.roleInspect(rolePath)).then(
                (res) => res && show("role", res),
              )
            }
          >
            {t("integrations.ansible.content.roles.inspect", "Inspect")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={depRoleName}
            placeholder={t(
              "integrations.ansible.content.roles.depRoleName",
              "Role name (dependencies)",
            )}
            onChange={(e) => setDepRoleName(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!rolesPath || !depRoleName}
            onClick={() =>
              act("role dependencies", () =>
                c.api.roleDependencies(rolesPath, depRoleName),
              ).then((res) => res && show("dependencies", res))
            }
          >
            {t("integrations.ansible.content.roles.dependencies", "Dependencies")}
          </button>
        </div>

        {/* Init role */}
        <div className="rounded border border-[var(--color-border)] p-2">
          <p className={labelClass}>
            {t("integrations.ansible.content.roles.initTitle", "Scaffold new role")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              className={inputClass}
              value={initName}
              placeholder={t(
                "integrations.ansible.content.roles.initName",
                "Role name",
              )}
              onChange={(e) => setInitName(e.target.value)}
            />
            <input
              className={inputClass}
              value={initPath}
              placeholder={t(
                "integrations.ansible.content.roles.initPath",
                "Target path (optional)",
              )}
              onChange={(e) => setInitPath(e.target.value)}
            />
            <select
              className={inputClass}
              value={initType}
              onChange={(e) => setInitType(e.target.value as RoleInitType)}
            >
              <option value="Default">Default</option>
              <option value="Container">Container</option>
              <option value="Network">Network</option>
              <option value="Apb">Apb</option>
            </select>
            <button
              className={primaryBtnClass}
              disabled={!initName}
              onClick={() => {
                const options: RoleInitOptions = {
                  name: initName,
                  path: initPath.trim() || null,
                  init_type: initType,
                  offline: false,
                };
                void act("role init", () => c.api.roleInit(id, options)).then(
                  (res) => res && show("role", res),
                );
              }}
            >
              <Plus size={12} />
              {t("integrations.ansible.content.roles.init", "Init")}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Vault ─────────────────────────────────────────────────────────────── */}
      <Section
        id="vault"
        title={t("integrations.ansible.content.vault.title", "Vault")}
        icon={<Lock size={14} className="text-primary" />}
        open={open.vault}
        onToggle={toggle}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            value={vaultFile}
            placeholder={t(
              "integrations.ansible.content.vault.file",
              "Vault file path",
            )}
            onChange={(e) => setVaultFile(e.target.value)}
          />
          <input
            className={inputClass}
            value={vaultPwFile}
            placeholder={t(
              "integrations.ansible.content.vault.pwFile",
              "Password file (optional)",
            )}
            onChange={(e) => setVaultPwFile(e.target.value)}
          />
        </div>
        <input
          className={inputClass}
          value={vaultId}
          placeholder={t(
            "integrations.ansible.content.vault.vaultId",
            "Vault id (optional)",
          )}
          onChange={(e) => setVaultId(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className={btnClass}
            disabled={!vaultFile}
            onClick={() =>
              act("vault encrypt", () =>
                c.api.vaultEncrypt(id, vaultFile, opt(vaultPwFile), opt(vaultId)),
              ).then((res) => res && show("vaultResult", res))
            }
          >
            <Lock size={12} />
            {t("integrations.ansible.content.vault.encrypt", "Encrypt")}
          </button>
          <button
            className={btnClass}
            disabled={!vaultFile}
            onClick={() =>
              act("vault decrypt", () =>
                c.api.vaultDecrypt(id, vaultFile, opt(vaultPwFile), opt(vaultId)),
              ).then((res) => res && show("vaultResult", res))
            }
          >
            {t("integrations.ansible.content.vault.decrypt", "Decrypt")}
          </button>
          <button
            className={btnClass}
            disabled={!vaultFile}
            onClick={() =>
              act("vault view", () =>
                c.api.vaultView(id, vaultFile, opt(vaultPwFile)),
              ).then((res) => res !== undefined && show("vaultView", res))
            }
          >
            {t("integrations.ansible.content.vault.view", "View")}
          </button>
          <button
            className={btnClass}
            disabled={!vaultFile}
            onClick={() =>
              act("vault is encrypted", () =>
                c.api.vaultIsEncrypted(vaultFile),
              ).then((res) => res !== undefined && show("isEncrypted", res))
            }
          >
            {t("integrations.ansible.content.vault.isEncrypted", "Is encrypted?")}
          </button>
        </div>

        {/* Rekey */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={rekeyNewPwFile}
            placeholder={t(
              "integrations.ansible.content.vault.rekeyNewPw",
              "New password file",
            )}
            onChange={(e) => setRekeyNewPwFile(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!vaultFile}
            onClick={() => {
              const options: VaultRekeyOptions = {
                file_path: vaultFile,
                old_vault_password_file: opt(vaultPwFile) ?? null,
                new_vault_password_file: opt(rekeyNewPwFile) ?? null,
                old_vault_id: null,
                new_vault_id: null,
              };
              void act("vault rekey", () => c.api.vaultRekey(id, options)).then(
                (res) => res && show("vaultResult", res),
              );
            }}
          >
            <KeyRound size={12} />
            {t("integrations.ansible.content.vault.rekey", "Rekey")}
          </button>
        </div>

        {/* Encrypt string */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            value={encStrVar}
            placeholder={t(
              "integrations.ansible.content.vault.encStrVar",
              "Variable name",
            )}
            onChange={(e) => setEncStrVar(e.target.value)}
          />
          <input
            className={inputClass}
            value={encStrPlain}
            placeholder={t(
              "integrations.ansible.content.vault.encStrPlain",
              "Plaintext value",
            )}
            onChange={(e) => setEncStrPlain(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!encStrVar || !encStrPlain}
            onClick={() => {
              const options: VaultEncryptStringOptions = {
                plaintext: encStrPlain,
                variable_name: encStrVar,
                vault_password_file: opt(vaultPwFile) ?? null,
                vault_id: opt(vaultId) ?? null,
              };
              void act("vault encrypt string", () =>
                c.api.vaultEncryptString(id, options),
              ).then((res) => res !== undefined && show("encryptedString", res));
            }}
          >
            {t("integrations.ansible.content.vault.encryptString", "Encrypt string")}
          </button>
        </div>
      </Section>

      {/* ── Galaxy ────────────────────────────────────────────────────────────── */}
      <Section
        id="galaxy"
        title={t("integrations.ansible.content.galaxy.title", "Galaxy")}
        icon={<Boxes size={14} className="text-primary" />}
        open={open.galaxy}
        onToggle={toggle}
      >
        {/* Roles */}
        <div className="rounded border border-[var(--color-border)] p-2">
          <p className={labelClass}>
            {t("integrations.ansible.content.galaxy.rolesTitle", "Galaxy roles")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className={inputClass}
              value={gxRoleName}
              placeholder={t(
                "integrations.ansible.content.galaxy.roleName",
                "Role (namespace.name)",
              )}
              onChange={(e) => setGxRoleName(e.target.value)}
            />
            <input
              className={inputClass}
              value={gxRoleVersion}
              placeholder={t(
                "integrations.ansible.content.galaxy.version",
                "Version (optional)",
              )}
              onChange={(e) => setGxRoleVersion(e.target.value)}
            />
            <button
              className={primaryBtnClass}
              disabled={!gxRoleName}
              onClick={() => {
                const options: GalaxyInstallOptions = {
                  name: gxRoleName,
                  version: opt(gxRoleVersion) ?? null,
                  roles_path: opt(gxRolesPath) ?? null,
                  collections_path: null,
                  force: false,
                  no_deps: false,
                  requirements_file: null,
                };
                void act("galaxy install role", () =>
                  c.api.galaxyInstallRole(id, options),
                ).then((res) => res !== undefined && show("galaxyInstall", res));
              }}
            >
              <Plus size={12} />
              {t("integrations.ansible.content.galaxy.install", "Install")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input
              className={inputClass}
              value={gxRolesPath}
              placeholder={t(
                "integrations.ansible.content.galaxy.rolesPath",
                "Roles path (optional)",
              )}
              onChange={(e) => setGxRolesPath(e.target.value)}
            />
            <button
              className={btnClass}
              onClick={() =>
                act("galaxy list roles", () =>
                  c.api.galaxyListRoles(id, opt(gxRolesPath)),
                ).then((res) => res && show("galaxyRoles", res))
              }
            >
              <RefreshCw size={12} />
              {t("integrations.ansible.content.galaxy.listRoles", "List")}
            </button>
            <button
              className={btnClass}
              disabled={!gxRoleName}
              onClick={() =>
                act("galaxy role info", () =>
                  c.api.galaxyRoleInfo(id, gxRoleName),
                ).then((res) => res !== undefined && show("galaxyRoleInfo", res))
              }
            >
              {t("integrations.ansible.content.galaxy.roleInfo", "Info")}
            </button>
            <button
              className={dangerBtnClass}
              disabled={!gxRoleName}
              onClick={() =>
                act("galaxy remove role", () =>
                  c.api.galaxyRemoveRole(id, gxRoleName, opt(gxRolesPath)),
                ).then((res) => res !== undefined && show("galaxyRemove", res))
              }
            >
              <Trash2 size={12} />
              {t("integrations.ansible.content.galaxy.remove", "Remove")}
            </button>
          </div>
        </div>

        {/* Collections */}
        <div className="rounded border border-[var(--color-border)] p-2">
          <p className={labelClass}>
            {t(
              "integrations.ansible.content.galaxy.collectionsTitle",
              "Galaxy collections",
            )}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className={inputClass}
              value={gxCollName}
              placeholder={t(
                "integrations.ansible.content.galaxy.collName",
                "Collection (namespace.name)",
              )}
              onChange={(e) => setGxCollName(e.target.value)}
            />
            <input
              className={inputClass}
              value={gxCollVersion}
              placeholder={t(
                "integrations.ansible.content.galaxy.version",
                "Version (optional)",
              )}
              onChange={(e) => setGxCollVersion(e.target.value)}
            />
            <button
              className={primaryBtnClass}
              disabled={!gxCollName}
              onClick={() => {
                const options: GalaxyInstallOptions = {
                  name: gxCollName,
                  version: opt(gxCollVersion) ?? null,
                  roles_path: null,
                  collections_path: opt(gxCollPath) ?? null,
                  force: false,
                  no_deps: false,
                  requirements_file: null,
                };
                void act("galaxy install collection", () =>
                  c.api.galaxyInstallCollection(id, options),
                ).then((res) => res !== undefined && show("galaxyInstall", res));
              }}
            >
              <Plus size={12} />
              {t("integrations.ansible.content.galaxy.install", "Install")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              className={inputClass}
              value={gxCollPath}
              placeholder={t(
                "integrations.ansible.content.galaxy.collPath",
                "Collections path (optional)",
              )}
              onChange={(e) => setGxCollPath(e.target.value)}
            />
            <button
              className={btnClass}
              onClick={() =>
                act("galaxy list collections", () =>
                  c.refreshCollections(opt(gxCollPath)),
                ).then((res) => res && show("galaxyCollections", res))
              }
            >
              <RefreshCw size={12} />
              {t("integrations.ansible.content.galaxy.listColl", "List")}
            </button>
            <button
              className={dangerBtnClass}
              disabled={!gxCollName}
              onClick={() =>
                act("galaxy remove collection", () =>
                  c.api.galaxyRemoveCollection(id, gxCollName, opt(gxCollPath)),
                ).then((res) => res !== undefined && show("galaxyRemove", res))
              }
            >
              <Trash2 size={12} />
              {t("integrations.ansible.content.galaxy.remove", "Remove")}
            </button>
          </div>
        </div>

        {/* Search + requirements */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={gxSearchQuery}
            placeholder={t(
              "integrations.ansible.content.galaxy.search",
              "Search query",
            )}
            onChange={(e) => setGxSearchQuery(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!gxSearchQuery}
            onClick={() => {
              const options: GalaxySearchOptions = {
                query: gxSearchQuery,
                galaxy_tags: [],
                platforms: [],
                author: null,
                order_by: null,
                page: null,
                page_size: null,
              };
              void act("galaxy search", () =>
                c.api.galaxySearch(id, options),
              ).then((res) => res && show("galaxySearch", res));
            }}
          >
            <Search size={12} />
            {t("integrations.ansible.content.galaxy.searchBtn", "Search")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            className={inputClass}
            value={gxReqPath}
            placeholder={t(
              "integrations.ansible.content.galaxy.reqPath",
              "requirements.yml path",
            )}
            onChange={(e) => setGxReqPath(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={gxReqForce}
              onChange={(e) => setGxReqForce(e.target.checked)}
            />
            {t("integrations.ansible.content.galaxy.force", "Force")}
          </label>
          <button
            className={btnClass}
            disabled={!gxReqPath}
            onClick={() =>
              act("galaxy install requirements", () =>
                c.api.galaxyInstallRequirements(id, gxReqPath, gxReqForce),
              ).then((res) => res !== undefined && show("galaxyRequirements", res))
            }
          >
            {t(
              "integrations.ansible.content.galaxy.installReq",
              "Install requirements",
            )}
          </button>
        </div>
      </Section>

      {/* ── Config & modules ──────────────────────────────────────────────────── */}
      <Section
        id="config"
        title={t(
          "integrations.ansible.content.config.title",
          "Configuration & Modules",
        )}
        icon={<Cog size={14} className="text-primary" />}
        open={open.config}
        onToggle={toggle}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={btnClass}
            onClick={() =>
              act("config dump", () => c.refreshConfig()).then(
                (res) => res && show("config", res),
              )
            }
          >
            <RefreshCw size={12} />
            {t("integrations.ansible.content.config.dump", "Dump config")}
          </button>
          <button
            className={btnClass}
            onClick={() =>
              act("config detect path", () => c.api.configDetectPath(id)).then(
                (res) => res !== undefined && show("configPath", res),
              )
            }
          >
            {t("integrations.ansible.content.config.detectPath", "Detect path")}
          </button>
          <button
            className={btnClass}
            onClick={() =>
              act("list modules", () => c.refreshModules()).then(
                (res) => res && show("modules", res),
              )
            }
          >
            {t("integrations.ansible.content.config.listModules", "List modules")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={cfgKey}
            placeholder={t(
              "integrations.ansible.content.config.key",
              "Config key (e.g. DEFAULT_ROLES_PATH)",
            )}
            onChange={(e) => setCfgKey(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!cfgKey}
            onClick={() =>
              act("config get", () => c.api.configGet(id, cfgKey)).then(
                (res) => res !== undefined && show(`config:${cfgKey}`, res),
              )
            }
          >
            {t("integrations.ansible.content.config.get", "Get")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={cfgFilePath}
            placeholder={t(
              "integrations.ansible.content.config.filePath",
              "ansible.cfg path (parse)",
            )}
            onChange={(e) => setCfgFilePath(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!cfgFilePath}
            onClick={() =>
              act("config parse file", () =>
                c.api.configParseFile(cfgFilePath),
              ).then((res) => res && show("configFile", res))
            }
          >
            {t("integrations.ansible.content.config.parseFile", "Parse file")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            className={inputClass}
            value={moduleName}
            placeholder={t(
              "integrations.ansible.content.config.moduleName",
              "Module name",
            )}
            onChange={(e) => setModuleName(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!moduleName}
            onClick={() =>
              act("module doc", () => c.api.moduleDoc(id, moduleName)).then(
                (res) => res && show(`moduleDoc:${moduleName}`, res),
              )
            }
          >
            {t("integrations.ansible.content.config.moduleDoc", "Doc")}
          </button>
          <button
            className={btnClass}
            disabled={!moduleName}
            onClick={() =>
              act("module examples", () =>
                c.api.moduleExamples(id, moduleName),
              ).then((res) => res !== undefined && show("moduleExamples", res))
            }
          >
            {t("integrations.ansible.content.config.moduleExamples", "Examples")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={pluginType}
            placeholder={t(
              "integrations.ansible.content.config.pluginType",
              "Plugin type (callback/connection/…)",
            )}
            onChange={(e) => setPluginType(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!pluginType}
            onClick={() =>
              act("list plugins", () =>
                c.api.listPlugins(id, pluginType),
              ).then((res) => res && show(`plugins:${pluginType}`, res))
            }
          >
            {t("integrations.ansible.content.config.listPlugins", "List plugins")}
          </button>
        </div>
      </Section>

      {/* ── Inspector + activity log ──────────────────────────────────────────── */}
      {(detail || c.error) && (
        <div className="border-t border-[var(--color-border)] p-4">
          {c.error && <p className="mb-2 text-xs text-red-500">{c.error}</p>}
          {detail && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-textSecondary)]">
                  {t("integrations.ansible.content.inspector", "Inspector")}:{" "}
                  {detail.label}
                </span>
                <button
                  className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  onClick={() => setDetail(null)}
                >
                  {t("integrations.ansible.content.close", "Close")}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[11px] leading-tight text-[var(--color-text)]">
                {JSON.stringify(detail.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
      {log.length > 0 && (
        <div className="border-t border-[var(--color-border)] p-4">
          <span className="text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.ansible.content.activity", "Activity")}
          </span>
          <ul className="mt-1 max-h-32 overflow-auto text-[11px] text-[var(--color-textSecondary)]">
            {log.map((line, i) => (
              <li key={i} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AnsibleContentTab;
