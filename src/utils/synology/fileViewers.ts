import { invoke } from "@tauri-apps/api/core";
import type {
  NasExternalApplication,
  NasViewerKind,
} from "../../types/settings/nasFileViewers";

export interface NasPreview {
  viewerId: string;
  name: string;
  bytes: number;
  isolation: "os-webview-process";
}
export interface NasViewerOptions {
  textWrap: boolean;
  textFontSize: number;
  imageFit: "contain" | "actual";
}
export interface NasPreviewCloseScope {
  instanceId: string;
  expectedSessionId: string;
  viewerId: string;
}
export interface NasFileReadScope {
  instanceId: string;
  expectedSessionId: string;
  path: string;
  kind: NasViewerKind;
  maxBytes: number;
}
export function nasViewerKind(name: string): NasViewerKind | null {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension ?? ""))
    return "image";
  if (
    [
      "txt",
      "log",
      "md",
      "csv",
      "tsv",
      "json",
      "xml",
      "yaml",
      "yml",
      "toml",
      "ini",
      "conf",
      "cfg",
      "html",
      "htm",
      "svg",
      "css",
      "js",
      "ts",
      "sh",
      "ps1",
      "bat",
      "sql",
    ].includes(extension ?? "")
  )
    return "text";
  return null;
}
const hasControl = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const isViewerId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !hasControl(value);
export function validateNasPreview(
  value: unknown,
  maxBytes: number,
): NasPreview {
  const invalid = () =>
    new Error(
      "The native viewer returned an invalid isolation receipt. No preview content was loaded in this window.",
    );
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16 * 1024 * 1024
  )
    throw invalid();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some(
      (key) => !["viewerId", "name", "bytes", "isolation"].includes(key),
    ) ||
    !isViewerId(item.viewerId) ||
    item.isolation !== "os-webview-process" ||
    typeof item.name !== "string" ||
    !item.name ||
    item.name.length > 255 ||
    hasControl(item.name) ||
    item.name.includes("/") ||
    item.name.includes("\\") ||
    typeof item.bytes !== "number" ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0 ||
    item.bytes > maxBytes ||
    item.bytes > 16 * 1024 * 1024
  )
    throw invalid();
  return {
    viewerId: item.viewerId,
    name: item.name,
    bytes: item.bytes,
    isolation: item.isolation,
  };
}
function assertRequest(scope: NasFileReadScope, cap: number) {
  if (
    !isIdentifier(scope.instanceId) ||
    !isIdentifier(scope.expectedSessionId) ||
    !scope.path.startsWith("/") ||
    scope.path.length > 4096 ||
    hasControl(scope.path) ||
    !["text", "pdf", "image"].includes(scope.kind) ||
    !Number.isSafeInteger(scope.maxBytes) ||
    scope.maxBytes < 1 ||
    scope.maxBytes > cap
  )
    throw new Error("The selected NAS file is not eligible for this viewer.");
}
/** Cleanup is tied to the captured receipt, not the newly active NAS/owner lease. */
export async function closeNasPreview(
  scope: NasPreviewCloseScope,
): Promise<boolean> {
  if (
    !isIdentifier(scope.instanceId) ||
    !isIdentifier(scope.expectedSessionId) ||
    !isViewerId(scope.viewerId)
  )
    throw new Error("The native viewer close receipt is invalid.");
  const result: unknown = await invoke("syn_fs_close_preview", { ...scope });
  if (typeof result !== "boolean")
    throw new Error(
      "The native viewer did not acknowledge closing. Close its window directly or retry.",
    );
  return result;
}
/** Only a process handle crosses IPC; file bytes and parsers stay out of the app WebView. */
export async function previewNasFile(
  scope: NasFileReadScope,
  viewerOptions: NasViewerOptions,
  assertCurrent: () => void,
): Promise<NasPreview> {
  assertRequest(scope, 16 * 1024 * 1024);
  if (
    typeof viewerOptions.textWrap !== "boolean" ||
    !Number.isInteger(viewerOptions.textFontSize) ||
    viewerOptions.textFontSize < 10 ||
    viewerOptions.textFontSize > 24 ||
    !["contain", "actual"].includes(viewerOptions.imageFit)
  )
    throw new Error("The native viewer preferences are invalid.");
  assertCurrent();
  const value: unknown = await invoke("syn_fs_preview_file", {
    ...scope,
    viewerOptions: {
      textWrap: viewerOptions.textWrap,
      textFontSize: viewerOptions.textFontSize,
      imageFit: viewerOptions.imageFit,
    },
  });
  try {
    const receipt = validateNasPreview(value, scope.maxBytes);
    assertCurrent();
    return receipt;
  } catch (error) {
    const viewerId =
      value && typeof value === "object"
        ? (value as Record<string, unknown>).viewerId
        : undefined;
    if (isViewerId(viewerId))
      await closeNasPreview({
        instanceId: scope.instanceId,
        expectedSessionId: scope.expectedSessionId,
        viewerId,
      }).catch(() => {
        console.warn(
          "A stale NAS viewer could not acknowledge closing; session cleanup remains responsible for terminating it.",
        );
      });
    throw error;
  }
}
export async function openNasFileExternally(
  scope: NasFileReadScope,
  application: NasExternalApplication,
  retentionMinutes: number,
  assertCurrent: () => void,
) {
  assertRequest(scope, 32 * 1024 * 1024);
  if (
    !["default", "choose"].includes(application) ||
    !Number.isInteger(retentionMinutes) ||
    retentionMinutes < 5 ||
    retentionMinutes > 1440
  )
    throw new Error("The external viewer preferences are invalid.");
  assertCurrent();
  const value: unknown = await invoke("syn_fs_open_external", {
    ...scope,
    application,
    retentionMinutes,
  });
  assertCurrent();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The external viewer returned an invalid response.");
  const result = value as Record<string, unknown>;
  if (
    typeof result.cancelled !== "boolean" ||
    typeof result.message !== "string" ||
    result.message.length > 1024 ||
    Object.keys(result).some((key) => !["cancelled", "message"].includes(key))
  )
    throw new Error("The external viewer returned an invalid response.");
  return { cancelled: result.cancelled, message: result.message };
}
