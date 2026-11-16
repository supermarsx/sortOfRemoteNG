import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  fetchOutputReplay,
  ReplayDedupe,
} from "../../../src/services/session/outputReplay";

const page = (over: Record<string, unknown>) => ({
  session_id: "s",
  data: "",
  encoding: "utf8",
  generation: 7,
  sequence_start: 0,
  sequence_end: 0,
  retained_start: 0,
  dropped_bytes: 0,
  gap: false,
  generation_changed: false,
  has_more: false,
  ...over,
});

beforeEach(() => invoke.mockReset());

describe("fetchOutputReplay", () => {
  it("pages with the generation/sequence cursor until has_more is false", async () => {
    invoke
      .mockResolvedValueOnce(
        page({ data: "ab", sequence_end: 2, has_more: true }),
      )
      .mockResolvedValueOnce(page({ data: "cd", sequence_end: 4 }));
    const replay = await fetchOutputReplay("telnet_get_output_snapshot", "s");
    expect(replay).toMatchObject({
      pages: ["ab", "cd"],
      generation: 7,
      sequenceEnd: 4,
      gap: false,
      encoding: "utf8",
    });
    expect(invoke.mock.calls[0]).toEqual([
      "telnet_get_output_snapshot",
      { sessionId: "s" },
    ]);
    expect(invoke.mock.calls[1]).toEqual([
      "telnet_get_output_snapshot",
      { sessionId: "s", generation: 7, afterSequence: 2 },
    ]);
  });

  it("reports serial base64 pages and gaps", async () => {
    invoke.mockResolvedValueOnce(
      page({ data: "AQID", encoding: "base64", sequence_end: 3, gap: true }),
    );
    const replay = await fetchOutputReplay("serial_get_output_snapshot", "s");
    expect(replay.encoding).toBe("base64");
    expect(replay.gap).toBe(true);
  });

  it("restarts from the beginning when the ring generation changes mid-read", async () => {
    invoke
      .mockResolvedValueOnce(
        page({ data: "old", sequence_end: 3, has_more: true }),
      )
      .mockResolvedValueOnce(
        page({
          generation: 8,
          generation_changed: true,
          gap: true,
          sequence_end: 1,
        }),
      )
      .mockResolvedValueOnce(
        page({ generation: 8, data: "new", sequence_end: 3 }),
      );
    const replay = await fetchOutputReplay("telnet_get_output_snapshot", "s");
    expect(replay.pages).toEqual(["new"]);
    expect(replay.generation).toBe(8);
    expect(invoke.mock.calls[2][1]).toEqual({ sessionId: "s" });
  });

  it("rejects malformed responses", async () => {
    invoke.mockResolvedValueOnce({ data: 5 });
    await expect(
      fetchOutputReplay("telnet_get_output_snapshot", "s"),
    ).rejects.toThrow(/malformed/);
  });
});

describe("ReplayDedupe", () => {
  it("passes live events straight through when no replay is active", () => {
    const gate = new ReplayDedupe<string>();
    expect(gate.offer("x", { generation: 1, sequenceEnd: 5 })).toBe("x");
    expect(gate.offer("y", undefined)).toBe("y");
  });

  it("holds events during the replay, then drops replayed and keeps newer ones in order", () => {
    const gate = new ReplayDedupe<string>();
    gate.begin();
    expect(
      gate.offer("covered", { generation: 7, sequenceEnd: 10 }),
    ).toBeNull();
    expect(gate.offer("edge", { generation: 7, sequenceEnd: 12 })).toBeNull();
    expect(gate.offer("newer", { generation: 7, sequenceEnd: 15 })).toBeNull();
    expect(gate.offer("echo", undefined)).toBeNull();
    expect(
      gate.offer("other-gen", { generation: 8, sequenceEnd: 1 }),
    ).toBeNull();
    const held = gate.finish({ generation: 7, sequenceEnd: 12 });
    expect(held).toEqual(["newer", "echo", "other-gen"]);
    // After the replay: duplicates of replayed output are still dropped.
    expect(
      gate.offer("late-dup", { generation: 7, sequenceEnd: 11 }),
    ).toBeNull();
    expect(gate.offer("late-new", { generation: 7, sequenceEnd: 20 })).toBe(
      "late-new",
    );
  });

  it("delivers everything when the snapshot failed", () => {
    const gate = new ReplayDedupe<string>();
    gate.begin();
    gate.offer("a", { generation: 1, sequenceEnd: 1 });
    gate.offer("b", { generation: 1, sequenceEnd: 2 });
    expect(gate.finish(null)).toEqual(["a", "b"]);
    expect(gate.offer("c", { generation: 1, sequenceEnd: 1 })).toBe("c");
  });

  it("events from old builds without ring positions are never dropped", () => {
    const gate = new ReplayDedupe<string>();
    gate.begin();
    gate.offer("legacy", {});
    expect(gate.finish({ generation: 1, sequenceEnd: 99 })).toEqual(["legacy"]);
  });
});
