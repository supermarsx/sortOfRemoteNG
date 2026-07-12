// useAnsibleContent — "Roles, Galaxy & Vault" command slice for the Ansible
// integration (t42-ansible-c1). Binds all 28 content-category commands: roles (5),
// vault (6), galaxy (9), config & modules (8).
//
// ⚠ WIRE-FORMAT — command ARG names are camelCase (Tauri default): `rolesPath`,
// `rolePath`, `roleName`, `filePath`, `vaultPasswordFile`, `vaultId`,
// `collectionsPath`, `requirementsPath`, `moduleName`, `pluginType`. STRUCT
// payload fields (inside `options`) stay snake_case — see `types/ansible`. The
// `id` arg is the live control-node `connectionId`, EXCEPT `roles_list`,
// `role_inspect`, `role_dependencies`, `config_parse_file`, `vault_is_encrypted`
// which take a filesystem `path`/`rolesPath`/`rolePath`, not a session id.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AnsibleConfig,
  ConfigSetting,
  GalaxyCollection,
  GalaxyInstallOptions,
  GalaxySearchOptions,
  GalaxySearchResult,
  ModuleInfo,
  Role,
  RoleDependency,
  RoleInitOptions,
  VaultEncryptStringOptions,
  VaultRekeyOptions,
  VaultResult,
} from "../../../types/ansible/content";

// ─── Low-level invoke wrappers (all 28 commands of the content slice) ──────────

export const ansibleContentApi = {
  // Roles (5)
  rolesList: (rolesPath: string) =>
    invoke<Role[]>("ansible_roles_list", { rolesPath }),
  roleInspect: (rolePath: string) =>
    invoke<Role>("ansible_role_inspect", { rolePath }),
  roleInit: (id: string, options: RoleInitOptions) =>
    invoke<Role>("ansible_role_init", { id, options }),
  roleDependencies: (rolesPath: string, roleName: string) =>
    invoke<RoleDependency[]>("ansible_role_dependencies", {
      rolesPath,
      roleName,
    }),
  roleInstallDeps: (id: string, rolePath: string) =>
    invoke<string>("ansible_role_install_deps", { id, rolePath }),

  // Vault (6)
  vaultEncrypt: (
    id: string,
    filePath: string,
    vaultPasswordFile?: string,
    vaultId?: string,
  ) =>
    invoke<VaultResult>("ansible_vault_encrypt", {
      id,
      filePath,
      vaultPasswordFile,
      vaultId,
    }),
  vaultDecrypt: (
    id: string,
    filePath: string,
    vaultPasswordFile?: string,
    vaultId?: string,
  ) =>
    invoke<VaultResult>("ansible_vault_decrypt", {
      id,
      filePath,
      vaultPasswordFile,
      vaultId,
    }),
  vaultView: (id: string, filePath: string, vaultPasswordFile?: string) =>
    invoke<string>("ansible_vault_view", { id, filePath, vaultPasswordFile }),
  vaultRekey: (id: string, options: VaultRekeyOptions) =>
    invoke<VaultResult>("ansible_vault_rekey", { id, options }),
  vaultEncryptString: (id: string, options: VaultEncryptStringOptions) =>
    invoke<string>("ansible_vault_encrypt_string", { id, options }),
  vaultIsEncrypted: (filePath: string) =>
    invoke<boolean>("ansible_vault_is_encrypted", { filePath }),

  // Galaxy (9)
  galaxyInstallRole: (id: string, options: GalaxyInstallOptions) =>
    invoke<string>("ansible_galaxy_install_role", { id, options }),
  galaxyListRoles: (id: string, rolesPath?: string) =>
    invoke<GalaxySearchResult[]>("ansible_galaxy_list_roles", { id, rolesPath }),
  galaxyRemoveRole: (id: string, roleName: string, rolesPath?: string) =>
    invoke<string>("ansible_galaxy_remove_role", { id, roleName, rolesPath }),
  galaxyInstallCollection: (id: string, options: GalaxyInstallOptions) =>
    invoke<string>("ansible_galaxy_install_collection", { id, options }),
  galaxyListCollections: (id: string, collectionsPath?: string) =>
    invoke<GalaxyCollection[]>("ansible_galaxy_list_collections", {
      id,
      collectionsPath,
    }),
  galaxyRemoveCollection: (id: string, name: string, collectionsPath?: string) =>
    invoke<string>("ansible_galaxy_remove_collection", {
      id,
      name,
      collectionsPath,
    }),
  galaxySearch: (id: string, options: GalaxySearchOptions) =>
    invoke<GalaxySearchResult[]>("ansible_galaxy_search", { id, options }),
  galaxyRoleInfo: (id: string, roleName: string) =>
    invoke<string>("ansible_galaxy_role_info", { id, roleName }),
  galaxyInstallRequirements: (
    id: string,
    requirementsPath: string,
    force: boolean,
  ) =>
    invoke<string>("ansible_galaxy_install_requirements", {
      id,
      requirementsPath,
      force,
    }),

  // Config & modules (8)
  configDump: (id: string) =>
    invoke<ConfigSetting[]>("ansible_config_dump", { id }),
  configGet: (id: string, key: string) =>
    invoke<ConfigSetting | null>("ansible_config_get", { id, key }),
  configParseFile: (path: string) =>
    invoke<AnsibleConfig>("ansible_config_parse_file", { path }),
  configDetectPath: (id: string) =>
    invoke<string | null>("ansible_config_detect_path", { id }),
  listModules: (id: string) =>
    invoke<string[]>("ansible_list_modules", { id }),
  moduleDoc: (id: string, moduleName: string) =>
    invoke<ModuleInfo>("ansible_module_doc", { id, moduleName }),
  moduleExamples: (id: string, moduleName: string) =>
    invoke<string>("ansible_module_examples", { id, moduleName }),
  listPlugins: (id: string, pluginType: string) =>
    invoke<string[]>("ansible_list_plugins", { id, pluginType }),
};

export type AnsibleContentApi = typeof ansibleContentApi;

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Holds the primary list state for the Roles, Galaxy & Vault tab and a `run`
 * helper funnelling every command through shared loading/error handling. Deeper,
 * selection-scoped reads and mutations are issued by the tab straight through
 * `api`, wrapped in `run`. `connectionId` is the live control-node id.
 */
export function useAnsibleContent(connectionId: string) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [collections, setCollections] = useState<GalaxyCollection[]>([]);
  const [config, setConfig] = useState<ConfigSetting[]>([]);
  const [modules, setModules] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** Run any command with shared loading/error handling; rethrows on failure so
   *  callers can branch, but always records the message for the tab to surface. */
  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
      throw e;
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  const refreshRoles = useCallback(
    async (rolesPath: string) => {
      const list = await run(() => ansibleContentApi.rolesList(rolesPath));
      if (mounted.current) setRoles(list);
      return list;
    },
    [run],
  );

  const refreshCollections = useCallback(
    async (collectionsPath?: string) => {
      const list = await run(() =>
        ansibleContentApi.galaxyListCollections(connectionId, collectionsPath),
      );
      if (mounted.current) setCollections(list);
      return list;
    },
    [run, connectionId],
  );

  const refreshConfig = useCallback(async () => {
    const list = await run(() => ansibleContentApi.configDump(connectionId));
    if (mounted.current) setConfig(list);
    return list;
  }, [run, connectionId]);

  const refreshModules = useCallback(async () => {
    const list = await run(() => ansibleContentApi.listModules(connectionId));
    if (mounted.current) setModules(list);
    return list;
  }, [run, connectionId]);

  return {
    // scoped session id
    connectionId,
    // state
    roles,
    collections,
    config,
    modules,
    isLoading,
    error,
    // loaders
    refreshRoles,
    refreshCollections,
    refreshConfig,
    refreshModules,
    clearError,
    // low-level access for selection-scoped reads + all mutations
    run,
    api: ansibleContentApi,
  };
}

export type AnsibleContentManager = ReturnType<typeof useAnsibleContent>;
