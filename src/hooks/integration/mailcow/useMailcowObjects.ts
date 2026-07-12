// mailcow "objects" invoke slice + hook (t42-mailcow-c1).
//
// `mailcowObjectsApi` is a thin 1:1 wrapper over the 35 provisioning `mailcow_*`
// commands (Domains 5, Mailboxes 8, Aliases 5, Domain aliases 5, DKIM 4,
// Resources 5, App passwords 3) in
// `src-tauri/crates/sorng-mailcow/src/commands.rs`.
//
// Every command's first arg is the live connection `id`. Tauri camelCases command
// PARAMS, so the non-obvious ones are `alias_id -> aliasId`,
// `app_password_id -> appPasswordId`, `src_domain/dst_domain -> srcDomain/dstDomain`
// and `alias_domain -> aliasDomain`. Single-word params (`domain`, `username`,
// `name`, `enable`) pass through unchanged.
//
// Request STRUCT bodies (`req`/`config`) stay snake_case — see
// `../../../types/mailcow/objects` and the serde note in
// `.orchestration/logs/t42-mailcow-categories.md`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CreateAliasRequest,
  CreateAppPasswordRequest,
  CreateDomainAliasRequest,
  CreateDomainRequest,
  CreateMailboxRequest,
  CreateResourceRequest,
  GenerateDkimRequest,
  MailcowAlias,
  MailcowAppPassword,
  MailcowDkimKey,
  MailcowDomain,
  MailcowDomainAlias,
  MailcowMailbox,
  MailcowResource,
  UpdateAliasRequest,
  UpdateDomainRequest,
  UpdateMailboxRequest,
} from "../../../types/mailcow/objects";

export const mailcowObjectsApi = {
  // ── Domains (5) ─────────────────────────────────────────────────
  listDomains: (id: string) =>
    invoke<MailcowDomain[]>("mailcow_list_domains", { id }),
  getDomain: (id: string, domain: string) =>
    invoke<MailcowDomain>("mailcow_get_domain", { id, domain }),
  createDomain: (id: string, req: CreateDomainRequest) =>
    invoke<unknown>("mailcow_create_domain", { id, req }),
  updateDomain: (id: string, domain: string, req: UpdateDomainRequest) =>
    invoke<unknown>("mailcow_update_domain", { id, domain, req }),
  deleteDomain: (id: string, domain: string) =>
    invoke<unknown>("mailcow_delete_domain", { id, domain }),

  // ── Mailboxes (8) ───────────────────────────────────────────────
  listMailboxes: (id: string) =>
    invoke<MailcowMailbox[]>("mailcow_list_mailboxes", { id }),
  listMailboxesByDomain: (id: string, domain: string) =>
    invoke<MailcowMailbox[]>("mailcow_list_mailboxes_by_domain", { id, domain }),
  getMailbox: (id: string, username: string) =>
    invoke<MailcowMailbox>("mailcow_get_mailbox", { id, username }),
  createMailbox: (id: string, req: CreateMailboxRequest) =>
    invoke<unknown>("mailcow_create_mailbox", { id, req }),
  updateMailbox: (id: string, username: string, req: UpdateMailboxRequest) =>
    invoke<unknown>("mailcow_update_mailbox", { id, username, req }),
  deleteMailbox: (id: string, username: string) =>
    invoke<unknown>("mailcow_delete_mailbox", { id, username }),
  quarantineNotifications: (id: string, username: string, enable: boolean) =>
    invoke<unknown>("mailcow_quarantine_notifications", { id, username, enable }),
  // `config` is a free-form pushover payload (serde_json::Value server-side).
  pushoverSetup: (id: string, username: string, config: unknown) =>
    invoke<unknown>("mailcow_pushover_setup", { id, username, config }),

  // ── Aliases (5) ─────────────────────────────────────────────────
  listAliases: (id: string) =>
    invoke<MailcowAlias[]>("mailcow_list_aliases", { id }),
  getAlias: (id: string, aliasId: number) =>
    invoke<MailcowAlias>("mailcow_get_alias", { id, aliasId }),
  createAlias: (id: string, req: CreateAliasRequest) =>
    invoke<unknown>("mailcow_create_alias", { id, req }),
  updateAlias: (id: string, aliasId: number, req: UpdateAliasRequest) =>
    invoke<unknown>("mailcow_update_alias", { id, aliasId, req }),
  deleteAlias: (id: string, aliasId: number) =>
    invoke<unknown>("mailcow_delete_alias", { id, aliasId }),

  // ── Domain aliases (5) ──────────────────────────────────────────
  listDomainAliases: (id: string) =>
    invoke<MailcowDomainAlias[]>("mailcow_list_domain_aliases", { id }),
  getDomainAlias: (id: string, aliasDomain: string) =>
    invoke<MailcowDomainAlias>("mailcow_get_domain_alias", { id, aliasDomain }),
  createDomainAlias: (id: string, req: CreateDomainAliasRequest) =>
    invoke<unknown>("mailcow_create_domain_alias", { id, req }),
  updateDomainAlias: (id: string, aliasDomain: string, active: boolean) =>
    invoke<unknown>("mailcow_update_domain_alias", { id, aliasDomain, active }),
  deleteDomainAlias: (id: string, aliasDomain: string) =>
    invoke<unknown>("mailcow_delete_domain_alias", { id, aliasDomain }),

  // ── DKIM (4) ────────────────────────────────────────────────────
  getDkim: (id: string, domain: string) =>
    invoke<MailcowDkimKey>("mailcow_get_dkim", { id, domain }),
  generateDkim: (id: string, req: GenerateDkimRequest) =>
    invoke<unknown>("mailcow_generate_dkim", { id, req }),
  deleteDkim: (id: string, domain: string) =>
    invoke<unknown>("mailcow_delete_dkim", { id, domain }),
  duplicateDkim: (id: string, srcDomain: string, dstDomain: string) =>
    invoke<unknown>("mailcow_duplicate_dkim", { id, srcDomain, dstDomain }),

  // ── Resources (5) ───────────────────────────────────────────────
  listResources: (id: string) =>
    invoke<MailcowResource[]>("mailcow_list_resources", { id }),
  getResource: (id: string, name: string) =>
    invoke<MailcowResource>("mailcow_get_resource", { id, name }),
  createResource: (id: string, req: CreateResourceRequest) =>
    invoke<unknown>("mailcow_create_resource", { id, req }),
  updateResource: (id: string, name: string, req: CreateResourceRequest) =>
    invoke<unknown>("mailcow_update_resource", { id, name, req }),
  deleteResource: (id: string, name: string) =>
    invoke<unknown>("mailcow_delete_resource", { id, name }),

  // ── App passwords (3) ───────────────────────────────────────────
  listAppPasswords: (id: string, username: string) =>
    invoke<MailcowAppPassword[]>("mailcow_list_app_passwords", { id, username }),
  createAppPassword: (id: string, req: CreateAppPasswordRequest) =>
    invoke<unknown>("mailcow_create_app_password", { id, req }),
  deleteAppPassword: (id: string, appPasswordId: number) =>
    invoke<unknown>("mailcow_delete_app_password", { id, appPasswordId }),
};

export type MailcowObjectsApi = typeof mailcowObjectsApi;

/**
 * Convenience hook for the Domains/Mailboxes/Aliases tab. Exposes the invoke
 * slice plus shared `isLoading`/`error` state and a `run` helper that binds the
 * live `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function useMailcowObjects(connectionId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(connectionId);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  return {
    api: mailcowObjectsApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseMailcowObjects = ReturnType<typeof useMailcowObjects>;
