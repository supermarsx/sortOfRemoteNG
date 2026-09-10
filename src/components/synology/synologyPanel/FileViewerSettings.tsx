import { useState } from "react";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import {
  normalizeNasFileViewers,
  type NasFileViewerSettings,
  type NasViewerKind,
} from "../../../types/settings/nasFileViewers";

const kinds: NasViewerKind[] = ["text", "pdf", "image"];
const labels = { text: "Text", pdf: "PDF", image: "Images" };
export default function FileViewerSettings({
  settings,
  onSave,
  onClose,
}: {
  settings: NasFileViewerSettings;
  onSave: (value: NasFileViewerSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    if (
      ![
        [draft.previewMaxMiB, 1, 16],
        [draft.externalMaxMiB, 1, 32],
        [draft.retentionMinutes, 5, 1440],
        [draft.textFontSize, 10, 24],
      ].every(
        ([value, min, max]) =>
          Number.isInteger(value) && value >= min && value <= max,
      )
    ) {
      setError(
        "Enter whole numbers within the limits shown for size, retention and font size. Your changes have not been saved.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(normalizeNasFileViewers(draft));
      onClose();
    } catch {
      setError(
        "Viewer settings could not be saved. Your changes are still here; unlock settings storage and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      isOpen
      ariaLabel="NAS viewer settings"
      onClose={busy ? undefined : onClose}
      panelClassName="max-w-3xl max-h-[90dvh] overflow-hidden"
      contentClassName="flex min-h-0 flex-col"
    >
      <ModalHeader
        title="NAS viewer settings"
        onClose={busy ? undefined : onClose}
      />
      <ModalBody className="space-y-4 overflow-auto p-4">
        <p className="text-sm">
          App-wide preferences for text, PDF, PNG, JPEG, GIF and WebP files.
          Previews open in a separate restricted viewer, not this application
          window. The OS-isolated viewer currently supports Windows; other
          platforms refuse preview rather than falling back to an unrestricted
          renderer.
        </p>
        <fieldset disabled={busy} className="space-y-4">
          {kinds.map((kind) => (
            <fieldset
              key={kind}
              className="rounded border border-border p-3 space-y-2"
            >
              <legend>{labels[kind]}</legend>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.preview[kind]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      preview: { ...draft.preview, [kind]: e.target.checked },
                    })
                  }
                />
                Enable {labels[kind]} previews
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.external[kind]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      external: { ...draft.external, [kind]: e.target.checked },
                    })
                  }
                />
                Allow {labels[kind]} external opening
              </label>
              <label className="flex items-center gap-2">
                {labels[kind]} external application
                <select
                  className="sor-form-select"
                  value={draft.application[kind]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      application: {
                        ...draft.application,
                        [kind]:
                          e.target.value === "choose" ? "choose" : "default",
                      },
                    })
                  }
                >
                  <option value="default">System default application</option>
                  <option value="choose">Choose application each time</option>
                </select>
              </label>
            </fieldset>
          ))}
          {(
            [
              ["previewMaxMiB", "Maximum preview size (MiB)", 1, 16],
              ["externalMaxMiB", "Maximum external file size (MiB)", 1, 32],
              [
                "retentionMinutes",
                "Temporary local copy retention (minutes)",
                5,
                1440,
              ],
              ["textFontSize", "Text font size (px)", 10, 24],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                className="sor-form-input"
                type="number"
                min={min}
                max={max}
                value={draft[key]}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.textWrap}
              onChange={(e) =>
                setDraft({ ...draft, textWrap: e.target.checked })
              }
            />
            Wrap text
          </label>
          <label className="block">
            Image display
            <select
              className="sor-form-select"
              value={draft.imageFit}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  imageFit: e.target.value === "actual" ? "actual" : "contain",
                })
              }
            >
              <option value="contain">Fit available width</option>
              <option value="actual">Actual size</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.confirmExternal}
              onChange={(e) =>
                setDraft({ ...draft, confirmExternal: e.target.checked })
              }
            />
            Confirm every external open
          </label>
        </fieldset>
        <p className="text-sm text-warning">
          External applications receive a plaintext temporary local copy.
          Cleanup is attempted after the configured period or when the NAS
          session closes, but an external application may retain its own copy or
          keep the file open. Nothing is written back to the NAS. Text files are
          opened as .txt, never as executable scripts.
        </p>
        {error && <p role="alert">{error}</p>}
      </ModalBody>
      <ModalFooter>
        <button
          className="sor-btn sor-btn-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="sor-btn sor-btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save viewer settings"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
