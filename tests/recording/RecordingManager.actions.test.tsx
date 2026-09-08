import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingManager } from "../../src/components/recording/RecordingManager";
import * as macroService from "../../src/utils/recording/macroService";
import { saveRdpRecordingToFile } from "../../src/utils/recording/recordingFileExport";
import { createRecordingPlayerSession } from "../../src/components/app/toolSession";
import { savedRdpRecording } from "./recordingLibraryFixture";
import type { ConnectionSession } from "../../src/types/connection/connection";

const harness = vi.hoisted(() => ({
  settings: { confirmDeleteRecording: undefined as boolean | undefined },
  state: { sessions: [] as ConnectionSession[] },
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: harness.settings }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => harness,
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadRecordings: vi.fn().mockResolvedValue([]),
  loadRdpRecordings: vi.fn(),
  loadWebRecordings: vi.fn().mockResolvedValue([]),
  loadWebVideoRecordings: vi.fn().mockResolvedValue([]),
  deleteRdpRecording: vi.fn(),
  saveRdpRecordings: vi.fn(),
}));
vi.mock("../../src/utils/recording/recordingFileExport", () => ({
  saveRdpRecordingToFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  harness.settings.confirmDeleteRecording = undefined;
  harness.state.sessions = [];
  vi.mocked(macroService.loadRdpRecordings).mockResolvedValue([
    savedRdpRecording,
  ]);
  vi.mocked(macroService.deleteRdpRecording).mockResolvedValue(undefined);
  vi.mocked(saveRdpRecordingToFile).mockResolvedValue("saved");
});
afterEach(cleanup);

async function openManager(onActivateSession = vi.fn()) {
  const view = render(
    <RecordingManager
      isOpen
      onClose={vi.fn()}
      onActivateSession={onActivateSession}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /RDP Screen/ }));
  fireEvent.click(await screen.findByText("Selected recording"));
  return { ...view, onActivateSession };
}

describe("Recording Manager actions", () => {
  it("opens a dedicated local player tab and deduplicates rapid Play clicks", async () => {
    const { onActivateSession } = await openManager();
    const play = screen.getByRole("button", { name: "Play" });
    act(() => {
      fireEvent.click(play);
      fireEvent.click(play);
    });
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    const session = harness.dispatch.mock.calls[0][0].payload;
    expect(session.protocol).toBe("tool:recordingPlayer");
    expect(session.recordingPlayer).toEqual({
      recordingId: savedRdpRecording.id,
    });
    expect(session).not.toHaveProperty("backendSessionId");
    expect(JSON.stringify(session)).not.toContain(savedRdpRecording.data);
    expect(onActivateSession).toHaveBeenNthCalledWith(1, session.id);
    expect(onActivateSession).toHaveBeenNthCalledWith(2, session.id);
  });

  it("focuses an existing recording tab without adding another", async () => {
    const existing = createRecordingPlayerSession(
      savedRdpRecording.id,
      savedRdpRecording.name,
    );
    harness.state.sessions = [existing];
    const { onActivateSession } = await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(onActivateSession).toHaveBeenCalledWith(existing.id);
  });

  it("can reopen the player after its prior tab is closed", async () => {
    const existing = createRecordingPlayerSession(
      savedRdpRecording.id,
      savedRdpRecording.name,
    );
    harness.state.sessions = [existing];
    const { rerender, onActivateSession } = await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    harness.state.sessions = [];
    rerender(
      <RecordingManager
        isOpen
        onClose={vi.fn()}
        onActivateSession={onActivateSession}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0][0].payload.id).toBe(existing.id);
  });

  it("shows confirmation by default and Cancel leaves the recording untouched", async () => {
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent(
      "Selected recording",
    );
    expect(macroService.deleteRdpRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(macroService.deleteRdpRecording).not.toHaveBeenCalled();
  });

  it("Enter on the real focused Cancel button cannot trigger deletion", async () => {
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    // Let the modal's initial focus animation finish before the user moves focus.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter", code: "Enter" });
    expect(macroService.deleteRdpRecording).not.toHaveBeenCalled();
    // jsdom does not synthesize the browser's button click from Enter.
    fireEvent.click(cancel);
    expect(macroService.deleteRdpRecording).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("accepting confirmation deletes only the chosen recording once", async () => {
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByTestId("confirm-yes"));
    await waitFor(() =>
      expect(macroService.deleteRdpRecording).toHaveBeenCalledExactlyOnceWith(
        savedRdpRecording.id,
      ),
    );
    expect(macroService.saveRdpRecordings).not.toHaveBeenCalled();
  });

  it("honors the persisted disabled confirmation setting", async () => {
    harness.settings.confirmDeleteRecording = false;
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(macroService.deleteRdpRecording).toHaveBeenCalledExactlyOnceWith(
        savedRdpRecording.id,
      ),
    );
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("also confirms Clear All and cancelling does not clear the library", async () => {
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent(
      "Delete all RDP recordings",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(macroService.saveRdpRecordings).not.toHaveBeenCalled();
  });

  it("closing the manager cancels an unanswered deletion prompt", async () => {
    const { rerender, onActivateSession } = await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByTestId("confirm-dialog");
    rerender(
      <RecordingManager
        isOpen={false}
        onClose={vi.fn()}
        onActivateSession={onActivateSession}
      />,
    );
    rerender(
      <RecordingManager
        isOpen
        onClose={vi.fn()}
        onActivateSession={onActivateSession}
      />,
    );
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(macroService.deleteRdpRecording).not.toHaveBeenCalled();
  });

  it("passes the selected recording to the native export flow and cancel is not an error", async () => {
    vi.mocked(saveRdpRecordingToFile).mockResolvedValue("cancelled");
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Save to File" }));
    await waitFor(() =>
      expect(saveRdpRecordingToFile).toHaveBeenCalledExactlyOnceWith(
        savedRdpRecording,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows export errors in the manager", async () => {
    vi.mocked(saveRdpRecordingToFile).mockRejectedValueOnce(
      new Error("native write denied"),
    );
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Save to File" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "native write denied",
    );
  });

  it("shows deletion failure without clearing the library", async () => {
    vi.mocked(macroService.deleteRdpRecording).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByTestId("confirm-yes"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "storage unavailable",
    );
    expect(screen.getByText("Selected recording")).toBeInTheDocument();
  });
});
