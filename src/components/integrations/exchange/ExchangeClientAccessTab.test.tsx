import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import ExchangeClientAccessTab from "./ExchangeClientAccessTab";

const summary = {
  connected: true,
  environment: "online" as const,
  server: null,
  organization: "contoso.onmicrosoft.com",
  connectedAs: "admin@contoso.com",
  exchangeVersion: "Exchange Online",
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("ExchangeClientAccessTab (clientaccess category)", () => {
  it("renders the Calendar section and the six-section sub-nav", async () => {
    render(<ExchangeClientAccessTab summary={summary} />);
    // "Calendar" appears in the sub-nav and the default section heading.
    expect(await screen.findAllByText("Calendar")).not.toHaveLength(0);
    expect(screen.getByText("Public Folders")).toBeInTheDocument();
    expect(screen.getByText("Mobile Devices")).toBeInTheDocument();
    expect(screen.getByText("Inbox Rules")).toBeInTheDocument();
    expect(screen.getByText("Client-Access Policies")).toBeInTheDocument();
    expect(screen.getByText("Virtual Directories")).toBeInTheDocument();
  });

  it("maps calendar 'Permissions' to exchange_list_calendar_permissions with identity (no connection id)", async () => {
    render(<ExchangeClientAccessTab summary={summary} />);
    fireEvent.change(screen.getByPlaceholderText("user@contoso.com"), {
      target: { value: "room1@contoso.com" },
    });
    fireEvent.click(screen.getByText("Permissions"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_list_calendar_permissions",
        { identity: "room1@contoso.com" },
      ),
    );
  });

  it("maps 'OWA policies' to exchange_list_owa_policies with no args (singleton service)", async () => {
    render(<ExchangeClientAccessTab summary={summary} />);
    fireEvent.click(screen.getByText("Client-Access Policies"));
    fireEvent.click(await screen.findByText("OWA policies"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_list_owa_policies",
        undefined,
      ),
    );
  });

  it("maps the virtual-directory 'Load' to exchange_list_owa_virtual_directories with server null", async () => {
    render(<ExchangeClientAccessTab summary={summary} />);
    fireEvent.click(screen.getByText("Virtual Directories"));
    fireEvent.click(await screen.findByText("Load"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_list_owa_virtual_directories",
        { server: null },
      ),
    );
  });
});
