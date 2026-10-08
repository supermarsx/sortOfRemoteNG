import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useOriginFind,
  validOriginFindText,
  type OriginFindOptions,
} from "../../src/hooks/protocol/useOriginFind";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides: Partial<OriginFindOptions> = {}) {
  const controls = {
    find: vi.fn().mockResolvedValue(true),
    stopFind: vi.fn().mockResolvedValue(true),
  };
  let options: OriginFindOptions = {
    controls,
    enabled: true,
    scopeKey: "db:connection:session:attempt:root",
    documentKey: "https://example.test/",
    loading: false,
    ...overrides,
  };
  const hook = renderHook((props) => useOriginFind(props), {
    initialProps: options,
  });
  return {
    ...hook,
    controls,
    update(patch: Partial<OriginFindOptions>) {
      options = { ...options, ...patch };
      hook.rerender(options);
    },
  };
}
const settle = () => act(async () => {});
const debounce = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
const requestId = (f: ReturnType<typeof fixture>) =>
  f.controls.find.mock.calls[
    f.controls.find.mock.calls.length - 1
  ][4] as string;
function query(f: ReturnType<typeof fixture>, text = "example") {
  act(() => {
    f.result.current.show();
    f.result.current.setText(text);
  });
}

describe("native find state and view fences", () => {
  it("debounces edits and sends a bounded correlation token without trimming search text", async () => {
    const f = fixture();
    query(f, "ex");
    act(() => f.result.current.setText(" example "));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(f.controls.find).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(f.controls.find).toHaveBeenCalledExactlyOnceWith(
      " example ",
      true,
      false,
      false,
      expect.any(String),
    );
    expect(requestId(f)).toMatch(/^[\da-f-]{36}$/);
    expect(f.result.current.submitted).toBe(true);
  });

  it("continues the same query in either direction and restarts when case changes", async () => {
    const f = fixture();
    query(f);
    await debounce();
    const first = requestId(f);
    await act(async () => f.result.current.search(false));
    expect(f.controls.find).toHaveBeenLastCalledWith(
      "example",
      false,
      false,
      true,
      expect.any(String),
    );
    expect(requestId(f)).not.toBe(first);
    act(() => f.result.current.setMatchCase(true));
    await debounce();
    expect(f.controls.find).toHaveBeenLastCalledWith(
      "example",
      true,
      true,
      false,
      expect.any(String),
    );
  });

  it("keeps edits responsive and coalesces to the latest query while native is pending", async () => {
    const f = fixture(),
      pending = deferred();
    f.controls.find.mockReturnValueOnce(pending.promise);
    query(f, "old");
    await debounce();
    const stale = requestId(f);
    act(() => f.result.current.setText("intermediate"));
    await debounce();
    act(() => f.result.current.setText("latest"));
    await debounce();
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    expect(f.controls.find).toHaveBeenCalledTimes(2);
    expect(f.controls.find).toHaveBeenLastCalledWith(
      "latest",
      true,
      false,
      false,
      expect.any(String),
    );
    f.update({
      result: {
        requestId: stale,
        activeMatchOrdinal: 9,
        numberOfMatches: 9,
        finalUpdate: true,
      },
    });
    expect(f.result.current.result).toBeNull();
  });

  it("closes immediately and clears after an in-flight find without reopening on its result", async () => {
    const f = fixture(),
      pending = deferred();
    f.controls.find.mockReturnValueOnce(pending.promise);
    query(f);
    await debounce();
    const stale = requestId(f);
    act(() => f.result.current.close());
    expect(f.result.current.open).toBe(false);
    expect(f.result.current.text).toBe("");
    expect(f.controls.stopFind).not.toHaveBeenCalled();
    await act(async () => pending.resolve(true));
    expect(f.controls.stopFind).toHaveBeenCalledExactlyOnceWith(true);
    f.update({
      result: {
        requestId: stale,
        activeMatchOrdinal: 1,
        numberOfMatches: 2,
        finalUpdate: true,
      },
    });
    expect(f.result.current.result).toBeNull();
    expect(f.result.current.open).toBe(false);
  });

  it("clears highlights on empty input and never searches empty or invalid text", async () => {
    const f = fixture();
    query(f);
    await debounce();
    act(() => f.result.current.setText(""));
    await settle();
    expect(f.controls.stopFind).toHaveBeenCalledWith(true);
    act(() => f.result.current.setText("é".repeat(513)));
    await debounce();
    act(() => f.result.current.search());
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    expect(f.result.current.valid).toBe(false);
  });

  it("accepts only matching, well-formed native counts including partial updates", async () => {
    const f = fixture();
    query(f);
    await debounce();
    const token = requestId(f);
    for (const [ordinal, total] of [
      [-1, 3],
      [4, 3],
      [1.1, 3],
      [0, -1],
      [0, NaN],
    ]) {
      f.update({
        result: {
          requestId: token,
          activeMatchOrdinal: ordinal,
          numberOfMatches: total,
          finalUpdate: true,
        },
      });
      expect(f.result.current.result).toBeNull();
    }
    f.update({
      result: {
        requestId: token,
        activeMatchOrdinal: 0,
        numberOfMatches: 3,
        finalUpdate: false,
      },
    });
    expect(f.result.current.result?.finalUpdate).toBe(false);
    f.update({
      result: {
        requestId: token,
        activeMatchOrdinal: 2,
        numberOfMatches: 3,
        finalUpdate: true,
      },
    });
    expect(f.result.current.result?.activeMatchOrdinal).toBe(2);
    f.update({
      result: {
        requestId: token,
        activeMatchOrdinal: 0,
        numberOfMatches: 1,
        finalUpdate: false,
      },
    });
    expect(f.result.current.result?.activeMatchOrdinal).toBe(2);
    expect(f.result.current.result?.numberOfMatches).toBe(3);
    act(() => f.result.current.setText("replacement"));
    expect(f.result.current.result).toBeNull();
  });

  it("never retargets delayed cleanup or results after owner/view replacement, including ABA", async () => {
    const f = fixture(),
      pending = deferred();
    f.controls.find.mockReturnValueOnce(pending.promise);
    query(f);
    await debounce();
    const stale = requestId(f);
    act(() => f.result.current.close());
    f.update({ scopeKey: "db:connection:session:attempt:popup" });
    f.update({ scopeKey: "db:connection:session:attempt:root" });
    await act(async () => pending.resolve(true));
    f.update({
      result: {
        requestId: stale,
        activeMatchOrdinal: 1,
        numberOfMatches: 2,
        finalUpdate: true,
      },
    });
    expect(f.controls.stopFind).not.toHaveBeenCalled();
    expect(f.result.current.open).toBe(false);
    expect(f.result.current.result).toBeNull();
  });

  it("invalidates navigation counts and starts a fresh search only after loading finishes", async () => {
    const f = fixture();
    query(f);
    await debounce();
    f.update({ loading: true, documentKey: "https://example.test/next" });
    await debounce();
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    f.update({ loading: false });
    await debounce();
    expect(f.controls.find).toHaveBeenLastCalledWith(
      "example",
      true,
      false,
      false,
      expect.any(String),
    );
    expect(f.controls.find).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch while disabled or resurrect old feedback after reactivation", async () => {
    const f = fixture();
    query(f);
    await debounce();
    const old = requestId(f);
    f.update({ enabled: false });
    act(() => f.result.current.search());
    await debounce();
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    f.update({ enabled: true });
    await debounce();
    f.update({
      result: {
        requestId: old,
        activeMatchOrdinal: 1,
        numberOfMatches: 8,
        finalUpdate: true,
      },
    });
    expect(f.result.current.result).toBeNull();
    expect(f.controls.find).toHaveBeenCalledTimes(2);
  });

  it("waits for IME composition to finish and cancels debounce on unmount", async () => {
    const f = fixture();
    act(() => {
      f.result.current.show();
      f.result.current.setComposing(true);
      f.result.current.setText("検索");
    });
    await debounce();
    act(() => f.result.current.search());
    expect(f.controls.find).not.toHaveBeenCalled();
    act(() => f.result.current.setComposing(false));
    await debounce();
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    act(() => f.result.current.setText("never sent"));
    f.unmount();
    await debounce();
    expect(f.controls.find).toHaveBeenCalledTimes(1);
    expect(f.controls.stopFind).not.toHaveBeenCalled();
  });

  it("handles rejected IPC with fixed text and permits an explicit retry", async () => {
    const f = fixture();
    f.controls.find.mockRejectedValueOnce(new Error("SECRET PAGE QUERY"));
    query(f);
    await debounce();
    expect(f.result.current.error).not.toContain("SECRET");
    expect(f.result.current.pending).toBe(false);
    expect(f.result.current.submitted).toBe(false);
    await act(async () => f.result.current.search());
    expect(f.result.current.error).toBeNull();
    expect(f.result.current.submitted).toBe(true);
  });

  it("defers a menu open request until eligibility, consumes it once, and supports refocus", () => {
    const f = fixture({ enabled: false, openRequest: 1 });
    expect(f.result.current.open).toBe(false);
    f.update({ enabled: true });
    expect(f.result.current.open).toBe(true);
    act(() => f.result.current.close());
    f.update({ enabled: false });
    f.update({ enabled: true });
    expect(f.result.current.open).toBe(false);
    f.update({ openRequest: 2 });
    expect(f.result.current.open).toBe(true);
    const focus = f.result.current.focusRevision;
    f.update({ openRequest: 3 });
    expect(f.result.current.focusRevision).toBeGreaterThan(focus);
  });

  it("validates UTF-8 bytes rather than character count", () => {
    expect(validOriginFindText("é".repeat(512))).toBe(true);
    expect(validOriginFindText("é".repeat(513))).toBe(false);
    expect(validOriginFindText("a\0b")).toBe(false);
    expect(validOriginFindText("")).toBe(false);
    expect(validOriginFindText(" ")).toBe(true);
  });
});
