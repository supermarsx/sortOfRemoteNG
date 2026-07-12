import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors CpanelPanel.test).
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

import CpanelAccountTab from "./CpanelAccountTab";
import { cpanelAccountApi } from "../../../hooks/integration/cpanel/useCpanelAccount";

const CID = "conn-1";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("cpanelAccountApi", () => {
  it("wraps all 44 account-scope commands with the exact command names", () => {
    // Domains (8)
    cpanelAccountApi.listDomains(CID, "bob");
    cpanelAccountApi.listAllDomains(CID);
    cpanelAccountApi.createAddonDomain(CID, "bob", {
      domain: "a.com",
      subdomain: "a",
      document_root: "public_html/a",
    });
    cpanelAccountApi.removeAddonDomain(CID, "bob", "a.com", "a");
    cpanelAccountApi.createSubdomain(CID, "bob", {
      subdomain: "dev",
      root_domain: "a.com",
    });
    cpanelAccountApi.removeSubdomain(CID, "bob", "dev.a.com");
    cpanelAccountApi.parkDomain(CID, "bob", "p.com");
    cpanelAccountApi.unparkDomain(CID, "bob", "p.com");
    // Email (12)
    cpanelAccountApi.listEmailAccounts(CID, "bob");
    cpanelAccountApi.createEmailAccount(CID, "bob", {
      email: "u@a.com",
      password: "x",
    });
    cpanelAccountApi.deleteEmailAccount(CID, "bob", "u@a.com");
    cpanelAccountApi.changeEmailPassword(CID, "bob", "u@a.com", "y");
    cpanelAccountApi.setEmailQuota(CID, "bob", "u@a.com", 100);
    cpanelAccountApi.listForwarders(CID, "bob", "a.com");
    cpanelAccountApi.addForwarder(CID, "bob", "a.com", "i@a.com", "fwd", "d@a.com");
    cpanelAccountApi.deleteForwarder(CID, "bob", "i@a.com", "d@a.com");
    cpanelAccountApi.listAutoresponders(CID, "bob", "a.com");
    cpanelAccountApi.listMailingLists(CID, "bob", "a.com");
    cpanelAccountApi.getSpamSettings(CID, "bob");
    cpanelAccountApi.listMxRecords(CID, "bob", "a.com");
    // Databases (7)
    cpanelAccountApi.listDatabases(CID, "bob");
    cpanelAccountApi.createDatabase(CID, "bob", "bob_db");
    cpanelAccountApi.deleteDatabase(CID, "bob", "bob_db");
    cpanelAccountApi.listDatabaseUsers(CID, "bob");
    cpanelAccountApi.createDatabaseUser(CID, "bob", "bob_u", "pw");
    cpanelAccountApi.deleteDatabaseUser(CID, "bob", "bob_u");
    cpanelAccountApi.grantDatabasePrivileges(CID, "bob", "bob_u", "bob_db", "ALL");
    // Files (4)
    cpanelAccountApi.listFiles(CID, "bob", "public_html");
    cpanelAccountApi.createDirectory(CID, "bob", "public_html", "sub");
    cpanelAccountApi.deleteFile(CID, "bob", "public_html/x");
    cpanelAccountApi.getDiskUsage(CID, "bob");
    // SSL (5)
    cpanelAccountApi.listSslCerts(CID, "bob");
    cpanelAccountApi.getSslStatus(CID, "bob");
    cpanelAccountApi.installSsl(CID, { domain: "a.com", cert: "c", key: "k" });
    cpanelAccountApi.generateCsr(CID, "bob", { domain: "a.com" });
    cpanelAccountApi.autosslCheck(CID, "bob");
    // FTP (4)
    cpanelAccountApi.listFtpAccounts(CID, "bob");
    cpanelAccountApi.createFtpAccount(CID, "bob", { user: "f", password: "pw" });
    cpanelAccountApi.deleteFtpAccount(CID, "bob", "f", true);
    cpanelAccountApi.listFtpSessions(CID);
    // Cron (4)
    cpanelAccountApi.listCronJobs(CID, "bob");
    cpanelAccountApi.addCronJob(CID, "bob", {
      command: "x",
      minute: "*",
      hour: "*",
      day: "*",
      month: "*",
      weekday: "*",
    });
    cpanelAccountApi.editCronJob(CID, "bob", "key1", {
      command: "y",
      minute: "*",
      hour: "*",
      day: "*",
      month: "*",
      weekday: "*",
    });
    cpanelAccountApi.deleteCronJob(CID, "bob", "key1");

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "cpanel_list_domains",
      "cpanel_list_all_domains",
      "cpanel_create_addon_domain",
      "cpanel_remove_addon_domain",
      "cpanel_create_subdomain",
      "cpanel_remove_subdomain",
      "cpanel_park_domain",
      "cpanel_unpark_domain",
      "cpanel_list_email_accounts",
      "cpanel_create_email_account",
      "cpanel_delete_email_account",
      "cpanel_change_email_password",
      "cpanel_set_email_quota",
      "cpanel_list_forwarders",
      "cpanel_add_forwarder",
      "cpanel_delete_forwarder",
      "cpanel_list_autoresponders",
      "cpanel_list_mailing_lists",
      "cpanel_get_spam_settings",
      "cpanel_list_mx_records",
      "cpanel_list_databases",
      "cpanel_create_database",
      "cpanel_delete_database",
      "cpanel_list_database_users",
      "cpanel_create_database_user",
      "cpanel_delete_database_user",
      "cpanel_grant_database_privileges",
      "cpanel_list_files",
      "cpanel_create_directory",
      "cpanel_delete_file",
      "cpanel_get_disk_usage",
      "cpanel_list_ssl_certs",
      "cpanel_get_ssl_status",
      "cpanel_install_ssl",
      "cpanel_generate_csr",
      "cpanel_autossl_check",
      "cpanel_list_ftp_accounts",
      "cpanel_create_ftp_account",
      "cpanel_delete_ftp_account",
      "cpanel_list_ftp_sessions",
      "cpanel_list_cron_jobs",
      "cpanel_add_cron_job",
      "cpanel_edit_cron_job",
      "cpanel_delete_cron_job",
    ]);
    expect(cmds).toHaveLength(44);
  });

  it("uses the exact camelCase gotcha arg names from the crate", () => {
    invokeMock.mockClear();
    // dbUser vs dbuser: create uses camelCase, delete stays lowercase.
    cpanelAccountApi.createDatabaseUser(CID, "bob", "bob_u", "pw");
    expect(invokeMock).toHaveBeenCalledWith("cpanel_create_database_user", {
      id: CID,
      user: "bob",
      dbUser: "bob_u",
      password: "pw",
    });
    cpanelAccountApi.deleteDatabaseUser(CID, "bob", "bob_u");
    expect(invokeMock).toHaveBeenCalledWith("cpanel_delete_database_user", {
      id: CID,
      user: "bob",
      dbuser: "bob_u",
    });
    cpanelAccountApi.grantDatabasePrivileges(CID, "bob", "bob_u", "bob_db", "ALL");
    expect(invokeMock).toHaveBeenCalledWith("cpanel_grant_database_privileges", {
      id: CID,
      user: "bob",
      dbUser: "bob_u",
      db: "bob_db",
      privileges: "ALL",
    });
    // ftpUser + destroy.
    cpanelAccountApi.deleteFtpAccount(CID, "bob", "f", true);
    expect(invokeMock).toHaveBeenCalledWith("cpanel_delete_ftp_account", {
      id: CID,
      user: "bob",
      ftpUser: "f",
      destroy: true,
    });
    // request-bearing / no-user commands.
    cpanelAccountApi.installSsl(CID, { domain: "a.com", cert: "c", key: "k" });
    expect(invokeMock).toHaveBeenCalledWith("cpanel_install_ssl", {
      id: CID,
      req: { domain: "a.com", cert: "c", key: "k" },
    });
    cpanelAccountApi.listFtpSessions(CID);
    expect(invokeMock).toHaveBeenCalledWith("cpanel_list_ftp_sessions", {
      id: CID,
    });
  });
});

describe("CpanelAccountTab", () => {
  it("mounts, loads the account picker, and shows the Domains group by default", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "cpanel_list_accounts")
        return Promise.resolve([{ user: "bob", domain: "a.com" }]);
      return Promise.resolve([]);
    });

    render(<CpanelAccountTab connectionId={CID} />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("cpanel_list_accounts", {
        id: CID,
      }),
    );
    // Group nav renders from inline English defaults.
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Databases")).toBeInTheDocument();
    // Once the picker auto-selects "bob", the Domains section loads its list.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("cpanel_list_domains", {
        id: CID,
        user: "bob",
      }),
    );
  });
});
