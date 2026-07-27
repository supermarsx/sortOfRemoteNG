import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import RoundcubeSubTab from "./RoundcubeSubTab";
import {
  INTEGRATION_CONFIG_KEY,
  INTEGRATION_VAULT_SERVICE,
  resetIntegrationConfigStoreForTests,
} from "../../../hooks/integrations/useIntegrationConfigStore";
import { _resetInvokeCache } from "../../../utils/tauri/invoke";

let persisted: string | null;

function installDefaultBackend() {
  invokeMock.mockImplementation(
    (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "read_app_data":
          return Promise.resolve(persisted);
        case "compare_and_swap_app_data": {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== persisted) return Promise.resolve(false);
          persisted = request.replacement;
          return Promise.resolve(true);
        }
        case "vault_store_secret":
        case "vault_delete_secret":
        case "rc_disconnect":
          return Promise.resolve(undefined);
        case "vault_read_secret":
          return Promise.resolve("vault-password");
        case "rc_connect":
        case "rc_ping":
          return Promise.resolve({
            host: "https://roundcube.example.com/api",
            version: "1.6.11",
            skin: "elastic",
            product_name: "Roundcube",
            plugins_count: 4,
          });
        case "rc_get_system_config":
          return Promise.resolve({
            product_name: "Roundcube",
            skin: "elastic",
            plugins_enabled: [],
          });
        case "rc_get_quota":
        case "rc_get_cache_stats":
        case "rc_get_db_stats":
          return Promise.resolve({});
        case "rc_list_users":
        case "rc_list_identities":
        case "rc_list_folders":
        case "rc_list_filters":
        case "rc_list_plugins":
        case "rc_get_logs":
          return Promise.resolve([]);
        case "rc_create_user":
          return Promise.resolve({
            id: "user-1",
            username: (args as { req: { username: string } }).req.username,
          });
        case "rc_create_folder":
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(undefined);
      }
    },
  );
}

beforeEach(() => {
  persisted = null;
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  _resetInvokeCache();
  (
    globalThis as unknown as {
      __TAURI__?: {
        core: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
    }
  ).__TAURI__ = {
    core: {
      invoke: (command, args) => invokeMock(command, args),
    },
  };
  installDefaultBackend();
});

afterEach(() => {
  delete (
    globalThis as unknown as {
      __TAURI__?: unknown;
    }
  ).__TAURI__;
  _resetInvokeCache();
});

async function fillCredentials() {
  await waitFor(() =>
    expect(screen.getByTestId("roundcube-base-url")).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByTestId("roundcube-base-url"), {
    target: { value: "https://mail.example.test/api/" },
  });
  fireEvent.change(screen.getByTestId("roundcube-username"), {
    target: { value: "administrator" },
  });
  fireEvent.change(screen.getByTestId("roundcube-password"), {
    target: { value: "top-secret-password" },
  });
}

async function connect() {
  await fillCredentials();
  fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
  await screen.findByRole("button", { name: "Users & identities" });
}

describe("RoundcubeSubTab", () => {
  it("persists non-secrets separately and sends the exact snake_case connect config", async () => {
    render(<RoundcubeSubTab active />);
    await fillCredentials();

    fireEvent.click(screen.getByRole("button", { name: "Save instance" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vault_store_secret",
        expect.objectContaining({
          service: INTEGRATION_VAULT_SERVICE,
          secret: "top-secret-password",
        }),
      ),
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain("top-secret-password");
    const record = JSON.parse(persisted!)[0];
    expect(record.integrationKey).toBe("mail.roundcube");
    expect(record.host).toBe("https://mail.example.test/api/");
    expect(record.credentialRefId).toBeTruthy();
    expect(record.secret).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith(
      "compare_and_swap_app_data",
      expect.objectContaining({ key: INTEGRATION_CONFIG_KEY }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rc_connect", {
        id: record.id,
        config: {
          base_url: "https://mail.example.test/api",
          username: "administrator",
          password: "top-secret-password",
          timeout_secs: 30,
          tls_skip_verify: false,
        },
      }),
    );
  });

  it("shows an actionable unsupported-route overview after a 404 connect failure", async () => {
    installDefaultBackend();
    invokeMock.mockImplementationOnce(() => Promise.resolve(null));
    // Keep storage loading deterministic, then fail only the connect call.
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "read_app_data") return Promise.resolve(null);
        if (command === "rc_connect") {
          return Promise.reject(
            new Error("HTTP 404: /api/system/info not found"),
          );
        }
        return Promise.resolve(undefined);
      },
    );

    render(<RoundcubeSubTab active />);
    await fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));

    expect(
      await screen.findByText("Administrative API route unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Verify that \/login and \/system\/info/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("roundcube-status")).toHaveTextContent(
      "Disconnected",
    );
  });

  it("executes representative user and folder mutations through real commands", async () => {
    render(<RoundcubeSubTab active />);
    await connect();

    fireEvent.click(screen.getByRole("button", { name: "Users & identities" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rc_list_users", {
        id: expect.any(String),
      }),
    );
    fireEvent.change(screen.getByTestId("roundcube-new-user"), {
      target: { value: "ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rc_create_user", {
        id: expect.any(String),
        req: {
          username: "ada",
          mail_host: null,
          language: null,
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Folders" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rc_list_folders", {
        id: expect.any(String),
      }),
    );
    fireEvent.change(screen.getByTestId("roundcube-folder-name"), {
      target: { value: "Projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rc_create_folder", {
        id: expect.any(String),
        req: { name: "Projects", parent: null },
      }),
    );
  });

  it("hydrates the session-selected instance and its vaulted password", async () => {
    persisted = JSON.stringify([
      {
        id: "saved-roundcube",
        integrationKey: "mail.roundcube",
        name: "Saved Roundcube",
        host: "https://saved.example/api",
        credentialRefId: "credential-1",
        fields: {
          username: "saved-admin",
          timeoutSecs: "55",
          tlsSkipVerify: "false",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);

    render(<RoundcubeSubTab active instanceId="saved-roundcube" />);
    await waitFor(() =>
      expect(screen.getByTestId("roundcube-username")).toHaveValue(
        "saved-admin",
      ),
    );
    expect(screen.getByTestId("roundcube-password")).toHaveValue(
      "vault-password",
    );

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "rc_connect",
        expect.objectContaining({ id: "saved-roundcube" }),
      ),
    );
  });

  it("treats a foreign Mail parent instance id as context, never as a Roundcube id", async () => {
    persisted = JSON.stringify([
      {
        id: "mail-parent",
        integrationKey: "mail.postfix",
        name: "Parent mail server",
        host: "smtp.example.test",
        fields: { username: "postfix-admin" },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);

    render(<RoundcubeSubTab active instanceId="mail-parent" />);
    await fillCredentials();

    fireEvent.click(screen.getByRole("button", { name: "Save instance" }));
    await waitFor(() => {
      const records = JSON.parse(persisted!);
      expect(records).toHaveLength(2);
    });

    const records = JSON.parse(persisted!);
    expect(
      records.find((record: { id: string }) => record.id === "mail-parent"),
    ).toMatchObject({
      integrationKey: "mail.postfix",
      host: "smtp.example.test",
      fields: { username: "postfix-admin" },
    });
    const roundcube = records.find(
      (record: { integrationKey: string }) =>
        record.integrationKey === "mail.roundcube",
    );
    expect(roundcube.id).not.toBe("mail-parent");

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "rc_connect",
        expect.objectContaining({ id: roundcube.id }),
      ),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "rc_connect",
      expect.objectContaining({ id: "mail-parent" }),
    );
  });
});
