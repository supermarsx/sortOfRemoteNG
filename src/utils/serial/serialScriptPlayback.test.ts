import { describe, expect, it, vi } from "vitest";
import {
  playSerialSteps,
  serialMacroSteps,
  serialPlaybackPreview,
  serialScriptSteps,
} from "./serialScriptPlayback";
import {
  loadSerialFavorites,
  saveSerialFavorites,
  toggleSerialFavorite,
} from "./serialFavorites";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("serial script playback", () => {
  it("drops the shebang and trailing blank lines, one step per line", () => {
    const steps = serialScriptSteps(
      { script: "#!/bin/bash\nenable\nshow version\n\n" },
      25,
    );
    expect(steps).toEqual([
      { text: "enable\n", delayMs: 25 },
      { text: "show version\n", delayMs: 25 },
    ]);
    expect(serialPlaybackPreview(steps)).toBe("enable\nshow version\n");
  });

  it("maps macro steps and honors sendNewline and bounded delays", () => {
    expect(
      serialMacroSteps({
        steps: [
          { command: "AT", delayMs: 500, sendNewline: true },
          { command: "+++", delayMs: 99_999_999, sendNewline: false },
        ],
      }),
    ).toEqual([
      { text: "AT\n", delayMs: 500 },
      { text: "+++", delayMs: 60_000 },
    ]);
  });

  it("plays in order and stops on abort before the next step", async () => {
    const controller = new AbortController();
    const sent: string[] = [];
    const result = await playSerialSteps(
      [
        { text: "a\n", delayMs: 0 },
        { text: "b\n", delayMs: 0 },
        { text: "c\n", delayMs: 0 },
      ],
      async (text) => {
        sent.push(text);
        if (text === "b\n") controller.abort();
      },
      controller.signal,
    );
    expect(sent).toEqual(["a\n", "b\n"]);
    expect(result).toEqual({ sent: 2, total: 3, aborted: true });
  });

  it("propagates a send failure", async () => {
    await expect(
      playSerialSteps(
        [{ text: "x", delayMs: 0 }],
        vi.fn().mockRejectedValue(new Error("port gone")),
        new AbortController().signal,
      ),
    ).rejects.toThrow("port gone");
  });
});

describe("serial favorites", () => {
  it("stores identifier-only references per bucket and toggles", () => {
    const storage = new MemoryStorage();
    toggleSerialFavorite("conn-1", { kind: "script", id: "s1" }, storage);
    toggleSerialFavorite("quick-connect", { kind: "macro", id: "m1" }, storage);
    expect(loadSerialFavorites("conn-1", storage)).toEqual([
      { kind: "script", id: "s1" },
    ]);
    expect(loadSerialFavorites("quick-connect", storage)).toEqual([
      { kind: "macro", id: "m1" },
    ]);
    toggleSerialFavorite("conn-1", { kind: "script", id: "s1" }, storage);
    expect(loadSerialFavorites("conn-1", storage)).toEqual([]);
  });

  it("never persists library bodies or database scopes", () => {
    const storage = new MemoryStorage();
    saveSerialFavorites(
      "c",
      [
        {
          kind: "script",
          id: "s1",
          scope: { kind: "database", databaseId: "db" },
          script: "rm -rf /",
        } as never,
      ],
      storage,
    );
    expect(storage.getItem("sorng.serial.favorites.v1")).not.toContain("rm");
    expect(loadSerialFavorites("c", storage)).toEqual([
      { kind: "script", id: "s1" },
    ]);
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem("sorng.serial.favorites.v1", "{not json");
    expect(loadSerialFavorites("c", storage)).toEqual([]);
    storage.setItem(
      "sorng.serial.favorites.v1",
      JSON.stringify({ c: [{ kind: "evil", id: "x" }] }),
    );
    expect(loadSerialFavorites("c", storage)).toEqual([]);
  });
});
