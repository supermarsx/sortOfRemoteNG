// cPanel Account Services invoke slice + hook (t42-cpanel-c2).
//
// `cpanelAccountApi` is a thin 1:1 wrapper over the 44 single-account
// `cpanel_*` commands (Domains 8, Email 12, Databases 7, Files 4, SSL 5, FTP 4,
// Cron 4) in `src-tauri/crates/sorng-cpanel/src/commands.rs`.
//
// Every command's first arg is the live connection `id`; account-scope commands
// additionally take the cPanel account username `user`. Tauri camelCases command
// PARAMS, so `keep_dns -> keepDns`, `ftp_user -> ftpUser`, `db_user -> dbUser`.
// Watch the crate's one inconsistency: `cpanel_delete_database_user` takes
// `dbuser` (already one word in Rust, stays `dbuser`), NOT `dbUser`.
//
// Request STRUCT bodies (`req`) stay snake_case — see `../../../types/cpanel/account`
// and the CRITICAL serde note in `.orchestration/logs/t42-cpanel-categories.md`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CpanelDatabase,
  CreateAddonDomainRequest,
  CreateCronRequest,
  CreateEmailRequest,
  CreateFtpRequest,
  CreateSubdomainRequest,
  CronJob,
  CsrResult,
  DatabaseUser,
  DiskUsageInfo,
  DomainInfo,
  EmailAccount,
  EmailAutoresponder,
  EmailForwarder,
  FileItem,
  FtpAccount,
  FtpSession,
  GenerateCsrRequest,
  InstallSslRequest,
  MailingList,
  MxRecord,
  SpamFilterSettings,
  SslCertificate,
  SslStatus,
} from "../../../types/cpanel/account";

/** Minimal shape of a cPanel account for the tab's user picker. The full
 *  `CpanelAccount` type is owned by the `server` slice; the picker only needs the
 *  username + primary domain, so we keep c2 self-contained and read the list via
 *  the (read-only, non-owning) `cpanel_list_accounts` command. */
export interface CpanelAccountRef {
  user: string;
  domain: string;
  suspended?: boolean;
}

export const cpanelAccountApi = {
  // ── Account picker (read-only; command owned by the `server` slice) ──
  listAccounts: (id: string) =>
    invoke<CpanelAccountRef[]>("cpanel_list_accounts", { id }),

  // ── Domains (8) ────────────────────────────────────────────────
  listDomains: (id: string, user: string) =>
    invoke<DomainInfo[]>("cpanel_list_domains", { id, user }),
  listAllDomains: (id: string) =>
    invoke<DomainInfo[]>("cpanel_list_all_domains", { id }),
  createAddonDomain: (id: string, user: string, req: CreateAddonDomainRequest) =>
    invoke<string>("cpanel_create_addon_domain", { id, user, req }),
  removeAddonDomain: (
    id: string,
    user: string,
    domain: string,
    subdomain: string,
  ) =>
    invoke<string>("cpanel_remove_addon_domain", {
      id,
      user,
      domain,
      subdomain,
    }),
  createSubdomain: (id: string, user: string, req: CreateSubdomainRequest) =>
    invoke<string>("cpanel_create_subdomain", { id, user, req }),
  removeSubdomain: (id: string, user: string, domain: string) =>
    invoke<string>("cpanel_remove_subdomain", { id, user, domain }),
  parkDomain: (id: string, user: string, domain: string) =>
    invoke<string>("cpanel_park_domain", { id, user, domain }),
  unparkDomain: (id: string, user: string, domain: string) =>
    invoke<string>("cpanel_unpark_domain", { id, user, domain }),

  // ── Email (12) ─────────────────────────────────────────────────
  listEmailAccounts: (id: string, user: string) =>
    invoke<EmailAccount[]>("cpanel_list_email_accounts", { id, user }),
  createEmailAccount: (id: string, user: string, req: CreateEmailRequest) =>
    invoke<string>("cpanel_create_email_account", { id, user, req }),
  deleteEmailAccount: (id: string, user: string, email: string) =>
    invoke<string>("cpanel_delete_email_account", { id, user, email }),
  changeEmailPassword: (
    id: string,
    user: string,
    email: string,
    password: string,
  ) =>
    invoke<string>("cpanel_change_email_password", {
      id,
      user,
      email,
      password,
    }),
  setEmailQuota: (id: string, user: string, email: string, quota: number) =>
    invoke<string>("cpanel_set_email_quota", { id, user, email, quota }),
  listForwarders: (id: string, user: string, domain: string) =>
    invoke<EmailForwarder[]>("cpanel_list_forwarders", { id, user, domain }),
  addForwarder: (
    id: string,
    user: string,
    domain: string,
    email: string,
    fwdopt: string,
    fwdemail: string,
  ) =>
    invoke<string>("cpanel_add_forwarder", {
      id,
      user,
      domain,
      email,
      fwdopt,
      fwdemail,
    }),
  deleteForwarder: (
    id: string,
    user: string,
    address: string,
    dest: string,
  ) => invoke<string>("cpanel_delete_forwarder", { id, user, address, dest }),
  listAutoresponders: (id: string, user: string, domain: string) =>
    invoke<EmailAutoresponder[]>("cpanel_list_autoresponders", {
      id,
      user,
      domain,
    }),
  listMailingLists: (id: string, user: string, domain: string) =>
    invoke<MailingList[]>("cpanel_list_mailing_lists", { id, user, domain }),
  getSpamSettings: (id: string, user: string) =>
    invoke<SpamFilterSettings>("cpanel_get_spam_settings", { id, user }),
  listMxRecords: (id: string, user: string, domain: string) =>
    invoke<MxRecord[]>("cpanel_list_mx_records", { id, user, domain }),

  // ── Databases (7) ──────────────────────────────────────────────
  listDatabases: (id: string, user: string) =>
    invoke<CpanelDatabase[]>("cpanel_list_databases", { id, user }),
  createDatabase: (id: string, user: string, name: string) =>
    invoke<string>("cpanel_create_database", { id, user, name }),
  deleteDatabase: (id: string, user: string, name: string) =>
    invoke<string>("cpanel_delete_database", { id, user, name }),
  listDatabaseUsers: (id: string, user: string) =>
    invoke<DatabaseUser[]>("cpanel_list_database_users", { id, user }),
  createDatabaseUser: (
    id: string,
    user: string,
    dbUser: string,
    password: string,
  ) =>
    invoke<string>("cpanel_create_database_user", {
      id,
      user,
      dbUser,
      password,
    }),
  // NOTE: `dbuser` (lowercase), NOT `dbUser` — the crate's one param inconsistency.
  deleteDatabaseUser: (id: string, user: string, dbuser: string) =>
    invoke<string>("cpanel_delete_database_user", { id, user, dbuser }),
  grantDatabasePrivileges: (
    id: string,
    user: string,
    dbUser: string,
    db: string,
    privileges: string,
  ) =>
    invoke<string>("cpanel_grant_database_privileges", {
      id,
      user,
      dbUser,
      db,
      privileges,
    }),

  // ── Files (4) ──────────────────────────────────────────────────
  listFiles: (id: string, user: string, path: string) =>
    invoke<FileItem[]>("cpanel_list_files", { id, user, path }),
  createDirectory: (id: string, user: string, path: string, name: string) =>
    invoke<string>("cpanel_create_directory", { id, user, path, name }),
  deleteFile: (id: string, user: string, path: string) =>
    invoke<string>("cpanel_delete_file", { id, user, path }),
  getDiskUsage: (id: string, user: string) =>
    invoke<DiskUsageInfo>("cpanel_get_disk_usage", { id, user }),

  // ── SSL (5) ────────────────────────────────────────────────────
  listSslCerts: (id: string, user: string) =>
    invoke<SslCertificate[]>("cpanel_list_ssl_certs", { id, user }),
  getSslStatus: (id: string, user: string) =>
    invoke<SslStatus[]>("cpanel_get_ssl_status", { id, user }),
  // No `user` arg — install is keyed to the domain in the request body.
  installSsl: (id: string, req: InstallSslRequest) =>
    invoke<string>("cpanel_install_ssl", { id, req }),
  generateCsr: (id: string, user: string, req: GenerateCsrRequest) =>
    invoke<CsrResult>("cpanel_generate_csr", { id, user, req }),
  autosslCheck: (id: string, user: string) =>
    invoke<unknown>("cpanel_autossl_check", { id, user }),

  // ── FTP (4) ────────────────────────────────────────────────────
  listFtpAccounts: (id: string, user: string) =>
    invoke<FtpAccount[]>("cpanel_list_ftp_accounts", { id, user }),
  createFtpAccount: (id: string, user: string, req: CreateFtpRequest) =>
    invoke<string>("cpanel_create_ftp_account", { id, user, req }),
  deleteFtpAccount: (
    id: string,
    user: string,
    ftpUser: string,
    destroy: boolean,
  ) =>
    invoke<string>("cpanel_delete_ftp_account", {
      id,
      user,
      ftpUser,
      destroy,
    }),
  // No `user` arg — sessions are enumerated server-wide.
  listFtpSessions: (id: string) =>
    invoke<FtpSession[]>("cpanel_list_ftp_sessions", { id }),

  // ── Cron (4) ───────────────────────────────────────────────────
  listCronJobs: (id: string, user: string) =>
    invoke<CronJob[]>("cpanel_list_cron_jobs", { id, user }),
  addCronJob: (id: string, user: string, req: CreateCronRequest) =>
    invoke<string>("cpanel_add_cron_job", { id, user, req }),
  editCronJob: (
    id: string,
    user: string,
    linekey: string,
    req: CreateCronRequest,
  ) => invoke<string>("cpanel_edit_cron_job", { id, user, linekey, req }),
  deleteCronJob: (id: string, user: string, linekey: string) =>
    invoke<string>("cpanel_delete_cron_job", { id, user, linekey }),
};

export type CpanelAccountApi = typeof cpanelAccountApi;

/**
 * Convenience hook for the Account Services tab. Exposes the invoke slice plus
 * shared `isLoading`/`error` state and a `run` helper that binds the live
 * `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function useCpanelAccount(connectionId: string) {
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
    api: cpanelAccountApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseCpanelAccount = ReturnType<typeof useCpanelAccount>;
