import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SSHClient } from "../sshClient";
import {
  SSHLibraryFactory,
  BaseSSHClient,
  WebSSHClientFrontend,
} from "../sshLibraries";

class MockSSHClient extends BaseSSHClient {
  connect = vi.fn(async () => {});
  sendData = vi.fn();
  resize = vi.fn();
  disconnect = vi.fn();

  emitData(data: string) {
    this.callbacks.onData?.(data);
  }
  emitConnect() {
    this.callbacks.onConnect?.();
  }
  emitError(err: string) {
    this.callbacks.onError?.(err);
  }
  emitClose() {
    this.callbacks.onClose?.();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("SSHClient event callbacks", () => {
  const config = { host: "h", port: 22, username: "u" };
  let mockClient: MockSSHClient;

  beforeEach(() => {
    mockClient = new MockSSHClient(config);
    vi.spyOn(SSHLibraryFactory, "createClient").mockReturnValue(mockClient);
  });

  it("wires event callbacks to underlying client", async () => {
    const ssh = new SSHClient(config);
    const onData = vi.fn();
    const onConnect = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    ssh.onData(onData);
    ssh.onConnect(onConnect);
    ssh.onError(onError);
    ssh.onClose(onClose);

    await ssh.connect();
    mockClient.emitData("out");
    mockClient.emitConnect();
    mockClient.emitError("err");
    mockClient.emitClose();

    expect(onData).toHaveBeenCalledWith("out");
    expect(onConnect).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("err");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("SSHLibraryFactory switching", () => {
  const baseConfig = { host: "h", port: 22, username: "u" };

  it("creates clients using requested libraries", () => {
    const mockA = new MockSSHClient(baseConfig);
    const mockB = new MockSSHClient(baseConfig);
    const spy = vi
      .spyOn(SSHLibraryFactory, "createClient")
      .mockImplementation((type) => (type === "ssh2" ? mockA : mockB));

    const ssh2Client = new SSHClient({ ...baseConfig, library: "ssh2" });
    const websshClient = new SSHClient({ ...baseConfig, library: "webssh" });

    expect(spy).toHaveBeenCalledWith("ssh2", {
      ...baseConfig,
      library: "ssh2",
    });
    expect(spy).toHaveBeenCalledWith("webssh", {
      ...baseConfig,
      library: "webssh",
    });
    expect((ssh2Client as any).client).toBe(mockA);
    expect((websshClient as any).client).toBe(mockB);
  });
});

describe("SSHLibraryFactory browser fallback", () => {
  const config = { host: "h", port: 22, username: "u" };

  it("falls back to webssh in browser for unsupported libraries", () => {
    (global as any).window = {};
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = SSHLibraryFactory.createClient("node-ssh", config);
    expect(client).toBeInstanceOf(WebSSHClientFrontend);
    expect(warn).toHaveBeenCalledWith(
      'SSH library "node-ssh" is not supported in the browser, falling back to webssh',
    );
    delete (global as any).window;
  });
});
