import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineRename } from "../../src/hooks/window/useInlineRename";

describe("useInlineRename", () => {
  it("returns expected initial state", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    expect(result.current.isRenaming).toBe(false);
    expect(result.current.draft).toBe("hello");
  });

  it("startRename sets isRenaming to true and resets draft", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.setDraft("changed");
    });
    act(() => {
      result.current.startRename();
    });

    expect(result.current.isRenaming).toBe(true);
    expect(result.current.draft).toBe("hello");
  });

  it("commitRename calls onCommit with trimmed draft", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.startRename();
    });
    act(() => {
      result.current.setDraft("  new name  ");
    });
    act(() => {
      result.current.commitRename();
    });

    expect(onCommit).toHaveBeenCalledWith("new name");
    expect(result.current.isRenaming).toBe(false);
  });

  it("commitRename does not call onCommit with empty draft", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.startRename();
    });
    act(() => {
      result.current.setDraft("   ");
    });
    act(() => {
      result.current.commitRename();
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.isRenaming).toBe(false);
  });

  it("cancelRename resets draft and stops renaming", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.startRename();
    });
    act(() => {
      result.current.setDraft("changed");
    });
    act(() => {
      result.current.cancelRename();
    });

    expect(result.current.isRenaming).toBe(false);
    expect(result.current.draft).toBe("hello");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("handleKeyDown Enter commits", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.startRename();
    });
    act(() => {
      result.current.setDraft("new");
    });
    act(() => {
      result.current.handleKeyDown({ key: "Enter" } as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(onCommit).toHaveBeenCalledWith("new");
    expect(result.current.isRenaming).toBe(false);
  });

  it("handleKeyDown Escape cancels", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineRename("hello", onCommit));

    act(() => {
      result.current.startRename();
    });
    act(() => {
      result.current.setDraft("changed");
    });
    act(() => {
      result.current.handleKeyDown({ key: "Escape" } as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.isRenaming).toBe(false);
    expect(result.current.draft).toBe("hello");
  });
});
