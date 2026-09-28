import React, { useId } from "react";
import type { SectionProps } from "./types";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { TextInput } from "../../ui/forms/TextInput";

const BookmarkEditDialog: React.FC<SectionProps> = ({ mgr }) => {
  const id = useId();
  const edit = mgr.bookmarkEdit;
  if (!edit) return null;
  const cancel = () => mgr.setBookmarkEdit(null);
  const update = (field: "name" | "path", value: string) =>
    mgr.setBookmarkEdit((previous) =>
      previous ? { ...previous, [field]: value, error: undefined } : null,
    );

  return (
    <Modal
      isOpen
      onClose={cancel}
      ariaLabel="Edit bookmark"
      panelClassName="max-w-md"
      dataTestId="bookmark-edit-dialog"
    >
      <ModalHeader title="Edit bookmark" onClose={cancel} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mgr.saveBookmarkEdit();
        }}
      >
        <ModalBody className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-name`}
              className="text-sm text-[var(--color-textSecondary)]"
            >
              Name
            </label>
            <TextInput
              id={`${id}-name`}
              value={edit.name}
              onChange={(value) => update("name", value)}
              className="w-full"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-path`}
              className="text-sm text-[var(--color-textSecondary)]"
            >
              URL or path
            </label>
            <TextInput
              id={`${id}-path`}
              value={edit.path}
              onChange={(value) => update("path", value)}
              className="w-full"
              placeholder="/status or https://example.com"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-help`}
            />
            <p
              id={`${id}-help`}
              className="text-xs text-[var(--color-textSecondary)]"
            >
              Use a path on this connection or a full HTTP or HTTPS URL.
            </p>
          </div>
          {edit.error && (
            <p role="alert" className="text-sm text-error">
              {edit.error}
            </p>
          )}
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="sor-btn sor-btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" className="sor-btn sor-btn-primary">
            Save
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default BookmarkEditDialog;
