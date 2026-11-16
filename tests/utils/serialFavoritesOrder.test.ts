import { beforeEach, describe, expect, it } from "vitest";
import {
  loadSerialFavorites,
  reorderSerialFavorites,
  saveSerialFavorites,
  toggleSerialFavorite,
} from "../../src/utils/serial/serialFavorites";
import { quickActionReferenceKey as key } from "../../src/utils/connection/sessionQuickActions";

const ref = (id: string) => ({ kind: "script" as const, id });

describe("serial favorites order persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists a reorder and survives a fresh read (restart)", () => {
    for (const id of ["a", "b", "c"]) toggleSerialFavorite("conn", ref(id));
    reorderSerialFavorites("conn", [
      key(ref("c")),
      key(ref("a")),
      key(ref("b")),
    ]);
    expect(loadSerialFavorites("conn").map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("appends new bookmarks at the end and drops removed ones in place", () => {
    for (const id of ["a", "b"]) toggleSerialFavorite("conn", ref(id));
    reorderSerialFavorites("conn", [key(ref("b")), key(ref("a"))]);
    toggleSerialFavorite("conn", ref("z"));
    expect(loadSerialFavorites("conn").map((i) => i.id)).toEqual([
      "b",
      "a",
      "z",
    ]);
    toggleSerialFavorite("conn", ref("b"));
    expect(loadSerialFavorites("conn").map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("prunes unknown ids and keeps entries missing from the order", () => {
    saveSerialFavorites("conn", [ref("a"), ref("b")]);
    reorderSerialFavorites("conn", [key(ref("gone")), key(ref("b"))]);
    expect(loadSerialFavorites("conn").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("does not write when the order is unchanged", () => {
    saveSerialFavorites("conn", [ref("a"), ref("b")]);
    const before = window.localStorage.getItem("sorng.serial.favorites.v1");
    const same = loadSerialFavorites("conn");
    expect(reorderSerialFavorites("conn", [key(ref("a")), key(ref("b"))])).toBe(
      same,
    );
    expect(window.localStorage.getItem("sorng.serial.favorites.v1")).toBe(
      before,
    );
  });
});
