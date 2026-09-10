import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RedirectReviewDialog from "../../src/components/protocol/webBrowser/RedirectReviewDialog";
const review = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "s",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://target.invalid/admin/",
  navigationToken: null,
  documentSequence: 1,
  removedQuery: false,
};
describe("redirect review decision", () => {
  it("requires an explicit click on a clearly identified security downgrade", () => {
    const accept = vi.fn();
    render(
      <RedirectReviewDialog
        manager={{
          review: { ...review, destinationUrl: "http://target.invalid/" },
          busy: false,
          error: "",
          accept,
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByText(/SECURITY DOWNGRADE: HTTPS to unencrypted HTTP/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not protected by TLS/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open anonymous tab" }));
    expect(accept).toHaveBeenCalledOnce();
  });
  it("clearly labels both origins, prevents Enter auto-confirm, and disables both actions while busy", () => {
    const manager = {
      review,
      busy: false,
      error: "",
      accept: vi.fn(),
      cancel: vi.fn(),
      offer: vi.fn(),
    };
    const view = render(<RedirectReviewDialog manager={manager} />);
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(screen.getByText(review.destinationUrl)).toHaveClass("break-all");
    expect(screen.getByText(/fresh HTTPS certificate/)).toBeInTheDocument();
    expect(screen.queryByText(/Query parameters and/)).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(manager.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open anonymous tab" }));
    expect(manager.accept).toHaveBeenCalledOnce();
    view.rerender(
      <RedirectReviewDialog manager={{ ...manager, busy: true }} />,
    );
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stay here" })).toBeDisabled();
  });
  it("shows plaintext and stripped URL warnings only where relevant", () => {
    render(
      <RedirectReviewDialog
        manager={{
          review: {
            ...review,
            sourceOrigin: "http://source.invalid",
            destinationUrl: "http://target.invalid/",
            removedQuery: true,
          },
          busy: false,
          error: "",
          accept: vi.fn(),
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText(/Unencrypted HTTP/)).toBeInTheDocument();
    expect(screen.getByText(/Query parameters and/)).toBeInTheDocument();
    expect(
      screen.queryByText(/fresh HTTPS certificate/),
    ).not.toBeInTheDocument();
  });
});
