import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors the cpanel tab test).
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

import MailcowObjectsTab from "./MailcowObjectsTab";
import { mailcowObjectsApi } from "../../../hooks/integration/mailcow/useMailcowObjects";

const CID = "conn-1";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("mailcowObjectsApi", () => {
  it("wraps all 35 provisioning commands with the exact command names", () => {
    // Domains (5)
    mailcowObjectsApi.listDomains(CID);
    mailcowObjectsApi.getDomain(CID, "example.com");
    mailcowObjectsApi.createDomain(CID, { domain: "example.com" });
    mailcowObjectsApi.updateDomain(CID, "example.com", { active: false });
    mailcowObjectsApi.deleteDomain(CID, "example.com");
    // Mailboxes (8)
    mailcowObjectsApi.listMailboxes(CID);
    mailcowObjectsApi.listMailboxesByDomain(CID, "example.com");
    mailcowObjectsApi.getMailbox(CID, "john@example.com");
    mailcowObjectsApi.createMailbox(CID, {
      local_part: "john",
      domain: "example.com",
      name: "John",
      password: "pw",
    });
    mailcowObjectsApi.updateMailbox(CID, "john@example.com", { active: false });
    mailcowObjectsApi.deleteMailbox(CID, "john@example.com");
    mailcowObjectsApi.quarantineNotifications(CID, "john@example.com", true);
    mailcowObjectsApi.pushoverSetup(CID, "john@example.com", { active: 1 });
    // Aliases (5)
    mailcowObjectsApi.listAliases(CID);
    mailcowObjectsApi.getAlias(CID, 7);
    mailcowObjectsApi.createAlias(CID, { address: "a@example.com", goto: "b@example.com" });
    mailcowObjectsApi.updateAlias(CID, 7, { active: false });
    mailcowObjectsApi.deleteAlias(CID, 7);
    // Domain aliases (5)
    mailcowObjectsApi.listDomainAliases(CID);
    mailcowObjectsApi.getDomainAlias(CID, "alias.example.com");
    mailcowObjectsApi.createDomainAlias(CID, {
      alias_domain: "alias.example.com",
      target_domain: "example.com",
    });
    mailcowObjectsApi.updateDomainAlias(CID, "alias.example.com", false);
    mailcowObjectsApi.deleteDomainAlias(CID, "alias.example.com");
    // DKIM (4)
    mailcowObjectsApi.getDkim(CID, "example.com");
    mailcowObjectsApi.generateDkim(CID, { domains: ["example.com"] });
    mailcowObjectsApi.deleteDkim(CID, "example.com");
    mailcowObjectsApi.duplicateDkim(CID, "example.com", "other.com");
    // Resources (5)
    mailcowObjectsApi.listResources(CID);
    mailcowObjectsApi.getResource(CID, "Room A");
    mailcowObjectsApi.createResource(CID, {
      name: "Room A",
      kind: "location",
      domain: "example.com",
    });
    mailcowObjectsApi.updateResource(CID, "Room A", {
      name: "Room A",
      kind: "location",
      domain: "example.com",
    });
    mailcowObjectsApi.deleteResource(CID, "Room A");
    // App passwords (3)
    mailcowObjectsApi.listAppPasswords(CID, "john@example.com");
    mailcowObjectsApi.createAppPassword(CID, {
      username: "john@example.com",
      name: "Thunderbird",
      password: "pw",
    });
    mailcowObjectsApi.deleteAppPassword(CID, 3);

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "mailcow_list_domains",
      "mailcow_get_domain",
      "mailcow_create_domain",
      "mailcow_update_domain",
      "mailcow_delete_domain",
      "mailcow_list_mailboxes",
      "mailcow_list_mailboxes_by_domain",
      "mailcow_get_mailbox",
      "mailcow_create_mailbox",
      "mailcow_update_mailbox",
      "mailcow_delete_mailbox",
      "mailcow_quarantine_notifications",
      "mailcow_pushover_setup",
      "mailcow_list_aliases",
      "mailcow_get_alias",
      "mailcow_create_alias",
      "mailcow_update_alias",
      "mailcow_delete_alias",
      "mailcow_list_domain_aliases",
      "mailcow_get_domain_alias",
      "mailcow_create_domain_alias",
      "mailcow_update_domain_alias",
      "mailcow_delete_domain_alias",
      "mailcow_get_dkim",
      "mailcow_generate_dkim",
      "mailcow_delete_dkim",
      "mailcow_duplicate_dkim",
      "mailcow_list_resources",
      "mailcow_get_resource",
      "mailcow_create_resource",
      "mailcow_update_resource",
      "mailcow_delete_resource",
      "mailcow_list_app_passwords",
      "mailcow_create_app_password",
      "mailcow_delete_app_password",
    ]);
    expect(cmds).toHaveLength(35);
  });

  it("uses the camelCase fn-arg names from the crate (structs stay snake_case)", () => {
    invokeMock.mockClear();
    // alias_id -> aliasId
    mailcowObjectsApi.getAlias(CID, 7);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_get_alias", {
      id: CID,
      aliasId: 7,
    });
    // src_domain/dst_domain -> srcDomain/dstDomain
    mailcowObjectsApi.duplicateDkim(CID, "a.com", "b.com");
    expect(invokeMock).toHaveBeenCalledWith("mailcow_duplicate_dkim", {
      id: CID,
      srcDomain: "a.com",
      dstDomain: "b.com",
    });
    // alias_domain -> aliasDomain; update also takes `active`
    mailcowObjectsApi.updateDomainAlias(CID, "alias.example.com", false);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_update_domain_alias", {
      id: CID,
      aliasDomain: "alias.example.com",
      active: false,
    });
    // app_password_id -> appPasswordId
    mailcowObjectsApi.deleteAppPassword(CID, 3);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_delete_app_password", {
      id: CID,
      appPasswordId: 3,
    });
    // request-bearing commands pass the snake_case struct as `req`
    mailcowObjectsApi.createDomain(CID, { domain: "example.com" });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_create_domain", {
      id: CID,
      req: { domain: "example.com" },
    });
    // update-with-key: id + key + req
    mailcowObjectsApi.updateMailbox(CID, "john@example.com", { active: false });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_update_mailbox", {
      id: CID,
      username: "john@example.com",
      req: { active: false },
    });
  });
});

describe("MailcowObjectsTab", () => {
  it("mounts, shows the group nav, and loads the domain list by default", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "mailcow_list_domains")
        return Promise.resolve([
          {
            domain_name: "example.com",
            description: "",
            aliases: 0,
            mailboxes: 1,
            max_aliases: 400,
            max_mailboxes: 10,
            max_quota: 0,
            quota: 0,
            relay_all_recipients: false,
            relay_host: "",
            backupmx: false,
            active: true,
            created: "",
            modified: "",
          },
        ]);
      return Promise.resolve([]);
    });

    render(<MailcowObjectsTab connectionId={CID} />);

    // Group nav renders from inline English defaults.
    expect(screen.getByText("Mailboxes")).toBeInTheDocument();
    expect(screen.getByText("Aliases")).toBeInTheDocument();
    // Domains group loads its list on mount.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("mailcow_list_domains", {
        id: CID,
      }),
    );
  });
});
