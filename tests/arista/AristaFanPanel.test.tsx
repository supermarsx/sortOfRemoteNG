import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import AristaFanPanel from "../../src/components/arista/AristaFanPanel";
import type { AristaCoolingReport } from "../../src/types/hardware/arista";

const config = { host: "sw1.example", username: "admin", password: "pw" };

const fan = (over: Record<string, unknown>) => ({
  trayLabel: "1",
  trayKind: "fanTray",
  fanLabel: "1/1",
  status: "ok",
  actualSpeedPct: 40,
  configuredSpeedPct: 40,
  rpm: 8100,
  maxRpm: 20000,
  uptimeSecs: 10,
  ...over,
});

const report = (fans: unknown[]): AristaCoolingReport =>
  ({
    systemStatus: "coolingOk",
    airflow: "frontToBackAirflow",
    ambientC: 24,
    fans,
    source: "show system environment cooling",
  }) as AristaCoolingReport;

describe("AristaFanPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders fans with status badges and speeds", async () => {
    vi.mocked(invoke).mockResolvedValue(
      report([
        fan({}),
        fan({
          fanLabel: "1/2",
          status: "failed",
          actualSpeedPct: null,
          rpm: 5000,
        }),
        fan({ fanLabel: "1/3", status: null, actualSpeedPct: null, rpm: null }),
      ]),
    );
    render(<AristaFanPanel config={config} pollMs={0} />);
    await waitFor(() =>
      expect(screen.getAllByTestId("arista-fan-status")).toHaveLength(3),
    );
    const tones = screen
      .getAllByTestId("arista-fan-status")
      .map((e) => e.getAttribute("data-tone"));
    expect(tones).toEqual(["ok", "bad", "unknown"]);
    expect(invoke).toHaveBeenCalledWith("arista_get_fan_speeds", { config });
    expect(screen.getByText("40%")).toBeTruthy();
    // rpm/maxRpm fallback: 5000/20000 = 25%
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByTestId("arista-summary").textContent).toContain(
      "coolingOk",
    );
  });

  it("shows empty state", async () => {
    vi.mocked(invoke).mockResolvedValue(report([]));
    render(<AristaFanPanel config={config} pollMs={0} />);
    await waitFor(() =>
      expect(screen.getByText("No fans reported by this switch.")).toBeTruthy(),
    );
  });

  it("shows error state and recovers on refresh", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      "Authentication failed (HTTP 401/403)",
    );
    render(<AristaFanPanel config={config} pollMs={0} />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Authentication failed",
      ),
    );
    vi.mocked(invoke).mockResolvedValueOnce(report([fan({})]));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getAllByTestId("arista-fan-status")).toHaveLength(1);
  });

  it("polls and stops polling on unmount", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(report([fan({})]));
    const { unmount } = render(
      <AristaFanPanel config={config} pollMs={1000} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
