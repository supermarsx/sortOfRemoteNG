import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { setInlineSsh } from "../../src/components/connection/editor/networkPathModel";
import {
  hostKeyPrompt,
  useOriginBrowserSshTrust,
  type NativeBrowserSshTrustOptions,
} from "../../src/hooks/protocol/useOriginBrowserSshTrust";
import {
  getOriginBrowserConfirmation,
  resetOriginBrowserConfirmationsForTests,
} from "../../src/hooks/protocol/originBrowserConfirmations";

const h = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  verify: vi.fn(),
  trust: vi.fn(),
  ensure: vi.fn(),
  prompt: vi.fn(),
  scope: { databaseId: "db" as string | null, resolved: true },
  callbacks: [] as Array<(event: { payload: unknown }) => Promise<void>>,
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("../../src/utils/prompts/promptQueue", () => ({
  requestPrompt: h.prompt,
}));
vi.mock("../../src/utils/auth/trustStore", async (original) => {
  const actual =
    await original<typeof import("../../src/utils/auth/trustStore")>();
  return {
    ...actual,
    getTrustStoreScope: () => h.scope,
    ensureTrustStoreReady: h.ensure,
    verifyIdentity: h.verify,
    trustIdentity: h.trust,
  };
});
const ssh = {
  id: "ssh",
  protocol: "ssh",
  hostname: "ssh.test",
  port: 22,
  username: "saved-user",
} as Connection;
const website = {
  id: "web",
  protocol: "https",
  security: {
    sshTunnel: {
      enabled: true,
      connectionId: "ssh",
      remoteHost: "localhost",
      remotePort: 10000,
      localPort: 0,
    },
  },
} as Connection;
function options(): NativeBrowserSshTrustOptions {
  return {
    sessionId: "browser",
    ownerDatabaseId: "db",
    proof: { assertCurrent: vi.fn() },
    connection: structuredClone(website),
    connections: [structuredClone(ssh)],
    settings: { trustPolicy: "always-ask", sshTrustPolicy: "inherit" },
    enabled: true,
  };
}
const prompt = (extra = {}) => ({
  session_id: "backend",
  host_key_prompt_id: "native-browser:browser",
  host: "ssh.test",
  port: 22,
  username: "vault-account",
  status: "first_use",
  fingerprint: "SHA256:fixture",
  key_type: "ssh-ed25519",
  key_bits: 256,
  public_key: "fixture-public-key",
  ...extra,
});
async function start(props = options()) {
  const view = renderHook((next) => useOriginBrowserSshTrust(next), {
    initialProps: props,
  });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}
async function emit(payload = prompt()) {
  await act(async () => {
    const listener = [...h.listen.mock.calls]
      .reverse()
      .find(([name]) => name === "ssh://host-key-prompt")?.[1];
    await listener({ payload });
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.callbacks = [];
  h.scope = { databaseId: "db", resolved: true };
  h.listen.mockImplementation(async (_name, callback) => {
    h.callbacks.push(callback);
    return h.off;
  });
  h.invoke.mockResolvedValue(undefined);
  h.ensure.mockResolvedValue(undefined);
  h.prompt.mockResolvedValue({ confirmed: false, remember: false });
  h.verify.mockResolvedValue({ status: "trusted" });
  h.trust.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOriginBrowserConfirmationsForTests();
});

describe("native browser SSH host-key trust", () => {
  it("binds a linked SSH source to its canonical hostname despite retained integration settings", async () => {
    const props = options();
    props.connections = [
      { ...ssh, integration: { host: "selected.test" } } as Connection,
    ];
    await start(props);
    await emit(prompt({ host: "ssh.test" }));
    expect(h.verify).toHaveBeenCalledWith(
      "ssh.test",
      22,
      "ssh",
      expect.anything(),
      "ssh",
    );
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "accept_and_save",
    });
    await emit(prompt({ session_id: "stale-host", host: "selected.test" }));
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenLastCalledWith(expect.anything(), {
      sessionId: "stale-host",
      decision: "reject",
    });
  });
  it.each([undefined, null, ""])(
    "falls back to the saved hostname for integration host %s",
    async (host) => {
      const props = options();
      props.connections = [
        { ...ssh, integration: { host } } as unknown as Connection,
      ];
      await start(props);
      await emit();
      expect(h.verify).toHaveBeenCalledWith(
        "ssh.test",
        22,
        "ssh",
        expect.anything(),
        "ssh",
      );
    },
  );
  it.each([
    false,
    23,
    {},
    "bad host",
    "https://ssh.test",
    "user@ssh.test",
    "[invalid]",
    "ssh.test:22",
  ])(
    "ignores unrelated integration host %s when verifying SSH",
    async (host) => {
      const props = options();
      props.connections = [
        { ...ssh, integration: { host } } as unknown as Connection,
      ];
      await start(props);
      await emit();
      expect(h.verify).toHaveBeenCalledWith(
        "ssh.test",
        22,
        "ssh",
        expect.anything(),
        "ssh",
      );
      expect(h.invoke).toHaveBeenLastCalledWith(expect.anything(), {
        sessionId: "backend",
        decision: "accept_and_save",
      });
    },
  );
  it("invalidates pending trust when the selected saved source changes", async () => {
    let finish!: (value: unknown) => void;
    h.verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = options();
    props.connections = [
      { ...ssh, integration: { host: "selected.test" } } as Connection,
    ];
    const view = await start(props);
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.callbacks[0]({ payload: prompt({ host: "ssh.test" }) });
      await Promise.resolve();
    });
    expect(h.verify).toHaveBeenCalledOnce();
    view.rerender({
      ...props,
      connections: [
        { ...ssh, integration: { host: "replacement.test" } } as Connection,
      ],
    });
    await act(async () => {
      finish({ status: "trusted" });
      await pending;
    });
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
    expect(h.invoke).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "accept_and_save" }),
    );
    expect(h.trust).not.toHaveBeenCalled();
  });
  it("validates the saved SSH IPv6 literal while retaining its saved port", async () => {
    const props = options();
    props.connections = [
      {
        ...ssh,
        hostname: "[::1]",
        port: 2222,
        integration: { host: "unrelated.test" },
      } as Connection,
    ];
    await start(props);
    await emit(prompt({ host: "::1", port: 2222 }));
    expect(h.verify).toHaveBeenCalledWith(
      "::1",
      2222,
      "ssh",
      expect.anything(),
      "ssh",
    );
    expect(h.invoke).toHaveBeenLastCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "accept_and_save",
    });
  });
  it.each([0, -1, 65536, "22"])(
    "rejects invalid linked endpoint port %s before trust lookup",
    async (port) => {
      const props = options();
      props.connections = [
        {
          ...ssh,
          port,
          integration: { host: "selected.test" },
        } as unknown as Connection,
      ];
      await start(props);
      await emit(prompt({ host: "selected.test" }));
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.invoke).toHaveBeenLastCalledWith(expect.anything(), {
        sessionId: "backend",
        decision: "reject",
      });
    },
  );
  it("verifies the saved SSH source selected through the connection editor", async () => {
    const props = options();
    props.connection = setInlineSsh(
      { ...website, security: undefined },
      { forwardType: "local", connectionId: "ssh", ownerDatabaseId: "db" },
    ) as Connection;
    expect(props.connection.security?.tunnelChain?.[0].type).toBe("ssh-jump");
    await start(props);
    expect(h.listen).toHaveBeenCalledTimes(2);
    await emit();
    expect(h.verify).toHaveBeenCalledWith(
      "ssh.test",
      22,
      "ssh",
      expect.any(Object),
      "ssh",
    );
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "accept_and_save",
    });
  });
  it("matches the native unbracketed IPv6 endpoint without changing its port", async () => {
    const props = options();
    props.connections = [{ ...ssh, hostname: "[::1]", port: 2222 }];
    await start(props);
    await emit(prompt({ host: "::1", port: 2222 }));
    expect(h.verify).toHaveBeenCalledWith(
      "::1",
      2222,
      "ssh",
      expect.any(Object),
      "ssh",
    );
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "accept_and_save",
    });
  });
  it("reports a fixed registration failure and retries without exposing the native error", async () => {
    h.listen.mockRejectedValueOnce(new Error("PRIVATE_NATIVE_ERROR"));
    const view = renderHook((next) => useOriginBrowserSshTrust(next), {
      initialProps: options(),
    });
    await waitFor(() => expect(view.result.current.failed).toBe(true));
    expect(view.result.current.ready).toBe(false);
    expect(view.result.current.error).not.toContain("PRIVATE");
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.failed).toBe(false);
    expect(h.listen).toHaveBeenCalledTimes(4);
  });
  it("gates a changed source until its replacement listener is actually registered", async () => {
    const props = options();
    const view = await start(props);
    let finish!: (value: () => void) => void;
    h.listen.mockImplementationOnce((_name, callback) => {
      h.callbacks.push(callback);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    view.rerender({ ...props, connections: [{ ...ssh, username: "changed" }] });
    expect(view.result.current.ready).toBe(false);
    await act(async () => {
      finish(h.off);
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
  });
  it("cleans a late registration after unmount without granting readiness", async () => {
    let finish!: (value: () => void) => void;
    h.listen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderHook(() => useOriginBrowserSshTrust(options()));
    expect(view.result.current.ready).toBe(false);
    view.unmount();
    await act(async () => {
      finish(h.off);
    });
    expect(h.off).toHaveBeenCalledTimes(2);
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("registers before readiness and accepts only the exact correlated native endpoint", async () => {
    await start();
    await emit(prompt({ host_key_prompt_id: "another-attempt" }));
    expect(h.verify).not.toHaveBeenCalled();
    await emit();
    expect(h.verify).toHaveBeenCalledWith(
      "ssh.test",
      22,
      "ssh",
      expect.objectContaining({ fingerprint: "SHA256:fixture" }),
      "ssh",
    );
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "accept_and_save",
    });
    expect(h.trust).not.toHaveBeenCalled();
  });
  it("never automatically accepts a new host, even with always-trust configured", async () => {
    const props = options();
    props.connections = [{ ...ssh, sshTrustPolicy: "always-trust" }];
    h.verify.mockResolvedValue({ status: "new" });
    await start(props);
    await emit();
    expect(h.prompt).toHaveBeenCalledOnce();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
  });
  it("persists explicit confirmation before accepting the native handshake", async () => {
    h.verify.mockResolvedValue({ status: "mismatch" });
    h.prompt.mockResolvedValue({ confirmed: true, remember: false });
    await start();
    await emit();
    expect(h.trust).toHaveBeenCalledWith(
      "ssh.test",
      22,
      "ssh",
      expect.anything(),
      true,
      "ssh",
    );
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "accept_and_save",
    });
    expect(h.trust.mock.invocationCallOrder[0]).toBeLessThan(
      h.invoke.mock.invocationCallOrder[0],
    );
  });
  it("rejects an unknown strict-policy host without showing a confirmation", async () => {
    const props = options();
    props.connections = [{ ...ssh, sshTrustPolicy: "strict" }];
    h.verify.mockResolvedValue({ status: "new" });
    await start(props);
    await emit();
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
  });
  it.each([
    "wrong-host",
    "wrong-port",
    "foreign-trust",
    "missing-source",
    "duplicate-source",
    "not-pending",
  ])("rejects %s without looking up trust", async (kind) => {
    const props = options();
    if (kind === "missing-source") props.connections = [];
    if (kind === "duplicate-source") props.connections = [ssh, ssh];
    if (kind === "not-pending") props.isPending = () => false;
    await start(props);
    if (kind === "foreign-trust") h.scope.databaseId = "foreign";
    await emit(
      prompt(
        kind === "wrong-host"
          ? { host: "foreign.test" }
          : kind === "wrong-port"
            ? { port: 2222 }
            : {},
      ),
    );
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
  });
  it("claims replayed prompts before an asynchronous verification and rejects on unmount", async () => {
    let finish!: (value: unknown) => void;
    h.verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await start();
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.callbacks[0]({ payload: prompt() });
      await Promise.resolve();
    });
    await emit();
    expect(h.verify).toHaveBeenCalledOnce();
    view.unmount();
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
    await act(async () => {
      finish({ status: "trusted" });
      await pending;
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects owner revocation after verification without saving trust", async () => {
    const props = options();
    const proof = vi.mocked(props.proof!.assertCurrent);
    h.verify.mockImplementation(async () => {
      proof.mockImplementation(() => {
        throw new Error("revoked");
      });
      return { status: "new" };
    });
    await start(props);
    await emit();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
  });
  it("rejects pending decisions when the selected source changes", async () => {
    let finish!: (value: unknown) => void;
    h.verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = options();
    const view = await start(props);
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.callbacks[0]({ payload: prompt() });
      await Promise.resolve();
    });
    view.rerender({ ...props, connections: [{ ...ssh, username: "changed" }] });
    await act(async () => {
      finish({ status: "trusted" });
      await pending;
    });
    expect(h.invoke).toHaveBeenCalledWith(expect.anything(), {
      sessionId: "backend",
      decision: "reject",
    });
    expect(h.trust).not.toHaveBeenCalled();
  });
  it("supports an inline local-forward source without importing its password into trust calls", async () => {
    const props = options();
    props.connections = [
      { ...ssh, integration: { host: "unselected.test" } } as Connection,
    ];
    props.connection = {
      ...website,
      security: {
        tunnelChain: [
          {
            id: "local",
            enabled: true,
            type: "local-forward",
            sshTunnel: {
              forwardType: "local",
              host: "ssh.test",
              port: 22,
              username: "user",
              password: "PRIVATE",
              remoteHost: "localhost",
              remotePort: 10000,
            },
          },
        ],
      },
    } as unknown as Connection;
    await start(props);
    await emit();
    expect(h.verify).toHaveBeenCalledWith(
      "ssh.test",
      22,
      "ssh",
      expect.anything(),
      undefined,
    );
    expect(JSON.stringify(h.invoke.mock.calls)).not.toContain("PRIVATE");
  });
  it("keeps duplicate browser consumers from registering competing decisions", async () => {
    const props = options();
    await start(props);
    const other = renderHook(() => useOriginBrowserSshTrust(props));
    expect(other.result.current.ready).toBe(false);
    expect(h.listen).toHaveBeenCalledTimes(2);
  });
  it("does not require a listener for an ordinary direct browser route", () => {
    const props = options();
    props.connection = { ...website, security: undefined };
    const view = renderHook(() => useOriginBrowserSshTrust(props));
    expect(view.result.current.ready).toBe(true);
    expect(h.listen).not.toHaveBeenCalled();
  });
});

const commandPrompt = (extra = {}) => ({
  nonce: "command-review-1",
  createRequestId: "create-1",
  hostKeyPromptId: "native-browser:browser",
  commandPreview: "fixture-proxy --target ssh.test:22",
  ...extra,
});
async function commandEvent(payload = commandPrompt()) {
  const listener = [...h.listen.mock.calls]
    .reverse()
    .find(([name]) => name === "ssh://native-browser-command-review")?.[1];
  await listener({ payload });
}
describe("native browser SSH command review", () => {
  it("uses the themed prompt and replies only nonce/decision for the exact pending create", async () => {
    const props = options();
    props.getPendingCreateRequestId = () => "create-1";
    h.prompt.mockResolvedValue({ confirmed: true, remember: false });
    await start(props);
    await act(async () => {
      await commandEvent();
    });
    expect(h.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultAction: "cancel",
        preview: {
          label: "SSH ProxyCommand",
          text: "fixture-proxy --target ssh.test:22",
        },
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(h.invoke).toHaveBeenCalledWith(
      "origin_browser_ssh_respond_to_command_review",
      { nonce: "command-review-1", accepted: true },
    );
    expect(h.invoke.mock.calls[0][1]).not.toHaveProperty("command");
    await act(async () => {
      await commandEvent();
    });
    expect(h.prompt).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects old/unknown create IDs and foreign correlations without opening a prompt", async () => {
    const props = options();
    props.getPendingCreateRequestId = () => "create-2";
    await start(props);
    await act(async () => {
      await commandEvent();
    });
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenLastCalledWith(
      "origin_browser_ssh_respond_to_command_review",
      { nonce: "command-review-1", accepted: false },
    );
    h.invoke.mockClear();
    await act(async () => {
      await commandEvent(
        commandPrompt({
          nonce: "foreign",
          hostKeyPromptId: "native-browser:other",
        }),
      );
    });
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("rechecks the current request after an asynchronous approval without needing a rerender", async () => {
    const props = options();
    let current = "create-1";
    props.getPendingCreateRequestId = () => current;
    let finish!: (value: { confirmed: boolean; remember: boolean }) => void;
    h.prompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await start(props);
    let work!: Promise<void>;
    act(() => {
      work = commandEvent();
    });
    await waitFor(() => expect(h.prompt).toHaveBeenCalledTimes(1));
    current = "create-2";
    await act(async () => {
      finish({ confirmed: true, remember: false });
      await work;
    });
    expect(h.invoke).toHaveBeenLastCalledWith(
      "origin_browser_ssh_respond_to_command_review",
      { nonce: "command-review-1", accepted: false },
    );
  });
  it("native expiry closes its exact pending prompt and cannot approve later", async () => {
    const props = options();
    props.getPendingCreateRequestId = () => "create-1";
    h.prompt.mockImplementation(
      (_request, { signal }) =>
        new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => resolve({ confirmed: false, remember: false }),
            { once: true },
          ),
        ),
    );
    await start(props);
    let work!: Promise<void>;
    act(() => {
      work = commandEvent();
    });
    await waitFor(() => expect(h.prompt).toHaveBeenCalledTimes(1));
    await act(async () => {
      await commandEvent(commandPrompt({ closed: true }));
      await work;
    });
    expect(h.invoke).toHaveBeenLastCalledWith(
      "origin_browser_ssh_respond_to_command_review",
      { nonce: "command-review-1", accepted: false },
    );
  });
  it("unmount rejects once and a late affirmative result cannot execute", async () => {
    const props = options();
    props.getPendingCreateRequestId = () => "create-1";
    let finish!: (value: { confirmed: boolean; remember: boolean }) => void;
    h.prompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await start(props);
    let work!: Promise<void>;
    act(() => {
      work = commandEvent();
    });
    await waitFor(() => expect(h.prompt).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finish({ confirmed: true, remember: false });
      await work;
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith(
      "origin_browser_ssh_respond_to_command_review",
      { nonce: "command-review-1", accepted: false },
    );
  });
});

describe("host-key confirmation in the shell prompt", () => {
  it("asks through the themed prompt, never window.confirm, with the fingerprint and Reject as default", async () => {
    h.verify.mockResolvedValue({ status: "new" });
    await start();
    await emit();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(h.prompt).toHaveBeenCalledOnce();
    const [request, options] = h.prompt.mock.calls[0];
    expect(request).toMatchObject({
      tone: "warning",
      defaultAction: "cancel",
      confirmLabel: "Trust and save key",
      preview: { label: "SHA-256 fingerprint", text: "SHA256:fixture" },
      targets: { items: [{ name: "ssh.test:22", detail: "ssh-ed25519" }] },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "reject",
    });
  });

  it("describes a changed key as a danger and brackets an IPv6 endpoint", () => {
    expect(
      hostKeyPrompt("::1", 2222, true, "SHA256:x", null, 3072),
    ).toMatchObject({
      tone: "danger",
      confirmLabel: "Replace and trust key",
      title: expect.stringContaining("changed"),
      targets: { items: [{ name: "[::1]:2222", detail: "SSH" }] },
      facts: ["3072 bits", "key changed"],
    });
  });

  it("holds the tab's pending confirmation only while the prompt is open", async () => {
    h.verify.mockResolvedValue({ status: "new" });
    let answer!: (value: { confirmed: boolean; remember: boolean }) => void;
    h.prompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await start();
    let delivered!: Promise<void>;
    await act(async () => {
      delivered = h.callbacks[0]({ payload: prompt() });
    });
    await waitFor(() => expect(h.prompt).toHaveBeenCalledOnce());
    expect(getOriginBrowserConfirmation("browser")).toBe("ssh-host-key");
    await act(async () => {
      answer({ confirmed: true, remember: false });
      await delivered;
    });
    expect(getOriginBrowserConfirmation("browser")).toBeNull();
    expect(h.trust).toHaveBeenCalledOnce();
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "accept_and_save",
    });
  });

  it("closes an open prompt on unmount, releases the hold and a late yes cannot trust", async () => {
    h.verify.mockResolvedValue({ status: "new" });
    let answer!: (value: { confirmed: boolean; remember: boolean }) => void;
    let signal!: AbortSignal;
    h.prompt.mockImplementation(
      (_request: unknown, options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal = options.signal;
          answer = resolve;
        }),
    );
    const view = await start();
    let delivered!: Promise<void>;
    await act(async () => {
      delivered = h.callbacks[0]({ payload: prompt() });
    });
    await waitFor(() => expect(h.prompt).toHaveBeenCalledOnce());
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      answer({ confirmed: true, remember: false });
      await delivered;
    });
    expect(getOriginBrowserConfirmation("browser")).toBeNull();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "reject",
    });
  });

  it("releases the hold and rejects when the prompt host is unavailable", async () => {
    h.verify.mockResolvedValue({ status: "new" });
    h.prompt.mockRejectedValue(new Error("no prompt host"));
    await start();
    await emit();
    expect(getOriginBrowserConfirmation("browser")).toBeNull();
    expect(h.trust).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
      sessionId: "backend",
      decision: "reject",
    });
  });
});
