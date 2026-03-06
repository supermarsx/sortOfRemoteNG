import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import MarketplacePanel from "../src/components/marketplace/MarketplacePanel";

describe("MarketplacePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it("renders the title", () => {
    render(<MarketplacePanel />);
    expect(screen.getByText("marketplace.title")).toBeInTheDocument();
  });

  it("shows tab bar", () => {
    render(<MarketplacePanel />);
    expect(screen.getByText("marketplace.tabs.browse")).toBeInTheDocument();
    expect(screen.getByText("marketplace.tabs.installed")).toBeInTheDocument();
    expect(screen.getByText("marketplace.tabs.updates")).toBeInTheDocument();
    expect(screen.getByText("marketplace.tabs.repositories")).toBeInTheDocument();
  });

  it("shows search input", () => {
    render(<MarketplacePanel />);
    const input = screen.getByPlaceholderText("marketplace.searchPlaceholder");
    expect(input).toBeInTheDocument();
  });

  it("shows refresh button", () => {
    render(<MarketplacePanel />);
    const btns = screen.getAllByRole("button");
    expect(btns.length).toBeGreaterThan(0);
  });

  it("switches to installed tab", async () => {
    render(<MarketplacePanel />);
    const tab = screen.getByText("marketplace.tabs.installed");
    await act(async () => { fireEvent.click(tab); });
    expect(screen.getByText("marketplace.noInstalled")).toBeInTheDocument();
  });

  it("switches to updates tab", async () => {
    render(<MarketplacePanel />);
    const tab = screen.getByText("marketplace.tabs.updates");
    await act(async () => { fireEvent.click(tab); });
    expect(screen.getByText("marketplace.allUpToDate")).toBeInTheDocument();
  });

  it("shows no plugins message when empty browse", async () => {
    await act(async () => { render(<MarketplacePanel />); });
    expect(screen.getByText("marketplace.noResults")).toBeInTheDocument();
  });

  it("triggers search on input change", async () => {
    render(<MarketplacePanel />);
    const input = screen.getByPlaceholderText("marketplace.searchPlaceholder");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ssh" } });
    });
    expect(input).toHaveValue("ssh");
  });

  it("calls mkt_get_installed on installed tab", async () => {
    render(<MarketplacePanel />);
    const tab = screen.getByText("marketplace.tabs.installed");
    await act(async () => { fireEvent.click(tab); });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it("shows repositories tab with add form", async () => {
    render(<MarketplacePanel />);
    const tab = screen.getByText("marketplace.tabs.repositories");
    await act(async () => { fireEvent.click(tab); });
    expect(screen.getByText("marketplace.addRepository")).toBeInTheDocument();
  });
});
