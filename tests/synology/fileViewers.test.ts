import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  closeNasPreview,
  validateNasPreview,
  nasViewerKind,
  openNasFileExternally,
  previewNasFile,
} from "../../src/utils/synology/fileViewers";
import {
  DEFAULT_NAS_FILE_VIEWERS,
  normalizeNasFileViewers,
} from "../../src/types/settings/nasFileViewers";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const scope = {
  instanceId: "instance-a",
  expectedSessionId: "session-a",
  path: "/public/note.txt",
  kind: "text" as const,
  maxBytes: 1024,
};
const options = {
  textWrap: true,
  textFontSize: 13,
  imageFit: "contain" as const,
};
const response = {
  viewerId: "viewer-a",
  name: "note.txt",
  bytes: 5,
  isolation: "os-webview-process",
};
const closeScope = {
  instanceId: "instance-a",
  expectedSessionId: "session-a",
  viewerId: "viewer-a",
};
beforeEach(() => vi.mocked(invoke).mockReset());

describe("isolated NAS viewer adapter", () => {
  it("defaults to preview-only and normalizes malformed external grants closed while preserving false preferences", () => {
    expect(normalizeNasFileViewers(undefined)).toEqual(
      DEFAULT_NAS_FILE_VIEWERS,
    );
    expect(
      normalizeNasFileViewers({
        preview: { text: false },
        external: { text: "true", pdf: 1 },
        confirmExternal: false,
        textWrap: false,
        previewMaxMiB: 100,
        retentionMinutes: 0,
      }),
    ).toMatchObject({
      preview: { text: false },
      external: { text: false, pdf: false, image: false },
      confirmExternal: false,
      textWrap: false,
      previewMaxMiB: 4,
      retentionMinutes: 30,
    });
  });
  it("classifies HTML/SVG/scripts as text and refuses arbitrary executable or unknown types", () => {
    for (const name of ["untrusted.HTML", "drawing.svg", "script.ps1"])
      expect(nasViewerKind(name)).toBe("text");
    expect(nasViewerKind("manual.PDF")).toBe("pdf");
    expect(nasViewerKind("picture.webp")).toBe("image");
    expect(nasViewerKind("program.exe")).toBeNull();
    expect(nasViewerKind("unknown.bin")).toBeNull();
  });
  it("accepts only an isolation handle and sends explicit display options through fixed IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(response);
    const guard = vi.fn();
    expect(await previewNasFile(scope, options, guard)).toEqual(response);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("syn_fs_preview_file", {
      ...scope,
      viewerOptions: options,
    });
  });
  it.each([
    { ...response, bytes: 1025 },
    { ...response, bytes: -1 },
    { ...response, isolation: "worker" },
    { ...response, name: "../secret.txt" },
    { ...response, viewerId: "../viewer" },
    { ...response, viewerId: "v".repeat(129) },
    { ...response, dataBase64: "aGVsbG8=" },
    { ...response, text: "private bytes" },
  ])("rejects malformed or content-bearing preview response %#", (value) => {
    expect(() => validateNasPreview(value, 1024)).toThrow(/isolation receipt/);
  });
  it("accepts zero-byte text metadata without receiving or decoding file content", () => {
    expect(validateNasPreview({ ...response, bytes: 0 }, 1024).bytes).toBe(0);
  });
  it("closes the exact returned handle after post-launch lease revocation", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_close_preview" ? true : response,
    );
    const guard = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error("revoked");
      });
    await expect(previewNasFile(scope, options, guard)).rejects.toThrow(
      "revoked",
    );
    expect(invoke).toHaveBeenLastCalledWith("syn_fs_close_preview", closeScope);
  });
  it("cleans up a bounded returned handle even if its other metadata is invalid", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_close_preview"
        ? true
        : { ...response, isolation: "unsandboxed" },
    );
    await expect(previewNasFile(scope, options, () => {})).rejects.toThrow(
      /isolation receipt/,
    );
    expect(invoke).toHaveBeenLastCalledWith("syn_fs_close_preview", closeScope);
  });
  it("refuses launch before IPC if owner access or bounded options are invalid", async () => {
    await expect(
      previewNasFile(scope, options, () => {
        throw new Error("locked");
      }),
    ).rejects.toThrow("locked");
    await expect(
      previewNasFile(scope, { ...options, textFontSize: 100 }, () => {}),
    ).rejects.toThrow();
    await expect(
      previewNasFile(
        { ...scope, maxBytes: 16 * 1024 * 1024 + 1 },
        options,
        () => {},
      ),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("permits exact old-receipt close cleanup and rejects malformed acknowledgement", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    expect(await closeNasPreview(closeScope)).toBe(false);
    expect(invoke).toHaveBeenCalledWith("syn_fs_close_preview", closeScope);
    vi.mocked(invoke).mockResolvedValue({ success: true });
    await expect(closeNasPreview(closeScope)).rejects.toThrow(
      /acknowledge closing/,
    );
  });
  it("sends only a closed external application choice, bounds retention and distinguishes cancellation", async () => {
    vi.mocked(invoke).mockResolvedValue({
      cancelled: true,
      message: "Cancelled",
    });
    expect(await openNasFileExternally(scope, "choose", 30, () => {})).toEqual({
      cancelled: true,
      message: "Cancelled",
    });
    expect(invoke).toHaveBeenCalledWith("syn_fs_open_external", {
      ...scope,
      application: "choose",
      retentionMinutes: 30,
    });
    vi.mocked(invoke).mockClear();
    await expect(
      openNasFileExternally(scope, "choose", 1441, () => {}),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
