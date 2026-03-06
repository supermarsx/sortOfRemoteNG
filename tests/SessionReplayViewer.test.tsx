import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { SessionReplayViewer } from "../src/components/recording/SessionReplayViewer";

const mockSession = {
  id: "sess-1",
  title: "Test Session",
  replayType: "terminal",
  durationMs: 60000,
  startTime: "2026-01-01T00:00:00Z",
};

function setupMock() {
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "replay_load_terminal":
      case "replay_load_video":
      case "replay_load_har":
        return { ...mockSession };
      case "replay_get_timeline":
        return { totalDurationMs: 60000, segments: [], markers: [] };
      case "replay_list_annotations":
        return [];
      case "replay_list_bookmarks":
        return [];
      case "replay_get_position":
        return { currentTimeMs: 0, totalTimeMs: 60000, percent: 0 };
      default:
        return null;
    }
  });
}

describe("SessionReplayViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
  });

  it("renders the component", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByText("Test Session")).toBeInTheDocument();
  });

  it("shows empty state when no session loaded", async () => {
    mockInvoke.mockResolvedValue(null);
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByText("replay.noSession")).toBeInTheDocument();
  });

  it("shows playback controls", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByTitle("replay.play")).toBeInTheDocument();
    expect(screen.getByTitle("replay.stop")).toBeInTheDocument();
  });

  it("shows speed selector", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByTitle("replay.speed")).toBeInTheDocument();
  });

  it("shows annotations section", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByText(/replay\.annotations/)).toBeInTheDocument();
  });

  it("shows bookmarks section", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByText(/replay\.bookmarks/)).toBeInTheDocument();
  });

  it("shows export button", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByText("replay.export")).toBeInTheDocument();
  });

  it("shows search field", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(screen.getByTitle("replay.search")).toBeInTheDocument();
  });

  it("has keyboard shortcut handler for space bar", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    // space key should trigger play/pause
    await act(async () => {
      fireEvent.keyDown(document, { key: " " });
    });
    // Verify the component handles this without errors
    expect(screen.getByText("Test Session")).toBeInTheDocument();
  });

  it("shows timeline section", async () => {
    await act(async () => {
      render(<SessionReplayViewer recordingId="test-recording-1" replayType="terminal" />);
    });
    expect(document.querySelector(".sor-replay-timeline")).toBeInTheDocument();
  });
});
