import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (opts && typeof opts === 'object' && 'count' in opts) return `${key} ${(opts as Record<string, unknown>).count}`;
      return key;
    },
  }),
}));

import { CredentialManager } from "../src/components/security/CredentialManager";

describe("CredentialManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it("renders the title", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.title")).toBeInTheDocument();
  });

  it("shows tab bar with all tabs", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.tabs.all")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.expiring")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.expired")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.groups")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.policies")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.audit")).toBeInTheDocument();
  });

  it("shows add credential button", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.addBtn")).toBeInTheDocument();
  });

  it("shows detect duplicates button", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.detectDuplicates")).toBeInTheDocument();
  });

  it("shows generate alerts button", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.generateAlerts")).toBeInTheDocument();
  });

  it("switches to expiring soon tab", async () => {
    await act(async () => { render(<CredentialManager />); });
    const tab = screen.getByText("credentials.tabs.expiring");
    await act(async () => { fireEvent.click(tab); });
    // Tab should still be in the document after click (no crash)
    expect(tab).toBeInTheDocument();
  });

  it("switches to groups tab", async () => {
    await act(async () => { render(<CredentialManager />); });
    const tab = screen.getByText("credentials.tabs.groups");
    await act(async () => { fireEvent.click(tab); });
    expect(tab).toBeInTheDocument();
  });

  it("opens add credential dialog", async () => {
    await act(async () => { render(<CredentialManager />); });
    const addBtn = screen.getByText("credentials.addBtn");
    await act(async () => { fireEvent.click(addBtn); });
    // Dialog should open with form fields
    await waitFor(() => {
      const nameInputs = screen.getAllByRole("textbox");
      expect(nameInputs.length).toBeGreaterThan(0);
    });
  });

  it("calls cred_list on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    await act(async () => { render(<CredentialManager />); });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it("shows empty state when no credentials", async () => {
    await act(async () => { render(<CredentialManager />); });
    expect(screen.getByText("credentials.empty")).toBeInTheDocument();
  });

  it("calls detect duplicates when button clicked", async () => {
    mockInvoke.mockResolvedValue([]);
    await act(async () => { render(<CredentialManager />); });
    const btn = screen.getByText("credentials.detectDuplicates");
    await act(async () => { fireEvent.click(btn); });
    expect(mockInvoke).toHaveBeenCalledWith("cred_detect_duplicates");
  });
});
