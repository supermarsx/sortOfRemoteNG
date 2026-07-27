import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import AmavisSubTab from "./AmavisSubTab";
import { amavisApi } from "../../../hooks/integration/mail/useAmavis";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";

beforeEach(() => {
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = { core: { invoke: invokeMock } };
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "amavis_connect":
      case "amavis_ping":
        return Promise.resolve({
          host: "mail.lab.local",
          version: "2.13.0",
          running: true,
          uptime_secs: 42,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("AmavisSubTab", () => {
  it("renders its own connect form when disconnected", async () => {
    render(<AmavisSubTab active />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("mail.lab.local")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to amavis_connect with a snake_case wire-shape config", async () => {
    render(<AmavisSubTab active />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("mail.lab.local")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("mail.lab.local"), {
      target: { value: "amavis.lab.local" },
    });
    // username is required to enable Connect — it's the second SSH text input.
    fireEvent.change(
      screen.getByText("SSH username").parentElement!.querySelector("input")!,
      { target: { value: "root" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "amavis_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "amavis.lab.local",
            username: "root",
          }),
        }),
      ),
    );
  });

  it("hydrates and connects the exact selected Amavis instance, including its vault secret", async () => {
    const persisted = JSON.stringify([
      {
        id: "amavis-wrong",
        integrationKey: "mail.amavis",
        name: "Wrong Amavis",
        host: "wrong.example.test",
        credentialRefId: "wrong-ref",
        fields: { username: "wrong-user" },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      {
        id: "amavis-selected",
        integrationKey: "mail.amavis",
        name: "Selected Amavis",
        host: "selected.example.test",
        credentialRefId: "selected-ref",
        fields: {
          port: "2222",
          username: "selected-user",
          privateKeyPath: "~/.ssh/amavis_ed25519",
          timeoutSecs: "45",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(persisted);
        if (cmd === "vault_read_secret") {
          return Promise.resolve(
            args?.account === "selected-ref"
              ? JSON.stringify({
                  password: "selected-password",
                  privateKey: "~/.ssh/amavis_ed25519",
                })
              : JSON.stringify({
                  password: "wrong-password",
                  privateKey: "~/.ssh/wrong_ed25519",
                }),
          );
        }
        if (cmd === "amavis_connect") {
          return Promise.resolve({
            host: "selected.example.test",
            version: "2.13.0",
            running: true,
            uptime_secs: 42,
          });
        }
        return Promise.resolve(null);
      },
    );

    render(<AmavisSubTab active instanceId="amavis-selected" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("selected.example.test")).toBeVisible();
      expect(screen.getByDisplayValue("selected-user")).toBeVisible();
      expect(screen.getByDisplayValue("selected-password")).toBeVisible();
      expect(screen.getByDisplayValue("~/.ssh/amavis_ed25519")).toBeVisible();
      expect(screen.getByText("SSH private key path")).toBeVisible();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("amavis_connect", {
        id: "amavis-selected",
        config: expect.objectContaining({
          host: "selected.example.test",
          port: 2222,
          username: "selected-user",
          password: "selected-password",
          private_key: "~/.ssh/amavis_ed25519",
          timeout_secs: 45,
        }),
      }),
    );
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain(
      "wrong-password",
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_read_secret",
      expect.objectContaining({ account: "selected-ref" }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "vault_read_secret",
      expect.objectContaining({ account: "wrong-ref" }),
    );
  });

  it("hydrates a legacy vault-only private-key path and passes it to connect", async () => {
    const persisted = JSON.stringify([
      {
        id: "amavis-legacy",
        integrationKey: "mail.amavis",
        name: "Legacy Amavis",
        host: "legacy.example.test",
        credentialRefId: "legacy-ref",
        fields: {
          port: "22",
          username: "legacy-user",
          timeoutSecs: "30",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(persisted);
        if (cmd === "vault_read_secret") {
          expect(args).toEqual(
            expect.objectContaining({ account: "legacy-ref" }),
          );
          return Promise.resolve(
            JSON.stringify({
              password: "legacy-password",
              privateKey: "~/.ssh/legacy_amavis",
            }),
          );
        }
        if (cmd === "amavis_connect") {
          return Promise.resolve({
            host: "legacy.example.test",
            version: "2.13.0",
            running: true,
            uptime_secs: 42,
          });
        }
        return Promise.resolve(null);
      },
    );

    render(<AmavisSubTab active instanceId="amavis-legacy" />);

    await waitFor(() =>
      expect(screen.getByDisplayValue("~/.ssh/legacy_amavis")).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("amavis_connect", {
        id: "amavis-legacy",
        config: expect.objectContaining({
          host: "legacy.example.test",
          username: "legacy-user",
          password: "legacy-password",
          private_key: "~/.ssh/legacy_amavis",
        }),
      }),
    );
  });

  it("api wrappers map to the correct command names + camelCase args", () => {
    amavisApi.getBannedRule("c1", "b1");
    amavisApi.listEntries("c1", "sender_whitelist");
    amavisApi.releaseAllQuarantine("c1", "spam");
    amavisApi.updatePolicyBank("c1", "pb1", { description: "x" });
    expect(invokeMock).toHaveBeenCalledWith("amavis_get_banned_rule", {
      id: "c1",
      banId: "b1",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_list_entries", {
      id: "c1",
      listType: "sender_whitelist",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_release_all_quarantine", {
      id: "c1",
      quarantineType: "spam",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_update_policy_bank", {
      id: "c1",
      name: "pb1",
      req: { description: "x" },
    });
  });

  it("persists the private-key path as non-secret metadata", async () => {
    let stored: string | null = null;
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          if (args?.expected !== stored) return Promise.resolve(false);
          stored = String(args?.replacement ?? "");
          return Promise.resolve(true);
        }
        return Promise.resolve(null);
      },
    );

    render(<AmavisSubTab active />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("mail.lab.local")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("mail.lab.local"), {
      target: { value: "amavis.lab.local" },
    });
    fireEvent.change(
      screen.getByText("SSH username").parentElement!.querySelector("input")!,
      { target: { value: "root" } },
    );
    fireEvent.change(screen.getByPlaceholderText("~/.ssh/id_ed25519"), {
      target: { value: "~/.ssh/amavis_ed25519" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save instance/i }));

    await waitFor(() => expect(stored).not.toBeNull());
    const [saved] = JSON.parse(stored!) as Array<{
      fields?: Record<string, string>;
    }>;
    expect(saved.fields).toMatchObject({
      privateKeyPath: "~/.ssh/amavis_ed25519",
    });
    expect(saved.fields).not.toHaveProperty("privateKey");
  });

  it("binds the full 52-command amavis surface", () => {
    // 4 connection + 48 management = 52 distinct wrappers.
    expect(Object.keys(amavisApi)).toHaveLength(52);
  });
});
