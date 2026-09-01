import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertRdpBinaryIpcPreflight,
  RDP_BINARY_IPC_PREFLIGHT_MAGIC,
  RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES,
  type RdpBinaryIpcPreflightRuntime,
} from "../../src/utils/rdp/rdpBinaryIpcPreflight";

function validProbe(): Uint8Array {
  const bytes = new Uint8Array(RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES);
  for (
    let index = 0;
    index < RDP_BINARY_IPC_PREFLIGHT_MAGIC.length;
    index += 1
  ) {
    bytes[index] = RDP_BINARY_IPC_PREFLIGHT_MAGIC.charCodeAt(index);
  }
  return bytes;
}

function deliveringRuntime(payload: unknown): {
  runtime: RdpBinaryIpcPreflightRuntime;
  channel: object;
  invokeCommand: ReturnType<typeof vi.fn>;
} {
  let deliver: ((value: unknown) => void) | undefined;
  const channel = { probe: true };
  const invokeCommand = vi.fn(async () => {
    deliver?.(payload);
  });
  return {
    channel,
    invokeCommand,
    runtime: {
      createChannel: (handler) => {
        deliver = handler;
        return channel;
      },
      invokeCommand,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RDP binary IPC preflight", () => {
  it("accepts the deterministic probe as an ArrayBuffer", async () => {
    const probe = validProbe();
    const { runtime, channel, invokeCommand } = deliveringRuntime(probe.buffer);

    await expect(
      assertRdpBinaryIpcPreflight({ runtime }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledWith("rdp_binary_ipc_preflight", {
      probeChannel: channel,
    });
  });

  it("accepts an offset typed-array view without copying unrelated bytes", async () => {
    const probe = validProbe();
    const backing = new Uint8Array(probe.byteLength + 4);
    backing.set(probe, 2);
    const view = new Uint8Array(backing.buffer, 2, probe.byteLength);
    const { runtime } = deliveringRuntime(view);

    await expect(
      assertRdpBinaryIpcPreflight({ runtime }),
    ).resolves.toBeUndefined();
  });

  it("coalesces concurrent callers onto one command invocation", async () => {
    let deliver: ((value: unknown) => void) | undefined;
    let completeCommand: (() => void) | undefined;
    const invokeCommand = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeCommand = resolve;
        }),
    );
    const runtime: RdpBinaryIpcPreflightRuntime = {
      createChannel: (handler) => {
        deliver = handler;
        return { probe: true };
      },
      invokeCommand,
    };

    const first = assertRdpBinaryIpcPreflight({ runtime });
    const second = assertRdpBinaryIpcPreflight({ runtime });
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(1));

    deliver?.(validProbe().buffer);
    completeCommand?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await expect(
      assertRdpBinaryIpcPreflight({ runtime }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects Tauri's serialized number-array fallback", async () => {
    const { runtime } = deliveringRuntime(Array.from(validProbe()));

    await expect(assertRdpBinaryIpcPreflight({ runtime })).rejects.toThrow(
      /serialized number\[\] payload is not binary IPC/,
    );
  });

  it("rejects a binary payload with the wrong length or magic", async () => {
    const shortRuntime = deliveringRuntime(
      validProbe().buffer.slice(0, RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES - 1),
    ).runtime;
    await expect(
      assertRdpBinaryIpcPreflight({ runtime: shortRuntime }),
    ).rejects.toThrow(/probe length/);

    const wrongMagic = validProbe();
    wrongMagic[0] ^= 0xff;
    const magicRuntime = deliveringRuntime(wrongMagic.buffer).runtime;
    await expect(
      assertRdpBinaryIpcPreflight({ runtime: magicRuntime }),
    ).rejects.toThrow(/probe magic mismatch/);
  });

  it("times out when the command returns without delivering a probe", async () => {
    vi.useFakeTimers();
    const runtime: RdpBinaryIpcPreflightRuntime = {
      createChannel: () => ({ probe: true }),
      invokeCommand: vi.fn(async () => undefined),
    };

    const preflight = assertRdpBinaryIpcPreflight({
      runtime,
      timeoutMs: 25,
    });
    const rejection = expect(preflight).rejects.toThrow(/timed out after 25ms/);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("memoizes a failed preflight without reinvoking for the runtime lifetime", async () => {
    const invokeCommand = vi.fn(async () => undefined);
    const runtime: RdpBinaryIpcPreflightRuntime = {
      createChannel: () => ({ probe: true }),
      invokeCommand,
    };

    const first = assertRdpBinaryIpcPreflight({ runtime, timeoutMs: 10 });
    const firstRejection =
      expect(first).rejects.toThrow(/timed out after 10ms/);
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(1));
    await firstRejection;

    await expect(
      assertRdpBinaryIpcPreflight({ runtime, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out after 10ms/);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });
});
