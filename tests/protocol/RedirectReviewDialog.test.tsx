import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RedirectReviewDialog from "../../src/components/protocol/webBrowser/RedirectReviewPanel";
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
  it("shows which handoff in a reverse-proxy chain is being reviewed without automatic acceptance", () => {
    const accept = vi.fn();
    render(
      <RedirectReviewDialog
        manager={{
          review,
          redirectStep: 3,
          maxRedirectHops: 5,
          busy: false,
          error: "",
          accept,
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Redirect 3 of 5 maximum",
    );
    expect(screen.getByRole("status")).toHaveTextContent("several addresses");
    expect(accept).not.toHaveBeenCalled();
  });
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
    expect(screen.getByText(/HTTPS to unencrypted HTTP/)).toBeInTheDocument();
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
  it("keeps long addresses inside a padded, named, scrollable dialog", () => {
    const destinationUrl = `https://target.invalid/${"long-path/".repeat(80)}`;
    render(
      <RedirectReviewDialog
        manager={{
          review: { ...review, destinationUrl },
          busy: false,
          error: "",
          accept: vi.fn(),
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    const dialog = screen.getByRole("region", {
      name: "Redirect review",
    });
    expect(dialog.firstElementChild).toHaveClass("p-5", "sm:p-8");
    expect(screen.getByText(destinationUrl)).toHaveClass(
      "break-all",
      "overflow-auto",
    );
    expect(screen.getByText(destinationUrl)).toHaveAttribute("dir", "ltr");
    expect(dialog.querySelector("footer")).toHaveClass("flex-wrap");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Choose where to continue")).toBeInTheDocument();
  });
  it("pads the unavailable state and offers no approval action", () => {
    render(
      <RedirectReviewDialog
        manager={{
          review: null,
          busy: false,
          error: "The redirect review expired. Try the link again.",
          accept: vi.fn(),
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Redirect review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("p-3");
    expect(
      screen.queryByRole("button", { name: "Open anonymous tab" }),
    ).not.toBeInTheDocument();
  });
  it("offers an explicit choice between this tab and a separate anonymous tab", () => {
    const accept = vi.fn();
    render(
      <RedirectReviewDialog
        manager={{
          review,
          busy: false,
          error: "",
          accept,
          cancel: vi.fn(),
          offer: vi.fn(),
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue in this tab" }),
    );
    expect(accept).toHaveBeenLastCalledWith("current", false, false);
    fireEvent.click(screen.getByRole("button", { name: "Open anonymous tab" }));
    expect(accept).toHaveBeenLastCalledWith("anonymous");
    expect(
      screen.getByText(/Either choice closes the source proxy/),
    ).toBeInTheDocument();
  });
  it("requires separate plaintext login approval and never applies it to anonymous mode", () => {
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
          authentication: {
            configured: true,
            available: true,
            insecure: true,
            reason: "",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Continue in this tab" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I approve sending this saved login over unencrypted HTTP",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue in this tab" }),
    );
    expect(accept).toHaveBeenLastCalledWith("current", true, true);
    fireEvent.click(screen.getByRole("button", { name: "Open anonymous tab" }));
    expect(accept).toHaveBeenLastCalledWith("anonymous");
  });
});
