import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OriginBrowserSecurityControl from "../../src/components/protocol/webBrowser/OriginBrowserSecurityControl";
import {
  useOriginBrowserSecurity,
  websiteSecurityOrigin,
  type SecurityTransport,
} from "../../src/hooks/protocol/useOriginBrowserSecurity";
import type { OriginBrowserSnapshot } from "../../src/types/protocols/originBrowser";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const identity = {
  ownerDatabaseId: "db",
  connectionId: "conn",
  sessionId: "session",
  attemptId: "attempt-a",
};
const page = (
  url = "https://10.15.27.1/index.php?secret=PRIVATE",
  sequence = 3,
): OriginBrowserSnapshot => ({
  identity,
  sequence,
  phase: "attached",
  currentUrl: url,
  displayUrl: "https://saved.invalid",
  title: "pfSense",
  loading: false,
  canGoBack: false,
  canGoForward: false,
});
const observation = {
  systemCaValid: false,
  reviewed: true,
  observedAt: "2026-11-01T12:00:00Z",
  tlsVersion: "TLS 1.3",
  cipherSuite: "TLS_AES_256_GCM_SHA384",
  source: "upstream-handshake",
  chain: [
    {
      subject: "CN=pfSense",
      issuer: "CN=Local administrator",
      fingerprint: "ab".repeat(32),
      validFrom: "2025-01-01T00:00:00Z",
      validTo: "2026-01-01T00:00:00Z",
    },
  ],
};
function props(
  snapshot = page(),
  transport: SecurityTransport = async (request) => ({
    ...request,
    observation,
  }),
) {
  return {
    snapshot,
    transport,
    eligible: true,
    scope: "owner-a",
    assertOwner: vi.fn(),
    onOverlayChange: vi.fn(),
    onOpenTrustCenter: vi.fn(),
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("native website security popup", () => {
  it("opens from a neutral toolbar gesture, displays the exact upstream identity and closes before Trust Center", async () => {
    const transport = vi.fn<SecurityTransport>(async (request) => ({
      ...request,
      observation,
    }));
    const p = props(page(), transport);
    const view = render(<OriginBrowserSecurityControl {...p} />);
    expect(transport).not.toHaveBeenCalled();
    const trigger = view.getByRole("button", { name: "Security information" });
    expect(trigger).toHaveAttribute("data-tooltip", "Security information");
    expect(trigger).not.toHaveAttribute("title");
    fireEvent.click(trigger);
    await view.findByText("HTTPS · website certificate observed");
    expect(p.assertOwner).toHaveBeenCalled();
    expect(
      await view.findByRole("region", { name: "Website security information" }),
    ).toBeTruthy();
    expect(view.getByText("https://10.15.27.1")).toBeTruthy();
    expect(view.queryByText(/PRIVATE|saved.invalid/)).toBeNull();
    expect(view.getByText(observation.chain[0].fingerprint)).toBeTruthy();
    expect(view.getByText(/Certificate expired/)).toBeTruthy();
    expect(
      view.getByText("Did not pass on the observed connection"),
    ).toBeTruthy();
    expect(view.getByText("TLS 1.3")).toBeTruthy();
    expect(view.getByText("TLS_AES_256_GCM_SHA384")).toBeTruthy();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(view.getByRole("button", { name: "Open Trust Center" }));
    expect(p.onOpenTrustCenter).toHaveBeenCalledOnce();
    expect(view.queryByRole("region")).toBeNull();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
  });
  it("does not fabricate trust when no observed certificate is available", async () => {
    const view = render(
      <OriginBrowserSecurityControl
        {...props(page(), async (request) => ({
          ...request,
          observation: null,
        }))}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByText("HTTPS · certificate evidence unavailable");
    expect(
      view.queryByText(
        /Secure connection|verified certificate|System certificate verification/i,
      ),
    ).toBeNull();
    expect(
      view.getByText(/No admitted upstream certificate was captured/),
    ).toBeTruthy();
  });
  it("shows HTTP encryption warning without requesting TLS or making a network probe", async () => {
    const transport = vi.fn<SecurityTransport>();
    const view = render(
      <OriginBrowserSecurityControl
        {...props(page("http://site.test"), transport)}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    expect(view.getByText("Not encrypted (HTTP)")).toBeTruthy();
    expect(transport).not.toHaveBeenCalled();
  });
  it("refreshes the current site's read-only security receipt", async () => {
    const transport = vi
      .fn<SecurityTransport>()
      .mockImplementationOnce(async (request) => ({
        ...request,
        observation: null,
      }))
      .mockImplementation(async (request) => ({ ...request, observation }));
    const view = render(
      <OriginBrowserSecurityControl {...props(page(), transport)} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByText("HTTPS · certificate evidence unavailable");
    fireEvent.click(
      await view.findByRole("button", { name: "Refresh security information" }),
    );
    await view.findByText("TLS_AES_256_GCM_SHA384");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][0]).toEqual(transport.mock.calls[1][0]);
  });
  it("reads the selected child view and closes its panel when the selection changes", async () => {
    const transport = vi.fn<SecurityTransport>(async (request) => ({
      ...request,
      observation,
    }));
    const p = props(page(), transport);
    const view = render(
      <OriginBrowserSecurityControl {...p} viewId="child-one" />,
    );
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByText("TLS 1.3");
    expect(transport.mock.calls[0][0].viewId).toBe("child-one");
    view.rerender(<OriginBrowserSecurityControl {...p} viewId="child-two" />);
    expect(view.queryByRole("region")).toBeNull();
  });
  it("shows browser-captured TLS details without inventing review history", async () => {
    const view = render(
      <OriginBrowserSecurityControl
        {...props(page(), async (request) => ({
          ...request,
          observation: {
            ...observation,
            source: "browser-navigation",
            reviewed: null,
          },
        }))}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByText("Review history not reported for this navigation");
    expect(view.getByText("TLS 1.3")).toBeTruthy();
    expect(
      view.getByText("Captured from this page’s native browser navigation."),
    ).toBeTruthy();
  });
  it("dismisses on cross-origin redirect or ownership loss and releases the overlay", async () => {
    const p = props();
    const view = render(<OriginBrowserSecurityControl {...p} />);
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByText("HTTPS · website certificate observed");
    view.rerender(
      <OriginBrowserSecurityControl
        {...p}
        snapshot={page("https://other.test", 4)}
      />,
    );
    expect(view.queryByRole("region")).toBeNull();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(view.getByRole("button", { name: "Security information" }));
    await view.findByRole("region");
    view.rerender(<OriginBrowserSecurityControl {...p} eligible={false} />);
    expect(view.queryByRole("region")).toBeNull();
  });
  it("never uses saved or redacted display URLs for current-site evidence", () => {
    expect(
      websiteSecurityOrigin({ ...page(), currentUrl: undefined }),
    ).toBeNull();
    expect(
      websiteSecurityOrigin(page("https://user:secret@site.test")),
    ).toBeNull();
    expect(websiteSecurityOrigin({ ...page(), phase: "failed" })).toBeNull();
  });
});

describe("native certificate receipt fencing", () => {
  it("keeps certificate details while pending TLS metadata finishes", async () => {
    vi.useFakeTimers();
    const snapshot = page();
    const transport = vi
      .fn<SecurityTransport>()
      .mockImplementationOnce(async (request) => ({
        ...request,
        observation: { ...observation, cipherSuite: null },
        availability: "pending",
      }))
      .mockImplementation(async (request) => ({
        ...request,
        observation,
        availability: "available",
      }));
    const { result } = renderHook(() =>
      useOriginBrowserSecurity(snapshot, transport),
    );
    await act(async () => {});
    expect(result.current.observation?.chain).toEqual(observation.chain);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.observation?.cipherSuite).toBe(
      observation.cipherSuite,
    );
    expect(result.current.loading).toBe(false);
  });
  it("waits for pending handshake publication without any separate network probe", async () => {
    vi.useFakeTimers();
    const snapshot = page();
    const transport = vi
      .fn<SecurityTransport>()
      .mockImplementationOnce(async (request) => ({
        ...request,
        observation: null,
        availability: "pending",
      }))
      .mockImplementation(async (request) => ({
        ...request,
        observation,
        availability: "available",
      }));
    const { result, unmount } = renderHook(() =>
      useOriginBrowserSecurity(snapshot, transport),
    );
    await act(async () => {});
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.observation).toEqual(observation);
    expect(result.current.loading).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
    unmount();
  });
  it("cancels pending reads on owner/view disposal and bounds retries", async () => {
    vi.useFakeTimers();
    const snapshot = page();
    const transport = vi.fn<SecurityTransport>(async (request) => ({
      ...request,
      observation: null,
      availability: "pending",
    }));
    const first = renderHook(() =>
      useOriginBrowserSecurity(snapshot, transport),
    );
    await act(async () => {});
    first.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockClear();
    const second = renderHook(() =>
      useOriginBrowserSecurity(snapshot, transport),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(transport).toHaveBeenCalledTimes(8);
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.observation).toBeNull();
  });
  it("drops a late old-origin reply across redirects, including return to the same origin", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const transport = vi
      .fn<SecurityTransport>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { result, rerender } = renderHook(
      ({ snapshot }) => useOriginBrowserSecurity(snapshot, transport),
      { initialProps: { snapshot: page() } },
    );
    rerender({ snapshot: page("https://other.test", 4) });
    rerender({ snapshot: page("https://10.15.27.1", 5) });
    await act(async () =>
      first.resolve({
        identity,
        sequence: 3,
        origin: "https://10.15.27.1",
        observation,
      }),
    );
    expect(result.current.observation).toBeNull();
    await act(async () =>
      third.resolve({
        identity,
        sequence: 5,
        origin: "https://10.15.27.1",
        observation,
      }),
    );
    await waitFor(() =>
      expect(result.current.observation).toEqual(observation),
    );
  });
  it.each(["identity", "origin", "sequence", "viewId", "malformed"])(
    "rejects mismatched %s evidence",
    async (field) => {
      const transport: SecurityTransport = async (request) => ({
        ...request,
        observation,
        ...(field === "identity"
          ? { identity: { ...identity, attemptId: "other" } }
          : field === "origin"
            ? { origin: "https://other.test" }
            : field === "sequence"
              ? { sequence: 2 }
              : field === "viewId"
                ? { viewId: "other-child" }
                : {
                    observation: {
                      ...observation,
                      chain: [{ ...observation.chain[0], fingerprint: "bad" }],
                    },
                  }),
      });
      const snapshot = page();
      const { result } = renderHook(() =>
        useOriginBrowserSecurity(snapshot, transport),
      );
      await waitFor(() => expect(result.current.unavailable).toBe(true));
      expect(result.current.observation).toBeNull();
    },
  );
});
