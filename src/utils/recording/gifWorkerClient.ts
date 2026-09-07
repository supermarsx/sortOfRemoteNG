import type {
  GifEncoderOptions,
  GifRequest,
  GifResponse,
  GifResult,
} from "./gifProtocol";

/** Exactly one request may be in flight. No pixel-message queue. */
export class GifWorkerClient {
  private worker: Worker;
  private pending: {
    resolve: (response: GifResponse) => void;
    reject: (error: Error) => void;
  } | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private failure: Error | null = null;
  onError?: (error: Error) => void;
  readonly ready: Promise<void>;

  constructor(options: GifEncoderOptions) {
    if (typeof Worker === "undefined")
      throw new Error(
        "GIF recording requires Web Worker support. Choose WebM or MP4.",
      );
    this.worker = new Worker(
      new URL("./gifEncoder.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = ({ data }: MessageEvent<GifResponse>) => {
      if (data.type === "error") {
        this.close(new Error(data.message));
        return;
      }
      const pending = this.pending;
      this.pending = null;
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = null;
      pending?.resolve(data);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close(new Error(event.message || "GIF encoder worker failed."));
    };
    this.worker.onmessageerror = () =>
      this.close(new Error("Unable to read GIF encoder output."));
    this.ready = this.request({ type: "init", options }).then(() => {});
    // Consumers can cancel before initialization settles.
    void this.ready.catch(() => {});
  }

  async addFrame(
    frame: ImageData,
    timestampMs: number,
    transfer = false,
  ): Promise<GifResult | null> {
    const rgba = transfer
      ? (frame.data.buffer as ArrayBuffer)
      : new Uint8ClampedArray(frame.data).buffer;
    const response = await this.request({ type: "frame", rgba, timestampMs }, [
      rgba,
    ]);
    return response.type === "done" ? response.result : null;
  }

  async finish(timestampMs: number): Promise<GifResult> {
    const response = await this.request({ type: "finish", timestampMs });
    if (response.type !== "done")
      throw new Error("GIF encoder did not finish.");
    return response.result;
  }

  close(
    error: Error = new DOMException("GIF encoding cancelled.", "AbortError"),
  ) {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    const pending = this.pending;
    this.pending = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    pending?.reject(error);
    if (error.name !== "AbortError") this.onError?.(error);
  }

  private request(
    message: GifRequest,
    transfer: Transferable[] = [],
  ): Promise<GifResponse> {
    if (this.closed)
      return Promise.reject(
        this.failure ??
          new DOMException("GIF encoding cancelled.", "AbortError"),
      );
    if (this.pending) return Promise.reject(new Error("GIF encoder is busy."));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timeout = setTimeout(
        () =>
          this.close(
            new Error(
              "GIF encoding timed out. Choose a smaller recording or WebM.",
            ),
          ),
        30_000,
      );
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
