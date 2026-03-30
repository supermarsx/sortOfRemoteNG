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

import { CredentialManager } from "../../src/components/security/CredentialManager";

describe("CredentialManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cred_list":
        case "cred_list_policies":
        case "cred_list_groups":
        case "cred_get_alerts":
        case "cred_get_audit_log":
        case "cred_get_expiring_soon":
        case "cred_get_expired":
        case "cred_detect_duplicates":
          return Promise.resolve([]);
        case "cred_get_stats":
          return Promise.resolve({
            total: 0,
            expiringSoon: 0,
            expired: 0,
          });
        default:
          return Promise.resolve(undefined);
      }
    });
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
    await act(async () => { render(<CredentialManager />); });
    const btn = screen.getByText("credentials.detectDuplicates");
    await act(async () => { fireEvent.click(btn); });
    expect(mockInvoke).toHaveBeenCalledWith("cred_detect_duplicates");
  });

  it("renders sortable headers with aria-sort state", async () => {
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cred_list":
          return Promise.resolve([
            {
              id: "cred-1",
              label: "Primary SSH",
              connectionName: "Server A",
              kind: "password",
              ageDays: 1,
              expiresAt: null,
              strength: "strong",
              lastRotated: null,
              isExpired: false,
              isStale: false,
            },
          ]);
        case "cred_list_policies":
        case "cred_list_groups":
        case "cred_get_alerts":
        case "cred_get_audit_log":
          return Promise.resolve([]);
        case "cred_get_stats":
          return Promise.resolve({ total: 1, expiringSoon: 0, expired: 0 });
        default:
          return Promise.resolve(undefined);
      }
    });

    await act(async () => { render(<CredentialManager />); });

    const nameHeader = screen.getByRole("columnheader", { name: /credentials.col.name/i });
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(screen.getByRole("button", { name: /credentials.col.name/i }));

    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("expands credential groups with accessible state", async () => {
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cred_list":
          return Promise.resolve([
            {
              id: "cred-1",
              label: "Shared DBA Password",
              connectionName: "Primary DB",
              kind: "password",
              ageDays: 10,
              expiresAt: null,
              strength: "strong",
              lastRotated: null,
              isExpired: false,
              isStale: false,
            },
          ]);
        case "cred_list_groups":
          return Promise.resolve([
            {
              id: "group-1",
              name: "Database Team",
              description: "",
              credentialIds: ["cred-1"],
            },
          ]);
        case "cred_list_policies":
        case "cred_get_alerts":
        case "cred_get_audit_log":
          return Promise.resolve([]);
        case "cred_get_stats":
          return Promise.resolve({ total: 1, expiringSoon: 0, expired: 0 });
        default:
          return Promise.resolve(undefined);
      }
    });

    await act(async () => { render(<CredentialManager />); });
    fireEvent.click(screen.getByRole("tab", { name: "credentials.tabs.groups" }));

    const groupButton = await screen.findByRole("button", { name: /^Database Team/i });
    expect(groupButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(groupButton);

    expect(groupButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Shared DBA Password/i)).toBeInTheDocument();
  });
});

