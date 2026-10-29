import { afterEach, describe, expect, it, vi } from "vitest";
import { reclaimShellFocus } from "../../src/utils/window/reclaimShellFocus";

const h = vi.hoisted(() => ({ setFocus: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: h.setFocus }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  h.setFocus.mockReset();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reclaimShellFocus", () => {
  it("moves WebView focus back when a native child holds it", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    h.setFocus.mockResolvedValue(undefined);
    reclaimShellFocus();
    await settle();
    expect(h.setFocus).toHaveBeenCalledOnce();
  });

  it("leaves focus alone when the shell document already has it", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    reclaimShellFocus();
    await settle();
    expect(h.setFocus).not.toHaveBeenCalled();
  });

  it("does not raise a hidden window", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    reclaimShellFocus();
    await settle();
    expect(h.setFocus).not.toHaveBeenCalled();
  });

  it("swallows a refused focus move", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    h.setFocus.mockRejectedValue(new Error("not permitted"));
    expect(() => reclaimShellFocus()).not.toThrow();
    await settle();
    expect(h.setFocus).toHaveBeenCalledOnce();
  });
});
