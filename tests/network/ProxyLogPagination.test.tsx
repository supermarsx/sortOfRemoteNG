import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProxyLogsTab } from "../../src/components/network/InternalProxyManager";
import type { useInternalProxyManager } from "../../src/hooks/network/useInternalProxyManager";

type Manager = ReturnType<typeof useInternalProxyManager>;
const entry = (i: number) => ({
  id: String(i),
  session_id: "fixture",
  method: "GET",
  url: `https://fixture.example.test/${i}`,
  status: 200,
  error: null,
  timestamp: "2026-01-01T00:00:00Z",
});
function manager(size = 10000) {
  return {
    requestLog: Array.from({ length: size }, (_, i) => entry(size - i)),
    handleClearLog: vi.fn(),
  } as unknown as Manager;
}

describe("bounded newest-first proxy request log", () => {
  it("renders at most100 of10000 and pages in native newest-first order", () => {
    const mgr = manager();
    render(<ProxyLogsTab mgr={mgr} />);
    expect(document.querySelectorAll("button[aria-expanded]")).toHaveLength(
      100,
    );
    expect(
      screen.getByText("https://fixture.example.test/10000"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("https://fixture.example.test/9900"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older requests" }));
    expect(
      screen.getByText("https://fixture.example.test/9900"),
    ).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 100")).toBeInTheDocument();
    expect(document.querySelectorAll("button[aria-expanded]")).toHaveLength(
      100,
    );
  });
  it("keeps expanded rows attached to stable entry IDs when new requests arrive", () => {
    const mgr = manager(3);
    const { rerender } = render(<ProxyLogsTab mgr={mgr} />);
    fireEvent.click(
      screen.getByText("https://fixture.example.test/2").closest("button")!,
    );
    expect(
      screen
        .getAllByText("https://fixture.example.test/2")[0]
        .closest("button"),
    ).toHaveAttribute("aria-expanded", "true");
    rerender(
      <ProxyLogsTab
        mgr={{ ...mgr, requestLog: [entry(4), ...mgr.requestLog] }}
      />,
    );
    expect(
      screen
        .getAllByText("https://fixture.example.test/2")[0]
        .closest("button"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("https://fixture.example.test/3").closest("button"),
    ).toHaveAttribute("aria-expanded", "false");
  });
  it("clamps pagination after a smaller ring is applied and retains clear action", () => {
    const mgr = manager(201);
    const { rerender } = render(<ProxyLogsTab mgr={mgr} />);
    fireEvent.click(screen.getByRole("button", { name: "Older requests" }));
    fireEvent.click(screen.getByRole("button", { name: "Older requests" }));
    rerender(
      <ProxyLogsTab mgr={{ ...mgr, requestLog: mgr.requestLog.slice(0, 2) }} />,
    );
    expect(
      screen.getByText("https://fixture.example.test/201"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Request log pages" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Log" }));
    expect(mgr.handleClearLog).toHaveBeenCalledOnce();
  });
});
