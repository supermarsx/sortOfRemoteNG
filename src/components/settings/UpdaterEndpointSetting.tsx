import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdaterEndpoint } from "../../hooks/settings/useUpdaterEndpoint";

/** Compatibility surface for the backend-managed private updater endpoint. */
export interface UpdaterEndpointSettingProps {
  className?: string;
}

export const UpdaterEndpointSetting: React.FC<UpdaterEndpointSettingProps> = ({
  className,
}) => {
  const { t } = useTranslation();
  const { endpoint, loaded, available, error, setEndpoint } =
    useUpdaterEndpoint();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<null | "saving" | "saved" | "error">(
    null,
  );

  useEffect(() => {
    setDraft(endpoint ?? "");
  }, [endpoint]);

  const handleSave = async () => {
    setStatus("saving");
    const value = draft.trim();
    const ok = await setEndpoint(value.length === 0 ? null : value);
    setStatus(ok ? "saved" : "error");
  };

  const handleClear = async () => {
    setStatus("saving");
    const ok = await setEndpoint(null);
    setDraft("");
    setStatus(ok ? "saved" : "error");
  };

  return (
    <section className={className} data-testid="updater-endpoint-setting">
      <h3>{t("updater.privateEndpoint.title", "Private update endpoint")}</h3>
      <p>
        {t(
          "updater.privateEndpoint.description",
          "Optional HTTPS URL to a private update feed (e.g. an internal S3 bucket's latest.json). Augments the public GitHub endpoint; signatures are verified against the same embedded key.",
        )}
      </p>
      <input
        type="url"
        inputMode="url"
        placeholder="https://updates.example.com/latest.json"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={!available || !loaded || status === "saving"}
        aria-label={t(
          "updater.privateEndpoint.inputLabel",
          "Private update endpoint URL",
        )}
        data-testid="updater-endpoint-input"
      />
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!available || !loaded || status === "saving"}
          data-testid="updater-endpoint-save"
        >
          {t("common.save", "Save")}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!available || !loaded || status === "saving" || !endpoint}
          data-testid="updater-endpoint-clear"
        >
          {t("common.clear", "Clear")}
        </button>
      </div>
      {!available && loaded && (
        <p role="status">
          {t(
            "updater.privateEndpoint.unavailable",
            "This control is only active inside the desktop app.",
          )}
        </p>
      )}
      {status === "saved" && (
        <p role="status">{t("common.saved", "Saved.")}</p>
      )}
      {(status === "error" || error) && (
        <p role="alert">
          {t("common.errorPrefix", "Error:")} {error ?? ""}
        </p>
      )}
    </section>
  );
};

export default UpdaterEndpointSetting;
