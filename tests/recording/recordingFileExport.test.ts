import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { saveRdpRecordingToFile } from "../../src/utils/recording/recordingFileExport";
import { savedRdpRecording } from "./recordingLibraryFixture";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Blob", NodeBlob);
  vi.mocked(save).mockResolvedValue("C:/chosen/recording.webm");
  vi.mocked(writeFile).mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("native recording export", () => {
  it.each(["webm", "mp4", "gif"])(
    "prompts for a %s path and writes exact decoded library bytes",
    async (format) => {
      expect(
        await saveRdpRecordingToFile({ ...savedRdpRecording, format }),
      ).toBe("saved");
      expect(save).toHaveBeenCalledWith({
        title: "Save recording",
        defaultPath: `Selected_recording.${format}`,
        filters: [
          { name: `${format.toUpperCase()} recording`, extensions: [format] },
        ],
      });
      expect(writeFile).toHaveBeenCalledWith(
        "C:/chosen/recording.webm",
        new Uint8Array([0, 1, 2, 255]),
      );
    },
  );

  it("cancellation neither decodes corrupt data nor writes a file", async () => {
    vi.mocked(save).mockResolvedValue(null);
    expect(
      await saveRdpRecordingToFile({ ...savedRdpRecording, data: "%%%" }),
    ).toBe("cancelled");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("propagates native dialog failure without writing", async () => {
    vi.mocked(save).mockRejectedValueOnce(new Error("dialog unavailable"));
    await expect(saveRdpRecordingToFile(savedRdpRecording)).rejects.toThrow(
      "dialog unavailable",
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("propagates native write failure without reporting success", async () => {
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(saveRdpRecordingToFile(savedRdpRecording)).rejects.toThrow(
      "disk full",
    );
  });
});
