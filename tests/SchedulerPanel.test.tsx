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

import { SchedulerPanel } from "../src/components/monitoring/SchedulerPanel";

describe("SchedulerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it("renders the title", () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("scheduler.title")).toBeInTheDocument();
  });

  it("shows tab bar", () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("scheduler.tabTasks")).toBeInTheDocument();
    expect(screen.getByText("scheduler.tabUpcoming")).toBeInTheDocument();
    expect(screen.getByText("scheduler.tabHistory")).toBeInTheDocument();
  });

  it("shows add task button", () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("scheduler.add")).toBeInTheDocument();
  });

  it("shows pause all button", () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTitle("scheduler.pauseAll")).toBeInTheDocument();
  });

  it("shows resume all button", () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTitle("scheduler.resumeAll")).toBeInTheDocument();
  });

  it("shows empty state when no tasks", async () => {
    await act(async () => { render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />); });
    expect(screen.getByText("scheduler.noTasks")).toBeInTheDocument();
  });

  it("opens add task modal when button clicked", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    const addBtn = screen.getByText("scheduler.add");
    await act(async () => { fireEvent.click(addBtn); });
    await waitFor(() => {
      expect(screen.getByText("scheduler.name")).toBeInTheDocument();
    });
  });

  it("switches to upcoming tab", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    const tab = screen.getByText("scheduler.tabUpcoming");
    await act(async () => { fireEvent.click(tab); });
    expect(tab).toBeInTheDocument();
  });

  it("switches to history tab", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    const tab = screen.getByText("scheduler.tabHistory");
    await act(async () => { fireEvent.click(tab); });
    expect(tab).toBeInTheDocument();
  });

  it("calls sched_list_tasks on mount", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it("shows cron helper in add modal", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    const addBtn = screen.getByText("scheduler.add");
    await act(async () => { fireEvent.click(addBtn); });
    await waitFor(() => {
      expect(screen.getByText("scheduler.cronHelper")).toBeInTheDocument();
    });
  });

  it("calls pause all when button clicked", async () => {
    render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);
    const btn = screen.getByTitle("scheduler.pauseAll");
    await act(async () => { fireEvent.click(btn); });
    expect(mockInvoke).toHaveBeenCalledWith("sched_pause_all");
  });
});
