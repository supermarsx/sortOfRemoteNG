import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import DrayTekStatusTab from "./DrayTekStatusTab";
import type { DraytekDeviceContext } from "./registry";

const device: DraytekDeviceContext = {
  host: "10.0.0.1",
  port: 443,
  useTls: true,
  username: "admin",
  password: "x",
  vendor: "draytek",
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("DrayTekStatusTab", () => {
  it("loads draytek_get_status on mount and renders the parsed fields", async () => {
    invokeMock.mockResolvedValue({
      model: "Vigor2927",
      firmware: "4.4.5",
      build: null,
      uptime: "12:00",
      wan: [
        { name: "WAN1", status: "Up", ip: "198.51.100.2" },
        { name: "WAN2", status: "Down" },
      ],
    });
    render(<DrayTekStatusTab connectionId="conn-7" device={device} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("draytek_get_status", {
        id: "conn-7",
      }),
    );
    expect(await screen.findByText("Vigor2927")).toBeInTheDocument();
    expect(screen.getByText("4.4.5")).toBeInTheDocument();
    expect(screen.getByText("WAN2")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.2")).toBeInTheDocument();
    // Missing fields render as an em-dash, never crash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("surfaces backend errors and re-queries on Refresh", async () => {
    invokeMock.mockRejectedValueOnce("login expired");
    invokeMock.mockResolvedValue({ wan: [] });
    render(<DrayTekStatusTab connectionId="conn-7" device={device} />);
    expect(await screen.findByText("login expired")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/No WAN information reported/),
    ).toBeInTheDocument();
  });
});
