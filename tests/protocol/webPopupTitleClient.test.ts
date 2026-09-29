import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_popup_title_client.js",
  "utf8",
);
const proxy = `http://p${"a".repeat(32)}.localhost:43123`;
const identity = {
  sessionId: "native-proxy",
  documentSequence: 5,
  documentToken: "b".repeat(32),
  navigationToken: null,
};
let post: ReturnType<typeof vi.spyOn>;
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function install(path = "/takecontrol/agent-one") {
  vi.stubGlobal("location", new URL(`${proxy}${path}?auth=secret#secret`));
  window.eval(
    `(function(){var p=${JSON.stringify(identity)};var popupTitleParentSequence=3;${source}})()`,
  );
}
beforeEach(() => {
  document.title = "Tactical RMM";
  post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.title = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Tactical popup title metadata", () => {
  it("reports asynchronous computer titles with document identity but no auth URL", async () => {
    install();
    await tick();
    post.mockClear();
    document.title = "PC-01 - Client - Site | Take Control";
    await tick();
    expect(post).toHaveBeenCalledExactlyOnceWith(
      {
        ...identity,
        type: "proxy_web_popup_title",
        version: 1,
        popupParentSequence: 3,
        title: "PC-01 - Client - Site | Take Control",
        url: `${proxy}/takecontrol/agent-one`,
      },
      "*",
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("secret");
  });

  it("observes only the head and deduplicates updates during remote-screen rendering", async () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    install();
    await tick();
    expect(observe).toHaveBeenCalledExactlyOnceWith(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    post.mockClear();
    for (let index = 0; index < 100; index++) {
      document.body.append(document.createElement("div"));
    }
    document.title = "Tactical RMM";
    await tick();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["/", "/dashboard", "/takecontrol", "/takecontrol/agent/extra"])(
    "does not report other pages: %s",
    async (path) => {
      install(path);
      await tick();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it("bounds titles and ignores a changed route", async () => {
    install();
    await tick();
    post.mockClear();
    document.title = "x".repeat(513);
    await tick();
    expect(post).not.toHaveBeenCalled();
    vi.stubGlobal("location", new URL(`${proxy}/takecontrol/other-agent`));
    document.title = "OTHER-PC - Client - Site | Take Control";
    await tick();
    expect(post).not.toHaveBeenCalled();
  });

  it("disconnects on page exit, including already queued title changes", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    install();
    window.dispatchEvent(new Event("pagehide"));
    document.title = "STALE-PC - Client - Site | Take Control";
    await tick();
    expect(post).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("starts observing when the parser creates a head after document start", async () => {
    const savedHead = document.head;
    savedHead.remove();
    try {
      vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
      install();
      document.documentElement.prepend(savedHead);
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await tick();
      post.mockClear();
      document.title = "LATE-PC - Client - Site | Take Control";
      await tick();
      expect(post).toHaveBeenCalledOnce();
    } finally {
      if (!savedHead.isConnected) document.documentElement.prepend(savedHead);
    }
  });
});
