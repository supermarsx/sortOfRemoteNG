import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWebExternalLinks,
  type ExternalLinkContext,
} from "../../src/hooks/protocol/useWebExternalLinks";
import ExternalLinkReview from "../../src/components/protocol/webBrowser/ExternalLinkReview";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const url = "https://news.example.test/article?q=a%20b&sig=x%2By#part";
let context: ExternalLinkContext | null;
let frame: HTMLIFrameElement;
let databaseGeneration: number;
const getCurrent = () => context;
function report(destinationUrl = url, overrides = {}, event = {}) {
  const doc = context!.document;
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: context!.frame,
        origin: proxy,
        data: {
          type: "sorng_owa_external_link",
          version: 1,
          sessionId: doc.sessionId,
          documentToken: doc.token,
          documentSequence: doc.sequence,
          navigationToken: doc.navigationToken,
          destinationUrl,
          ...overrides,
        },
        ...event,
      }),
    );
  });
}
beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  frame = document.createElement("iframe");
  document.body.append(frame);
  databaseGeneration = 1;
  context = {
    frame: frame.contentWindow!,
    sourceOrigin: "https://mail.example.test",
    captureAccess: vi.fn(() => {
      const captured = databaseGeneration;
      return () => {
        if (captured !== databaseGeneration)
          throw new Error("Revoked database lease");
      };
    }),
    document: {
      sessionId: "owa",
      token: "a".repeat(32),
      sequence: 4,
      navigationToken: null,
      generation: 1,
      url: `${proxy}/owa/`,
    },
  };
});
afterEach(() => {
  cleanup();
  frame.remove();
  vi.restoreAllMocks();
});
describe("trusted application external link review", () => {
  it("opens only the reviewed real URL on an explicit trusted app click, with no credentials or cookies", async () => {
    const { result } = renderHook(() => useWebExternalLinks(getCurrent));
    report();
    expect(result.current.url).toBe(url);
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.open({ isTrusted: false });
    });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.open({ isTrusted: true });
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("open_url_external", {
      url,
    });
    expect(context!.captureAccess).toHaveBeenCalledOnce();
    expect(result.current.url).toBeNull();
  });
  it("does not auto-open or replace an address that is already being reviewed", () => {
    const { result } = renderHook(() => useWebExternalLinks(getCurrent));
    report();
    report("https://swapped.example.test/");
    expect(result.current.url).toBe(url);
    act(() => result.current.cancel());
    expect(result.current.url).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects stale identities, unrelated frames, origins, and unsafe URLs", () => {
    const { result } = renderHook(() => useWebExternalLinks(getCurrent));
    report(url, { documentToken: "stale" });
    report(url, { documentSequence: 5 });
    report(url, { navigationToken: "b".repeat(32) });
    report(url, { sessionId: "other" });
    report(url, {}, { origin: "https://attacker.test" });
    report(url, {}, { source: window });
    for (const unsafe of [
      "javascript:alert(1)",
      "https://user:password@news.example.test",
      `${proxy}/owa/`,
      "https://mail.example.test/owa/?ae=Item",
      "https://news.example.test/?__sorng_generation_v1=secret",
    ])
      report(unsafe);
    expect(result.current.url).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["navigation", "owner", "disabled"])(
    "revokes a pending action after %s changes",
    async (change) => {
      const { result, rerender } = renderHook(() =>
        useWebExternalLinks(getCurrent),
      );
      report();
      const open = result.current.open;
      if (change === "navigation")
        context = {
          ...context!,
          document: { ...context!.document, generation: 2 },
        };
      if (change === "owner") databaseGeneration++;
      if (change === "disabled") context = null;
      rerender();
      await act(async () => {
        await open({ isTrusted: true });
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(result.current.url).toBeNull();
    },
  );
  it("deduplicates the system launch and displays failures without a window.open fallback", async () => {
    let reject!: (reason: Error) => void;
    invoke.mockImplementation(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const fallback = vi.spyOn(window, "open");
    const { result } = renderHook(() => useWebExternalLinks(getCurrent));
    report();
    let opening!: Promise<void>;
    act(() => {
      opening = result.current.open({ isTrusted: true });
    });
    await act(async () => {
      await result.current.open({ isTrusted: true });
    });
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error("OS opener failed"));
      await opening;
    });
    expect(result.current.error).toMatch(/Could not open the system browser/);
    expect(fallback).not.toHaveBeenCalled();
    expect(result.current.url).toBe(url);
  });
  it("renders a destination and explicit button; a synthetic UI event cannot launch it", () => {
    function Harness() {
      const manager = useWebExternalLinks(getCurrent);
      return <ExternalLinkReview manager={manager} />;
    }
    render(<Harness />);
    report();
    expect(
      screen.getByRole("dialog", { name: "Open email link" }),
    ).toHaveTextContent(url);
    expect(
      screen.getByText(/uses its own network and proxy settings/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "Open email link" }),
    ).toBeNull();
  });
});
