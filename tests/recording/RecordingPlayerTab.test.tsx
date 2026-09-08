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
import { RecordingPlayerTab } from "../../src/components/recording/RecordingPlayerTab";
import { loadRdpRecordings } from "../../src/utils/recording/macroService";
import { saveRdpRecordingToFile } from "../../src/utils/recording/recordingFileExport";
import { SessionRenderActivityContext } from "../../src/contexts/SessionRenderActivityContext";
import { savedRdpRecording } from "./recordingLibraryFixture";

vi.mock("../../src/utils/recording/macroService", () => ({
  loadRdpRecordings: vi.fn(),
  rdpRecordingToBlob: vi.fn(() => new Blob(["media"])),
}));
vi.mock("../../src/utils/recording/recordingFileExport", () => ({
  saveRdpRecordingToFile: vi.fn(),
}));

const createUrl = vi.fn();
const revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
  createUrl.mockImplementation(
    () => `blob:recording-${createUrl.mock.calls.length}`,
  );
  vi.mocked(loadRdpRecordings).mockResolvedValue([savedRdpRecording]);
  vi.mocked(saveRdpRecordingToFile).mockResolvedValue("saved");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recording player tab", () => {
  it.each(["webm", "mp4"])(
    "loads selected %s recording with native playback controls and releases it on close",
    async (format) => {
      vi.mocked(loadRdpRecordings).mockResolvedValue([
        { ...savedRdpRecording, format },
      ]);
      const view = render(
        <RecordingPlayerTab recordingId={savedRdpRecording.id} />,
      );
      const video = await screen.findByLabelText(
        "Recording: Selected recording",
      );
      expect(video.tagName).toBe("VIDEO");
      expect(video).toHaveAttribute("controls");
      expect(video).toHaveAttribute("src", "blob:recording-1");
      view.unmount();
      expect(revokeUrl).toHaveBeenCalledWith("blob:recording-1");
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    },
  );

  it("displays GIFs as animated images and removes hidden GIF rendering without leaking its URL", async () => {
    vi.mocked(loadRdpRecordings).mockResolvedValue([
      { ...savedRdpRecording, format: "gif" },
    ]);
    const view = render(
      <SessionRenderActivityContext.Provider value={{ isActive: true }}>
        <RecordingPlayerTab recordingId={savedRdpRecording.id} />
      </SessionRenderActivityContext.Provider>,
    );
    expect(
      await screen.findByAltText("Recording: Selected recording"),
    ).toBeInTheDocument();
    view.rerender(
      <SessionRenderActivityContext.Provider value={{ isActive: false }}>
        <RecordingPlayerTab recordingId={savedRdpRecording.id} />
      </SessionRenderActivityContext.Provider>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(revokeUrl).not.toHaveBeenCalled();
    view.unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it("pauses a hidden video and never auto-resumes it when returning", async () => {
    const tree = (active: boolean) => (
      <SessionRenderActivityContext.Provider value={{ isActive: active }}>
        <RecordingPlayerTab recordingId={savedRdpRecording.id} />
      </SessionRenderActivityContext.Provider>
    );
    const view = render(tree(true));
    await screen.findByLabelText("Recording: Selected recording");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    view.rerender(tree(false));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    view.rerender(tree(true));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("never creates a URL if the tab closes before the library finishes loading", async () => {
    let resolve!: (value: (typeof savedRdpRecording)[]) => void;
    vi.mocked(loadRdpRecordings).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(
      <RecordingPlayerTab recordingId={savedRdpRecording.id} />,
    );
    view.unmount();
    await act(async () => resolve([savedRdpRecording]));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("does not auto-play a recording loaded into an inactive tab", async () => {
    render(
      <SessionRenderActivityContext.Provider value={{ isActive: false }}>
        <RecordingPlayerTab recordingId={savedRdpRecording.id} />
      </SessionRenderActivityContext.Provider>,
    );
    await screen.findByLabelText("Recording: Selected recording");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("ignores an old library response after the recording ID changes", async () => {
    let resolve!: (value: (typeof savedRdpRecording)[]) => void;
    vi.mocked(loadRdpRecordings).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const second = { ...savedRdpRecording, id: "two", name: "Second" };
    const view = render(
      <RecordingPlayerTab recordingId={savedRdpRecording.id} />,
    );
    vi.mocked(loadRdpRecordings).mockResolvedValueOnce([second]);
    view.rerender(<RecordingPlayerTab recordingId="two" />);
    await screen.findByLabelText("Recording: Second");
    await act(async () => resolve([savedRdpRecording]));
    expect(screen.getByLabelText("Recording: Second")).toBeInTheDocument();
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("revokes the old URL and loads the newly selected recording", async () => {
    const second = { ...savedRdpRecording, id: "two", name: "Second" };
    vi.mocked(loadRdpRecordings).mockResolvedValue([savedRdpRecording, second]);
    const view = render(
      <RecordingPlayerTab recordingId={savedRdpRecording.id} />,
    );
    await screen.findByLabelText("Recording: Selected recording");
    view.rerender(<RecordingPlayerTab recordingId="two" />);
    expect(await screen.findByLabelText("Recording: Second")).toHaveAttribute(
      "src",
      "blob:recording-2",
    );
    expect(revokeUrl).toHaveBeenCalledWith("blob:recording-1");
  });

  it("shows an error if the recording was deleted before opening", async () => {
    vi.mocked(loadRdpRecordings).mockResolvedValue([]);
    render(<RecordingPlayerTab recordingId={savedRdpRecording.id} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer in the library",
    );
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("shows media failure while keeping original export available", async () => {
    render(<RecordingPlayerTab recordingId={savedRdpRecording.id} />);
    fireEvent.error(
      await screen.findByLabelText("Recording: Selected recording"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("could not be played");
    expect(screen.getByRole("button", { name: "Save to File" })).toBeEnabled();
  });

  it("guards repeated saves and displays the native write error", async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(saveRdpRecordingToFile).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    render(<RecordingPlayerTab recordingId={savedRdpRecording.id} />);
    await screen.findByLabelText("Recording: Selected recording");
    const button = screen.getByRole("button", { name: "Save to File" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveRdpRecordingToFile).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("disk full")));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("disk full"),
    );
  });

  it("does not display an old export failure against a newly loaded recording", async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(saveRdpRecordingToFile).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const second = { ...savedRdpRecording, id: "two", name: "Second" };
    vi.mocked(loadRdpRecordings).mockResolvedValue([savedRdpRecording, second]);
    const view = render(
      <RecordingPlayerTab recordingId={savedRdpRecording.id} />,
    );
    await screen.findByLabelText("Recording: Selected recording");
    fireEvent.click(screen.getByRole("button", { name: "Save to File" }));
    view.rerender(<RecordingPlayerTab recordingId="two" />);
    await screen.findByLabelText("Recording: Second");
    await act(async () => reject(new Error("old export failed")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
