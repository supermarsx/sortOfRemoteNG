import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, ProxyConfig } from "../types/settings";
import { SettingsManager } from "../utils/settingsManager";
import { ThemeManager } from "../utils/themeManager";
import { loadLanguage } from "../i18n";
import { useSettings } from "../contexts/SettingsContext";
import { useToastContext } from "../contexts/ToastContext";
import { useSettingsSearch } from "../components/SettingsDialog/useSettingsSearch";
import { useSettingHighlight } from "../components/SettingsDialog/useSettingHighlight";
import { TAB_DEFAULTS, DEFAULT_VALUES } from "../components/SettingsDialog/settingsConstants";

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useSettingsDialog(isOpen: boolean, onClose: () => void) {
  const { t, i18n } = useTranslation();
  const { settings: contextSettings } = useSettings();
  const { toast } = useToastContext();

  const [activeTab, setActiveTab] = useState("general");
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const searchResult = useSettingsSearch(searchQuery);
  useSettingHighlight(highlightKey);

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<GlobalSettings | null>(null);

  const settingsManager = SettingsManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  // ── Load on open ──────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    const currentSettings = await settingsManager.loadSettings();
    setSettings(currentSettings);
  }, [settingsManager]);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen, loadSettings]);

  // ── Keyboard (ESC) ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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

  const flushDebouncedSave = useCallback(async () => {
    if (debounceSaveRef.current) {
      clearTimeout(debounceSaveRef.current);
      debounceSaveRef.current = null;
    }
    const pending = pendingSettingsRef.current;
    if (pending) {
      pendingSettingsRef.current = null;
      try {
        await settingsManager.saveSettings(pending, { silent: true });
        showAutoSave("success");
      } catch (error) {
        console.error("Failed to flush debounced save:", error);
        showAutoSave("error");
      }
    }
  }, [settingsManager, showAutoSave]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
      const pending = pendingSettingsRef.current;
      if (pending) {
        settingsManager.saveSettings(pending, { silent: true }).catch(() => {});
      }
    };
  }, [settingsManager]);

  const scheduleSave = useCallback(
    (newSettings: GlobalSettings) => {
      settingsManager.applyInMemory(newSettings);

      const autoSave = newSettings.settingsDialog?.autoSave ?? true;
      if (!autoSave) {
        pendingSettingsRef.current = newSettings;
        return;
      }

      pendingSettingsRef.current = newSettings;
      if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
      debounceSaveRef.current = setTimeout(async () => {
        debounceSaveRef.current = null;
        const toSave = pendingSettingsRef.current;
        if (!toSave) return;
        pendingSettingsRef.current = null;
        try {
          await settingsManager.saveSettings(toSave, { silent: true });
          showAutoSave("success");
        } catch (error) {
          console.error("Failed to auto save settings:", error);
          showAutoSave("error");
        }
      }, 1500);
    },
    [settingsManager, showAutoSave],
  );

  // ── Public handlers ───────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!settings) return;
    try {
      await flushDebouncedSave();
      await settingsManager.saveSettings(settings);

      if (settings.language !== i18n.language) {
        if (settings.language !== "en") await loadLanguage(settings.language);
        await i18n.changeLanguage(settings.language);
      }

      themeManager.applyTheme(
        settings.theme,
        settings.colorScheme,
        settings.primaryAccentColor,
      );
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  }, [settings, flushDebouncedSave, settingsManager, i18n, themeManager, onClose]);

  const handleReset = useCallback(() => {
    const confirm = settings?.settingsDialog?.confirmBeforeReset ?? true;
    if (confirm) {
      setShowResetConfirm(true);
    } else {
      confirmResetImpl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSettings(newSettings);

    try {
      await settingsManager.saveSettings(newSettings);

      if (activeTab === "theme") {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.primaryAccentColor,
        );
      }

      showAutoSave("success");
    } catch (error) {
      console.error("Failed to reset tab settings:", error);
      showAutoSave("error");
    }

    setShowResetConfirm(false);
  }, [settings, activeTab, settingsManager, themeManager, showAutoSave]);

  const handleBenchmark = useCallback(async () => {
    if (!settings) return;
    setIsBenchmarking(true);
    try {
      const optimalIterations = await settingsManager.benchmarkKeyDerivation(
        settings.benchmarkTimeSeconds,
      );
      setSettings({ ...settings, keyDerivationIterations: optimalIterations });
    } catch (error) {
      console.error("Benchmark failed:", error);
    } finally {
      setIsBenchmarking(false);
    }
  }, [settings, settingsManager]);

  const updateSettings = useCallback(
    async (updates: Partial<GlobalSettings>) => {
      if (!settings) return;

      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);

      if (updates.language && updates.language !== i18n.language) {
        if (updates.language !== "en") await loadLanguage(updates.language);
        await i18n.changeLanguage(updates.language);
      }

      if (
        updates.theme ||
        updates.colorScheme ||
        typeof updates.primaryAccentColor !== "undefined"
      ) {
        themeManager.applyTheme(
          newSettings.theme,
          newSettings.colorScheme,
          newSettings.primaryAccentColor,
        );
      }

      scheduleSave(newSettings);
    },
    [settings, i18n, themeManager, scheduleSave],
  );

  const updateProxy = useCallback(
    async (updates: Partial<ProxyConfig>) => {
      if (!settings) return;

      const newSettings = {
        ...settings,
        globalProxy: { ...settings.globalProxy, ...updates } as ProxyConfig,
      };
      setSettings(newSettings);
      scheduleSave(newSettings);
    },
    [settings, scheduleSave],
  );

  const dialogConfig = settings
    ? {
        showSaveButton: false,
        confirmBeforeReset: true,
        autoSave: true,
        ...settings.settingsDialog,
      }
    : { showSaveButton: false, confirmBeforeReset: true, autoSave: true };

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
