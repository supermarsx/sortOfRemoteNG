import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyLatestProxyLogButton } from "../../src/components/network/CopyLatestProxyLogButton";

const entries = [
  {
    id: "1",
    session_id: "s",
    method: "GET",
    url: "https://fixture.test/",
    timestamp: "2026-09-13T09:00:00Z",
    status: 200,
    error: null,
  },
];
afterEach(() => vi.unstubAllGlobals());
function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}
describe("copy latest proxy log feedback", () => {
  it("does nothing until clicked and disables empty snapshots", () => {
    const write = clipboard();
    render(<CopyLatestProxyLogButton entries={[]} />);
    expect(
      screen.getByRole("button", { name: "Copy latest 1,000" }),
    ).toBeDisabled();
    expect(write).not.toHaveBeenCalled();
  });
  it("reports success only after clipboard completion and prevents duplicate writes", async () => {
    let finish!: () => void;
    const write = clipboard(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    render(<CopyLatestProxyLogButton entries={entries} />);
    const button = screen.getByRole("button", { name: "Copy latest 1,000" });
    expect(button).toHaveClass("sor-option-chip");
    expect(button.title).toContain("across all pages");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(write).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).not.toHaveTextContent("Copied");
    await act(async () => {
      finish();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied 1 proxy log entries",
    );
    expect(button).toBeEnabled();
  });
  it("shows a safe actionable clipboard failure and allows retry", async () => {
    const write = clipboard(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("private-token"))
        .mockResolvedValueOnce(undefined),
    );
    render(<CopyLatestProxyLogButton entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy latest 1,000" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Check clipboard permission",
      ),
    );
    expect(document.body).not.toHaveTextContent("private-token");
    fireEvent.click(screen.getByRole("button", { name: "Copy latest 1,000" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copied 1"),
    );
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("drops stale feedback when the log is cleared while copying", async () => {
    let finish!: () => void;
    clipboard(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const view = render(<CopyLatestProxyLogButton entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy latest 1,000" }));
    view.rerender(<CopyLatestProxyLogButton entries={[]} />);
    await act(async () => {
      finish();
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Copy latest 1,000" }),
    ).toBeDisabled();
  });
  it("preserves snapshot feedback when new requests arrive during and after copying", async () => {
    let finish!: () => void;
    const write = clipboard(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const view = render(<CopyLatestProxyLogButton entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy latest 1,000" }));
    const newer = [{ ...entries[0], id: "2" }, ...entries];
    view.rerender(<CopyLatestProxyLogButton entries={newer} />);
    await act(async () => {
      finish();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied 1 proxy log entries",
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("latest 1 of 1"),
    );
    view.rerender(
      <CopyLatestProxyLogButton
        entries={[{ ...entries[0], id: "3" }, ...newer]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied 1 proxy log entries",
    );
    view.rerender(<CopyLatestProxyLogButton entries={[]} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
