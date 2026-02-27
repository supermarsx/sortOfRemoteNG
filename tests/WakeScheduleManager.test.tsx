import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  scheduleWakeUp: vi.fn(),
  cancelSchedule: vi.fn(),
}));

vi.mock("../src/utils/wakeOnLan", () => ({
  WakeOnLanService: class {
    listSchedules = mocks.listSchedules;
    scheduleWakeUp = mocks.scheduleWakeUp;
    cancelSchedule = mocks.cancelSchedule;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { WakeScheduleManager } from "../src/components/WakeScheduleManager";

describe("WakeScheduleManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSchedules.mockReturnValue([
      {
        macAddress: "00:11:22:33:44:55",
        wakeTime: "2030-01-01T10:00:00.000Z",
        port: 9,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when closed", () => {
    render(<WakeScheduleManager isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText("Wake Schedule Manager")).not.toBeInTheDocument();
  });

  it("renders schedules when open", async () => {
    render(<WakeScheduleManager isOpen onClose={() => {}} />);

    expect(
      await screen.findByText("Wake Schedule Manager"),
    ).toBeInTheDocument();
    expect(screen.getByText("00:11:22:33:44:55")).toBeInTheDocument();
  });

  it("opens new schedule form and calls scheduleWakeUp", async () => {
    render(<WakeScheduleManager isOpen onClose={() => {}} />);

    fireEvent.click(await screen.findByText("New Schedule"));
    fireEvent.change(screen.getByPlaceholderText("00:11:22:33:44:55"), {
      target: { value: "AA:BB:CC:DD:EE:FF" },
    });

    const addButton = screen.getByRole("button", { name: /Add Schedule/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mocks.scheduleWakeUp).toHaveBeenCalled();
    });
  });

  it("closes on Escape when form is not open", async () => {
    const onClose = vi.fn();
    render(<WakeScheduleManager isOpen onClose={onClose} />);

    await screen.findByText("Wake Schedule Manager");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <WakeScheduleManager isOpen onClose={onClose} />,
    );

    await screen.findByText("Wake Schedule Manager");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });
});
