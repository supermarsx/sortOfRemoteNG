import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  renderHook,
} from "@testing-library/react";
import { WOLQuickTool } from "../../src/components/network/WOLQuickTool";
import { useWOLQuickTool } from "../../src/hooks/network/useWOLQuickTool";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/utils/network/macVendorLookup", () => ({
  lookupVendor: vi.fn().mockResolvedValue({ vendor: null, source: null }),
  lookupVendorLocal: vi.fn().mockReturnValue(null),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { lookupVendor } from "../../src/utils/network/macVendorLookup";

const successfulOutcome = {
  sentTo: ["192.168.1.255:9"],
  warnings: [],
  configuredBroadcastDelivered: true,
  limitedBroadcastFallbackDelivered: false,
  resolvedTargetDelivered: false,
  targetResolutionFailed: false,
};

describe("WOLQuickTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    // Wait for any pending async operations to complete
    vi.clearAllTimers();
  });

  it("renders when open", () => {
    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    expect(screen.getByText("Wake-on-LAN")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<WOLQuickTool isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText("Wake-on-LAN")).not.toBeInTheDocument();
  });

  it("formats MAC address correctly", () => {
    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("00:11:22:33:44:55");

    fireEvent.change(input, { target: { value: "001122334455" } });
    expect(input).toHaveValue("00:11:22:33:44:55");
  });

  it("sends wake packet on button click", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(successfulOutcome);

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("00:11:22:33:44:55");
    const wakeButton = screen.getByText("Wake");

    fireEvent.change(input, { target: { value: "00:11:22:33:44:55" } });
    fireEvent.click(wakeButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "wake_on_lan",
        expect.objectContaining({
          macAddress: "00:11:22:33:44:55",
        }),
      );
    });
  });

  it("shows a DNS warning while preserving configured-broadcast delivery", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...successfulOutcome,
      warnings: [
        "DNS resolution for 'missing.example' failed; continuing with the available broadcast destination",
      ],
      targetResolutionFailed: true,
    });

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Advanced Options"));
    fireEvent.change(
      screen.getByPlaceholderText("host.example.com or 192.168.1.20"),
      {
        target: { value: "missing.example" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("00:11:22:33:44:55"), {
      target: { value: "00:11:22:33:44:55" },
    });
    fireEvent.click(screen.getByText("Wake"));

    await waitFor(() => {
      expect(
        screen.getByText(/Wake packet sent .* with warnings/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/continuing with the available broadcast/),
      ).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith(
      "wake_on_lan",
      expect.objectContaining({ targetAddress: "missing.example" }),
    );
  });

  it("labels configured-broadcast DNS failure as limited-broadcast fallback", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...successfulOutcome,
      sentTo: ["255.255.255.255:9"],
      warnings: [
        "DNS resolution for 'bad broadcast' failed; using limited broadcast 255.255.255.255 instead",
      ],
      configuredBroadcastDelivered: false,
      limitedBroadcastFallbackDelivered: true,
    });

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("00:11:22:33:44:55"), {
      target: { value: "00:11:22:33:44:55" },
    });
    fireEvent.click(screen.getByText("Wake"));

    expect(
      await screen.findByText(/using only the limited-broadcast fallback/),
    ).toBeInTheDocument();
  });

  it("does not say only fallback when a resolved target also received the packet", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...successfulOutcome,
      sentTo: ["192.168.1.20:9", "255.255.255.255:9"],
      warnings: [
        "DNS resolution for 'bad broadcast' failed; using limited broadcast 255.255.255.255 instead",
      ],
      configuredBroadcastDelivered: false,
      limitedBroadcastFallbackDelivered: true,
      resolvedTargetDelivered: true,
    });

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("00:11:22:33:44:55"), {
      target: { value: "00:11:22:33:44:55" },
    });
    fireEvent.click(screen.getByText("Wake"));

    expect(
      await screen.findByText(
        /using the resolved target and limited-broadcast fallback/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/using only the limited-broadcast fallback/),
    ).not.toBeInTheDocument();
  });

  it("shows error for invalid MAC address", async () => {
    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("00:11:22:33:44:55");
    const wakeButton = screen.getByText("Wake");

    fireEvent.change(input, { target: { value: "00:11:22" } });
    fireEvent.click(wakeButton);

    await waitFor(() => {
      expect(
        screen.getByText("Invalid MAC address format"),
      ).toBeInTheDocument();
    });
  });

  it("scans for devices", async () => {
    const mockDevices = [
      {
        ip: "192.168.1.100",
        mac: "00:11:22:33:44:55",
        hostname: "test-device",
        last_seen: "2026-01-04T00:00:00Z",
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(mockDevices);

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    const scanButton = screen.getByText("Scan ARP");

    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("discover_wol_devices");
      expect(screen.getByText("00:11:22:33:44:55")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scan ARP" })).toBeEnabled();
    });
  });

  it("cancels a pending vendor lookup when unmounted", async () => {
    const mockDevice = {
      ip: "192.168.1.100",
      mac: "00:11:22:33:44:55",
      hostname: "test-device",
      last_seen: "2026-01-04T00:00:00Z",
    };
    let resolveLookup!: (value: {
      vendor: string | null;
      source: "local" | "maclookup" | "macvendors" | null;
    }) => void;
    let lookupSignal: AbortSignal | undefined;

    vi.mocked(invoke).mockResolvedValueOnce([mockDevice]);
    vi.mocked(lookupVendor).mockImplementationOnce((_mac, signal) => {
      lookupSignal = signal;
      return new Promise((resolve) => {
        resolveLookup = resolve;
      });
    });

    const { unmount } = render(
      <WOLQuickTool isOpen={true} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Scan ARP"));

    await waitFor(() => expect(lookupVendor).toHaveBeenCalledOnce());
    expect(lookupSignal?.aborted).toBe(false);

    unmount();
    expect(lookupSignal?.aborted).toBe(true);

    await act(async () => {
      resolveLookup({ vendor: null, source: null });
      await Promise.resolve();
    });
  });

  it("keeps the latest scan results when an earlier lookup resolves late", async () => {
    const firstDevice = {
      ip: "192.168.1.100",
      mac: "00:11:22:33:44:55",
      hostname: "first-device",
      last_seen: "2026-01-04T00:00:00Z",
    };
    const secondDevice = {
      ip: "192.168.1.101",
      mac: "00:11:24:33:44:66",
      hostname: "second-device",
      last_seen: "2026-01-04T00:00:01Z",
    };
    let resolveFirstLookup!: (value: {
      vendor: string | null;
      source: "local" | "maclookup" | "macvendors" | null;
    }) => void;
    let firstLookupSignal: AbortSignal | undefined;

    vi.mocked(invoke)
      .mockResolvedValueOnce([firstDevice])
      .mockResolvedValueOnce([secondDevice]);
    vi.mocked(lookupVendor)
      .mockImplementationOnce((_mac, signal) => {
        firstLookupSignal = signal;
        return new Promise((resolve) => {
          resolveFirstLookup = resolve;
        });
      })
      .mockResolvedValueOnce({ vendor: "Second Vendor", source: "maclookup" });

    const { result } = renderHook(() => useWOLQuickTool(() => {}));
    let firstScan!: Promise<void>;
    await act(async () => {
      firstScan = result.current.handleScan();
      await Promise.resolve();
    });
    await waitFor(() => expect(lookupVendor).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.handleScan();
    });

    expect(firstLookupSignal?.aborted).toBe(true);
    expect(result.current.isScanning).toBe(false);
    expect(result.current.devices).toEqual([
      expect.objectContaining({
        mac: secondDevice.mac,
        vendor: "Second Vendor",
      }),
    ]);

    await act(async () => {
      resolveFirstLookup({ vendor: "Late Vendor", source: "macvendors" });
      await firstScan;
    });

    expect(result.current.devices).toEqual([
      expect.objectContaining({
        mac: secondDevice.mac,
        vendor: "Second Vendor",
      }),
    ]);
  });

  it("counts structured warnings when waking selected devices", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const device = {
        ip: "192.168.1.100",
        mac: "00:11:24:33:44:55",
        hostname: "test-device.example.com",
        last_seen: "2026-01-04T00:00:00Z",
      };
      const warning = "Target DNS lookup failed; broadcast delivery succeeded";
      vi.mocked(invoke)
        .mockResolvedValueOnce([device])
        .mockResolvedValueOnce({
          ...successfulOutcome,
          warnings: [warning],
          targetResolutionFailed: true,
        });

      render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Scan ARP"));
      const mac = await screen.findByText(device.mac);
      const row = mac.closest('[role="button"]');
      expect(row).toBeTruthy();
      const selectionButton = row?.querySelector("button");
      expect(selectionButton).toBeTruthy();
      fireEvent.click(selectionButton!);
      fireEvent.click(screen.getByText(/Wake Selected/));

      expect(
        await screen.findByText(/1 used a DNS or delivery fallback/),
      ).toBeInTheDocument();
      expect(invoke).toHaveBeenLastCalledWith(
        "wake_on_lan",
        expect.objectContaining({
          macAddress: device.mac,
          targetAddress: device.hostname,
        }),
      );
      expect(warningSpy.mock.calls).toEqual([
        [`Wake-on-LAN warnings for ${device.mac}:`, [warning]],
      ]);
    } finally {
      warningSpy.mockRestore();
    }
  });

  it("saves recent MACs to localStorage", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    render(<WOLQuickTool isOpen={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("00:11:22:33:44:55");
    const wakeButton = screen.getByText("Wake");

    fireEvent.change(input, { target: { value: "00:11:22:33:44:55" } });
    fireEvent.click(wakeButton);

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("wol-recent-macs") || "[]");
      expect(saved).toContain("00:11:22:33:44:55");
    });
  });

  it("calls onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <WOLQuickTool isOpen={true} onClose={onClose} />,
    );

    const backdrop = container.querySelector(".fixed.inset-0");
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it("calls onClose when clicking X button", () => {
    const onClose = vi.fn();
    const { container } = render(
      <WOLQuickTool isOpen={true} onClose={onClose} />,
    );

    // Find the X button by finding the button with an svg child
    const buttons = container.querySelectorAll("button");
    const xButton = Array.from(buttons).find((btn) =>
      btn.querySelector("svg.lucide-x"),
    );
    if (xButton) {
      fireEvent.click(xButton);
      expect(onClose).toHaveBeenCalled();
    }
  });
});
