import React, { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { PasswordInput } from "../ui/forms";

interface PasswordPromptDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  error?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const PasswordPromptDialog: React.FC<PasswordPromptDialogProps> = ({
  isOpen,
  title,
  description,
  error,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValue("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    onSubmit(value);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      backdropClassName="bg-black/60"
      panelClassName="max-w-md rounded-xl overflow-hidden"
      contentClassName="bg-[var(--color-surface)]"
      dataTestId="import-password-prompt"
    >
      <DialogHeader
        icon={Lock}
        iconColor="text-primary"
        iconBg="bg-primary/20"
        title={title}
        onClose={onCancel}
      />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <p className="text-sm text-[var(--color-textSecondary)]">{description}</p>
        <PasswordInput
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="sor-form-input w-full"
          placeholder="Password"
          autoComplete="current-password"
          data-testid="import-password-prompt-input"
        />
        {error && (
          <p className="text-xs text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="sor-btn-secondary-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value}
            className="sor-btn-primary-sm"
            data-testid="import-password-prompt-submit"
          >
            Decrypt
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PasswordPromptDialog;
