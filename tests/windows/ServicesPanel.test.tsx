import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ServicesPanel from "../../src/components/windows/panels/ServicesPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { WindowsService } from "../../src/types/windows/winmgmt";

const makeService = (overrides: Partial<WindowsService>): WindowsService => ({
  name: "Spooler",
  displayName: "Print Spooler",
  description: null,
  state: "stopped",
  startMode: "manual",
  serviceType: "Own Process",
  pathName: "C:/Windows/System32/spoolsv.exe",
  processId: null,
  exitCode: null,
  status: "OK",
  started: false,
  acceptPause: false,
  acceptStop: false,
  startName: "LocalSystem",
  delayedAutoStart: null,
  dependsOn: [],
  dependentServices: [],
  ...overrides,
});

describe("ServicesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders labeled controls, announces status, and fetches services on mount", async () => {
    const services: WindowsService[] = [
      makeService({ name: "Spooler", displayName: "Print Spooler", state: "stopped" }),
      makeService({
        name: "W32Time",
        displayName: "Windows Time",
        state: "running",
        startMode: "auto",
        started: true,
        acceptStop: true,
      }),
    ];

    const cmd = vi.fn(async (command: string) => {
      if (command === "winmgmt_list_services") return services;
      if (command === "winmgmt_get_service_dependencies") return [];
      return 0;
    });

    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<ServicesPanel ctx={ctx} />);

    expect(await screen.findByRole("table", { name: /Windows services list/i })).toBeInTheDocument();
    expect(cmd).toHaveBeenCalledWith("winmgmt_list_services");

    expect(screen.getByRole("textbox", { name: /Search services/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Filter services/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh services/i })).toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 2 services");
  });

  it("supports filtering, marks selected rows, and exposes start action busy state", async () => {
    const services: WindowsService[] = [
      makeService({ name: "Spooler", displayName: "Print Spooler", state: "stopped" }),
      makeService({
        name: "W32Time",
        displayName: "Windows Time",
        state: "running",
        startMode: "auto",
        started: true,
        acceptStop: true,
      }),
    ];

    let resolveStart: () => void = () => {
      throw new Error("Expected start action resolver to be initialized");
    };

    const cmd = vi.fn((command: string) => {
      if (command === "winmgmt_list_services") return Promise.resolve(services);
      if (command === "winmgmt_start_service") {
        return new Promise<number>((resolve) => {
          resolveStart = () => resolve(0);
        });
      }
      if (command === "winmgmt_get_service_dependencies") return Promise.resolve([]);
      return Promise.resolve(0);
    });

    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<ServicesPanel ctx={ctx} />);
    await screen.findByRole("table", { name: /Windows services list/i });

    fireEvent.change(screen.getByRole("combobox", { name: /Filter services/i }), {
      target: { value: "running" },
    });

    expect(screen.queryByText("Print Spooler")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 2 services");

    fireEvent.change(screen.getByRole("combobox", { name: /Filter services/i }), {
      target: { value: "all" },
    });

    const spoolerName = await screen.findByText("Print Spooler");
    fireEvent.click(spoolerName);
    const spoolerRow = spoolerName.closest("tr");
    expect(spoolerRow).toHaveAttribute("aria-selected", "true");

    const startButton = screen.getByRole("button", { name: /Start service Print Spooler/i });
    fireEvent.click(startButton);

    expect(cmd).toHaveBeenCalledWith("winmgmt_start_service", { name: "Spooler" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Start service Print Spooler/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });

    resolveStart();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Start service Print Spooler/i })).toHaveAttribute(
        "aria-busy",
        "false",
      );
    });
  });
});
