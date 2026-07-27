import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import PostfixSubTab from "./PostfixSubTab";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";

describe("PostfixSubTab selected instance", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetIntegrationConfigStoreForTests();
    (
      globalThis as unknown as {
        __TAURI__?: { core: { invoke: typeof invokeMock } };
      }
    ).__TAURI__ = { core: { invoke: invokeMock } };
  });

  it("hydrates and connects only the exact selected Postfix config and vault reference", async () => {
    const persisted = JSON.stringify([
      {
        id: "postfix-first",
        integrationKey: "mail.postfix",
        name: "First Postfix",
        host: "first.example.test",
        credentialRefId: "first-ref",
        fields: {
          port: "22",
          sshUser: "first-user",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      {
        id: "postfix-selected",
        integrationKey: "mail.postfix",
        name: "Selected Postfix",
        host: "selected.example.test",
        credentialRefId: "selected-ref",
        fields: {
          port: "2222",
          sshUser: "selected-user",
          sshKey: "~/.ssh/postfix_ed25519",
          postfixBin: "/opt/postfix/sbin/postfix",
          configDir: "/opt/postfix/etc",
          queueDir: "/opt/postfix/queue",
          timeoutSecs: "45",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "read_app_data") return Promise.resolve(persisted);
        if (command === "vault_read_secret") {
          return Promise.resolve(
            args?.account === "selected-ref"
              ? "selected-password"
              : "first-password",
          );
        }
        if (command === "postfix_connect") {
          return Promise.resolve({
            host: "selected.example.test",
            version: "3.9",
            running: true,
          });
        }
        return Promise.resolve(undefined);
      },
    );

    render(<PostfixSubTab active instanceId="postfix-selected" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("selected.example.test")).toBeVisible();
      expect(screen.getByDisplayValue("selected-user")).toBeVisible();
      expect(screen.getByDisplayValue("selected-password")).toBeVisible();
      expect(screen.getByDisplayValue("~/.ssh/postfix_ed25519")).toBeVisible();
      expect(screen.getByText("SSH private key path")).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("postfix_connect", {
        id: "postfix-selected",
        config: expect.objectContaining({
          host: "selected.example.test",
          port: 2222,
          ssh_user: "selected-user",
          ssh_password: "selected-password",
          ssh_key: "~/.ssh/postfix_ed25519",
          postfix_bin: "/opt/postfix/sbin/postfix",
          config_dir: "/opt/postfix/etc",
          queue_dir: "/opt/postfix/queue",
          timeout_secs: 45,
        }),
      }),
    );
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "vault_read_secret",
      ),
    ).toEqual([
      [
        "vault_read_secret",
        expect.objectContaining({ account: "selected-ref" }),
      ],
    ]);
  });
});
