import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  verify: vi.fn(),
  trust: vi.fn(),
  unlisten: vi.fn(),
  database: "db",
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/utils/auth/trustStore", () => ({
  verifyIdentity: mocks.verify,
  trustIdentity: mocks.trust,
  getTrustStoreScope: () => ({ databaseId: mocks.database }),
}));
import { listenForTunnelTrust as registerTrust } from "../../src/utils/ssh/sshTunnelTrust";
const cleanups: Array<() => void> = [];
const listenForTunnelTrust = async (
  ...args: Parameters<typeof registerTrust>
) => {
  const close = await registerTrust(...args);
  cleanups.push(close);
  return close;
};
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
});
const payload = {
  session_id: "native-session",
  host: "ssh.example",
  port: 22,
  username: "alice",
  fingerprint: "fingerprint",
  status: "first_use",
  key_type: "ed25519",
  key_bits: 256,
  public_key: "key",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.database = "db";
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.verify.mockResolvedValue({ status: "first-use" });
  mocks.trust.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
const emit = () => mocks.listen.mock.calls[0][1]({ payload });
it("reserves the endpoint before listener registration finishes and releases it on failure", async () => {
  let reject!: (error: Error) => void;
  mocks.listen.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const registration = listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "a",
    "strict",
    () => {},
  );
  const failed = expect(registration).rejects.toThrow("registration failed");
  await expect(
    listenForTunnelTrust(
      "ssh.example",
      22,
      "alice",
      "b",
      "always-ask",
      () => {},
    ),
  ).rejects.toThrow("already awaiting");
  reject(new Error("registration failed"));
  await failed;
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "b",
    "always-ask",
    () => {},
  );
});

it("rejects the claimed prompt if its attempt closes while verification is pending", async () => {
  let resolve!: (result: { status: string }) => void;
  mocks.verify.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const close = await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "a",
    "always-ask",
    () => {},
  );
  const pending = emit();
  close();
  resolve({ status: "trusted" });
  await pending;
  expect(mocks.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
    sessionId: payload.session_id,
    decision: "reject",
  });
  expect(mocks.trust).not.toHaveBeenCalled();
});

it("keeps different endpoints independent and ignores unrelated events", async () => {
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "a",
    "strict",
    () => {},
  );
  await listenForTunnelTrust(
    "other.example",
    22,
    "alice",
    "b",
    "always-ask",
    () => {},
  );
  await mocks.listen.mock.calls[1][1]({ payload });
  expect(mocks.invoke).not.toHaveBeenCalled();
  await emit();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("rejects a competing endpoint listener before it can cross-answer a prompt", async () => {
  const close = await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "base-a",
    "strict",
    () => {},
  );
  await expect(
    listenForTunnelTrust(
      "SSH.EXAMPLE",
      22,
      "alice",
      "base-b",
      "always-ask",
      () => {},
    ),
  ).rejects.toThrow("already awaiting host-key verification");
  expect(mocks.listen).toHaveBeenCalledTimes(1);
  await emit();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
    sessionId: payload.session_id,
    decision: "reject",
  });
  close();
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "base-b",
    "always-ask",
    () => {},
  );
});

it("ignores duplicate and different-session prompts after claiming a handshake", async () => {
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "base",
    "always-ask",
    () => {},
  );
  await Promise.all([
    emit(),
    emit(),
    mocks.listen.mock.calls[0][1]({
      payload: { ...payload, session_id: "other-session" },
    }),
  ]);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("prompts for first use and rejects when declined", async () => {
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    undefined,
    "always-ask",
    () => {},
  );
  await emit();
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("fingerprint"),
  );
  expect(mocks.trust).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
    sessionId: "native-session",
    decision: "reject",
  });
});
it("persists an explicitly approved fingerprint through Trust Center", async () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  const close = await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    "base",
    "always-ask",
    () => {},
  );
  await emit();
  expect(mocks.trust).toHaveBeenCalledWith(
    "ssh.example",
    22,
    "ssh",
    expect.objectContaining({ fingerprint: "fingerprint" }),
    true,
    "base",
  );
  expect(mocks.invoke).toHaveBeenCalledWith("ssh_respond_to_host_key_prompt", {
    sessionId: "native-session",
    decision: "accept_and_save",
  });
  close();
  expect(mocks.unlisten).toHaveBeenCalled();
});
it("strict policy rejects unknown keys without offering approval", async () => {
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    undefined,
    "strict",
    () => {},
  );
  await emit();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "ssh_respond_to_host_key_prompt",
    expect.objectContaining({ decision: "reject" }),
  );
});
it("rejects a trust-store switch during verification", async () => {
  await listenForTunnelTrust(
    "ssh.example",
    22,
    "alice",
    undefined,
    "always-ask",
    () => {},
  );
  mocks.verify.mockImplementation(async () => {
    mocks.database = "other";
    return { status: "trusted" };
  });
  await emit();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "ssh_respond_to_host_key_prompt",
    expect.objectContaining({ decision: "reject" }),
  );
});
