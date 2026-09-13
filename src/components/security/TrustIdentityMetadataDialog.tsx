import { useState } from "react";
import type { TrustCenterRow } from "../../hooks/security/useTrustCenter";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";

export default function TrustIdentityMetadataDialog({
  row,
  busy,
  error,
  onSave,
  onClose,
}: {
  row: TrustCenterRow;
  busy: boolean;
  error: string | null;
  onSave: (tags: string[], description: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tags, setTags] = useState(row.record.tags?.join(", ") ?? "");
  const [description, setDescription] = useState(row.record.description ?? "");
  const [attempted, setAttempted] = useState(false);
  const field =
    "mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary";
  return (
    <Modal
      isOpen
      ariaLabel="Edit identity tags and description"
      onClose={busy ? undefined : onClose}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      panelClassName="max-w-lg"
    >
      <ModalHeader
        title="Tags and description"
        onClose={busy ? undefined : onClose}
      />
      <ModalBody className="space-y-4">
        <p className="break-all text-sm">
          {row.record.host} · {row.record.type.toUpperCase()}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Organize this identity without changing its fingerprint, approval or
          verification policy. These notes are searchable and included in trust
          exports; do not enter passwords or private keys.
        </p>
        <label className="block text-sm">
          Tags
          <input
            aria-label="Identity metadata tags"
            className={field}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            disabled={busy}
            placeholder="production, office"
          />
        </label>
        <label className="block text-sm">
          Description
          <textarea
            aria-label="Identity description"
            className={`${field} min-h-28 resize-y`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            maxLength={4096}
            placeholder="Purpose, owner or verification notes"
          />
        </label>
        <p className="text-xs text-[var(--color-textMuted)]">
          Comma-separated tags; description up to 4096 UTF-8 bytes. Clearing a
          field removes that metadata.
        </p>
        {attempted && error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
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
          onClick={async () => {
            setAttempted(true);
            if (await onSave(tags.split(","), description)) onClose();
          }}
        >
          {busy ? "Saving…" : "Save metadata"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
