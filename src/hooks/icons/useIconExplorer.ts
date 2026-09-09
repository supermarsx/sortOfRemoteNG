import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useIconLibrary, type IconImportPreview } from "./useIconLibrary";

import {
  MAX_ICON_IMPORT_BYTES,
  MAX_ICON_SVG_BYTES,
} from "../../utils/icons/iconLibrary";
import { getIconLibrarySnapshot } from "../../utils/icons/iconLibraryRuntime";

export function useIconExplorer() {
  const library = useIconLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<IconImportPreview | null>(null);
  const previewRef = useRef<IconImportPreview | null>(null);
  const previewEpoch = useRef<number | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const current = useRef(library);
  current.current = library;
  const replacePreview = (next: IconImportPreview | null) => {
    if (previewRef.current) current.current.discardImport(previewRef.current);
    previewRef.current = next;
    previewEpoch.current = next ? getIconLibrarySnapshot().revision : null;
    setPreview(next);
  };
  const available = () =>
    mounted.current &&
    current.current.ready &&
    !current.current.locked &&
    !current.current.error;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewRef.current) current.current.discardImport(previewRef.current);
      previewRef.current = null;
      previewEpoch.current = null;
    };
  }, []);
  useEffect(() => {
    if (
      !library.ready ||
      library.locked ||
      (previewRef.current && previewEpoch.current !== library.accessEpoch)
    ) {
      const wasReviewed = Boolean(previewRef.current);
      if (previewRef.current) current.current.discardImport(previewRef.current);
      previewRef.current = null;
      previewEpoch.current = null;
      setPreview(null);
      if (wasReviewed && library.ready && !library.locked)
        setMessage(
          "The icon library changed. Choose the file again to review its current conflicts.",
        );
    }
  }, [library.ready, library.locked, library.accessEpoch]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current || !available()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const assertAvailable = (revision: number) => {
    const snapshot = getIconLibrarySnapshot();
    if (
      !available() ||
      !snapshot.ready ||
      snapshot.locked ||
      snapshot.error ||
      snapshot.revision !== revision
    )
      throw new Error(
        "Icon library access changed; reopen the explorer before continuing.",
      );
  };
  const importFile = () =>
    run(async () => {
      const revision = getIconLibrarySnapshot().revision;
      if (!isTauri()) throw new Error("File import requires the desktop app.");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Icon SVG or JSON pack", extensions: ["svg", "json"] },
        ],
      });
      if (typeof path !== "string") return;
      assertAvailable(revision);
      const filename = path.split(/[\\/]/).pop() ?? "Imported icon";
      const format = /\.svg$/i.test(filename)
        ? "svg"
        : /\.json$/i.test(filename)
          ? "json"
          : null;
      if (!format)
        throw new Error("Only SVG and JSON icon packs are supported.");
      const limit =
        format === "svg" ? MAX_ICON_SVG_BYTES : MAX_ICON_IMPORT_BYTES;
      const { stat, readTextFile } = await import("@tauri-apps/plugin-fs");
      const info = await stat(path);
      if (!info.isFile || info.size > limit)
        throw new Error(
          format === "svg"
            ? "Choose an SVG no larger than 64 KiB."
            : "Choose a JSON pack no larger than 1 MiB.",
        );
      assertAvailable(revision);
      const text = await readTextFile(path);
      assertAvailable(revision);
      replacePreview(
        current.current.previewImport(
          text,
          format,
          filename.replace(/\.[^.]+$/, ""),
        ),
      );
    });
  const applyImport = (resolutions: Record<string, "replace" | "skip">) =>
    run(async () => {
      if (!preview) return;
      if (previewEpoch.current === null)
        throw new Error("Import review expired; choose the file again.");
      assertAvailable(previewEpoch.current);
      await current.current.applyImport(preview, resolutions);
      if (mounted.current) {
        replacePreview(null);
        setMessage("Reviewed icon import saved.");
      }
    });
  const exportIcons = (keys: string[], format: "svg" | "json") =>
    run(async () => {
      const revision = getIconLibrarySnapshot().revision;
      if (!isTauri()) throw new Error("File export requires the desktop app.");
      if (!keys.length || (format === "svg" && keys.length !== 1))
        throw new Error(
          "Select one icon for SVG or one or more icons for a JSON pack.",
        );
      const contents =
        format === "svg"
          ? current.current.exportSvg(keys[0])
          : current.current.exportPack(keys);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: format === "svg" ? "icon.svg" : "icon-library.json",
        filters: [
          {
            name: format === "svg" ? "SVG icon" : "Icon JSON pack",
            extensions: [format],
          },
        ],
      });
      if (!path) return;
      assertAvailable(revision);
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      assertAvailable(revision);
      await writeTextFile(path, contents);
      if (mounted.current)
        setMessage(
          `Exported ${keys.length} ${keys.length === 1 ? "icon" : "icons"} as ${format.toUpperCase()}.`,
        );
    });
  const updateMetadata = (key: string, label: string, notes: string) =>
    run(async () => {
      await current.current.updateMetadata(key, { label, notes });
      if (mounted.current)
        setMessage(
          "Personal icon metadata saved. The icon key and artwork are unchanged.",
        );
    });
  const deleteCustom = (keys: string[], reviewedRevision: number) =>
    run(async () => {
      assertAvailable(reviewedRevision);
      await current.current.deleteCustom(keys);
      if (mounted.current)
        setMessage(
          `Deleted ${keys.length} custom ${keys.length === 1 ? "icon" : "icons"}. Built-in icons were not changed.`,
        );
    });
  return {
    ...library,
    busy,
    error: error ?? library.error,
    message,
    preview:
      library.ready &&
      !library.locked &&
      previewEpoch.current === library.accessEpoch
        ? preview
        : null,
    importFile,
    applyImport,
    exportIcons,
    updateMetadata,
    deleteCustom,
    dismissImport: () => {
      if (!pending.current) replacePreview(null);
    },
  };
}
