/**
 * Replay of a sequenced backend output ring (telnet / serial; the SSH ring has
 * the same contract) after a webview reload, plus the dedupe of live events
 * against what the snapshot already delivered.
 *
 * This module never sits on the live path: live events go straight through
 * `ReplayDedupe.offer`, which only buffers while a snapshot fetch is in
 * flight (adoption) and otherwise costs one comparison.
 */

import { invoke } from "@tauri-apps/api/core";

export type OutputSnapshotCommand =
  "telnet_get_output_snapshot" | "serial_get_output_snapshot";

/** Wire shape (snake_case) shared with SSH `get_terminal_buffer_snapshot`. */
interface OutputSnapshotPage {
  data?: unknown;
  encoding?: unknown;
  generation?: unknown;
  sequence_start?: unknown;
  sequence_end?: unknown;
  gap?: unknown;
  generation_changed?: unknown;
  has_more?: unknown;
}

export interface OutputReplay {
  /** Page payloads in order: utf8 text (telnet) or base64 (serial). */
  pages: string[];
  encoding: "utf8" | "base64";
  generation: number;
  /** Ring position just past the last replayed byte. */
  sequenceEnd: number;
  /** Output was lost between what the UI had and what the ring retained. */
  gap: boolean;
}

/** Ring position of one live chunk; absent fields mean "unknown, deliver". */
export interface RingPosition {
  generation?: number;
  sequenceEnd?: number;
}

const MAX_REPLAY_PAGES = 80; // 80 x 256 KiB covers the 16 MiB ring ceiling.
const MAX_REPLAY_RESTARTS = 2;

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Read the whole retained ring, paging with the generation/sequence cursor. */
export async function fetchOutputReplay(
  command: OutputSnapshotCommand,
  sessionId: string,
): Promise<OutputReplay> {
  for (let restart = 0; restart <= MAX_REPLAY_RESTARTS; restart += 1) {
    const pages: string[] = [];
    let generation: number | undefined;
    let sequenceEnd: number | undefined;
    let encoding: "utf8" | "base64" = "utf8";
    let gap = false;
    let restartNeeded = false;

    for (let page = 0; page < MAX_REPLAY_PAGES; page += 1) {
      const args: Record<string, unknown> = { sessionId };
      if (generation !== undefined && sequenceEnd !== undefined) {
        args.generation = generation;
        args.afterSequence = sequenceEnd;
      }
      const raw = await invoke<OutputSnapshotPage>(command, args);
      if (!raw || typeof raw !== "object") {
        throw new Error("Output snapshot response is malformed.");
      }
      const pageGeneration = finite(raw.generation);
      const pageEnd = finite(raw.sequence_end);
      if (pageGeneration === undefined || pageEnd === undefined) {
        throw new Error("Output snapshot response is malformed.");
      }
      if (typeof raw.data !== "string") {
        throw new Error("Output snapshot response is malformed.");
      }
      if (page > 0 && raw.generation_changed === true) {
        // The ring was cleared mid-read: start over from its new beginning.
        restartNeeded = true;
        break;
      }
      encoding = raw.encoding === "base64" ? "base64" : "utf8";
      if (raw.gap === true) gap = true;
      if (raw.data.length > 0) pages.push(raw.data);
      generation = pageGeneration;
      sequenceEnd = pageEnd;
      if (raw.has_more !== true) {
        return { pages, encoding, generation, sequenceEnd, gap };
      }
    }
    if (!restartNeeded) {
      throw new Error("Output snapshot exceeded the replay page limit.");
    }
  }
  throw new Error("Output ring kept changing while it was replayed.");
}

const MAX_BUFFERED_EVENTS = 10_000;

/**
 * Drops live events a snapshot already delivered and holds live events that
 * arrive while the snapshot is being fetched, so replay always precedes them.
 */
export class ReplayDedupe<T> {
  private buffering = false;
  private buffer: Array<{ item: T; position: RingPosition | undefined }> = [];
  private cursor: { generation: number; sequenceEnd: number } | null = null;

  get isBuffering(): boolean {
    return this.buffering;
  }

  /** Start holding live events (adoption: snapshot fetch begins). */
  begin(): void {
    this.buffering = true;
    this.buffer = [];
    this.cursor = null;
  }

  private isDuplicate(position: RingPosition | undefined): boolean {
    const cursor = this.cursor;
    if (
      !cursor ||
      !position ||
      position.generation !== cursor.generation ||
      position.sequenceEnd === undefined
    ) {
      return false;
    }
    return position.sequenceEnd <= cursor.sequenceEnd;
  }

  /**
   * Returns the item when it should be delivered now, or null when it was
   * buffered (replay in flight) or dropped (already replayed).
   */
  offer(item: T, position: RingPosition | undefined): T | null {
    if (this.buffering) {
      if (this.buffer.length >= MAX_BUFFERED_EVENTS) this.buffer.shift();
      this.buffer.push({ item, position });
      return null;
    }
    return this.isDuplicate(position) ? null : item;
  }

  /**
   * End the replay window. `replay` null means the snapshot failed: nothing
   * is deduped and every buffered event is delivered. Returns the buffered
   * events that must still be delivered, in arrival order.
   */
  finish(replay: Pick<OutputReplay, "generation" | "sequenceEnd"> | null): T[] {
    this.cursor = replay
      ? { generation: replay.generation, sequenceEnd: replay.sequenceEnd }
      : null;
    this.buffering = false;
    const held = this.buffer;
    this.buffer = [];
    return held
      .filter((entry) => !this.isDuplicate(entry.position))
      .map((entry) => entry.item);
  }

  reset(): void {
    this.buffering = false;
    this.buffer = [];
    this.cursor = null;
  }
}
