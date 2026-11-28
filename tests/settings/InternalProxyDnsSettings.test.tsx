import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import InternalProxyDnsSettings from "../../src/components/SettingsDialog/sections/InternalProxyDnsSettings";
import { normalizeInternalProxySettings } from "../../src/utils/settings/webBrowserSettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
beforeEach(() => {
  native.mockReset();
});
describe("internal proxy DNS controls", () => {
  it("invalidates native caches before reading real counters", async () => {
    native
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ hits: 4, misses: 2, generation: 1 });
    render(
      <InternalProxyDnsSettings
        config={normalizeInternalProxySettings(undefined)}
        update={vi.fn()}
        disabled={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear proxy DNS caches" }),
    );
    await screen.findByText(/caches invalidated for subsequent lookups/);
    expect(native.mock.calls.map((call) => call[0])).toEqual([
      "clear_proxy_dns_caches",
      "get_proxy_dns_stats",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("4 cache hits");
  });
  it("does not report a successful clear when the backend rejects it", async () => {
    native.mockRejectedValue(new Error("unavailable"));
    render(
      <InternalProxyDnsSettings
        config={normalizeInternalProxySettings(undefined)}
        update={vi.fn()}
        disabled={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear proxy DNS caches" }),
    );
    await screen.findByText(/DNS controls are unavailable/);
    expect(native).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/caches invalidated/)).not.toBeInTheDocument();
  });
  it("changes the saved address family through the actual selector", async () => {
    const update = vi.fn();
    render(
      <InternalProxyDnsSettings
        config={normalizeInternalProxySettings(undefined)}
        update={update}
        disabled={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "Address selection" }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "IPv4 only" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ addressFamily: "ipv4-only" }),
    );
  });
});
