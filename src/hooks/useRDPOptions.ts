import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Connection,
  DEFAULT_RDP_SETTINGS,
  RdpConnectionSettings,
} from "../types/connection";
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from "../utils/trustStore";

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

export const KEYBOARD_LAYOUTS: { label: string; value: number }[] = [
  { label: "US English", value: 0x0409 },
  { label: "UK English", value: 0x0809 },
  { label: "German", value: 0x0407 },
  { label: "French", value: 0x040c },
  { label: "Spanish", value: 0x0c0a },
  { label: "Italian", value: 0x0410 },
  { label: "Portuguese (BR)", value: 0x0416 },
  { label: "Japanese", value: 0x0411 },
  { label: "Korean", value: 0x0412 },
  { label: "Chinese (Simplified)", value: 0x0804 },
  { label: "Chinese (Traditional)", value: 0x0404 },
  { label: "Russian", value: 0x0419 },
  { label: "Arabic", value: 0x0401 },
  { label: "Hindi", value: 0x0439 },
  { label: "Dutch", value: 0x0413 },
  { label: "Swedish", value: 0x041d },
  { label: "Norwegian", value: 0x0414 },
  { label: "Danish", value: 0x0406 },
  { label: "Finnish", value: 0x040b },
  { label: "Polish", value: 0x0415 },
  { label: "Czech", value: 0x0405 },
  { label: "Turkish", value: 0x041f },
];

export const PERFORMANCE_PRESETS: Record<
  string,
  Partial<NonNullable<RdpConnectionSettings["performance"]>>
> = {
  modem: {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: true,
    disableCursorShadow: true,
    enableFontSmoothing: false,
    enableDesktopComposition: false,
    targetFps: 15,
    frameBatchIntervalMs: 66,
  },
  "broadband-low": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    targetFps: 24,
    frameBatchIntervalMs: 42,
  },
  "broadband-high": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
    targetFps: 30,
    frameBatchIntervalMs: 33,
  },
  wan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
    targetFps: 60,
    frameBatchIntervalMs: 16,
  },
  lan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
    targetFps: 60,
    frameBatchIntervalMs: 16,
  },
};

export const CSS = {
  select: "sor-form-select text-sm",
  input: "sor-form-input text-sm",
  checkbox: "sor-form-checkbox",
  label:
    "flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]",
} as const;

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useRDPOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const [rdpTrustRecords, setRdpTrustRecords] = useState<TrustRecord[]>([]);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [detectingLayout, setDetectingLayout] = useState(false);

  /* Keyboard layout detection */
  const detectKeyboardLayout = useCallback(async () => {
    setDetectingLayout(true);
    try {
      const layout = await invoke<number>("detect_keyboard_layout");
      const langId = layout & 0xffff;
      setFormData((prev) => ({
        ...prev,
        rdpSettings: {
          ...(prev.rdpSettings ?? DEFAULT_RDP_SETTINGS),
          input: {
            ...(prev.rdpSettings ?? DEFAULT_RDP_SETTINGS).input,
            keyboardLayout: langId,
          },
        },
      }));
    } catch {
      /* detection not available outside Tauri */
    } finally {
      setDetectingLayout(false);
    }
  }, [setFormData]);

  /* Load trust records */
  useEffect(() => {
    if (formData.isGroup || formData.protocol !== "rdp") return;
    try {
      const connRecords = formData.id ? getAllTrustRecords(formData.id) : [];
      const globalRecords = getAllTrustRecords();
      const all = [...connRecords, ...globalRecords].filter(
        (r) => r.type === "tls",
      );
      const seen = new Set<string>();
      const deduped = all.filter((r) => {
        if (seen.has(r.identity.fingerprint)) return false;
        seen.add(r.identity.fingerprint);
        return true;
      });
      setRdpTrustRecords(deduped);
    } catch {
      /* ignore */
    }
  }, [formData.isGroup, formData.protocol, formData.id]);

  /* Derived */
  const rdp: RdpConnectionSettings =
    formData.rdpSettings ?? DEFAULT_RDP_SETTINGS;

  const updateRdp = useCallback(
    <K extends keyof RdpConnectionSettings>(
      section: K,
      patch: Partial<NonNullable<RdpConnectionSettings[K]>>,
    ) => {
      setFormData((prev) => ({
        ...prev,
        rdpSettings: {
          ...prev.rdpSettings,
          [section]: {
            ...(prev.rdpSettings?.[section] ??
              (DEFAULT_RDP_SETTINGS[section] as Record<string, unknown>)),
            ...patch,
          },
        },
      }));
    },
    [setFormData],
  );

  const hostRecords = rdpTrustRecords.filter((r) => {
    const expectedHost = `${formData.hostname}:${formData.port || 3389}`;
    return r.host === expectedHost;
  });

  /* Trust handlers */
  const handleRemoveTrust = useCallback(
    (record: TrustRecord) => {
      try {
        const [host, portStr] = record.host.split(":");
        const port = parseInt(portStr, 10) || 3389;
        removeIdentity(host, port, "tls", formData.id);
        removeIdentity(host, port, "tls");
        setRdpTrustRecords((prev) =>
          prev.filter(
            (r) => r.identity.fingerprint !== record.identity.fingerprint,
          ),
        );
      } catch {
        /* ignore */
      }
    },
    [formData.id],
  );

  const handleClearAllRdpTrust = useCallback(() => {
    try {
      if (formData.id) clearAllTrustRecords(formData.id);
      setRdpTrustRecords([]);
    } catch {
      /* ignore */
    }
  }, [formData.id]);

  const handleSaveNickname = useCallback(
    (record: TrustRecord) => {
      try {
        const [host, portStr] = record.host.split(":");
        const port = parseInt(portStr, 10) || 3389;
        updateTrustRecordNickname(
          host,
          port,
          "tls",
          nicknameInput,
          formData.id,
        );
        setRdpTrustRecords((prev) =>
          prev.map((r) =>
            r.identity.fingerprint === record.identity.fingerprint
              ? { ...r, nickname: nicknameInput }
              : r,
          ),
        );
        setEditingNickname(null);
        setNicknameInput("");
      } catch {
        /* ignore */
      }
    },
    [formData.id, nicknameInput],
  );

  return {
    rdp,
    updateRdp,
    detectingLayout,
    detectKeyboardLayout,
    hostRecords,
    editingNickname,
    setEditingNickname,
    nicknameInput,
    setNicknameInput,
    handleRemoveTrust,
    handleClearAllRdpTrust,
    handleSaveNickname,
    formatFingerprint,
  };
}

export type RDPOptionsMgr = ReturnType<typeof useRDPOptions>;
