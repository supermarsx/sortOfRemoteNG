import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BrowserHttpCacheFields from "../../src/components/SettingsDialog/sections/webBrowser/BrowserHttpCacheFields";
import { DEFAULT_BROWSER_HTTP_CACHE } from "../../src/utils/settings/browserSessionSettings";

const transport = vi.hoisted(() => ({ getInvoke: vi.fn(), invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: transport.getInvoke,
}));

beforeEach(() => {
  transport.invoke.mockReset();
  transport.getInvoke.mockReset().mockResolvedValue(transport.invoke);
});
afterEach(() => vi.restoreAllMocks());

function renderFields(
  capability?: React.ComponentProps<
    typeof BrowserHttpCacheFields
  >["capability"],
  nativeEngine = true,
) {
  const onChange = vi.fn();
  render(
    <BrowserHttpCacheFields
      value={{ ...DEFAULT_BROWSER_HTTP_CACHE }}
      onChange={onChange}
      capability={capability}
      nativeEngine={nativeEngine}
    />,
  );
  return onChange;
}

describe("global page cache fields", () => {
  it("states the device-only, never-synced cache rules", () => {
    renderFields();
    expect(
      screen.getByText(
        /Page cache \(this device only, never synced, follows site cache rules\)/,
      ),
    ).toHaveTextContent("never included in cloud sync, backups or exports");
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("states that the disk cache needs HTTPS inspection, and flags a Direct TLS default", () => {
    const { rerender } = render(
      <BrowserHttpCacheFields
        value={{ ...DEFAULT_BROWSER_HTTP_CACHE }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Page cache \(this device only/)).toHaveTextContent(
      "The disk page cache is available only when HTTPS inspection is active for the connection.",
    );
    expect(screen.queryByText(/Direct TLS is the app default/)).toBeNull();
    rerender(
      <BrowserHttpCacheFields
        value={{ ...DEFAULT_BROWSER_HTTP_CACHE }}
        onChange={vi.fn()}
        tlsInterception="off"
      />,
    );
    expect(
      screen.getByText(
        "Direct TLS is the app default, so connections that inherit it use no disk page cache.",
      ),
    ).toBeVisible();
  });

  it.each([
    ["disabled", "Page cache is turned off."],
    ["cache-location-not-local", "not a local, non-synced folder"],
    ["engine-unsupported", "does not support a page cache on disk yet"],
    ["unavailable", "unavailable in this build"],
  ] as const)("explains the %s reason", (reason, text) => {
    renderFields({ available: false, reason });
    expect(screen.getByText(new RegExp(text))).toBeVisible();
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("shows global usage when available and clears all caches", async () => {
    transport.invoke.mockImplementation(async (command: string) => {
      if (command === "origin_browser_http_cache_usage")
        return {
          available: true,
          bytes: 200 * 1024 * 1024,
          limitBytes: 1024 * 1024 * 1024,
        };
      if (command === "origin_browser_clear_all_http_cache")
        return { cleared: true, pendingRestart: true };
      throw `command ${command} not found`;
    });
    renderFields({ available: true });
    expect(
      await screen.findByText("Page cache in use: 200 MB of 1.0 GB."),
    ).toBeVisible();
    expect(transport.invoke).toHaveBeenCalledWith(
      "origin_browser_http_cache_usage",
      { request: {} },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all page caches" }),
    );
    expect(
      await screen.findByText(
        /Caches in use are removed when their tabs close/,
      ),
    ).toBeVisible();
    expect(transport.invoke).toHaveBeenCalledWith(
      "origin_browser_clear_all_http_cache",
      undefined,
    );
  });

  it("reports unavailable when the clear command does not exist yet", async () => {
    transport.invoke.mockRejectedValue(
      "command origin_browser_clear_all_http_cache not found",
    );
    renderFields();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all page caches" }),
    );
    expect(
      await screen.findByText("Not available in this build yet."),
    ).toBeVisible();
  });

  it("disables clearing for the legacy engine", () => {
    renderFields({ available: true }, false);
    expect(
      screen.getByRole("button", { name: "Clear all page caches" }),
    ).toBeDisabled();
    expect(transport.getInvoke).not.toHaveBeenCalled();
  });
});
