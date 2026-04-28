import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionEditor } from "../../src/hooks/connection/useConnectionEditor";
import type { Connection } from "../../src/types/connection/connection";

const mockDispatch = vi.fn();
const mockToastInfo = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [] },
    dispatch: mockDispatch,
  }),
}));

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { autoSaveEnabled: false },
  }),
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: mockToastSuccess,
      error: vi.fn(),
      warning: vi.fn(),
      info: mockToastInfo,
    },
  }),
}));

vi.mock("../../src/utils/discovery/defaultPorts", () => ({
  getDefaultPort: vi.fn((protocol: string) => {
    if (protocol === "ssh") return 22;
    return 3389;
  }),
}));

vi.mock("../../src/utils/core/id", () => ({
  generateId: vi.fn(() => "generated-connection-id"),
}));

describe("useConnectionEditor SSH secret handling", () => {
  const baseConnection: Connection = {
    id: "ssh-connection-1",
    name: "SSH Connection",
    protocol: "ssh",
    hostname: "server.example.com",
    port: 22,
    username: "root",
    password: "stored-password",
    privateKey: "-----BEGIN PRIVATE KEY-----\noriginal\n-----END PRIVATE KEY-----",
    passphrase: "stored-passphrase",
    totpSecret: "stored-totp-secret",
    sshConnectionConfigOverride: {
      proxyCommandHost: "proxy.example.com",
      proxyCommandPassword: "stored-proxy-password",
    },
    authType: "key",
    isGroup: false,
    tags: [],
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z",
  };

  beforeEach(() => {
    mockDispatch.mockClear();
    mockToastInfo.mockClear();
    mockToastSuccess.mockClear();
  });

  it("keeps SSH secrets out of formData but still persists them on save", async () => {
    const { result } = renderHook(() =>
      useConnectionEditor(baseConnection, true, vi.fn()),
    );

    await waitFor(() => {
      expect(result.current.formData.hostname).toBe("server.example.com");
    });

    expect(result.current.formData.password).toBe("");
    expect(result.current.formData.passphrase).toBe("");
    expect(result.current.formData.privateKey).toBe("");
    expect(result.current.formData.totpSecret).toBe("");
    expect(
      result.current.formData.sshConnectionConfigOverride?.proxyCommandPassword,
    ).toBeUndefined();
    expect(
      result.current.formData.sshConnectionConfigOverride?.proxyCommandHost,
    ).toBe("proxy.example.com");
    expect(result.current.sshSecrets.getPassword()).toBe("stored-password");
    expect(result.current.sshSecrets.getPassphrase()).toBe("stored-passphrase");
    expect(result.current.sshSecrets.getPrivateKey()).toContain("original");

    act(() => {
      result.current.sshSecrets.handlePasswordChange("rotated-password");
      result.current.sshSecrets.handlePassphraseChange("rotated-passphrase");
      result.current.sshSecrets.handlePrivateKeyChange(
        "-----BEGIN PRIVATE KEY-----\nupdated\n-----END PRIVATE KEY-----",
      );
    });

    expect(result.current.formData.password).toBe("");
    expect(result.current.formData.passphrase).toBe("");
    expect(result.current.formData.privateKey).toBe("");

    act(() => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "UPDATE_CONNECTION",
      payload: expect.objectContaining({
        password: "rotated-password",
        passphrase: "rotated-passphrase",
        totpSecret: "stored-totp-secret",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nupdated\n-----END PRIVATE KEY-----",
        sshConnectionConfigOverride: expect.objectContaining({
          proxyCommandHost: "proxy.example.com",
          proxyCommandPassword: "stored-proxy-password",
        }),
      }),
    });
    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalled();
  });
});