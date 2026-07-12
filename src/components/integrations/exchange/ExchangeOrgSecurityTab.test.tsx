import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors the netbox tab tests).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, dflt?: string) => dflt ?? _key,
  }),
}));

import ExchangeOrgSecurityTab from "./ExchangeOrgSecurityTab";
import { exchangeOrgSecurityApi } from "../../../hooks/integration/exchange/useExchangeOrgSecurity";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("exchangeOrgSecurityApi", () => {
  it("wraps all 45 org/security/compliance commands with exact names + singleton args", async () => {
    // Retention & compliance holds (9)
    exchangeOrgSecurityApi.listRetentionPolicies();
    exchangeOrgSecurityApi.getRetentionPolicy("Default MRM Policy");
    exchangeOrgSecurityApi.listRetentionTags();
    exchangeOrgSecurityApi.getRetentionTag("1 Week Delete");
    exchangeOrgSecurityApi.getMailboxHold("jdoe");
    exchangeOrgSecurityApi.enableLitigationHold("jdoe", "2555.00:00:00", "admin");
    exchangeOrgSecurityApi.disableLitigationHold("jdoe");
    exchangeOrgSecurityApi.listDlpPolicies();
    exchangeOrgSecurityApi.getDlpPolicy("PII");
    // Journal rules (6)
    exchangeOrgSecurityApi.listJournalRules();
    exchangeOrgSecurityApi.getJournalRule("All Mail");
    exchangeOrgSecurityApi.createJournalRule({
      name: "All Mail",
      journalEmailAddress: "journal@contoso.com",
      scope: "global",
      enabled: true,
    });
    exchangeOrgSecurityApi.removeJournalRule("All Mail");
    exchangeOrgSecurityApi.enableJournalRule("All Mail");
    exchangeOrgSecurityApi.disableJournalRule("All Mail");
    // RBAC & audit (12)
    exchangeOrgSecurityApi.listRoleGroups();
    exchangeOrgSecurityApi.getRoleGroup("Organization Management");
    exchangeOrgSecurityApi.addRoleGroupMember("Organization Management", "jdoe");
    exchangeOrgSecurityApi.removeRoleGroupMember(
      "Organization Management",
      "jdoe",
    );
    exchangeOrgSecurityApi.listManagementRoles();
    exchangeOrgSecurityApi.getManagementRole("Mail Recipients");
    exchangeOrgSecurityApi.listRoleAssignments("Mail Recipients", "jdoe");
    exchangeOrgSecurityApi.searchAdminAuditLog({ resultSize: 50 });
    exchangeOrgSecurityApi.getAdminAuditLogConfig();
    exchangeOrgSecurityApi.searchMailboxAuditLog(
      "jdoe",
      "2026-01-01",
      "2026-02-01",
      "Admin",
      100,
    );
    exchangeOrgSecurityApi.enableMailboxAudit("jdoe");
    exchangeOrgSecurityApi.disableMailboxAudit("jdoe");
    // Organization config (2)
    exchangeOrgSecurityApi.getOrganizationConfig();
    exchangeOrgSecurityApi.setOrganizationConfig({ mailtipsEnabled: true });
    // Anti-spam / hygiene & quarantine (10)
    exchangeOrgSecurityApi.getContentFilterConfig();
    exchangeOrgSecurityApi.setContentFilterConfig({ sclJunkThreshold: 4 });
    exchangeOrgSecurityApi.getConnectionFilterConfig();
    exchangeOrgSecurityApi.setConnectionFilterConfig({ enableSafeList: true });
    exchangeOrgSecurityApi.getSenderFilterConfig();
    exchangeOrgSecurityApi.setSenderFilterConfig({
      blankSenderBlockingEnabled: true,
    });
    exchangeOrgSecurityApi.listQuarantineMessages(50, "Spam");
    exchangeOrgSecurityApi.getQuarantineMessage("abc");
    exchangeOrgSecurityApi.releaseQuarantineMessage("abc", true);
    exchangeOrgSecurityApi.deleteQuarantineMessage("abc");
    // Certificates (6)
    exchangeOrgSecurityApi.listCertificates("mail01");
    exchangeOrgSecurityApi.getCertificate("THUMB", "mail01");
    exchangeOrgSecurityApi.enableCertificate("THUMB", "IIS,SMTP", "mail01");
    exchangeOrgSecurityApi.importCertificate("C:\\cert.pfx", "pw", "mail01");
    exchangeOrgSecurityApi.removeCertificate("THUMB", "mail01");
    exchangeOrgSecurityApi.newCertificateRequest(
      "CN=mail.contoso.com",
      ["mail.contoso.com", "autodiscover.contoso.com"],
      "mail01",
    );

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "exchange_list_retention_policies",
      "exchange_get_retention_policy",
      "exchange_list_retention_tags",
      "exchange_get_retention_tag",
      "exchange_get_mailbox_hold",
      "exchange_enable_litigation_hold",
      "exchange_disable_litigation_hold",
      "exchange_list_dlp_policies",
      "exchange_get_dlp_policy",
      "exchange_list_journal_rules",
      "exchange_get_journal_rule",
      "exchange_create_journal_rule",
      "exchange_remove_journal_rule",
      "exchange_enable_journal_rule",
      "exchange_disable_journal_rule",
      "exchange_list_role_groups",
      "exchange_get_role_group",
      "exchange_add_role_group_member",
      "exchange_remove_role_group_member",
      "exchange_list_management_roles",
      "exchange_get_management_role",
      "exchange_list_role_assignments",
      "exchange_search_admin_audit_log",
      "exchange_get_admin_audit_log_config",
      "exchange_search_mailbox_audit_log",
      "exchange_enable_mailbox_audit",
      "exchange_disable_mailbox_audit",
      "exchange_get_organization_config",
      "exchange_set_organization_config",
      "exchange_get_content_filter_config",
      "exchange_set_content_filter_config",
      "exchange_get_connection_filter_config",
      "exchange_set_connection_filter_config",
      "exchange_get_sender_filter_config",
      "exchange_set_sender_filter_config",
      "exchange_list_quarantine_messages",
      "exchange_get_quarantine_message",
      "exchange_release_quarantine_message",
      "exchange_delete_quarantine_message",
      "exchange_list_certificates",
      "exchange_get_certificate",
      "exchange_enable_certificate",
      "exchange_import_certificate",
      "exchange_remove_certificate",
      "exchange_new_certificate_request",
    ]);
    expect(cmds).toHaveLength(45);

    // Singleton service: no connection id; camelCase args map 1:1 with Rust params.
    expect(invokeMock).toHaveBeenCalledWith("exchange_enable_litigation_hold", {
      identity: "jdoe",
      duration: "2555.00:00:00",
      owner: "admin",
    });
    expect(invokeMock).toHaveBeenCalledWith("exchange_add_role_group_member", {
      group: "Organization Management",
      member: "jdoe",
    });
    expect(invokeMock).toHaveBeenCalledWith("exchange_create_journal_rule", {
      request: {
        name: "All Mail",
        journalEmailAddress: "journal@contoso.com",
        scope: "global",
        enabled: true,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "exchange_release_quarantine_message",
      { identity: "abc", releaseToAll: true },
    );
    expect(invokeMock).toHaveBeenCalledWith("exchange_new_certificate_request", {
      subjectName: "CN=mail.contoso.com",
      domainNames: ["mail.contoso.com", "autodiscover.contoso.com"],
      server: "mail01",
    });
  });
});

describe("ExchangeOrgSecurityTab", () => {
  it("mounts and loads the default retention policies section", async () => {
    render(<ExchangeOrgSecurityTab summary={null} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_list_retention_policies",
        undefined,
      ),
    );
    // Group pills render from the inline English defaults.
    expect(screen.getByText("RBAC & Audit")).toBeInTheDocument();
    expect(screen.getByText("Certificates")).toBeInTheDocument();
  });
});
