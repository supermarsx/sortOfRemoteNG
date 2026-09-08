import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { SavedRDPRecording } from "../../types/recording/macroTypes";
import { rdpRecordingToBlob } from "./macroService";

/** Export the selected recording unchanged, only after the user chooses a path. */
export async function saveRdpRecordingToFile(
  recording: SavedRDPRecording,
): Promise<"saved" | "cancelled"> {
  const extension =
    recording.format === "gif" || recording.format === "mp4"
      ? recording.format
      : "webm";
  const name = recording.name.replace(/[^a-zA-Z0-9-_]/g, "_") || "recording";
  const path = await save({
    title: "Save recording",
    defaultPath: `${name}.${extension}`,
    filters: [
      { name: `${extension.toUpperCase()} recording`, extensions: [extension] },
    ],
  });
  if (path === null) return "cancelled";

  const blob = rdpRecordingToBlob(recording);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return "saved";
}
