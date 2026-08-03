import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionEditor } from "../../src/hooks/connection/useConnectionEditor";
import type { Connection } from "../../src/types/connection/connection";

const mockDispatch = vi.fn();
const mockDispatchAndFlush = vi.fn();
const mockToastInfo = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [] },
    dispatch: mockDispatch,
    dispatchAndFlush: mockDispatchAndFlush,
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
    privateKey:
      "-----BEGIN PRIVATE KEY-----\noriginal\n-----END PRIVATE KEY-----",
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
    mockDispatchAndFlush.mockReset();
    mockDispatchAndFlush.mockResolvedValue(undefined);
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

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockDispatchAndFlush).toHaveBeenCalledWith({
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

  it("coalesces queued revisions and leaves the newest durable save last", async () => {
    const firstFlush = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = () => done();
      });
      return { promise, resolve };
    })();
    const latestFlush = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = () => done();
      });
      return { promise, resolve };
    })();
    mockDispatchAndFlush
      .mockImplementationOnce(() => firstFlush.promise)
      .mockImplementationOnce(() => latestFlush.promise);

    const { result } = renderHook(() =>
      useConnectionEditor(baseConnection, true, vi.fn()),
    );
    await waitFor(() => {
      expect(result.current.formData.hostname).toBe("server.example.com");
    });

    act(() => {
      result.current.setFormData((current) => ({
        ...current,
        hostname: "first.example.com",
      }));
    });
    let firstSave!: Promise<Connection | null>;
    act(() => {
      firstSave = result.current.saveNow();
    });
    await waitFor(() => expect(mockDispatchAndFlush).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setFormData((current) => ({
        ...current,
        hostname: "middle.example.com",
      }));
    });
    let middleSave!: Promise<Connection | null>;
    act(() => {
      middleSave = result.current.saveNow();
    });

    act(() => {
      result.current.setFormData((current) => ({
        ...current,
        hostname: "latest.example.com",
      }));
    });
    let latestSave!: Promise<Connection | null>;
    act(() => {
      latestSave = result.current.saveNow();
    });

    await act(async () => {
      firstFlush.resolve();
      await firstSave;
    });
    await waitFor(() => expect(mockDispatchAndFlush).toHaveBeenCalledTimes(2));

    expect(
      mockDispatchAndFlush.mock.calls.map(
        ([action]) => action.payload.hostname,
      ),
    ).toEqual(["first.example.com", "latest.example.com"]);

    let results!: Array<Connection | null>;
    await act(async () => {
      latestFlush.resolve();
      results = await Promise.all([firstSave, middleSave, latestSave]);
    });
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]?.hostname).toBe("latest.example.com");
  });

  it("does not report submit success before the durable flush resolves", async () => {
    let resolveFlush!: () => void;
    const flush = new Promise<void>((done) => {
      resolveFlush = () => done();
    });
    mockDispatchAndFlush.mockImplementationOnce(() => flush);

    const { result } = renderHook(() =>
      useConnectionEditor(baseConnection, true, vi.fn()),
    );
    await waitFor(() => {
      expect(result.current.formData.hostname).toBe("server.example.com");
    });
    act(() => {
      result.current.setFormData((current) => ({
        ...current,
        hostname: "durable.example.com",
      }));
    });

    let submit!: Promise<void>;
    act(() => {
      submit = result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });
    await waitFor(() => expect(mockDispatchAndFlush).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).not.toHaveBeenCalled();

    await act(async () => {
      resolveFlush();
      await submit;
    });
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
  });
});
