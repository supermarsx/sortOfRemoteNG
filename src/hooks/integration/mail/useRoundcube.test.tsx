import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IntegrationSessionLifecycleProvider,
  reconnectIntegrationSession,
} from "../../integrations/IntegrationSessionLifecycle";
import {
  roundcubeApi,
  useRoundcube,
  type RoundcubeManager,
} from "./useRoundcube";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

function Probe({ report }: { report: (manager: RoundcubeManager) => void }) {
  const manager = useRoundcube();
  useEffect(() => report(manager), [manager, report]);
  return null;
}

describe("useRoundcube", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("binds all 63 registered commands with exact Tauri argument names", () => {
    expect(Object.keys(roundcubeApi)).toHaveLength(63);

    roundcubeApi.connect("rc-1", {
      base_url: "https://mail.example/api",
      username: "admin",
      password: "secret",
      timeout_secs: 45,
      tls_skip_verify: false,
    });
    roundcubeApi.updateIdentity("rc-1", "user-1", "identity-1", {
      reply_to: "reply@example.com",
      is_standard: true,
    });
    roundcubeApi.searchContacts("rc-1", "book-1", "Ada");
    roundcubeApi.getLogs("rc-1", 50, "error");
    roundcubeApi.testImap("rc-1", "imap.example.com", "ada", "imap-password");

    expect(invokeMock).toHaveBeenCalledWith("rc_connect", {
      id: "rc-1",
      config: {
        base_url: "https://mail.example/api",
        username: "admin",
        password: "secret",
        timeout_secs: 45,
        tls_skip_verify: false,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("rc_update_identity", {
      id: "rc-1",
      userId: "user-1",
      identityId: "identity-1",
      req: {
        reply_to: "reply@example.com",
        is_standard: true,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("rc_search_contacts", {
      id: "rc-1",
      bookId: "book-1",
      query: "Ada",
    });
    expect(invokeMock).toHaveBeenCalledWith("rc_get_logs", {
      id: "rc-1",
      limit: 50,
      level: "error",
    });
    expect(invokeMock).toHaveBeenCalledWith("rc_test_imap", {
      id: "rc-1",
      host: "imap.example.com",
      user: "ada",
      pass: "imap-password",
    });
  });

  it("surfaces a failed connect without claiming a live handle", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("HTTP 401: administrator credentials rejected"),
    );
    let latest: RoundcubeManager | undefined;
    render(
      <Probe
        report={(manager) => {
          latest = manager;
        }}
      />,
    );
    await waitFor(() => expect(latest).toBeDefined());

    await act(async () => {
      await expect(
        latest!.connect("rc-1", {
          base_url: "https://mail.example/api",
          username: "admin",
          password: "wrong",
        }),
      ).resolves.toBe(false);
    });

    expect(latest!.connectionId).toBeNull();
    expect(latest!.isConnected).toBe(false);
    expect(latest!.error).toContain("credentials rejected");
  });

  it("registers reconnect and unmount cleanup with the shared session lifecycle", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "rc_connect") {
        return Promise.resolve({
          host: "https://mail.example/api",
          version: "1.6.11",
        });
      }
      return Promise.resolve(undefined);
    });
    let latest: RoundcubeManager | undefined;
    const view = render(
      <IntegrationSessionLifecycleProvider sessionId="roundcube-session">
        <Probe
          report={(manager) => {
            latest = manager;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(latest).toBeDefined());

    await act(async () => {
      await latest!.connect("rc-1", {
        base_url: "https://mail.example/api",
        username: "admin",
        password: "secret",
      });
    });
    expect(latest!.isConnected).toBe(true);

    await act(async () => {
      await expect(
        reconnectIntegrationSession("roundcube-session"),
      ).resolves.toBe(true);
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rc_connect"),
    ).toHaveLength(2);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rc_disconnect"),
    ).toHaveLength(1);

    view.unmount();
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(
          ([command]) => command === "rc_disconnect",
        ),
      ).toHaveLength(2),
    );
  });
});
