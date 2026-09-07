import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecordingControls from "../../src/components/rdp/rdpClientHeader/RecordingControls";

describe("recording finalization controls", () => {
  it("shows save progress and exposes no start/stop actions while finalizing", () => {
    render(
      <RecordingControls
        recState={{
          isRecording: false,
          isPaused: false,
          duration: 12,
          isFinalizing: true,
        }}
        startRecording={vi.fn()}
        pauseRecording={vi.fn()}
        resumeRecording={vi.fn()}
        handleStopRecording={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saving recording");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
