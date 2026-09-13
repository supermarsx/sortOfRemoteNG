import React, { useState } from "react";
import { Moon, X } from "lucide-react";
import type { WebsiteDarkModeController } from "../../../hooks/protocol/useWebsiteDarkMode";
import { normalizeWebsiteDarkModeConfig } from "../../../utils/connection/websiteDarkMode";
import { WebsiteDarkModeFields } from "../../websites/WebsiteDarkModeFields";
import { Checkbox } from "../../ui/forms";
import { Modal } from "../../ui/overlays/Modal";

export default function WebsiteDarkModeControls({
  controller,
}: {
  controller: WebsiteDarkModeController;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Dark-mode extension"
        aria-pressed={controller.enabled}
        aria-haspopup="dialog"
        data-tooltip={
          controller.enabled
            ? "Dark-mode extension enabled"
            : "Dark-mode extension disabled"
        }
        onClick={() => setOpen(true)}
        className={`sor-icon-btn-sm ${controller.enabled ? "text-primary ring-1 ring-inset ring-primary/40" : ""}`}
      >
        <Moon size={16} />
      </button>
      {open && (
        <AppearanceDialog
          key={controller.scopeKey}
          controller={controller}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AppearanceDialog({
  controller,
  onClose,
}: {
  controller: WebsiteDarkModeController;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(controller.configuration);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = controller.busy || saving;
  const apply = async () => {
    setFailure(null);
    setSaving(true);
    try {
      const value = normalizeWebsiteDarkModeConfig(draft);
      if (await controller.updateConfiguration(value)) onClose();
      else
        setFailure(
          "Appearance was not saved. Check connection access and try again.",
        );
    } catch {
      setFailure(
        "Appearance could not be saved. Check the custom CSS and try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const toggle = async () => {
    setFailure(null);
    setSaving(true);
    try {
      if (!(await controller.setEnabled(!controller.enabled)))
        setFailure(
          "The extension setting was not saved. Check connection access and try again.",
        );
    } catch {
      setFailure("The extension setting could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      ariaLabel="Dark-mode extension settings"
      panelClassName="w-[min(36rem,calc(100vw-2rem))] !max-w-[36rem] max-h-[85vh] overflow-y-auto rounded-xl"
    >
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold flex gap-2 items-center">
            <Moon size={18} />
            Dark-mode extension
          </h3>
          <button
            type="button"
            aria-label="Close appearance settings"
            className="sor-icon-btn-sm"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--color-textSecondary)]">
            {controller.savedConnectionName
              ? `Appearance changes are saved to “${controller.savedConnectionName}”.`
              : "Appearance changes require a verified saved connection."}{" "}
            App defaults do not enable other websites.
          </p>
          <button
            type="button"
            className="sor-btn-primary-sm shrink-0"
            disabled={busy || !controller.available}
            onClick={() => void toggle()}
          >
            {controller.enabled ? "Disable extension" : "Enable extension"}
          </button>
        </div>
        {!controller.available &&
          controller.unavailableReason !== controller.error &&
          controller.unavailableReason !== failure && (
            <p role="status" className="text-sm text-warning">
              {controller.unavailableReason}
            </p>
          )}
        {(failure || controller.error) && (
          <p role="alert" className="text-sm text-error">
            {failure || controller.error}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.useGlobalDefaults}
            disabled={busy || !controller.available}
            onChange={(useGlobalDefaults) =>
              setDraft({ ...draft, useGlobalDefaults })
            }
          />
          Use app appearance defaults
        </label>
        <WebsiteDarkModeFields
          theme={
            draft.useGlobalDefaults ? controller.defaultTheme : draft.theme
          }
          disabled={busy || !controller.available || draft.useGlobalDefaults}
          presets={controller.presets}
          onChange={(theme) =>
            setDraft({ ...draft, useGlobalDefaults: false, theme })
          }
        />
        <p className="text-xs text-[var(--color-textMuted)]">
          Manage app defaults and custom presets in Settings → Web Browser →
          Website appearance.
        </p>
        <div className="flex justify-between gap-3">
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={busy || !controller.available}
            onClick={() => setDraft(normalizeWebsiteDarkModeConfig(undefined))}
          >
            Reset to app defaults
          </button>
          <button
            type="button"
            className="sor-btn-primary-sm"
            disabled={busy || !controller.available}
            onClick={() => void apply()}
          >
            {busy ? "Saving…" : "Save appearance"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
