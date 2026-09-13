import { useId, useState } from "react";
import type { TrustCenterRow } from "../../hooks/security/useTrustCenter";
import { FormField } from "../ui/forms/FormField";
import { TextInput } from "../ui/forms/TextInput";
import { Textarea } from "../ui/forms/Textarea";
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
  const fieldId = useId();
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
      <ModalBody className="space-y-4 px-5 py-4 text-[var(--color-text)]">
        <p className="break-all text-sm">
          {row.record.host} · {row.record.type.toUpperCase()}
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Organize this identity without changing its fingerprint, approval or
          verification policy. These notes are searchable and included in trust
          exports; do not enter passwords or private keys.
        </p>
        <FormField label="Tags" htmlFor={`${fieldId}-tags`}>
          <TextInput
            id={`${fieldId}-tags`}
            aria-label="Identity metadata tags"
            value={tags}
            onChange={setTags}
            disabled={busy}
            placeholder="production, office"
          />
        </FormField>
        <FormField label="Description" htmlFor={`${fieldId}-description`}>
          <Textarea
            id={`${fieldId}-description`}
            aria-label="Identity description"
            className="min-h-28 resize-y"
            value={description}
            onChange={setDescription}
            disabled={busy}
            maxLength={4096}
            placeholder="Purpose, owner or verification notes"
          />
        </FormField>
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
