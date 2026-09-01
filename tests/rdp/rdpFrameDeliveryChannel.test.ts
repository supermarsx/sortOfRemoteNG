import { describe, expect, it, vi } from "vitest";
import type { Channel } from "@tauri-apps/api/core";

import {
  createRdpFrameDeliveryChannel,
  RDP_ACK_FRAME_DELIVERY_MAX_ATTEMPTS,
  RDP_ACK_FRAME_DELIVERY_COMMAND,
  type RdpFrameDeliveryChannelRuntime,
} from "../../src/utils/rdp/rdpFrameDeliveryChannel";

function runtimeHarness(channelId = 73) {
  let deliver: ((payload: unknown) => void) | undefined;
  const invokeCommand = vi.fn(
    async (
      _command: string,
      args: Record<string, unknown>,
    ): Promise<unknown> => ({
      channelId: args.channelId,
      deliveryId: args.deliveryId,
      duplicate: false,
      acknowledgedBytes: 32,
      inFlightFrames: 0,
      inFlightBytes: 0,
      droppedFrames: 0,
      nalChainBroken: false,
    }),
  );
  const reportAcknowledgementError = vi.fn();
  const reportFrameConsumptionError = vi.fn();
  const channel = { id: channelId } as Channel<unknown>;
  const runtime: RdpFrameDeliveryChannelRuntime = {
    createChannel: (handler) => {
      deliver = handler;
      return channel;
    },
    invokeCommand,
    reportAcknowledgementError,
    reportFrameConsumptionError,
  };
  return {
    runtime,
    channel,
    invokeCommand,
    reportAcknowledgementError,
    reportFrameConsumptionError,
    deliver: (payload: unknown) => deliver?.(payload),
  };
}

describe("RDP native frame delivery credits", () => {
  it("acknowledges the exact Channel and ordered delivery ID after frame consumption", async () => {
    const harness = runtimeHarness(41);
    const onFrame = vi.fn();

    expect(
      createRdpFrameDeliveryChannel(onFrame, { runtime: harness.runtime }),
    ).toBe(harness.channel);
    const payload = new ArrayBuffer(32);
    harness.deliver(payload);

    expect(onFrame).toHaveBeenCalledWith(payload);
    await vi.waitFor(() => {
      expect(harness.invokeCommand).toHaveBeenCalledWith(
        RDP_ACK_FRAME_DELIVERY_COMMAND,
        { channelId: 41, deliveryId: 1 },
      );
    });
    expect(onFrame.mock.invocationCallOrder[0]).toBeLessThan(
      harness.invokeCommand.mock.invocationCallOrder[0],
    );
  });

  it("reports and acknowledges a sync frame error without breaking Channel ordering", () => {
    const harness = runtimeHarness();
    const onFrame = vi.fn(() => {
      throw new Error("malformed frame");
    });
    createRdpFrameDeliveryChannel(onFrame, { runtime: harness.runtime });

    expect(() => harness.deliver([1, 2, 3])).not.toThrow();
    expect(harness.reportFrameConsumptionError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "malformed frame" }),
    );
    expect(harness.invokeCommand).toHaveBeenCalledWith(
      RDP_ACK_FRAME_DELIVERY_COMMAND,
      { channelId: 73, deliveryId: 1 },
    );
  });

  it("waits for asynchronous frame consumption before acknowledging", async () => {
    const harness = runtimeHarness();
    let finishFrame: (() => void) | undefined;
    const onFrame = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFrame = resolve;
        }),
    );
    createRdpFrameDeliveryChannel(onFrame, { runtime: harness.runtime });

    harness.deliver(new Uint8Array(4));
    await Promise.resolve();
    expect(harness.invokeCommand).not.toHaveBeenCalled();

    finishFrame?.();
    await vi.waitFor(() => {
      expect(harness.invokeCommand).toHaveBeenCalledWith(
        RDP_ACK_FRAME_DELIVERY_COMMAND,
        { channelId: 73, deliveryId: 1 },
      );
    });
  });

  it("retries the same exact ID when the first processed ACK response is lost", async () => {
    const harness = runtimeHarness();
    harness.invokeCommand
      .mockRejectedValueOnce(new Error("response lost after native processing"))
      .mockResolvedValueOnce({
        channelId: 73,
        deliveryId: 1,
        duplicate: true,
        acknowledgedBytes: 4,
        inFlightFrames: 0,
        inFlightBytes: 0,
        droppedFrames: 0,
        nalChainBroken: false,
      });
    createRdpFrameDeliveryChannel(vi.fn(), { runtime: harness.runtime });

    harness.deliver(new Uint8Array(4));
    await vi.waitFor(() => {
      expect(harness.invokeCommand).toHaveBeenCalledTimes(2);
    });
    expect(harness.invokeCommand).toHaveBeenNthCalledWith(
      1,
      RDP_ACK_FRAME_DELIVERY_COMMAND,
      { channelId: 73, deliveryId: 1 },
    );
    expect(harness.invokeCommand).toHaveBeenNthCalledWith(
      2,
      RDP_ACK_FRAME_DELIVERY_COMMAND,
      { channelId: 73, deliveryId: 1 },
    );
    expect(harness.reportAcknowledgementError).not.toHaveBeenCalled();
  });

  it("bounds acknowledgement retries and reports the final failure", async () => {
    const harness = runtimeHarness();
    harness.invokeCommand.mockRejectedValue(new Error("backend unavailable"));
    createRdpFrameDeliveryChannel(vi.fn(), { runtime: harness.runtime });

    harness.deliver(new Uint8Array(4));
    await vi.waitFor(() => {
      expect(harness.reportAcknowledgementError).toHaveBeenCalledTimes(1);
    });
    expect(harness.invokeCommand).toHaveBeenCalledTimes(
      RDP_ACK_FRAME_DELIVERY_MAX_ATTEMPTS,
    );
  });

  it("surfaces a native NAL-chain drop to the recovery callback", async () => {
    const harness = runtimeHarness();
    harness.invokeCommand.mockResolvedValueOnce({
      channelId: 73,
      deliveryId: 1,
      duplicate: false,
      acknowledgedBytes: 1024,
      inFlightFrames: 1,
      inFlightBytes: 2048,
      droppedFrames: 3,
      nalChainBroken: true,
    });
    const onDeliveryPressure = vi.fn();
    createRdpFrameDeliveryChannel(vi.fn(), {
      runtime: harness.runtime,
      onDeliveryPressure,
    });

    harness.deliver(new Uint8Array(4));
    await vi.waitFor(() => {
      expect(onDeliveryPressure).toHaveBeenCalledWith(
        expect.objectContaining({ droppedFrames: 3, nalChainBroken: true }),
      );
    });
  });
});
