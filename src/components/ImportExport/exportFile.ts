import { getInvoke } from "../../utils/tauri/invoke";

export type ExportFileResult =
  | { status: "saved"; path: string }
  | { status: "downloaded"; filename: string }
  | { status: "cancelled" };

/**
 * Only a completed native write supplies a destination; browsers own their paths.
 * assertAccess must throw/reject when source access has expired. Recheck after
 * asynchronous preparation, including the Save dialog, before releasing bytes.
 */
export async function saveExportFile(
  content: string | Uint8Array,
  filename: string,
  mimeType: string,
  assertAccess?: () => void | Promise<void>,
): Promise<ExportFileResult> {
  await assertAccess?.();
  const invoke = await getInvoke();
  await assertAccess?.();
  if (invoke) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    await assertAccess?.();
    const path = await save({
      title: "Export databases",
      defaultPath: filename,
    });
    if (path === null) return { status: "cancelled" };
    await assertAccess?.();
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await assertAccess?.();
    await writeFile(
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    );
    return { status: "saved", path };
  }

  await assertAccess?.();
  return downloadExportFile(content, filename, mimeType);
}

export function downloadExportFile(
  content: string | Uint8Array,
  filename: string,
  mimeType: string,
): ExportFileResult {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  return { status: "downloaded", filename };
}

export async function openExportFolder(path: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error("Opening an export folder requires the desktop app.");
  const { dirname } = await import("@tauri-apps/api/path");
  await invoke("open_folder", { path: await dirname(path) });
}
