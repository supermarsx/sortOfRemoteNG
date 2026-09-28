import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookmarkEditDialog from "../../src/components/protocol/webBrowser/BookmarkEditDialog";
import type { WebBrowserMgr } from "../../src/components/protocol/webBrowser/types";

afterEach(cleanup);

function Fixture({
  save,
  navigate,
  error,
}: {
  save: (value: WebBrowserMgr["bookmarkEdit"]) => void;
  navigate: () => void;
  error?: string;
}) {
  const [bookmarkEdit, setBookmarkEdit] = useState<
    WebBrowserMgr["bookmarkEdit"]
  >({ idx: 2, childIdx: 1, name: "Status", path: "/status", error });
  const mgr = {
    bookmarkEdit,
    setBookmarkEdit,
    saveBookmarkEdit: () => save(bookmarkEdit),
    navigateToUrl: navigate,
  } as unknown as WebBrowserMgr;
  return <BookmarkEditDialog mgr={mgr} />;
}

describe("bookmark editor", () => {
  it("submits both fields and preserves the folder child identity without navigating", () => {
    const save = vi.fn();
    const navigate = vi.fn();
    render(<Fixture save={save} navigate={navigate} />);
    expect(
      screen.getByRole("dialog", { name: "Edit bookmark" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Remote status" },
    });
    fireEvent.change(screen.getByLabelText("URL or path"), {
      target: { value: "https://other.test/status" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({
      idx: 2,
      childIdx: 1,
      name: "Remote status",
      path: "https://other.test/status",
      error: undefined,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Close", "Escape", "backdrop"])(
    "discards edits safely via %s",
    (action) => {
      const save = vi.fn();
      const navigate = vi.fn();
      render(<Fixture save={save} navigate={navigate} />);
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Unsaved" },
      });
      fireEvent.change(screen.getByLabelText("URL or path"), {
        target: { value: "/unsaved" },
      });
      if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (action === "backdrop")
        fireEvent.click(screen.getByTestId("bookmark-edit-dialog"));
      else fireEvent.click(screen.getByRole("button", { name: action }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(save).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Use an HTTP or HTTPS URL.",
    "This bookmark has changed. Reopen the editor.",
  ])("shows manager validation: %s", (error) => {
    render(<Fixture save={vi.fn()} navigate={vi.fn()} error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    expect(screen.getByLabelText("URL or path")).toHaveValue("/status");
    fireEvent.change(screen.getByLabelText("URL or path"), {
      target: { value: "/fixed" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
