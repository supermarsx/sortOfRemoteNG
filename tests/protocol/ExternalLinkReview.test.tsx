import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExternalLinkReview from "../../src/components/protocol/webBrowser/ExternalLinkReview";
import type { useWebExternalLinks } from "../../src/hooks/protocol/useWebExternalLinks";

afterEach(cleanup);

function manager(
  overrides: Partial<ReturnType<typeof useWebExternalLinks>> = {},
): ReturnType<typeof useWebExternalLinks> {
  return {
    url: "https://news.example.test/article?signature=x%2By#section",
    busy: false,
    error: "",
    cancel: vi.fn(),
    open: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("Outlook external-link review", () => {
  it("has no dialog or open action without a pending link", () => {
    render(<ExternalLinkReview manager={manager({ url: null })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the exact destination, standard controls and external routing notice, with Cancel focused", async () => {
    const state = manager();
    render(<ExternalLinkReview manager={state} />);
    const dialog = screen.getByRole("dialog", { name: "Open email link" });
    expect(dialog).toHaveClass("sor-modal-panel", "mx-4");
    const destination = screen.getByText(state.url!);
    expect(destination).toHaveAttribute("dir", "ltr");
    expect(destination.closest("a")).toBeNull();
    expect(
      screen.getByText(/cookies and saved login details are not shared/i),
    ).toBeVisible();
    expect(screen.getByText(/own network and proxy settings/i)).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    expect(state.open).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open in browser" })).toHaveClass(
      "sor-btn",
      "sor-btn-primary",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(state.open).not.toHaveBeenCalled();
  });

  it("forwards the native gesture to the opener guard only through the explicit action", () => {
    const state = manager();
    render(<ExternalLinkReview manager={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(state.open).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent));
    // Synthetic events stay untrusted; the hook, not the dialog, authorizes
    // a genuine native gesture before invoking the operating-system opener.
    expect(vi.mocked(state.open).mock.calls[0][0].isTrusted).toBe(false);
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it("disables duplicate opening and dismissal while the native action is pending", () => {
    const state = manager({ busy: true });
    render(<ExternalLinkReview manager={state} />);
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Opening…" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.open).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it("shows a recoverable opener error without replacing the destination", () => {
    const state = manager({
      error: "Could not open the system browser. Try again or cancel.",
    });
    render(<ExternalLinkReview manager={state} />);
    expect(screen.getByRole("alert")).toHaveTextContent(state.error);
    expect(screen.getByText(state.url!)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open in browser" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.cancel).toHaveBeenCalledOnce();
  });
});
