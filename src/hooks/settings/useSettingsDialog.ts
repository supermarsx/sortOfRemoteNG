import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, ProxyConfig } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { ThemeManager } from "../../utils/settings/themeManager";
import { loadLanguage, resolveSupportedLanguage } from "../../i18n";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { useSettingsSearch } from "../../components/SettingsDialog/useSettingsSearch";
import { useSettingHighlight } from "../../components/SettingsDialog/useSettingHighlight";
import {
  TAB_DEFAULTS,
  DEFAULT_VALUES,
  type SettingsTabId,
} from "../../components/SettingsDialog/settingsConstants";

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

/**
 * @param initialTab      Tab to land on. Applied every time the dialog opens
 *                        (and whenever a *new* request arrives while it is
 *                        already open), not just on first mount — so two
 *                        different "Open … Settings" buttons each land on
 *                        their own tab. Omit to keep the current/default tab.
 * @param initialTabNonce Bump to re-apply `initialTab` when it is unchanged.
 *                        Needed by the always-mounted settings *tab*, where
 *                        clicking the same deep link twice must return to
 *                        that tab even if the user navigated away in between.
 */
export function useSettingsDialog(
  isOpen: boolean,
  onClose: () => void,
  initialTab?: SettingsTabId,
  initialTabNonce?: number,
) {
  const { t, i18n } = useTranslation();
  const { settings: contextSettings } = useSettings();
  const { toast } = useToastContext();

  const [activeTab, setActiveTab] = useState<string>(initialTab ?? "general");
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  // `t` is threaded into search so entries carrying `labelKey`/`descriptionKey`
  // also match on their translated text in the current UI language.
  const searchResult = useSettingsSearch(searchQuery, t);
  useSettingHighlight(highlightKey);

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef<GlobalSettings | null>(null);
  const pendingPatchRef = useRef<Partial<GlobalSettings> | null>(null);
  const inFlightPatchRef = useRef<Partial<GlobalSettings> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const settingsManager = SettingsManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  // The provider is the only settings-sync consumer. It accepts only validated,
  // ordered snapshots and updates `contextSettings`; this dialog never listens
  // to the raw Tauri event bus itself. Local unsaved/in-flight edits form a
  // shallow top-level overlay so a newer validated remote snapshot cannot wipe
  // them, while unrelated remote fields remain authoritative.
  useEffect(() => {
    if (!isOpen) return;
    const localOverlay = {
      ...(inFlightPatchRef.current ?? {}),
      ...(pendingPatchRef.current ?? {}),
    };
    const rebased = { ...contextSettings, ...localOverlay };
    settingsRef.current = rebased;
    setSettings(rebased);
    if (Object.keys(localOverlay).length > 0) {
      settingsManager.applyInMemory(localOverlay);
    }
  }, [contextSettings, isOpen, settingsManager]);

  // ── Keyboard (ESC) ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // ── Deep link: land on the requested tab ──────────────────────
  // Re-applied on every open (and on every new request while open) rather
  // than only on mount, so "Backup Settings" and "Configure Sync" each land
  // on their own tab even when the dialog/tab is reused.
  const appliedTabRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      // Closed: forget what was applied so the next open re-applies it.
      appliedTabRequestRef.current = null;
      return;
    }
    if (!initialTab) return;
    const token = `${initialTab}:${initialTabNonce ?? 0}`;
    if (appliedTabRequestRef.current === token) return;
    appliedTabRequestRef.current = token;
    setActiveTab(initialTab);
    // An explicit deep link supersedes any in-progress search navigation.
    setSearchQuery("");
    setHighlightKey(null);
  }, [isOpen, initialTab, initialTabNonce]);

  // ── Reset scroll-to-bottom on tab change ──────────────────────
  useEffect(() => {
    setHasScrolledToBottom(false);
    contentScrollRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  // ── Observe bottom sentinel ───────────────────────────────────
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    const container = contentScrollRef.current;
    if (!sentinel || !container) return;

    const checkOverflow = () => {
      if (container.scrollHeight <= container.clientHeight + 10) {
        setHasScrolledToBottom(true);
      }
    };
    checkOverflow();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setHasScrolledToBottom(true);
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, settings]);

  // ── Auto-save helpers ─────────────────────────────────────────
  const showAutoSave = useCallback(
    (status: "success" | "error") => {
      if (status === "success") {
        toast.success(t("settings.autoSaveSuccess"), 2000);
      } else {
        toast.error(t("settings.autoSaveError"), 3000);
      }
    },
    [toast, t],
  );
  const showAutoSaveRef = useRef(showAutoSave);
  showAutoSaveRef.current = showAutoSave;

  const flushPendingPatch = useCallback(
    async (mode: "auto" | "manual" | "unmount" = "auto") => {
      if (debounceSaveRef.current) {
        clearTimeout(debounceSaveRef.current);
        debounceSaveRef.current = null;
      }

      const run = async () => {
        const pending = pendingPatchRef.current;
        if (!pending || Object.keys(pending).length === 0) return;

        pendingPatchRef.current = null;
        inFlightPatchRef.current = pending;
        try {
          await settingsManager.saveSettings(pending, {
            silent: mode !== "manual",
          });
          if (mode !== "unmount") showAutoSaveRef.current("success");
        } catch (error) {
          // A newer edit may have arrived while this patch was in flight. Put
          // the failed patch back underneath it so the newest local value wins
          // and a later manual/auto flush can retry the complete local intent.
          pendingPatchRef.current = {
            ...pending,
            ...(pendingPatchRef.current ?? {}),
          };
          if (mode !== "unmount") showAutoSaveRef.current("error");
          throw error;
        } finally {
          inFlightPatchRef.current = null;
        }
      };

      const operation = saveChainRef.current.then(run, run);
      saveChainRef.current = operation.catch(() => undefined);
      await operation;
    },
    [settingsManager],
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
      void flushPendingPatch("unmount").catch(() => {});
    };
  }, [flushPendingPatch]);

  const scheduleSave = useCallback(
    (patch: Partial<GlobalSettings>, newSettings: GlobalSettings) => {
      pendingPatchRef.current = {
        ...(pendingPatchRef.current ?? {}),
        ...patch,
      };
      settingsManager.applyInMemory(patch);

      if (debounceSaveRef.current) {
        clearTimeout(debounceSaveRef.current);
        debounceSaveRef.current = null;
      }

      const autoSave = newSettings.settingsDialog?.autoSave ?? true;
      if (!autoSave) return;

      debounceSaveRef.current = setTimeout(() => {
        debounceSaveRef.current = null;
        void flushPendingPatch("auto").catch((error) => {
          console.error("Failed to auto save settings:", error);
        });
      }, 1500);
    },
    [flushPendingPatch, settingsManager],
  );

  // ── Public handlers ───────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;
    try {
      await flushPendingPatch("manual");

      const effectiveLanguage = currentSettings.autoDetectOsLanguage
        ? resolveSupportedLanguage(
            typeof navigator !== "undefined" ? navigator.language : "en",
          )
        : currentSettings.language;
      if (effectiveLanguage !== i18n.language) {
        if (effectiveLanguage !== "en-US")
          await loadLanguage(effectiveLanguage);
        await i18n.changeLanguage(effectiveLanguage);
      }
      if (typeof document !== "undefined") {
        document.documentElement.dir = currentSettings.rtlLayout
          ? "rtl"
          : "ltr";
      }

      themeManager.applyTheme(
        currentSettings.theme,
        currentSettings.colorScheme,
        currentSettings.useCustomAccent
          ? currentSettings.primaryAccentColor
          : undefined,
      );
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  }, [flushPendingPatch, i18n, themeManager, onClose]);

  const handleReset = useCallback(() => {
    const confirm = settings?.settingsDialog?.confirmBeforeReset ?? true;
    if (confirm) {
      setShowResetConfirm(true);
    } else {
      confirmResetImpl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps -- settings object is the source of truth
  }, [settings]);

  const confirmResetImpl = useCallback(async () => {
    if (!settings) return;

    const tabKeys = TAB_DEFAULTS[activeTab] || [];
    const resetUpdates: Partial<GlobalSettings> = {};

    for (const key of tabKeys) {
      if (key in DEFAULT_VALUES) {
        (resetUpdates as Record<string, unknown>)[key] = (
          DEFAULT_VALUES as Record<string, unknown>
        )[key];
      }
    }

    const newSettings = { ...settings, ...resetUpdates };
    settingsRef.current = newSettings;
    setSettings(newSettings);
    scheduleSave(resetUpdates, newSettings);

    try {
      await flushPendingPatch("manual");

      if (activeTab === "theme") {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.useCustomAccent
            ? newSettings.primaryAccentColor
            : undefined,
        );
      }
    } catch (error) {
      console.error("Failed to reset tab settings:", error);
    }

    setShowResetConfirm(false);
  }, [settings, activeTab, scheduleSave, flushPendingPatch, themeManager]);

  const handleBenchmark = useCallback(async () => {
    if (!settings) return;
    setIsBenchmarking(true);
    try {
      const optimalIterations = await settingsManager.benchmarkKeyDerivation(
        settings.benchmarkTimeSeconds,
      );
      const patch = { keyDerivationIterations: optimalIterations };
      const newSettings = { ...settings, ...patch };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      scheduleSave(patch, newSettings);
    } catch (error) {
      console.error("Benchmark failed:", error);
    } finally {
      setIsBenchmarking(false);
    }
  }, [settings, settingsManager, scheduleSave]);

  const updateSettings = useCallback(
    async (updates: Partial<GlobalSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;

      const newSettings = { ...currentSettings, ...updates };
      settingsRef.current = newSettings;
      setSettings(newSettings);

      if (updates.language && updates.language !== i18n.language) {
        if (updates.language !== "en-US") await loadLanguage(updates.language);
        await i18n.changeLanguage(updates.language);
      }

      if (
        updates.theme ||
        updates.colorScheme ||
        typeof updates.primaryAccentColor !== "undefined" ||
        typeof updates.useCustomAccent !== "undefined"
      ) {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.useCustomAccent
            ? newSettings.primaryAccentColor
            : undefined,
        );
      }

      scheduleSave(updates, newSettings);
    },
    [i18n, themeManager, scheduleSave],
  );

  const updateProxy = useCallback(
    async (updates: Partial<ProxyConfig>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;

      const patch = {
        globalProxy: {
          ...currentSettings.globalProxy,
          ...updates,
        } as ProxyConfig,
      };
      const newSettings = {
        ...currentSettings,
        ...patch,
      };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      scheduleSave(patch, newSettings);
    },
    [scheduleSave],
  );

  const defaults = {
    showSaveButton: false,
    confirmBeforeReset: true,
    autoSave: true,
  };
  const dialogConfig = settings
    ? { ...defaults, ...settings.settingsDialog }
    : defaults;

  return {
    t,
    contextSettings,
    activeTab,
    setActiveTab,
    settings,
    isBenchmarking,
    searchQuery,
    setSearchQuery,
    highlightKey,
    setHighlightKey,
    searchResult,
    showResetConfirm,
    setShowResetConfirm,
    hasScrolledToBottom,
    contentScrollRef,
    bottomSentinelRef,
    dialogConfig,
    handleSave,
    handleReset,
    confirmReset: confirmResetImpl,
    handleBenchmark,
    updateSettings,
    updateProxy,
  };
}

export type SettingsDialogMgr = ReturnType<typeof useSettingsDialog>;
