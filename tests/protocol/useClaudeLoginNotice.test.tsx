import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_EMAIL_VERIFICATION,
  useClaudeLoginNotice,
} from "../../src/hooks/protocol/useClaudeLoginNotice";
import SecurityInfoBar from "../../src/components/protocol/webBrowser/SecurityInfoBar";
import type { WebBrowserMgr } from "../../src/hooks/protocol/useWebBrowser";

afterEach(cleanup);
const handoff = { ok: false, reason: "manual-email-verification-required" };

describe("Claude interactive verification advisory", () => {
  it("is scoped to the active document and expires on navigation or revocation", () => {
    let document: object | null = {};
    const view = renderHook(() => useClaudeLoginNotice(() => document));
    act(() => view.result.current.receive(handoff));
    expect(view.result.current.presentation).toBe(CLAUDE_EMAIL_VERIFICATION);
    document = {};
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
    act(() => view.result.current.receive(handoff));
    document = null;
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
  });

  it("ignores disabled, manual, other-provider and revoked contexts", () => {
    let document: object | null = null;
    const view = renderHook(() => useClaudeLoginNotice(() => document));
    act(() => view.result.current.receive(handoff));
    document = {};
    view.rerender();
    expect(view.result.current.presentation).toBeNull();
  });

  it.each([
    null,
    {},
    { ...handoff, ok: true },
    { ok: false, reason: "submitted" },
    { ok: false, reason: "reviewed-login-stopped" },
  ])("does not infer verification or authentication from %j", (result) => {
    const document = {};
    const view = renderHook(() => useClaudeLoginNotice(() => document));
    act(() => view.result.current.receive(result));
    expect(view.result.current.presentation).toBeNull();
  });

  it("renders guidance without a login failure or automatic retry", () => {
    render(
      <SecurityInfoBar
        mgr={
          {
            isSecure: true,
            session: { hostname: "claude.ai" },
            automaticLoginNotice: CLAUDE_EMAIL_VERIFICATION,
          } as unknown as WebBrowserMgr
        }
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Continue with Claude’s email verification.",
    );
    expect(screen.getByRole("status").getAttribute("title")).toContain(
      "does not confirm",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
