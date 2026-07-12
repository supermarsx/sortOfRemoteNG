import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors NetboxIpamTab.test).
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

import ExchangeRecipientsTab from "./ExchangeRecipientsTab";
import { exchangeRecipientsApi as api } from "../../../hooks/integration/exchange/useExchangeRecipients";

beforeEach(() => {
  invokeMock.mockReset();
  // Lists resolve to arrays; the rest to {} — enough for a smoke pass.
  invokeMock.mockResolvedValue([]);
});

describe("exchangeRecipientsApi", () => {
  it("wraps all 49 recipient commands with the exact command names and no id", () => {
    // Mailboxes (14)
    api.listMailboxes(100, "a");
    api.getMailbox("m");
    api.createMailbox({
      displayName: "D",
      alias: "d",
      primarySmtpAddress: "d@x",
      mailboxType: "userMailbox",
    });
    api.removeMailbox("m");
    api.enableMailbox("m", "DB01");
    api.disableMailbox("m");
    api.updateMailbox({ identity: "m" });
    api.getMailboxStatistics("m");
    api.getMailboxPermissions("m");
    api.addMailboxPermission("m", "u", "FullAccess");
    api.removeMailboxPermission("m", "u", "FullAccess");
    api.getForwarding("m");
    api.getOoo("m");
    api.setOoo({ identity: "m", autoReplyState: "enabled", externalAudience: "all" });
    // Distribution / M365 groups (9)
    api.listGroups(50);
    api.getGroup("g");
    api.createGroup({
      displayName: "G",
      alias: "g",
      primarySmtpAddress: "g@x",
      groupType: "distribution",
    });
    api.updateGroup({ identity: "g" });
    api.removeGroup("g");
    api.listGroupMembers("g");
    api.addGroupMember("g", "u");
    api.removeGroupMember("g", "u");
    api.listDynamicGroups();
    // Mail contacts & mail users (10)
    api.listMailContacts(25);
    api.getMailContact("c");
    api.createMailContact({ displayName: "C", alias: "c", externalEmailAddress: "c@x" });
    api.updateMailContact("c", { DisplayName: "C2" });
    api.removeMailContact("c");
    api.listMailUsers(25);
    api.getMailUser("u");
    api.createMailUser({
      displayName: "U",
      alias: "u",
      externalEmailAddress: "u@x",
      userPrincipalName: "u@x",
      password: "p",
    });
    api.removeMailUser("u");
    api.convertMailbox({ identity: "m", targetType: "sharedMailbox" });
    // Shared / resource mailboxes (10)
    api.listSharedMailboxes(100);
    api.listRoomMailboxes();
    api.listEquipmentMailboxes();
    api.addAutomapping("m", "u");
    api.removeAutomapping("m", "u");
    api.addSendAs("m", "u");
    api.removeSendAs("m", "u");
    api.addSendOnBehalf("m", "u");
    api.removeSendOnBehalf("m", "u");
    api.listRoomLists();
    // Archive mailboxes (6)
    api.getArchiveInfo("m");
    api.enableArchive("m", "DB01");
    api.disableArchive("m");
    api.enableAutoExpandingArchive("m");
    api.setArchiveQuota("m", "100GB", "90GB");
    api.getArchiveStatistics("m");

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "exchange_list_mailboxes",
      "exchange_get_mailbox",
      "exchange_create_mailbox",
      "exchange_remove_mailbox",
      "exchange_enable_mailbox",
      "exchange_disable_mailbox",
      "exchange_update_mailbox",
      "exchange_get_mailbox_statistics",
      "exchange_get_mailbox_permissions",
      "exchange_add_mailbox_permission",
      "exchange_remove_mailbox_permission",
      "exchange_get_forwarding",
      "exchange_get_ooo",
      "exchange_set_ooo",
      "exchange_list_groups",
      "exchange_get_group",
      "exchange_create_group",
      "exchange_update_group",
      "exchange_remove_group",
      "exchange_list_group_members",
      "exchange_add_group_member",
      "exchange_remove_group_member",
      "exchange_list_dynamic_groups",
      "exchange_list_mail_contacts",
      "exchange_get_mail_contact",
      "exchange_create_mail_contact",
      "exchange_update_mail_contact",
      "exchange_remove_mail_contact",
      "exchange_list_mail_users",
      "exchange_get_mail_user",
      "exchange_create_mail_user",
      "exchange_remove_mail_user",
      "exchange_convert_mailbox",
      "exchange_list_shared_mailboxes",
      "exchange_list_room_mailboxes",
      "exchange_list_equipment_mailboxes",
      "exchange_add_automapping",
      "exchange_remove_automapping",
      "exchange_add_send_as",
      "exchange_remove_send_as",
      "exchange_add_send_on_behalf",
      "exchange_remove_send_on_behalf",
      "exchange_list_room_lists",
      "exchange_get_archive_info",
      "exchange_enable_archive",
      "exchange_disable_archive",
      "exchange_enable_auto_expanding_archive",
      "exchange_set_archive_quota",
      "exchange_get_archive_statistics",
    ]);
    expect(cmds).toHaveLength(49);

    // camelCase arg conversion + singleton contract (no connection id).
    expect(invokeMock).toHaveBeenCalledWith("exchange_list_mailboxes", {
      resultSize: 100,
      filter: "a",
    });
    expect(invokeMock).toHaveBeenCalledWith("exchange_add_mailbox_permission", {
      identity: "m",
      user: "u",
      accessRights: "FullAccess",
    });
    // convert uses the `req` arg key (not `request`), matching commands.rs.
    expect(invokeMock).toHaveBeenCalledWith("exchange_convert_mailbox", {
      req: { identity: "m", targetType: "sharedMailbox" },
    });
    expect(invokeMock).toHaveBeenCalledWith("exchange_set_archive_quota", {
      identity: "m",
      quota: "100GB",
      warningQuota: "90GB",
    });
  });
});

describe("ExchangeRecipientsTab", () => {
  it("mounts and loads the default (Mailboxes) section against the live connection", async () => {
    render(<ExchangeRecipientsTab summary={null} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("exchange_list_mailboxes", {
        resultSize: 100,
        filter: undefined,
      }),
    );
    // Section pills render from the inline English defaults.
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });
});
