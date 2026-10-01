import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ECP_LOGIN_STOPPED,
  useEcpLoginNotice,
} from "../../src/hooks/protocol/useEcpLoginNotice";
import SecurityInfoBar from "../../src/components/protocol/webBrowser/SecurityInfoBar";
import type { WebBrowserMgr } from "../../src/hooks/protocol/useWebBrowser";

afterEach(cleanup);
describe("ECP timeout advisory", () => {
  it("shows neutral guidance for the current document and expires on navigation", () => {
    let document: object | null = {};
    const view = renderHook(() => useEcpLoginNotice(() => document));
    expect(view.result.current.presentation).toBeNull();
    act(() =>
      view.result.current.receive({
        ok: false,
        reason: "form-not-found-timeout",
      }),
    );
    expect(view.result.current.presentation).toBe(ECP_LOGIN_STOPPED);
    document = {};
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
    act(() =>
      view.result.current.receive({
        ok: false,
        reason: "form-not-found-timeout",
      }),
    );
    expect(view.result.current.presentation).toBe(ECP_LOGIN_STOPPED);
    document = null;
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
  });
  it("ignores disabled, manual, other-profile and revoked contexts", () => {
    let document: object | null = null;
    const view = renderHook(() => useEcpLoginNotice(() => document));
    act(() =>
      view.result.current.receive({
        ok: false,
        reason: "form-not-found-timeout",
      }),
    );
    document = {};
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
  });
  it.each([
    null,
    {},
    { ok: true, reason: "form-not-found-timeout" },
    { ok: false, reason: "submitted" },
    { ok: false, reason: "manual-mfa-required" },
    { ok: false, reason: "reviewed-login-timeout" },
  ])("does not infer auth or MFA from %j", (result) => {
    const document = {};
    const view = renderHook(() => useEcpLoginNotice(() => document));
    act(() => view.result.current.receive(result));
    expect(view.result.current.presentation).toBeNull();
  });
  it("renders an accessible advisory without replacing Synology status or adding retry behavior", () => {
    const refresh = vi.fn();
    const mgr = {
      isSecure: true,
      session: { hostname: "mail.example.test" },
      automaticLoginNotice: ECP_LOGIN_STOPPED,
      deferredLogin: {
        text: "Auto-fill: waiting for DSM",
        detail: "Existing Synology status",
        muted: true,
      },
      refreshDeferredLoginStatus: refresh,
    } as unknown as WebBrowserMgr;
    render(<SecurityInfoBar mgr={mgr} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic sign-in stopped; use manual sign-in.",
    );
    expect(screen.getByRole("status").getAttribute("title")).toContain(
      "does not identify MFA",
    );
    expect(
      screen.getByRole("button", { name: "Refresh saved login status" }),
    ).toHaveTextContent("Auto-fill: waiting for DSM");
    expect(refresh).not.toHaveBeenCalled();
  });
});
