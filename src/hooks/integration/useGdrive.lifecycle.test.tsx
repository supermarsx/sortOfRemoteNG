import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IntegrationSessionLifecycleProvider,
  disconnectIntegrationSession,
  reconnectIntegrationSession,
} from "../integrations/IntegrationSessionLifecycle";
import { gdriveApi, useGdrive } from "./useGdrive";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const wrapperFor =
  (sessionId: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <IntegrationSessionLifecycleProvider sessionId={sessionId}>
      {children}
    </IntegrationSessionLifecycleProvider>
  );

const wrapper = wrapperFor("gdrive-session");

describe("useGdrive lifecycle ownership", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "gdrive_is_authenticated") return Promise.resolve(true);
      if (command === "gdrive_connection_summary") {
        return Promise.resolve({ email: "owner@example.com" });
      }
      if (command === "gdrive_get_token") {
        return Promise.resolve({
          accessToken: "access-owner",
          refreshToken: "refresh-owner",
          tokenType: "Bearer",
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("disconnects session ownership without revoking OAuth and reconnects via refresh", async () => {
    const { result } = renderHook(() => useGdrive(), { wrapper });
    await act(async () => {
      await result.current.setCredentials({
        clientId: "client-owner",
        clientSecret: "secret-owner",
        redirectUri: "http://localhost",
        scopes: ["drive"],
      });
      await expect(result.current.exchangeCode("one-shot-code")).resolves.toBe(
        true,
      );
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await disconnectIntegrationSession("gdrive-session");
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith("gdrive_revoke");

    await act(async () => {
      await expect(reconnectIntegrationSession("gdrive-session")).resolves.toBe(
        true,
      );
    });
    expect(invokeMock).toHaveBeenCalledWith("gdrive_refresh_token");
    expect(result.current.isAuthenticated).toBe(true);
    await act(async () => {
      await disconnectIntegrationSession("gdrive-session");
    });
  });

  it("reserves native revocation for explicit Revoke and releases the retry plan", async () => {
    const { result } = renderHook(() => useGdrive(), { wrapper });
    await act(async () => {
      await result.current.setCredentials({
        clientId: "client-owner",
        clientSecret: "secret-owner",
        redirectUri: "http://localhost",
        scopes: ["drive"],
      });
      await result.current.exchangeCode("one-shot-code");
      await result.current.revoke();
    });

    expect(invokeMock).toHaveBeenCalledWith("gdrive_revoke");
    await expect(reconnectIntegrationSession("gdrive-session")).resolves.toBe(
      false,
    );
  });

  it("refreshes a persisted refresh token before validating authentication", async () => {
    let authenticated = false;
    invokeMock.mockImplementation((command: string) => {
      if (command === "gdrive_refresh_token") {
        authenticated = true;
        return Promise.resolve(undefined);
      }
      if (command === "gdrive_is_authenticated") {
        return Promise.resolve(authenticated);
      }
      if (command === "gdrive_connection_summary") {
        return Promise.resolve({ userEmail: "restored@example.com" });
      }
      if (command === "gdrive_get_token") {
        return Promise.resolve({
          accessToken: "renewed-access",
          refreshToken: "saved-refresh",
          tokenType: "Bearer",
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useGdrive(), { wrapper });
    await act(async () => {
      await expect(
        result.current.setCredentials({
          clientId: "client-restored",
          clientSecret: "secret-restored",
          redirectUri: "http://localhost",
          scopes: ["drive"],
        }),
      ).resolves.toBe(true);
      await expect(
        result.current.restoreToken({
          accessToken: "",
          refreshToken: "saved-refresh",
          tokenType: "Bearer",
        }),
      ).resolves.toBe(true);
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands.indexOf("gdrive_set_token")).toBeLessThan(
      commands.indexOf("gdrive_refresh_token"),
    );
    expect(commands.indexOf("gdrive_refresh_token")).toBeLessThan(
      commands.indexOf("gdrive_is_authenticated"),
    );
    await act(async () => {
      await disconnectIntegrationSession("gdrive-session");
    });
  });

  it("reconnects with the owning account instead of the current global token", async () => {
    let currentClientId = "";
    let currentToken = {
      accessToken: "",
      refreshToken: "",
      tokenType: "Bearer",
    };
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "gdrive_set_credentials") {
          currentClientId = String(args?.clientId ?? "");
          return Promise.resolve(undefined);
        }
        if (command === "gdrive_exchange_code") {
          currentToken = {
            accessToken: "access-a",
            refreshToken: "refresh-a",
            tokenType: "Bearer",
          };
          return Promise.resolve(undefined);
        }
        if (command === "gdrive_set_token") {
          currentToken = {
            ...(args?.token as typeof currentToken),
          };
          return Promise.resolve(undefined);
        }
        if (command === "gdrive_refresh_token") {
          currentToken = {
            ...currentToken,
            accessToken: `renewed-${currentToken.refreshToken}`,
          };
          return Promise.resolve(undefined);
        }
        if (command === "gdrive_get_token") {
          return Promise.resolve({ ...currentToken });
        }
        if (command === "gdrive_is_authenticated") {
          return Promise.resolve(Boolean(currentToken.accessToken));
        }
        if (command === "gdrive_connection_summary") {
          return Promise.resolve({
            userEmail:
              currentToken.refreshToken === "refresh-a"
                ? "a@example.com"
                : "b@example.com",
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const accountA = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-a"),
    });
    await act(async () => {
      await accountA.result.current.setCredentials({
        clientId: "client-a",
        clientSecret: "secret-a",
        redirectUri: "http://localhost/a",
        scopes: ["drive"],
      });
      await accountA.result.current.exchangeCode("code-a");
      await disconnectIntegrationSession("gdrive-a");
    });

    const accountB = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-b"),
    });
    await act(async () => {
      await accountB.result.current.setCredentials({
        clientId: "client-b",
        clientSecret: "secret-b",
        redirectUri: "http://localhost/b",
        scopes: ["drive"],
      });
      await accountB.result.current.restoreToken({
        accessToken: "",
        refreshToken: "refresh-b",
        tokenType: "Bearer",
      });
    });
    expect(currentClientId).toBe("client-b");
    expect(currentToken.refreshToken).toBe("refresh-b");

    invokeMock.mockClear();
    await act(async () => {
      await expect(reconnectIntegrationSession("gdrive-a")).rejects.toThrow(
        /already owned by another active integration session/i,
      );
    });
    expect(currentClientId).toBe("client-b");
    expect(currentToken.refreshToken).toBe("refresh-b");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "gdrive_set_credentials",
      expect.objectContaining({ clientId: "client-a" }),
    );

    await act(async () => {
      await disconnectIntegrationSession("gdrive-b");
    });

    invokeMock.mockClear();
    await act(async () => {
      await expect(reconnectIntegrationSession("gdrive-a")).resolves.toBe(true);
    });
    expect(invokeMock.mock.calls.slice(0, 3)).toEqual([
      [
        "gdrive_set_credentials",
        expect.objectContaining({ clientId: "client-a" }),
      ],
      [
        "gdrive_set_token",
        expect.objectContaining({
          token: expect.objectContaining({ refreshToken: "refresh-a" }),
        }),
      ],
      ["gdrive_refresh_token"],
    ]);
    expect(currentClientId).toBe("client-a");
    expect(currentToken.refreshToken).toBe("refresh-a");
    await act(async () => {
      await disconnectIntegrationSession("gdrive-a");
    });
  });

  it("claims the global slot before staging credentials from a second panel", async () => {
    let currentClientId = "";
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "gdrive_set_credentials") {
          currentClientId = String(args?.clientId ?? "");
        }
        return Promise.resolve(undefined);
      },
    );
    const accountA = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-staging-a"),
    });
    const accountB = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-staging-b"),
    });

    await act(async () => {
      await expect(
        accountA.result.current.setCredentials({
          clientId: "client-a",
          clientSecret: "secret-a",
          redirectUri: "http://localhost/a",
          scopes: ["drive"],
        }),
      ).resolves.toBe(true);
    });
    expect(currentClientId).toBe("client-a");

    invokeMock.mockClear();
    await act(async () => {
      await expect(
        accountB.result.current.setCredentials({
          clientId: "client-b",
          clientSecret: "secret-b",
          redirectUri: "http://localhost/b",
          scopes: ["drive"],
        }),
      ).resolves.toBe(false);
    });
    expect(accountB.result.current.error).toMatch(
      /already owned by another active integration session/i,
    );
    expect(currentClientId).toBe("client-a");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "gdrive_set_credentials",
      expect.objectContaining({ clientId: "client-b" }),
    );

    await act(async () => {
      await disconnectIntegrationSession("gdrive-staging-a");
      await expect(
        accountB.result.current.setCredentials({
          clientId: "client-b",
          clientSecret: "secret-b",
          redirectUri: "http://localhost/b",
          scopes: ["drive"],
        }),
      ).resolves.toBe(true);
      await disconnectIntegrationSession("gdrive-staging-b");
    });
    expect(currentClientId).toBe("client-b");
  });

  it("blocks cold panels from foreign token, revoke, status, and resource access", async () => {
    const owner = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-resource-owner"),
    });
    const foreign = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-resource-foreign"),
    });
    await act(async () => {
      await owner.result.current.setCredentials({
        clientId: "client-owner",
        clientSecret: "secret-owner",
        redirectUri: "http://localhost/owner",
        scopes: ["drive"],
      });
    });

    invokeMock.mockClear();
    await act(async () => {
      await expect(foreign.result.current.refreshAuthState()).resolves.toBe(
        false,
      );
      await expect(foreign.result.current.getToken()).resolves.toBeNull();
      await expect(foreign.result.current.refreshToken()).resolves.toBe(false);
      await expect(foreign.result.current.getAuthUrl()).resolves.toBeNull();
      await foreign.result.current.revoke();
      await expect(
        foreign.result.current.run(() => gdriveApi.listFiles()),
      ).rejects.toThrow(/does not own the process-global account session/i);
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(foreign.result.current.isAuthenticated).toBe(false);
    expect(foreign.result.current.error).toMatch(
      /does not own the process-global account session/i,
    );
    await act(async () => {
      await disconnectIntegrationSession("gdrive-resource-owner");
    });
  });

  it("does not expose an old account token while a new owner is only reserved", async () => {
    const previousAccount = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-stale-token-a"),
    });
    await act(async () => {
      await previousAccount.result.current.setCredentials({
        clientId: "client-a",
        clientSecret: "secret-a",
        redirectUri: "http://localhost/a",
        scopes: ["drive"],
      });
      await previousAccount.result.current.exchangeCode("code-a");
      await disconnectIntegrationSession("gdrive-stale-token-a");
    });

    const reservedAccount = renderHook(() => useGdrive(), {
      wrapper: wrapperFor("gdrive-stale-token-b"),
    });
    await act(async () => {
      await expect(
        reservedAccount.result.current.setCredentials({
          clientId: "client-b",
          clientSecret: "secret-b",
          redirectUri: "http://localhost/b",
          scopes: ["drive"],
        }),
      ).resolves.toBe(true);
    });

    invokeMock.mockClear();
    await act(async () => {
      await expect(
        reservedAccount.result.current.refreshAuthState(),
      ).resolves.toBe(false);
      await expect(
        reservedAccount.result.current.getToken(),
      ).resolves.toBeNull();
      await expect(reservedAccount.result.current.refreshToken()).resolves.toBe(
        false,
      );
      await reservedAccount.result.current.revoke();
      await expect(
        reservedAccount.result.current.run(() => gdriveApi.listFiles()),
      ).rejects.toThrow(/not authenticated yet/i);
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(reservedAccount.result.current.error).toMatch(
      /not authenticated yet/i,
    );
    await act(async () => {
      await disconnectIntegrationSession("gdrive-stale-token-b");
    });
  });
});
