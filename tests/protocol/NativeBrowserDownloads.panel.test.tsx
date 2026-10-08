import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeBrowserDownloads from "../../src/components/protocol/webBrowser/NativeBrowserDownloads";
import type { NativeBrowserDownloadsController } from "../../src/hooks/protocol/useNativeBrowserDownloads";
import type { NativeDownload } from "../../src/types/protocols/nativeBrowserDownloads";

const identity = {
  ownerDatabaseId: "database",
  connectionId: "website",
  sessionId: "tab",
  attemptId: "attempt",
};
function row(overrides: Partial<NativeDownload> = {}): NativeDownload {
  return {
    identity,
    downloadId: 1,
    sequence: 1,
    fileName: "report.pdf",
    status: "in-progress",
    receivedBytes: 512,
    totalBytes: 1024,
    bytesPerSecond: 128,
    canPause: true,
    canResume: false,
    canCancel: true,
    canReveal: false,
    ...overrides,
  };
}
function controller(
  rows: NativeDownload[] = [],
): NativeBrowserDownloadsController {
  return {
    scope: JSON.stringify(identity),
    rows,
    error: "",
    busy: new Set<number>(),
    act: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
    activeCount: rows.filter((item) =>
      ["awaiting-destination", "in-progress", "paused"].includes(item.status),
    ).length,
  };
}
async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "Downloads" }));
  return screen.findByRole("dialog", { name: "Website downloads" });
}
function article(fileName: string) {
  const article = screen.getByText(fileName).closest("article");
  expect(article).not.toBeNull();
  return within(article!);
}
afterEach(cleanup);

describe("native downloads panel availability", () => {
  it("cannot open without a live controller scope", () => {
    const downloads = { ...controller(), scope: "" };
    render(<NativeBrowserDownloads controller={downloads} allowed />);
    const button = screen.getByRole("button", {
      name: "Downloads",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(downloads.act).not.toHaveBeenCalled();
    expect(downloads.refresh).not.toHaveBeenCalled();
  });

  it("keeps disabled-download guidance accessible and delegates Open settings without granting permission", async () => {
    const downloads = controller();
    const onOpenSettings = vi.fn();
    render(
      <NativeBrowserDownloads
        controller={downloads}
        allowed={false}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByRole("button", { name: "Downloads" })).toBeEnabled();
    const panel = await openPanel();
    expect(panel).toHaveTextContent(
      "Website downloads are disabled in Web Browser settings.",
    );
    expect(panel).toHaveTextContent(
      "Enable them and reopen this website to download files.",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Open settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(downloads.act).not.toHaveBeenCalled();
    expect(downloads.refresh).not.toHaveBeenCalled();
    expect(panel).toHaveTextContent("No downloads in this browser session.");
  });

  it("does not invent an Open settings action when no handler was supplied", async () => {
    render(
      <NativeBrowserDownloads controller={controller()} allowed={false} />,
    );
    const panel = await openPanel();
    expect(panel).toHaveTextContent("Website downloads are disabled");
    expect(
      within(panel).queryByRole("button", { name: "Open settings" }),
    ).not.toBeInTheDocument();
  });

  it("shows the enabled empty state, session lifetime, and no-auto-open explanation", async () => {
    const onOpenSettings = vi.fn();
    render(
      <NativeBrowserDownloads
        controller={controller()}
        allowed
        onOpenSettings={onOpenSettings}
      />,
    );
    const panel = await openPanel();
    expect(panel).toHaveTextContent("No downloads in this browser session.");
    expect(panel).toHaveTextContent("native browser session and private proxy");
    expect(panel).toHaveTextContent(
      "locking its database cancels active downloads",
    );
    expect(panel).toHaveTextContent("Files are never opened automatically.");
    expect(panel).not.toHaveTextContent("Website downloads are disabled");
    expect(
      within(panel).queryByRole("button", { name: "Open settings" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/active downloads/)).not.toBeInTheDocument();
  });

  it("closes and disables the panel when the owning session becomes unavailable", async () => {
    const downloads = controller([row()]);
    const view = render(
      <NativeBrowserDownloads controller={downloads} allowed />,
    );
    await openPanel();
    view.rerender(
      <NativeBrowserDownloads
        controller={{ ...controller(), scope: "" }}
        allowed
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Downloads" })).toBeDisabled();
    expect(downloads.act).not.toHaveBeenCalled();
  });

  it("does not carry an open panel into a replacement attempt with reused download IDs", async () => {
    const downloads = controller([row({ fileName: "old-owner.pdf" })]);
    const view = render(
      <NativeBrowserDownloads controller={downloads} allowed />,
    );
    await openPanel();
    const nextIdentity = { ...identity, attemptId: "reconnected" };
    const successor = {
      ...controller([
        row({ identity: nextIdentity, fileName: "new-owner.pdf" }),
      ]),
      scope: JSON.stringify(nextIdentity),
    };
    view.rerender(<NativeBrowserDownloads controller={successor} allowed />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("old-owner.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Downloads" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await openPanel();
    fireEvent.click(
      article("new-owner.pdf").getByRole("button", { name: "Cancel" }),
    );
    expect(successor.act).toHaveBeenCalledExactlyOnceWith(1, "cancel");
    expect(downloads.act).not.toHaveBeenCalled();
  });
});

describe("native download actions and progress", () => {
  it("uses native capability flags for pending, active, paused and terminal rows", async () => {
    const downloads = controller([
      row({
        downloadId: 1,
        fileName: "pending.pdf",
        status: "awaiting-destination",
        canPause: false,
        receivedBytes: 0,
        totalBytes: null,
      }),
      row({ downloadId: 2, fileName: "active.pdf" }),
      row({
        downloadId: 3,
        fileName: "paused.pdf",
        status: "paused",
        canPause: false,
        canResume: true,
      }),
      row({
        downloadId: 4,
        fileName: "completed.pdf",
        status: "completed",
        canPause: false,
        canCancel: false,
        canReveal: true,
      }),
      row({
        downloadId: 5,
        fileName: "cancelled.pdf",
        status: "cancelled",
        canPause: false,
        canCancel: false,
      }),
      row({
        downloadId: 6,
        fileName: "interrupted.pdf",
        status: "interrupted",
        canPause: false,
        canCancel: false,
      }),
    ]);
    render(<NativeBrowserDownloads controller={downloads} allowed />);
    expect(screen.getByLabelText("3 active downloads")).toHaveTextContent("3");
    await openPanel();
    expect(
      article("pending.pdf").getByText(/Choose where to save/),
    ).toBeInTheDocument();
    expect(article("pending.pdf").getAllByRole("button")).toHaveLength(1);
    expect(
      article("pending.pdf").queryByRole("progressbar"),
    ).not.toBeInTheDocument();
    expect(
      article("paused.pdf").queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
    expect(
      article("cancelled.pdf").queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      article("interrupted.pdf").getByText(/Interrupted/),
    ).toBeInTheDocument();
    expect(
      article("interrupted.pdf").queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      article("completed.pdf").queryByRole("progressbar"),
    ).not.toBeInTheDocument();
    expect(downloads.act).not.toHaveBeenCalled();
    fireEvent.click(
      article("pending.pdf").getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(
      article("active.pdf").getByRole("button", { name: "Pause" }),
    );
    fireEvent.click(
      article("paused.pdf").getByRole("button", { name: "Resume" }),
    );
    fireEvent.click(
      article("completed.pdf").getByRole("button", { name: "Show in folder" }),
    );
    expect(vi.mocked(downloads.act).mock.calls).toEqual([
      [1, "cancel"],
      [2, "pause"],
      [3, "resume"],
      [4, "reveal"],
    ]);
  });

  it("never assumes action support from status alone", async () => {
    render(
      <NativeBrowserDownloads
        controller={controller([row({ canPause: false, canCancel: false })])}
        allowed
      />,
    );
    await openPanel();
    expect(article("report.pdf").queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables all offered actions only for busy rows and restores them after settlement", async () => {
    const downloads = {
      ...controller([row(), row({ downloadId: 2, fileName: "other.pdf" })]),
      busy: new Set([1]),
    };
    const view = render(
      <NativeBrowserDownloads controller={downloads} allowed />,
    );
    await openPanel();
    for (const button of article("report.pdf").getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(downloads.act).not.toHaveBeenCalled();
    expect(
      article("other.pdf").getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
    view.rerender(
      <NativeBrowserDownloads
        controller={{ ...downloads, busy: new Set() }}
        allowed
      />,
    );
    fireEvent.click(
      article("report.pdf").getByRole("button", { name: "Pause" }),
    );
    expect(downloads.act).toHaveBeenCalledExactlyOnceWith(1, "pause");
  });

  it("formats progress safely, clamps overrun and leaves unknown totals indeterminate", async () => {
    render(
      <NativeBrowserDownloads
        controller={controller([
          row({
            fileName: "known.pdf",
            receivedBytes: 2048,
            totalBytes: 1024,
            bytesPerSecond: 128,
          }),
          row({
            downloadId: 2,
            fileName: "unknown.pdf",
            receivedBytes: 1024 * 1024,
            totalBytes: null,
            bytesPerSecond: 0,
          }),
          row({
            downloadId: 3,
            fileName: "paused.pdf",
            status: "paused",
            canPause: false,
            canResume: true,
            receivedBytes: 1024 ** 3,
            totalBytes: 1024 ** 4,
            bytesPerSecond: 99,
          }),
        ])}
        allowed
      />,
    );
    await openPanel();
    expect(
      article("known.pdf").getByText(
        "Downloading · 2.0 KiB / 1.0 KiB · 128 B/s",
      ),
    ).toBeInTheDocument();
    expect(article("known.pdf").getByRole("progressbar")).toHaveAttribute(
      "value",
      "1024",
    );
    expect(article("known.pdf").getByRole("progressbar")).toHaveAttribute(
      "max",
      "1024",
    );
    const indeterminate = article("unknown.pdf").getByRole("progressbar", {
      name: "Download progress for unknown.pdf",
    });
    expect(indeterminate).not.toHaveAttribute("value");
    expect(indeterminate).not.toHaveAttribute("max");
    expect(
      article("unknown.pdf").getByText("Downloading · 1.0 MiB"),
    ).toBeInTheDocument();
    expect(
      article("paused.pdf").getByText("Paused · 1.0 GiB / 1.0 TiB"),
    ).toBeInTheDocument();
  });

  it("renders filenames as text, ignores private path extensions, and reveals only on explicit action", async () => {
    const fileName = '<img src="untrusted" onerror="alert(1)">.pdf';
    const downloaded = {
      ...row({
        fileName,
        status: "completed",
        canPause: false,
        canCancel: false,
        canReveal: true,
      }),
      path: "C:\\private-folder\\report.pdf",
      url: "https://private.example/?secret=token",
    };
    const downloads = controller([downloaded]);
    render(<NativeBrowserDownloads controller={downloads} allowed />);
    const panel = await openPanel();
    expect(panel).toHaveTextContent(fileName);
    expect(panel.querySelector("img, a, input[type=file]")).toBeNull();
    expect(panel).not.toHaveTextContent("private-folder");
    expect(panel).not.toHaveTextContent("secret=token");
    expect(downloads.act).not.toHaveBeenCalled();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Show in folder" }),
    );
    expect(downloads.act).toHaveBeenCalledExactlyOnceWith(1, "reveal");
  });

  it("offers refresh on an error and closes via button, Escape or outside click", async () => {
    const downloads = {
      ...controller(),
      error:
        "Downloads could not be refreshed. Check this browser session and retry.",
    };
    render(<NativeBrowserDownloads controller={downloads} allowed />);
    const panel = await openPanel();
    expect(within(panel).getByRole("alert")).toHaveTextContent(downloads.error);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Refresh downloads" }),
    );
    expect(downloads.refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Close downloads" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Downloads" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(downloads.act).not.toHaveBeenCalled();
  });
});
