// Exchange "Org Config, Security & Compliance" invoke slice + hook (t42-exchange-c5).
//
// `exchangeOrgSecurityApi` is a thin 1:1 wrapper over the 45 org/security/compliance
// `exchange_*` commands in `src-tauri/crates/sorng-exchange/src/commands.rs`:
//   Retention & compliance holds (9), Journal rules (6), RBAC & audit (12),
//   Organization config (2), Anti-spam/hygiene & quarantine (10), Certificates (6).
//
// ⚠️ Exchange is a SINGLETON service: these commands take NO connection id — they
// run against the one active connection. Argument names are camelCase 1:1 with the
// Rust `#[tauri::command]` params (Tauri camelCases: `start_date -> startDate`,
// `result_size -> resultSize`, `page_size -> pageSize`, `file_path -> filePath`,
// `subject_name -> subjectName`, `domain_names -> domainNames`, etc.). Commands with
// a `serde_json::Value` param/return surface as `Record<string, unknown>` / `unknown`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AdminAuditLogEntry,
  AdminAuditLogSearchRequest,
  ConnectionFilterConfig,
  ContentFilterConfig,
  CreateJournalRuleRequest,
  DlpPolicy,
  ExchangeCertificate,
  JournalRule,
  MailboxAuditLogEntry,
  MailboxHold,
  ManagementRole,
  ManagementRoleAssignment,
  OrganizationConfig,
  QuarantineMessage,
  RetentionPolicy,
  RetentionTag,
  RoleGroup,
  SenderFilterConfig,
} from "../../../types/exchange/orgsecurity";

export const exchangeOrgSecurityApi = {
  // ── Retention & compliance holds (9) ──────────────────────────────
  listRetentionPolicies: () =>
    invoke<RetentionPolicy[]>("exchange_list_retention_policies"),
  getRetentionPolicy: (identity: string) =>
    invoke<RetentionPolicy>("exchange_get_retention_policy", { identity }),
  listRetentionTags: () =>
    invoke<RetentionTag[]>("exchange_list_retention_tags"),
  getRetentionTag: (identity: string) =>
    invoke<RetentionTag>("exchange_get_retention_tag", { identity }),
  getMailboxHold: (identity: string) =>
    invoke<MailboxHold>("exchange_get_mailbox_hold", { identity }),
  enableLitigationHold: (
    identity: string,
    duration?: string | null,
    owner?: string | null,
  ) =>
    invoke<string>("exchange_enable_litigation_hold", {
      identity,
      duration: duration ?? null,
      owner: owner ?? null,
    }),
  disableLitigationHold: (identity: string) =>
    invoke<string>("exchange_disable_litigation_hold", { identity }),
  listDlpPolicies: () => invoke<DlpPolicy[]>("exchange_list_dlp_policies"),
  getDlpPolicy: (identity: string) =>
    invoke<DlpPolicy>("exchange_get_dlp_policy", { identity }),

  // ── Journal rules (6) ─────────────────────────────────────────────
  listJournalRules: () => invoke<JournalRule[]>("exchange_list_journal_rules"),
  getJournalRule: (identity: string) =>
    invoke<JournalRule>("exchange_get_journal_rule", { identity }),
  createJournalRule: (request: CreateJournalRuleRequest) =>
    invoke<JournalRule>("exchange_create_journal_rule", { request }),
  removeJournalRule: (identity: string) =>
    invoke<string>("exchange_remove_journal_rule", { identity }),
  enableJournalRule: (identity: string) =>
    invoke<string>("exchange_enable_journal_rule", { identity }),
  disableJournalRule: (identity: string) =>
    invoke<string>("exchange_disable_journal_rule", { identity }),

  // ── RBAC & audit (12) ─────────────────────────────────────────────
  listRoleGroups: () => invoke<RoleGroup[]>("exchange_list_role_groups"),
  getRoleGroup: (identity: string) =>
    invoke<RoleGroup>("exchange_get_role_group", { identity }),
  addRoleGroupMember: (group: string, member: string) =>
    invoke<string>("exchange_add_role_group_member", { group, member }),
  removeRoleGroupMember: (group: string, member: string) =>
    invoke<string>("exchange_remove_role_group_member", { group, member }),
  listManagementRoles: () =>
    invoke<ManagementRole[]>("exchange_list_management_roles"),
  getManagementRole: (identity: string) =>
    invoke<ManagementRole>("exchange_get_management_role", { identity }),
  listRoleAssignments: (role?: string | null, roleAssignee?: string | null) =>
    invoke<ManagementRoleAssignment[]>("exchange_list_role_assignments", {
      role: role ?? null,
      roleAssignee: roleAssignee ?? null,
    }),
  searchAdminAuditLog: (request: AdminAuditLogSearchRequest) =>
    invoke<AdminAuditLogEntry[]>("exchange_search_admin_audit_log", { request }),
  getAdminAuditLogConfig: () =>
    invoke<unknown>("exchange_get_admin_audit_log_config"),
  searchMailboxAuditLog: (
    mailbox: string,
    startDate?: string | null,
    endDate?: string | null,
    logOnTypes?: string | null,
    resultSize?: number | null,
  ) =>
    invoke<MailboxAuditLogEntry[]>("exchange_search_mailbox_audit_log", {
      mailbox,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      logOnTypes: logOnTypes ?? null,
      resultSize: resultSize ?? null,
    }),
  enableMailboxAudit: (identity: string) =>
    invoke<string>("exchange_enable_mailbox_audit", { identity }),
  disableMailboxAudit: (identity: string) =>
    invoke<string>("exchange_disable_mailbox_audit", { identity }),

  // ── Organization config (2) ───────────────────────────────────────
  getOrganizationConfig: () =>
    invoke<OrganizationConfig>("exchange_get_organization_config"),
  setOrganizationConfig: (params: Record<string, unknown>) =>
    invoke<string>("exchange_set_organization_config", { params }),

  // ── Anti-spam / hygiene & quarantine (10) ─────────────────────────
  getContentFilterConfig: () =>
    invoke<ContentFilterConfig>("exchange_get_content_filter_config"),
  setContentFilterConfig: (params: Record<string, unknown>) =>
    invoke<string>("exchange_set_content_filter_config", { params }),
  getConnectionFilterConfig: () =>
    invoke<ConnectionFilterConfig>("exchange_get_connection_filter_config"),
  setConnectionFilterConfig: (params: Record<string, unknown>) =>
    invoke<string>("exchange_set_connection_filter_config", { params }),
  getSenderFilterConfig: () =>
    invoke<SenderFilterConfig>("exchange_get_sender_filter_config"),
  setSenderFilterConfig: (params: Record<string, unknown>) =>
    invoke<string>("exchange_set_sender_filter_config", { params }),
  listQuarantineMessages: (
    pageSize?: number | null,
    quarantineType?: string | null,
  ) =>
    invoke<QuarantineMessage[]>("exchange_list_quarantine_messages", {
      pageSize: pageSize ?? null,
      quarantineType: quarantineType ?? null,
    }),
  getQuarantineMessage: (identity: string) =>
    invoke<QuarantineMessage>("exchange_get_quarantine_message", { identity }),
  releaseQuarantineMessage: (identity: string, releaseToAll: boolean) =>
    invoke<string>("exchange_release_quarantine_message", {
      identity,
      releaseToAll,
    }),
  deleteQuarantineMessage: (identity: string) =>
    invoke<string>("exchange_delete_quarantine_message", { identity }),

  // ── Certificates (6) ──────────────────────────────────────────────
  listCertificates: (server?: string | null) =>
    invoke<ExchangeCertificate[]>("exchange_list_certificates", {
      server: server ?? null,
    }),
  getCertificate: (thumbprint: string, server?: string | null) =>
    invoke<ExchangeCertificate>("exchange_get_certificate", {
      thumbprint,
      server: server ?? null,
    }),
  enableCertificate: (
    thumbprint: string,
    services: string,
    server?: string | null,
  ) =>
    invoke<string>("exchange_enable_certificate", {
      thumbprint,
      services,
      server: server ?? null,
    }),
  importCertificate: (
    filePath: string,
    password?: string | null,
    server?: string | null,
  ) =>
    invoke<ExchangeCertificate>("exchange_import_certificate", {
      filePath,
      password: password ?? null,
      server: server ?? null,
    }),
  removeCertificate: (thumbprint: string, server?: string | null) =>
    invoke<string>("exchange_remove_certificate", {
      thumbprint,
      server: server ?? null,
    }),
  newCertificateRequest: (
    subjectName: string,
    domainNames: string[],
    server?: string | null,
  ) =>
    invoke<string>("exchange_new_certificate_request", {
      subjectName,
      domainNames,
      server: server ?? null,
    }),
};

export type ExchangeOrgSecurityApi = typeof exchangeOrgSecurityApi;

/**
 * Convenience hook for the Org Config, Security & Compliance tab. Exposes the
 * invoke slice plus shared `isLoading`/`error` state and a `run` helper that wraps
 * a call and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`). Exchange is a singleton
 * service, so `run` binds no connection id — it just brackets the async call.
 */
export function useExchangeOrgSecurity() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    api: exchangeOrgSecurityApi,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseExchangeOrgSecurity = ReturnType<typeof useExchangeOrgSecurity>;
