import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (opts && typeof opts === "object" && "count" in opts)
        return `${key} ${(opts as Record<string, unknown>).count}`;
      return key;
    },
  }),
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { CredentialManager } from "../../src/components/security/CredentialManager";
import { ToastProvider } from "../../src/contexts/ToastContext";

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
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(screen.getByText("credentials.title")).toBeInTheDocument();
  });

  it("shows tab bar with all tabs", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(screen.getByText("credentials.tabs.all")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.expiring")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.expired")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.groups")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.policies")).toBeInTheDocument();
    expect(screen.getByText("credentials.tabs.audit")).toBeInTheDocument();
  });

  it("shows add credential button", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(screen.getByText("credentials.addBtn")).toBeInTheDocument();
  });

  it("shows detect duplicates button", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(
      screen.getByText("credentials.detectDuplicates"),
    ).toBeInTheDocument();
  });

  it("shows generate alerts button", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(screen.getByText("credentials.generateAlerts")).toBeInTheDocument();
  });

  it("switches to expiring soon tab", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    const tab = screen.getByText("credentials.tabs.expiring");
    await act(async () => {
      fireEvent.click(tab);
    });
    // Tab should still be in the document after click (no crash)
    expect(tab).toBeInTheDocument();
  });

  it("switches to groups tab", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    const tab = screen.getByText("credentials.tabs.groups");
    await act(async () => {
      fireEvent.click(tab);
    });
    expect(tab).toBeInTheDocument();
  });

  it("opens add credential dialog", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    const addBtn = screen.getByText("credentials.addBtn");
    await act(async () => {
      fireEvent.click(addBtn);
    });
    // Dialog should open with form fields
    await waitFor(() => {
      const nameInputs = screen.getAllByRole("textbox");
      expect(nameInputs.length).toBeGreaterThan(0);
    });
  });

  it("calls cred_list on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it("shows empty state when no credentials", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    expect(screen.getByText("credentials.empty")).toBeInTheDocument();
  });

  it("calls detect duplicates when button clicked", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    const btn = screen.getByText("credentials.detectDuplicates");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mockInvoke).toHaveBeenCalledWith("cred_detect_duplicates");
  });

  it("renders sortable headers with aria-sort state", async () => {
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cred_list":
          return Promise.resolve([
            {
              id: "cred-1",
              connection_id: "server-a",
              credential_type: "password",
              label: "Primary SSH",
              username: null,
              fingerprint: "credential-primary-ssh",
              created_at: "2026-01-01T00:00:00.000Z",
              last_rotated_at: null,
              expires_at: null,
              rotation_policy_id: null,
              group_id: null,
              strength: "strong",
              notes: "",
              metadata: { connectionName: "Server A" },
            },
          ]);
        case "cred_list_policies":
        case "cred_list_groups":
        case "cred_get_alerts":
        case "cred_get_audit_log":
          return Promise.resolve([]);
        case "cred_get_stats":
          return Promise.resolve({
            total_credentials: 1,
            by_type: { password: 1 },
            expired_count: 0,
            expiring_soon_count: 0,
            stale_count: 0,
            weak_count: 0,
            duplicate_count: 0,
            avg_age_days: 1,
            oldest_credential_days: 1,
          });
        default:
          return Promise.resolve(undefined);
      }
    });

    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });

    const nameSortButton = await screen.findByRole("button", {
      name: "credentials.col.name",
    });
    const nameHeader = nameSortButton.closest("th");
    expect(nameHeader).not.toBeNull();
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(nameSortButton);

    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("expands credential groups with accessible state", async () => {
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cred_list":
          return Promise.resolve([
            {
              id: "cred-1",
              connection_id: "primary-db",
              credential_type: "password",
              label: "Shared DBA Password",
              username: null,
              fingerprint: "credential-shared-dba",
              created_at: "2026-01-01T00:00:00.000Z",
              last_rotated_at: null,
              expires_at: null,
              rotation_policy_id: null,
              group_id: "group-1",
              strength: "strong",
              notes: "",
              metadata: { connectionName: "Primary DB" },
            },
          ]);
        case "cred_list_groups":
          return Promise.resolve([
            {
              id: "group-1",
              name: "Database Team",
              description: "",
              credential_ids: ["cred-1"],
              shared_policy_id: null,
              auto_rotate_together: false,
            },
          ]);
        case "cred_list_policies":
        case "cred_get_alerts":
        case "cred_get_audit_log":
          return Promise.resolve([]);
        case "cred_get_stats":
          return Promise.resolve({
            total_credentials: 1,
            by_type: { password: 1 },
            expired_count: 0,
            expiring_soon_count: 0,
            stale_count: 0,
            weak_count: 0,
            duplicate_count: 0,
            avg_age_days: 10,
            oldest_credential_days: 10,
          });
        default:
          return Promise.resolve(undefined);
      }
    });

    await act(async () => {
      render(
        <ToastProvider>
          <CredentialManager />
        </ToastProvider>,
      );
    });
    fireEvent.click(
      screen.getByRole("tab", { name: "credentials.tabs.groups" }),
    );

    const groupButton = await screen.findByRole("button", {
      name: /^Database Team/i,
    });
    expect(groupButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(groupButton);

    expect(groupButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Shared DBA Password/i)).toBeInTheDocument();
  });
});
