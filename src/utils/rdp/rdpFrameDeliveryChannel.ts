import { Channel, invoke } from "@tauri-apps/api/core";

export const RDP_ACK_FRAME_DELIVERY_COMMAND = "rdp_ack_frame_delivery";

export interface RdpFrameDeliveryChannelRuntime {
  createChannel: (onMessage: (payload: unknown) => void) => Channel<unknown>;
  invokeCommand: (
    command: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  reportAcknowledgementError: (error: unknown) => void;
  reportFrameConsumptionError: (error: unknown) => void;
}

export interface RdpFrameDeliveryAcknowledgement {
  channelId: number;
  deliveryId: number;
  duplicate: boolean;
  acknowledgedBytes: number;
  inFlightFrames: number;
  inFlightBytes: number;
  droppedFrames: number;
  nalChainBroken: boolean;
}

export const RDP_ACK_FRAME_DELIVERY_MAX_ATTEMPTS = 3;
const RDP_ACK_FRAME_DELIVERY_RETRY_DELAYS_MS = [25, 100] as const;

export interface RdpFrameDeliveryChannelOptions {
  runtime?: RdpFrameDeliveryChannelRuntime;
  onDeliveryPressure?: (
    acknowledgement: RdpFrameDeliveryAcknowledgement,
  ) => void;
}

const defaultRuntime: RdpFrameDeliveryChannelRuntime = {
  createChannel: (onMessage) => new Channel<unknown>(onMessage),
  invokeCommand: (command, args) => invoke(command, args),
  reportAcknowledgementError: (error) => {
    console.warn(
      `[RDP frame delivery] acknowledgement failed closed: ${String(error)}`,
    );
  },
  reportFrameConsumptionError: (error) => {
    console.error(
      `[RDP frame delivery] frame consumption failed: ${String(error)}`,
    );
  },
};

/**
 * Create the high-volume RDP frame channel with a native delivery credit.
 *
 * Native permits only one outstanding body per channel and permanently closes
 * a channel when `Channel.send()` fails. Tauri Channel callbacks therefore map
 * exactly to successful native delivery IDs `1, 2, ...` without adding a
 * header to the raw frame body. The exact `(channelId, deliveryId)` ACK is
 * idempotent, so a bounded retry cannot release a newer payload when an invoke
 * response is lost.
 *
 * `onFrame` may return a promise. Credit is released only after that promise
 * settles, allowing the renderer pipeline to hold native backpressure until
 * its bounded queue entry is actually consumed or deliberately dropped.
 */
export function createRdpFrameDeliveryChannel(
  onFrame: (payload: unknown) => void | Promise<void>,
  options: RdpFrameDeliveryChannelOptions = {},
): Channel<unknown> {
  const runtime = options.runtime ?? defaultRuntime;
  let nextDeliveryId = 1;

  const acknowledge = async (deliveryId: number): Promise<void> => {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < RDP_ACK_FRAME_DELIVERY_MAX_ATTEMPTS;
      attempt += 1
    ) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(
            resolve,
            RDP_ACK_FRAME_DELIVERY_RETRY_DELAYS_MS[attempt - 1],
          );
        });
      }
      try {
        const response = (await runtime.invokeCommand(
          RDP_ACK_FRAME_DELIVERY_COMMAND,
          {
            channelId: channel.id,
            deliveryId,
          },
        )) as Partial<RdpFrameDeliveryAcknowledgement> | null;
        if (
          !response ||
          response.channelId !== channel.id ||
          response.deliveryId !== deliveryId ||
          typeof response.duplicate !== "boolean" ||
          typeof response.acknowledgedBytes !== "number" ||
          typeof response.inFlightFrames !== "number" ||
          typeof response.inFlightBytes !== "number" ||
          typeof response.droppedFrames !== "number" ||
          typeof response.nalChainBroken !== "boolean"
        ) {
          throw new Error(
            `invalid acknowledgement for channel ${channel.id}, delivery ${deliveryId}`,
          );
        }

        if (response.droppedFrames > 0 || response.nalChainBroken) {
          options.onDeliveryPressure?.(
            response as RdpFrameDeliveryAcknowledgement,
          );
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }
    runtime.reportAcknowledgementError(lastError);
  };

  const channel = runtime.createChannel((payload) => {
    const deliveryId = nextDeliveryId;
    nextDeliveryId += 1;

    let frameCompletion: Promise<void>;
    try {
      frameCompletion = Promise.resolve(onFrame(payload));
    } catch (error) {
      // Never rethrow from a Tauri Channel callback. Its JavaScript dispatcher
      // advances the ordered message index only after `onmessage` returns; a
      // throw would leave an index gap and strand every subsequent raw body.
      runtime.reportFrameConsumptionError(error);
      void acknowledge(deliveryId);
      return;
    }

    void frameCompletion.then(
      () => acknowledge(deliveryId),
      (error) => {
        runtime.reportFrameConsumptionError(error);
        return acknowledge(deliveryId);
      },
    );
  });
  return channel;
}
