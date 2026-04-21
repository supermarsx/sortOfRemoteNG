import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadJson, saveJson } from "../../src/utils/storage/fileStorage";
import fs from "fs";
import path from "path";

vi.mock("fs", () => {
  const actual = {
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  };
  return { default: actual, ...actual };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadJson", () => {
  it("returns parsed JSON from file", async () => {
    const data = { name: "test", count: 42 };
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(data));

    const result = await loadJson("/some/file.json", {});
    expect(result).toEqual(data);
    expect(fs.promises.readFile).toHaveBeenCalledWith(
      path.resolve("/some/file.json"),
      "utf8",
    );
  });

  it("returns default value when file does not exist", async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      new Error("ENOENT: no such file"),
    );

    const fallback = { items: [] };
    const result = await loadJson("/missing.json", fallback);
    expect(result).toEqual(fallback);
  });

  it("returns default value on invalid JSON", async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue("not-json{{{");

    const fallback = { ok: false };
    const result = await loadJson("/bad.json", fallback);
    expect(result).toEqual(fallback);
  });

  it("revives ISO date strings into Date objects", async () => {
    const raw = JSON.stringify({ ts: "2024-06-15T10:30:00.000Z" });
    vi.mocked(fs.promises.readFile).mockResolvedValue(raw);

    const result = await loadJson<{ ts: Date }>("/dates.json", { ts: new Date(0) });
    expect(result.ts).toBeInstanceOf(Date);
    expect(result.ts.getFullYear()).toBe(2024);
  });

  it("leaves non-date strings as strings", async () => {
    const raw = JSON.stringify({ name: "hello world" });
    vi.mocked(fs.promises.readFile).mockResolvedValue(raw);

    const result = await loadJson<{ name: string }>("/str.json", { name: "" });
    expect(typeof result.name).toBe("string");
    expect(result.name).toBe("hello world");
  });
});

describe("saveJson", () => {
  it("creates parent directory recursively and writes file", async () => {
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

    const data = { key: "value" };
    await saveJson("/some/nested/dir/file.json", data);

    const fullPath = path.resolve("/some/nested/dir/file.json");
    expect(fs.promises.mkdir).toHaveBeenCalledWith(
      path.dirname(fullPath),
      { recursive: true },
    );
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      fullPath,
      JSON.stringify(data, null, 2),
      "utf8",
    );
  });

  it("writes pretty-formatted JSON (2-space indent)", async () => {
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

    const data = { a: 1, b: { c: 2 } };
    await saveJson("/out.json", data);

    const written = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
    expect(written).toBe(JSON.stringify(data, null, 2));
    expect(written).toContain("\n"); // multi-line
  });

  it("propagates write errors", async () => {
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockRejectedValue(
      new Error("EACCES: permission denied"),
    );

    await expect(saveJson("/readonly/file.json", {})).rejects.toThrow(
      "EACCES",
    );
  });
});
