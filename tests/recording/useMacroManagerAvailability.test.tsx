import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMacroManager } from "../../src/hooks/recording/useMacroManager";
const store = vi.hoisted(() => ({
  loadMacros: vi.fn(),
  loadRecordings: vi.fn(),
  saveMacro: vi.fn(),
  deleteMacro: vi.fn(),
}));
vi.mock("../../src/utils/recording/macroService", () => store);
const macro = {
  id: "retained",
  name: "Retained macro",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  steps: [],
};
beforeEach(() => {
  store.loadMacros.mockReset().mockResolvedValue([macro]);
  store.loadRecordings.mockReset().mockResolvedValue([]);
  store.saveMacro.mockReset();
  store.deleteMacro.mockReset();
});
describe("macro manager durable availability", () => {
  it("reports a protected-store refusal without resetting the library or losing the draft", async () => {
    const view = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(view.result.current.macros).toEqual([macro]));
    act(() => view.result.current.setEditingMacro(macro));
    store.loadMacros.mockRejectedValue(new Error("Locked fixture"));
    await act(() => view.result.current.refresh());
    expect(view.result.current.error).toMatch(/unlock.*not been reset/);
    expect(view.result.current.macros).toEqual([macro]);
    expect(view.result.current.editingMacro).toEqual(macro);
    expect(store.saveMacro).not.toHaveBeenCalled();
  });
  it("keeps a failed save draft and recovers after an explicit retry", async () => {
    const view = renderHook(() => useMacroManager(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    act(() => view.result.current.setEditingMacro(macro));
    store.saveMacro.mockRejectedValueOnce(new Error("Locked"));
    await act(() => view.result.current.handleSaveMacro(macro));
    expect(view.result.current.editingMacro).toEqual(macro);
    expect(view.result.current.error).toContain("draft was retained");
    store.saveMacro.mockResolvedValueOnce(undefined);
    await act(() => view.result.current.handleSaveMacro(macro));
    expect(view.result.current.editingMacro).toBeNull();
    expect(view.result.current.error).toBeNull();
  });
});
