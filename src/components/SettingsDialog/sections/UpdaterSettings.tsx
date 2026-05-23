import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import { Checkbox, NumberInput, TextInput } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import {
  SettingsSectionHeader as SectionHeader,
} from "../../ui/settings/SettingsPrimitives";
import { useUpdater } from "../../../hooks/updater/useUpdater";
import type {
  ResolvedUpdaterEndpoint,
  UpdaterEndpointMode,
  UpdaterSettingsPatch,
  UpdaterStatusValue,
} from "../../../types/updater/updater";

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusKey(status: UpdaterStatusValue | null | undefined): string {
  switch (status) {
    case "checking":
      return "checking";
    case "up_to_date":
      return "upToDate";
    case "available":
      return "updateAvailable";
    case "downloading":
      return "downloading";
    case "installing":
      return "installing";
    case "restart_required":
      return "restartRequired";
    case "error":
      return "error";
    case "idle":
    default:
      return "idle";
  }
}

function endpointModeKey(mode: UpdaterEndpointMode | null | undefined): string {
  return mode === "private_then_public" ? "privateThenPublic" : "publicOnly";
}

const DEFAULT_UPDATER_SETTINGS: UpdaterSettingsPatch = {
  autoCheckEnabled: true,
  checkIntervalHours: 24,
  privateEndpointEnabled: false,
  privateEndpointUrl: "",
};

const EndpointList: React.FC<{ endpoints: ResolvedUpdaterEndpoint[] }> = ({
  endpoints,
}) => {
  const { t } = useTranslation();
  if (endpoints.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="updater-endpoints">
      {endpoints.map((endpoint) => (
        <div
          key={`${endpoint.source}-${endpoint.url}`}
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)]/50 bg-[var(--color-background)] px-3 py-2"
        >
          <Server className="w-4 h-4 mt-0.5 text-[var(--color-textSecondary)]" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-[var(--color-text)]">
              {endpoint.source === "private"
                ? t("updater.privateEndpointLabel", "Private endpoint")
                : t("updater.publicEndpoint", "Public endpoint")}
            </div>
            <div className="text-xs text-[var(--color-textMuted)] break-all">
              {endpoint.url}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const UpdaterSettings: React.FC = () => {
  const { t } = useTranslation();
  const updater = useUpdater();
  const [intervalDraft, setIntervalDraft] = useState(24);
  const [endpointEnabledDraft, setEndpointEnabledDraft] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [endpointLocalError, setEndpointLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!updater.settings) return;
    setIntervalDraft(updater.settings.checkIntervalHours);
    setEndpointEnabledDraft(updater.settings.privateEndpointEnabled);
    setEndpointDraft(updater.settings.privateEndpointUrl ?? "");
  }, [updater.settings]);

  const statusLabel = t(
    `updater.status.${statusKey(updater.status?.status)}`,
    statusKey(updater.status?.status),
  );
  const endpointModeLabel = t(
    `updater.endpointMode.${endpointModeKey(updater.status?.endpointMode ?? updater.settings?.endpointMode)}`,
    endpointModeKey(updater.status?.endpointMode ?? updater.settings?.endpointMode),
  );
  const available = updater.availableUpdate;
  const progressPercent = updater.progressPercent ?? 0;
  const totalBytes = updater.status?.totalBytes ?? null;
  const downloadedBytes = updater.status?.downloadedBytes ?? 0;
  const endpoints =
    updater.status?.resolvedEndpoints ?? updater.settings?.resolvedEndpoints ?? [];

  const statusTone = useMemo(() => {
    switch (updater.status?.status) {
      case "available":
      case "restart_required":
        return "border-warning/40 bg-warning/10 text-warning";
      case "error":
        return "border-error/40 bg-error/10 text-error";
      case "up_to_date":
        return "border-success/40 bg-success/10 text-success";
      default:
        return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)]";
    }
  }, [updater.status?.status]);

  const handleAutoCheckChange = useCallback(
    (enabled: boolean) => {
      void updater.saveSettings({ autoCheckEnabled: enabled });
    },
    [updater],
  );

  const saveIntervalDraft = useCallback(() => {
    void updater.saveSettings({ checkIntervalHours: Math.max(1, intervalDraft) });
  }, [intervalDraft, updater]);

  const handleIntervalBlur = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (relatedTarget?.id === "updater-reset-defaults-btn") return;
      saveIntervalDraft();
    },
    [saveIntervalDraft],
  );

  const handleEndpointSave = useCallback(async () => {
    const value = endpointDraft.trim();
    if (endpointEnabledDraft && value.length === 0) {
      setEndpointLocalError(
        t(
          "updater.privateEndpointRequired",
          "Private endpoint URL is required when the private endpoint is enabled.",
        ),
      );
      return;
    }
    setEndpointLocalError(null);
    await updater.saveSettings({
      privateEndpointEnabled: endpointEnabledDraft,
      privateEndpointUrl: endpointEnabledDraft ? value : "",
    });
  }, [endpointDraft, endpointEnabledDraft, t, updater]);

  const handleEndpointBlur = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (
        relatedTarget?.id === "updater-private-endpoint-toggle" ||
        relatedTarget?.id === "updater-reset-defaults-btn"
      ) {
        return;
      }
      void handleEndpointSave();
    },
    [handleEndpointSave],
  );

  const handleEndpointEnabledChange = useCallback(
    (enabled: boolean) => {
      setEndpointEnabledDraft(enabled);

      if (!enabled) {
        setEndpointDraft("");
        setEndpointLocalError(null);
        void updater.saveSettings({
          privateEndpointEnabled: false,
          privateEndpointUrl: "",
        });
      }
    },
    [updater],
  );

  const handleResetToDefaults = useCallback(async () => {
    setIntervalDraft(DEFAULT_UPDATER_SETTINGS.checkIntervalHours ?? 24);
    setEndpointEnabledDraft(false);
    setEndpointDraft("");
    setEndpointLocalError(null);
    await updater.saveSettings(DEFAULT_UPDATER_SETTINGS);
  }, [updater]);

  return (
    <div className="space-y-6" data-testid="settings-updater-section">
      <SectionHeading
        icon={<RefreshCw className="w-5 h-5 text-primary" />}
        title={t("settings.updater.title", "Updater")}
        description={t(
          "settings.updater.description",
          "Signed application updates, check cadence, and private feed endpoint.",
        )}
      />

      <div className="space-y-4">
        <SectionHeader
          icon={<ShieldCheck className="w-4 h-4 text-primary" />}
          title={t("updater.updateStatus", "Update status")}
        />
        <div className="sor-settings-card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--color-textMuted)]">
              {t("updater.currentVersion", "Current version")}: {updater.currentVersion ?? "-"}
            </p>
            <div
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${statusTone}`}
              data-testid="updater-status-badge"
            >
              {updater.status?.status === "error" ? (
                <AlertCircle className="w-4 h-4" />
              ) : updater.status?.status === "up_to_date" ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Clock3 className="w-4 h-4" />
              )}
              {statusLabel}
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--color-textMuted)]">
                {t("updater.lastChecked", "Last checked")}
              </dt>
              <dd className="text-[var(--color-textSecondary)]" data-testid="updater-last-checked">
                {formatDate(updater.lastCheckedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-textMuted)]">
                {t("updater.endpointModeLabel", "Endpoint mode")}
              </dt>
              <dd className="text-[var(--color-textSecondary)]" data-testid="updater-endpoint-mode">
                {endpointModeLabel}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-textMuted)]">
                {t("updater.downloaded", "Downloaded")}
              </dt>
              <dd className="text-[var(--color-textSecondary)]">
                {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
              </dd>
            </div>
          </dl>

          {(updater.isDownloading || updater.isInstalling) && (
            <div className="space-y-2" data-testid="updater-progress">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]/40">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(progressPercent, 100))}%` }}
                />
              </div>
              <p className="text-xs text-[var(--color-textMuted)]">
                {Math.round(progressPercent)}%
              </p>
            </div>
          )}

          {updater.lastError && (
            <div
              role="alert"
              className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
              data-testid="updater-error"
            >
              {updater.lastError}
            </div>
          )}

          {available && (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3"
              data-testid="updater-available"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {t("updater.newVersionAvailable", "New version available")}: {available.version}
                  </p>
                  {available.date && (
                    <p className="text-xs text-[var(--color-textMuted)]">
                      {formatDate(available.date)}
                    </p>
                  )}
                </div>
                <a
                  href={available.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("updater.artifact", "Artifact")}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              {available.body && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-textSecondary)]">
                  {available.body}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void updater.check(true)}
              disabled={!updater.canCheck}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="updater-check-btn"
            >
              <RefreshCw className={`w-4 h-4 ${updater.isChecking ? "animate-spin" : ""}`} />
              {updater.isChecking
                ? t("updater.checking", "Checking for updates...")
                : t("updater.checkForUpdates", "Check for updates")}
            </button>
            {updater.canInstall && (
              <button
                type="button"
                onClick={() => void updater.install(available?.version)}
                disabled={updater.isBusy}
                className="inline-flex items-center gap-2 rounded-md bg-success px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="updater-install-btn"
              >
                <Download className="w-4 h-4" />
                {t("updater.downloadAndInstall", "Download and install")}
              </button>
            )}
            {updater.canRelaunch && (
              <button
                type="button"
                onClick={() => void updater.relaunch()}
                disabled={updater.relaunching}
                className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="updater-relaunch-btn"
              >
                <Power className="w-4 h-4" />
                {t("updater.restartToUpdate", "Restart to update")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<RefreshCw className="w-4 h-4 text-primary" />}
          title={t("updater.autoChecks", "Automatic checks")}
        />
        <div className="sor-settings-card space-y-4">
          <label className="sor-settings-toggle-row" data-setting-key="updater.autoCheckEnabled">
            <Checkbox
              checked={updater.settings?.autoCheckEnabled ?? true}
              onChange={handleAutoCheckChange}
              disabled={updater.savingSettings || !updater.settings}
              data-testid="updater-auto-check-toggle"
            />
            <div className="sor-settings-toggle-icon">
              <RefreshCw size={16} />
            </div>
            <div className="min-w-0">
              <span className="sor-settings-toggle-label flex items-center gap-1">
                {t("updater.autoCheck", "Auto-check for updates")}
                <InfoTooltip text={t("updater.autoCheckTooltip", "Checks never install updates without confirmation.")} />
              </span>
              <p className="sor-settings-toggle-description">
                {t(
                  "updater.autoCheckDescription",
                  "Check in the background without installing updates automatically.",
                )}
              </p>
            </div>
          </label>
          <div
            data-setting-key="updater.checkIntervalHours"
            className={`space-y-2 ${!(updater.settings?.autoCheckEnabled ?? true) ? "opacity-50" : ""}`}
          >
            <label className="flex items-center gap-2 sor-settings-row-label" htmlFor="updater-check-interval">
              <Clock3 className="w-4 h-4 text-[var(--color-textSecondary)]" />
              {t("updater.checkIntervalHours", "Check interval (hours)")}
              <InfoTooltip text={t("updater.checkIntervalTooltip", "How often the app checks for signed updates while automatic checks are enabled.")} />
            </label>
            <NumberInput
              id="updater-check-interval"
              value={intervalDraft}
              min={1}
              max={720}
              onChange={setIntervalDraft}
              onBlur={handleIntervalBlur}
              disabled={updater.savingSettings || !updater.settings}
              className="w-full"
              data-testid="updater-check-interval"
            />
            <p className="text-xs text-[var(--color-textMuted)]">
              {t("updater.checkIntervalDescription", "Valid range: 1 to 720 hours.")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<Server className="w-4 h-4 text-primary" />}
          title={t("updater.privateEndpointLabel", "Private endpoint")}
        />
        <div className="sor-settings-card space-y-4">
          <label className="sor-settings-toggle-row" data-setting-key="updater.privateEndpointEnabled">
            <Checkbox
              id="updater-private-endpoint-toggle"
              checked={endpointEnabledDraft}
              onChange={handleEndpointEnabledChange}
              disabled={updater.savingSettings || !updater.settings}
              data-testid="updater-private-endpoint-toggle"
            />
            <div className="sor-settings-toggle-icon">
              <Server size={16} />
            </div>
            <div className="min-w-0">
              <span className="sor-settings-toggle-label flex items-center gap-1">
                {t("updater.privateEndpointEnabled", "Use a private update feed first")}
                <InfoTooltip text={t("updater.privateEndpointTooltip", "Try the configured private update feed before falling back to the public endpoint.")} />
              </span>
              <p className="sor-settings-toggle-description">
                {t(
                  "updater.privateEndpointDescription",
                  "Useful for staged releases, internal builds, or controlled update feeds.",
                )}
              </p>
            </div>
          </label>
          <div className="space-y-2">
            <div
              data-setting-key="updater.privateEndpointUrl"
              className={`space-y-2 ${!endpointEnabledDraft ? "opacity-50" : ""}`}
            >
              <label className="flex items-center gap-2 sor-settings-row-label" htmlFor="updater-private-endpoint-url">
                <Server className="w-4 h-4 text-[var(--color-textSecondary)]" />
                {t("updater.privateEndpointUrl", "Private endpoint URL")}
                <InfoTooltip text={t("updater.privateEndpointUrlTooltip", "HTTPS URL for a Tauri-compatible update manifest.")} />
              </label>
              <TextInput
                id="updater-private-endpoint-url"
                inputMode="url"
                value={endpointDraft}
                onChange={setEndpointDraft}
                onBlur={handleEndpointBlur}
                variant="settings"
                disabled={updater.savingSettings || !updater.settings || !endpointEnabledDraft}
                placeholder="https://updates.example.com/latest.json"
                className="w-full"
                data-testid="updater-private-endpoint-input"
              />
              {(endpointLocalError || updater.settings?.privateEndpointValidationError) && (
                <p className="text-xs text-error" role="alert" data-testid="updater-private-endpoint-error">
                  {endpointLocalError ?? updater.settings?.privateEndpointValidationError}
                </p>
              )}
            </div>
          </div>
          <EndpointList endpoints={endpoints} />
        </div>
      </div>

      <div className="sticky bottom-0 flex justify-end border-t border-[var(--color-border)]/30 bg-[var(--color-surface)]/80 px-0 py-2 backdrop-blur-sm">
        <button
          id="updater-reset-defaults-btn"
          type="button"
          onClick={() => void handleResetToDefaults()}
          disabled={updater.savingSettings || !updater.settings}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-surfaceHover)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="updater-reset-defaults-btn"
        >
          <RotateCcw size={12} />
          {t("settings.reset", "Reset to Defaults")}
        </button>
      </div>
    </div>
  );
};

export default UpdaterSettings;
