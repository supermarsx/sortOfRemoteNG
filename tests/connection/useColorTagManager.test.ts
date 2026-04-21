import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock generateId
vi.mock("../../src/utils/core/id", () => ({
  generateId: () => "mock-id-1",
}));

import { useColorTagManager, PREDEFINED_COLORS } from "../../src/hooks/connection/useColorTagManager";

describe("useColorTagManager", () => {
  const mockTags = {
    "tag-1": { id: "tag-1", name: "Server", color: "#ef4444", global: true },
    "tag-2": { id: "tag-2", name: "Client", color: "#3b82f6", global: false },
  };

  it("returns expected shape", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    expect(result.current.handleAddTag).toBeTypeOf("function");
    expect(result.current.handleEditTag).toBeTypeOf("function");
    expect(result.current.handleUpdateTag).toBeTypeOf("function");
    expect(result.current.handleDeleteTag).toBeTypeOf("function");
    expect(result.current.showAddForm).toBe(false);
    expect(result.current.editingTag).toBeNull();
  });

  it("adds a new tag via handleAddTag", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    // Set tag name first
    act(() => {
      result.current.setNewTag({ name: "Network", color: "#10b981", global: true });
    });

    act(() => {
      result.current.handleAddTag();
    });

    expect(onUpdate).toHaveBeenCalledWith({
      ...mockTags,
      "mock-id-1": {
        id: "mock-id-1",
        name: "Network",
        color: "#10b981",
        global: true,
      },
    });
  });

  it("does not add tag with empty name", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    act(() => {
      result.current.setNewTag({ name: "", color: "#ef4444", global: true });
    });
    act(() => {
      result.current.handleAddTag();
    });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("sets editing tag via handleEditTag", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    act(() => {
      result.current.handleEditTag(mockTags["tag-1"]);
    });

    expect(result.current.editingTag).toEqual(mockTags["tag-1"]);
  });

  it("updates a tag via handleUpdateTag", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    act(() => {
      result.current.handleEditTag(mockTags["tag-1"]);
    });

    act(() => {
      result.current.setEditingTag({
        ...mockTags["tag-1"],
        name: "Updated Server",
      });
    });

    act(() => {
      result.current.handleUpdateTag();
    });

    expect(onUpdate).toHaveBeenCalledWith({
      ...mockTags,
      "tag-1": { ...mockTags["tag-1"], name: "Updated Server" },
    });
  });

  it("deletes a tag via handleDeleteTag", () => {
    // Mock confirm
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    act(() => {
      result.current.handleDeleteTag("tag-1");
    });

    expect(onUpdate).toHaveBeenCalledWith({
      "tag-2": mockTags["tag-2"],
    });
  });

  it("does not delete tag when confirm is cancelled", () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(false);

    const onUpdate = vi.fn();
    const { result } = renderHook(() => useColorTagManager(mockTags, onUpdate));

    act(() => {
      result.current.handleDeleteTag("tag-1");
    });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  describe("PREDEFINED_COLORS", () => {
    it("exports 20 predefined colors", () => {
      expect(PREDEFINED_COLORS).toHaveLength(20);
    });

    it("all colors are valid hex", () => {
      for (const color of PREDEFINED_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });
});
