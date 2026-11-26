import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = readFileSync(
  "src-tauri/crates/sorng-protocols/src/internal_page.js",
  "utf8",
);
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
function page(clipboard?: { writeText: (text: string) => Promise<void> }) {
  document.body.innerHTML = `<button id="retry">Retry</button><button id="copy-error">Copy error</button><button id="copy-full">Copy full page</button><p id="action-status"></p><pre id="short-report" hidden>Error code: tls-test</pre><details><pre id="full-report" hidden>Error code: tls-test\nHidden trace: frame 1</pre></details>`;
  const assign = vi.fn();
  new Function("window", "document", "navigator", script)(
    { location: { href: "https://device.test/page", assign } },
    document,
    { clipboard },
  );
  const click = (id: string) => document.getElementById(id)!.click();
  return { assign, click };
}
describe("internal proxy page actions", () => {
  it("copies a short error and the full report including collapsed trace", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const p = page({ writeText });
    p.click("copy-error");
    await vi.waitFor(() =>
      expect(document.getElementById("action-status")!.textContent).toBe(
        "Error copied",
      ),
    );
    expect(writeText).toHaveBeenLastCalledWith("Error code: tls-test");
    p.click("copy-full");
    await vi.waitFor(() =>
      expect(document.getElementById("action-status")!.textContent).toBe(
        "Full report copied",
      ),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      "Error code: tls-test\nHidden trace: frame 1",
    );
  });
  it("retries with a fresh URL navigation", () => {
    const p = page();
    p.click("retry");
    expect(p.assign).toHaveBeenCalledExactlyOnceWith(
      "https://device.test/page",
    );
  });
  it("falls back to native selection copy when Clipboard API is unavailable", async () => {
    let selected = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        selected = document.querySelector("textarea")!.value;
        return true;
      }),
    });
    page().click("copy-full");
    await vi.waitFor(() => expect(selected).toContain("Hidden trace: frame 1"));
    expect(document.querySelector("textarea")).toBeNull();
  });
});
