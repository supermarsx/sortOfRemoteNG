import { IncrementalGifEncoder } from "./gifEncodingCore";
import type { GifRequest, GifResponse } from "./gifProtocol";

let encoder: IncrementalGifEncoder | null = null;
self.onmessage = ({ data }: MessageEvent<GifRequest>) => {
  let response: GifResponse;
  try {
    if (data.type === "init") {
      encoder = new IncrementalGifEncoder(data.options);
      response = { type: "ready" };
    } else {
      if (!encoder) throw new Error("GIF encoder is not initialized.");
      const result =
        data.type === "frame"
          ? encoder.addFrame(data.rgba, data.timestampMs)
          : encoder.finish(data.timestampMs);
      response = result ? { type: "done", result } : { type: "frame" };
      if (result) encoder = null;
    }
  } catch (error) {
    encoder = null;
    response = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
