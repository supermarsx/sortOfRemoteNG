import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteDiagnosticsCopyButton } from "../../src/components/protocol/webBrowser/WebsiteDiagnosticsCopyButton";

const writeText = vi.fn<(text: string) => Promise<void>>();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  cleanup();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("website diagnostics copy control", () => {
  it("copies exactly the supplied summary only on a user click", async () => {
    const text =
      "Website diagnostics\nOrigin: https://nas.example.test\nRouting: ready\nBlocked: fetch";
    render(<WebsiteDiagnosticsCopyButton text={text} />);
    expect(writeText).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Copy diagnostics" });
    expect(button).toHaveClass("sor-icon-btn-sm");
    expect(button).toHaveAttribute("data-tooltip", "Copy diagnostics");
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Diagnostics copied.",
      ),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(button).toHaveAttribute("aria-label", "Copy diagnostics");
  });

  it("announces a safe permission failure and permits explicit retry", async () => {
    writeText.mockRejectedValueOnce(
      new Error("Permission denied: secret diagnostic data"),
    );
    render(<WebsiteDiagnosticsCopyButton text="Safe summary" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not copy diagnostics. Check clipboard permission and try again.",
      ),
    );
    expect(document.body).not.toHaveTextContent("secret diagnostic data");
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Diagnostics copied.",
      ),
    );
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("handles an unavailable clipboard without an unhandled rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(<WebsiteDiagnosticsCopyButton text="Safe summary" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not copy diagnostics.",
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([
    { text: "", disabled: false },
    { text: "  ", disabled: false },
    { text: "Safe summary", disabled: true },
  ])("does not write disabled or empty content: %j", (props) => {
    render(<WebsiteDiagnosticsCopyButton {...props} />);
    const button = screen.getByRole("button", { name: "Copy diagnostics" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("suppresses duplicate clicks and does not announce old text after a source change", async () => {
    let finish!: () => void;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<WebsiteDiagnosticsCopyButton text="First summary" />);
    const button = screen.getByRole("button", { name: "Copy diagnostics" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(writeText).toHaveBeenCalledTimes(1);
    view.rerender(<WebsiteDiagnosticsCopyButton text="Second summary" />);
    await act(async () => {
      finish();
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Diagnostics copied.",
      ),
    );
    expect(writeText).toHaveBeenLastCalledWith("Second summary");
  });

  it("does not write again or update a replacement control after unmount", async () => {
    let finish!: () => void;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<WebsiteDiagnosticsCopyButton text="First summary" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    view.unmount();
    render(<WebsiteDiagnosticsCopyButton text="Second summary" />);
    await act(async () => {
      finish();
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
