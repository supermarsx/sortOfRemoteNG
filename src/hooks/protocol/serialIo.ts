/**
 * Serial I/O plumbing shared by useSerialSession: an ordered, coalescing send
 * queue (one in-flight IPC at a time) and a ref-style output stream that feeds
 * xterm without per-chunk React state.
 */

/** Largest single `serial_send_raw` payload produced by the queue. */
export const SERIAL_SEND_BATCH_BYTES = 16 * 1024;
/** Queued bytes at which the UI should show a "send backlog" indicator. */
export const SERIAL_SEND_BACKLOG_BYTES = 8 * 1024;

interface QueuedSend {
  data: Uint8Array;
  offset: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface SerialSendQueueOptions {
  /** Performs one IPC write; must preserve call order (the queue serializes). */
  write: (data: Uint8Array) => Promise<void>;
  /** Called when queued byte count crosses the backlog threshold. */
  onBacklogChange?: (backlogged: boolean) => void;
  batchBytes?: number;
  backlogBytes?: number;
}

/**
 * Coalesces every send enqueued in the same tick into as few writes as
 * possible (capped at `batchBytes`), never runs two writes concurrently and
 * retries a failed write once before rejecting the sends it carried. Later
 * sends are still attempted after a failure so ordering of the survivors holds.
 */
export class SerialSendQueue {
  private readonly items: QueuedSend[] = [];
  private queuedBytes = 0;
  private running = false;
  private backlogged = false;
  private readonly batchBytes: number;
  private readonly backlogBytes: number;

  constructor(private readonly options: SerialSendQueueOptions) {
    this.batchBytes = options.batchBytes ?? SERIAL_SEND_BATCH_BYTES;
    this.backlogBytes = options.backlogBytes ?? SERIAL_SEND_BACKLOG_BYTES;
  }

  get pendingBytes(): number {
    return this.queuedBytes;
  }

  enqueue(data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) return Promise.resolve();
    // Copy: callers zero their buffers after the promise settles.
    const copy = data.slice();
    return new Promise<void>((resolve, reject) => {
      this.items.push({ data: copy, offset: 0, resolve, reject });
      this.queuedBytes += copy.byteLength;
      this.updateBacklog();
      if (!this.running) {
        this.running = true;
        // Microtask: sends issued in the same tick land in one batch.
        queueMicrotask(() => void this.drain());
      }
    });
  }

  /** Reject everything still queued (session closed / unmounted). */
  clear(error: unknown): void {
    const dropped = this.items.splice(0);
    this.queuedBytes = 0;
    this.updateBacklog();
    for (const item of dropped) {
      item.data.fill(0);
      item.reject(error);
    }
  }

  private updateBacklog() {
    const next = this.queuedBytes >= this.backlogBytes;
    if (next !== this.backlogged) {
      this.backlogged = next;
      this.options.onBacklogChange?.(next);
    }
  }

  private takeBatch(): { payload: Uint8Array; owners: QueuedSend[] } {
    const parts: Uint8Array[] = [];
    const owners: QueuedSend[] = [];
    let size = 0;
    while (this.items.length > 0 && size < this.batchBytes) {
      const item = this.items[0];
      const room = this.batchBytes - size;
      const remaining = item.data.byteLength - item.offset;
      const take = Math.min(room, remaining);
      parts.push(item.data.subarray(item.offset, item.offset + take));
      size += take;
      item.offset += take;
      if (!owners.includes(item)) owners.push(item);
      if (item.offset >= item.data.byteLength) {
        this.items.shift();
      } else {
        break;
      }
    }
    const payload = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      payload.set(part, at);
      at += part.byteLength;
    }
    this.queuedBytes -= size;
    this.updateBacklog();
    return { payload, owners };
  }

  private async drain(): Promise<void> {
    try {
      while (this.items.length > 0) {
        const { payload, owners } = this.takeBatch();
        let failure: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await this.options.write(payload);
            failure = null;
            break;
          } catch (error) {
            failure = error;
          }
        }
        payload.fill(0);
        for (const owner of owners) {
          // An owner is finished once its last byte has been taken.
          const finished = owner.offset >= owner.data.byteLength;
          if (failure !== null) {
            owner.reject(failure);
            // Drop the unsent tail of a partially sent payload.
            const index = this.items.indexOf(owner);
            if (index >= 0) {
              this.queuedBytes -= owner.data.byteLength - owner.offset;
              this.items.splice(index, 1);
              this.updateBacklog();
            }
            owner.data.fill(0);
          } else if (finished) {
            owner.data.fill(0);
            owner.resolve();
          }
        }
      }
    } finally {
      this.running = false;
      // A send enqueued during the final await may have been missed.
      if (this.items.length > 0 && !this.running) {
        this.running = true;
        queueMicrotask(() => void this.drain());
      }
    }
  }
}

const MAX_RETAINED_CHUNKS = 2_048;
const MAX_RETAINED_BYTES = 1024 * 1024;

export interface SerialOutputListener {
  onChunk: (chunk: Uint8Array) => void;
  onReset?: () => void;
}

/**
 * Bounded retained output with push subscribers. New subscribers (a freshly
 * mounted terminal) get the retained history replayed synchronously.
 */
export class SerialOutputStream {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private readonly listeners = new Set<SerialOutputListener>();

  get subscriberCount(): number {
    return this.listeners.size;
  }

  snapshot(): readonly Uint8Array[] {
    return this.chunks.slice();
  }

  append(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    while (
      this.chunks.length > MAX_RETAINED_CHUNKS ||
      this.bytes > MAX_RETAINED_BYTES
    ) {
      this.bytes -= this.chunks.shift()?.byteLength ?? 0;
    }
    for (const listener of this.listeners) listener.onChunk(chunk);
  }

  reset(): void {
    this.chunks = [];
    this.bytes = 0;
    for (const listener of this.listeners) listener.onReset?.();
  }

  subscribe(listener: SerialOutputListener): () => void {
    this.listeners.add(listener);
    for (const chunk of this.chunks) listener.onChunk(chunk);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
