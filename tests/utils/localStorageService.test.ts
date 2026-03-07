import { describe, it, expect } from "vitest";
import { LocalStorageService } from "../../src/utils/storage/localStorageService";

describe("LocalStorageService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("setItem / getItem", () => {
    it("stores and retrieves a string", () => {
      LocalStorageService.setItem("key1", "hello");
      expect(LocalStorageService.getItem("key1")).toBe("hello");
    });

    it("stores and retrieves an object", () => {
      const obj = { name: "test", count: 42 };
      LocalStorageService.setItem("key2", obj);
      expect(LocalStorageService.getItem("key2")).toEqual(obj);
    });

    it("stores and retrieves an array", () => {
      const arr = [1, 2, 3];
      LocalStorageService.setItem("key3", arr);
      expect(LocalStorageService.getItem("key3")).toEqual(arr);
    });

    it("returns null for missing keys", () => {
      expect(LocalStorageService.getItem("nonexistent")).toBeNull();
    });
  });

  describe("removeItem", () => {
    it("removes stored items", () => {
      LocalStorageService.setItem("key1", "val");
      LocalStorageService.removeItem("key1");
      expect(LocalStorageService.getItem("key1")).toBeNull();
    });

    it("does not throw for missing keys", () => {
      expect(() => LocalStorageService.removeItem("nonexistent")).not.toThrow();
    });
  });

  describe("error handling", () => {
    it("returns null when stored value is invalid JSON", () => {
      localStorage.setItem("bad", "notjson{{{");
      expect(LocalStorageService.getItem("bad")).toBeNull();
    });
  });
});
