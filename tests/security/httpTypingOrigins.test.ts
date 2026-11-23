import { describe, expect, it, vi } from "vitest";
import {
  MAX_HTTP_TYPING_ORIGINS,
  httpTypingOrigin,
  normalizeHttpTypingOrigins,
  saveHttpTypingOrigin,
  withHttpTypingOrigin,
} from "../../src/utils/connection/httpTypingOrigins";

type Row = { id: string; httpTypingOrigins?: string[] };

describe("HTTP typing origins", () => {
  it("keeps the exact scheme, host and non-default port of an HTTP page", () => {
    expect(httpTypingOrigin("http://device.test:8080/login?q=1#f")).toBe(
      "http://device.test:8080",
    );
    expect(httpTypingOrigin("http://device.test:80/x")).toBe(
      "http://device.test",
    );
    expect(httpTypingOrigin("http://DEVICE.test/x")).toBe("http://device.test");
  });
  it("offers nothing for HTTPS, other schemes, credentials or garbage", () => {
    for (const value of [
      "https://device.test/login",
      "ftp://device.test",
      "about:blank",
      "file:///c:/x.html",
      "http://user:pw@device.test/",
      "not a url",
      "",
      undefined,
      null,
      42,
    ])
      expect(httpTypingOrigin(value)).toBeNull();
  });
  it("normalizes a saved list to exact, unique HTTP origins only", () => {
    expect(
      normalizeHttpTypingOrigins([
        "http://a.test:81",
        "http://a.test:81",
        "http://a.test:81/",
        "http://*.a.test",
        "https://a.test",
        "http://b.test",
        7,
      ]),
    ).toEqual(["http://a.test:81", "http://b.test"]);
    expect(normalizeHttpTypingOrigins("http://a.test")).toEqual([]);
    expect(normalizeHttpTypingOrigins(undefined)).toEqual([]);
  });
  it("appends once, never widens and is bounded", () => {
    expect(withHttpTypingOrigin(undefined, "http://a.test:81")).toEqual([
      "http://a.test:81",
    ]);
    expect(
      withHttpTypingOrigin(["http://a.test:81"], "http://a.test:81"),
    ).toEqual(["http://a.test:81"]);
    expect(
      withHttpTypingOrigin(["http://a.test:81"], "http://a.test:82"),
    ).toEqual(["http://a.test:81", "http://a.test:82"]);
    for (const bad of [
      "https://a.test",
      "http://*.a.test",
      "http://a.test/path",
      "a.test",
    ])
      expect(withHttpTypingOrigin([], bad)).toBeNull();
    const full = Array.from(
      { length: MAX_HTTP_TYPING_ORIGINS },
      (_, i) => `http://h${i}.test`,
    );
    expect(withHttpTypingOrigin(full, "http://extra.test")).toBeNull();
  });
});

describe("saving an allowed HTTP typing origin", () => {
  const row: Row = { id: "c1" };
  it("writes the exact origin including its port and changes nothing else", async () => {
    const write = vi.fn(async (_updated: Row) => {});
    await saveHttpTypingOrigin({
      connection: row,
      current: row,
      origin: "http://device.test:8080",
      write,
    });
    expect(write).toHaveBeenCalledExactlyOnceWith({
      id: "c1",
      httpTypingOrigins: ["http://device.test:8080"],
    });
  });
  it("adds to the saved list and never stores a wildcard, HTTPS or path", async () => {
    const saved: Row = { id: "c1", httpTypingOrigins: ["http://one.test"] };
    const write = vi.fn(async (_updated: Row) => {});
    await saveHttpTypingOrigin({
      connection: saved,
      current: saved,
      origin: "http://two.test:9",
      write,
    });
    expect(write.mock.calls[0][0].httpTypingOrigins).toEqual([
      "http://one.test",
      "http://two.test:9",
    ]);
    for (const origin of [
      "https://two.test",
      "http://*.two.test",
      "http://two.test/x",
    ])
      await expect(
        saveHttpTypingOrigin({
          connection: saved,
          current: saved,
          origin,
          write,
        }),
      ).rejects.toThrow();
    expect(write).toHaveBeenCalledOnce();
  });
  it("writes nothing when the saved row changed after review", async () => {
    const write = vi.fn(async (_updated: Row) => {});
    await expect(
      saveHttpTypingOrigin({
        connection: row,
        current: { ...row },
        origin: "http://device.test",
        write,
      }),
    ).rejects.toThrow();
    await expect(
      saveHttpTypingOrigin({
        connection: row,
        current: undefined,
        origin: "http://device.test",
        write,
      }),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it("passes a failed write on to the caller", async () => {
    await expect(
      saveHttpTypingOrigin({
        connection: row,
        current: row,
        origin: "http://device.test",
        write: async () => {
          throw new Error("disk");
        },
      }),
    ).rejects.toThrow("disk");
  });
});
