export type NasViewerKind = "text" | "pdf" | "image";
export type NasExternalApplication = "default" | "choose";
export interface NasFileViewerSettings {
  preview: Record<NasViewerKind, boolean>;
  external: Record<NasViewerKind, boolean>;
  application: Record<NasViewerKind, NasExternalApplication>;
  previewMaxMiB: number;
  externalMaxMiB: number;
  confirmExternal: boolean;
  retentionMinutes: number;
  textWrap: boolean;
  textFontSize: number;
  imageFit: "contain" | "actual";
}
export const DEFAULT_NAS_FILE_VIEWERS: NasFileViewerSettings = {
  preview: { text: true, pdf: true, image: true },
  external: { text: false, pdf: false, image: false },
  application: { text: "default", pdf: "default", image: "default" },
  previewMaxMiB: 4,
  externalMaxMiB: 16,
  confirmExternal: true,
  retentionMinutes: 30,
  textWrap: true,
  textFontSize: 13,
  imageFit: "contain",
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : fallback;
export function normalizeNasFileViewers(value: unknown): NasFileViewerSettings {
  const input = record(value),
    preview = record(input.preview),
    external = record(input.external),
    application = record(input.application);
  const defaults = DEFAULT_NAS_FILE_VIEWERS;
  return {
    preview: {
      text: preview.text !== false,
      pdf: preview.pdf !== false,
      image: preview.image !== false,
    },
    external: {
      text: external.text === true,
      pdf: external.pdf === true,
      image: external.image === true,
    },
    application: {
      text: application.text === "choose" ? "choose" : "default",
      pdf: application.pdf === "choose" ? "choose" : "default",
      image: application.image === "choose" ? "choose" : "default",
    },
    previewMaxMiB: number(input.previewMaxMiB, defaults.previewMaxMiB, 1, 16),
    externalMaxMiB: number(
      input.externalMaxMiB,
      defaults.externalMaxMiB,
      1,
      32,
    ),
    confirmExternal: input.confirmExternal !== false,
    retentionMinutes: number(
      input.retentionMinutes,
      defaults.retentionMinutes,
      5,
      1440,
    ),
    textWrap: input.textWrap !== false,
    textFontSize: number(input.textFontSize, defaults.textFontSize, 10, 24),
    imageFit: input.imageFit === "actual" ? "actual" : "contain",
  };
}
