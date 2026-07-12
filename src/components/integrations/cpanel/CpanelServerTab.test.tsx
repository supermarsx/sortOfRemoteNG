import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors the sibling tabs).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import CpanelServerTab from "./CpanelServerTab";
import { cpanelServerApi } from "../../../hooks/integration/cpanel/useCpanelServer";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("cpanelServerApi bindings", () => {
  it("binds all 39 server-category commands", () => {
    // 12 accounts + 5 DNS + 5 backups + 8 security + 4 monitoring + 5 PHP.
    expect(Object.keys(cpanelServerApi)).toHaveLength(39);
  });

  it("passes the connection id + account user as invoke args", () => {
    cpanelServerApi.getAccountSummary("conn-1", "bob");
    expect(invokeMock).toHaveBeenCalledWith("cpanel_get_account_summary", {
      id: "conn-1",
      user: "bob",
    });
  });

  it("camelCases two-word Rust params (keep_dns, key_type)", () => {
    cpanelServerApi.terminateAccount("conn-1", "bob", true);
    expect(invokeMock).toHaveBeenCalledWith("cpanel_terminate_account", {
      id: "conn-1",
      user: "bob",
      keepDns: true,
    });

    cpanelServerApi.importSshKey("conn-1", "bob", "k1", "ssh-rsa AAAA", "rsa");
    expect(invokeMock).toHaveBeenCalledWith("cpanel_import_ssh_key", {
      id: "conn-1",
      user: "bob",
      name: "k1",
      key: "ssh-rsa AAAA",
      keyType: "rsa",
    });
  });

  it("passes request-bearing commands through as `req`", () => {
    cpanelServerApi.createAccount("conn-1", {
      username: "u",
      domain: "d.tld",
      password: "p",
    });
    expect(invokeMock).toHaveBeenCalledWith("cpanel_create_account", {
      id: "conn-1",
      req: { username: "u", domain: "d.tld", password: "p" },
    });
  });
});

describe("CpanelServerTab", () => {
  it("fetches the account list on mount for its selector", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "cpanel_list_accounts")
        return Promise.resolve([{ user: "bob", domain: "bob.tld" }]);
      return Promise.resolve([]);
    });

    render(<CpanelServerTab connectionId="conn-1" />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("cpanel_list_accounts", {
        id: "conn-1",
      }),
    );
    expect(await screen.findByText("Accounts")).toBeInTheDocument();
  });
});
