"use client";
import React, { useEffect, useRef, useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { Select as AppSelect } from "../ui/forms";
import type { SelectProps } from "../ui/forms/Select";
import { DocumentIconPicker } from "./DocumentIconPicker";
import ServiceDeskTags from "./ServiceDeskTags";
import type {
  BulkEntryPatch,
  BulkEntrySection,
  BulkTags,
} from "../../utils/documents/documentBulkEdit";
import type { DocumentTicket } from "../../types/documents/document";

function Select(props: SelectProps) {
  const label = props.label?.replace(/^Bulk /, "");
  return (
    <div className="space-y-1">
      <p className="text-sm">
        {label ? label[0].toUpperCase() + label.slice(1) : ""}
      </p>
      <AppSelect
        {...props}
        onChange={(value) => {
          if (!props.disabled) props.onChange(value);
        }}
      />
    </div>
  );
}

export default function BulkEditEntriesDialog({
  section,
  count,
  folders,
  tagSuggestions,
  disabled = false,
  onClose,
  onApply,
}: {
  section: BulkEntrySection;
  count: number;
  folders: readonly { id: string; name: string }[];
  tagSuggestions: string[];
  disabled?: boolean;
  onClose: () => void;
  onApply: (patch: BulkEntryPatch) => void | Promise<void>;
}) {
  const [folder, setFolder] = useState("keep");
  const [iconMode, setIconMode] = useState("keep");
  const [icon, setIcon] = useState("file-text");
  const [organizationMode, setOrganizationMode] = useState("keep");
  const [organization, setOrganization] = useState("");
  const [status, setStatus] = useState("keep");
  const [priority, setPriority] = useState("keep");
  const [tagMode, setTagMode] = useState<BulkTags["mode"]>("keep");
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [review, setReview] = useState<{
    patch: BulkEntryPatch;
    lines: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!alive.current || pending.current || disabled) return;
    setError("");
    if (!review) {
      const lines: string[] = [];
      const tagChange: BulkTags =
        tagMode === "keep" || tagMode === "clear"
          ? { mode: tagMode }
          : { mode: tagMode, values: tagValues };
      if (section !== "documents" && tagMode !== "keep") {
        if (tagMode !== "clear" && !tagValues.length) {
          setError("Add the tags to apply, or choose Clear all tags.");
          return;
        }
        lines.push(
          tagMode === "clear"
            ? "Clear all tags"
            : `${tagMode === "add" ? "Add" : tagMode === "remove" ? "Remove" : "Replace tags with"}: ${tagValues.join(", ")}`,
        );
      }
      let patch: BulkEntryPatch;
      if (section === "documents") {
        if (folder !== "keep")
          lines.push(
            `Move to ${folder === "root" ? "Database root" : (folders.find((item) => `folder:${item.id}` === folder)?.name ?? "unavailable folder")}`,
          );
        if (iconMode !== "keep") lines.push("Set the selected document icon");
        patch = {
          section,
          folder:
            folder === "keep"
              ? { mode: "keep" }
              : {
                  mode: "set",
                  value: folder === "root" ? null : folder.slice(7),
                },
          icon:
            iconMode === "keep"
              ? { mode: "keep" }
              : { mode: "set", value: icon },
        };
      } else if (section === "people") {
        if (organizationMode !== "keep") {
          if (organizationMode === "set" && !organization.trim()) {
            setError("Enter an organization, or choose Clear organization.");
            return;
          }
          lines.push(
            organizationMode === "clear"
              ? "Clear organization"
              : `Set organization: ${organization.trim()}`,
          );
        }
        patch = {
          section,
          organization:
            organizationMode === "keep"
              ? { mode: "keep" }
              : {
                  mode: "set",
                  value:
                    organizationMode === "clear" ? "" : organization.trim(),
                },
          tags: tagChange,
        };
      } else {
        if (status !== "keep")
          lines.push(`Set status: ${status.replace(/-/g, " ")}`);
        if (priority !== "keep") lines.push(`Set priority: ${priority}`);
        patch = {
          section,
          status:
            status === "keep"
              ? { mode: "keep" }
              : { mode: "set", value: status as DocumentTicket["status"] },
          priority:
            priority === "keep"
              ? { mode: "keep" }
              : { mode: "set", value: priority as DocumentTicket["priority"] },
          tags: tagChange,
        };
      }
      if (!lines.length) {
        setError(
          "Choose at least one field to change. All other fields stay unchanged.",
        );
        return;
      }
      setReview({ patch, lines });
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await onApply(review.patch);
      if (alive.current) onClose();
    } catch {
      if (alive.current)
        setError(
          "The bulk edit could not be applied. No partial batch was applied. Check database access, selected entries, folder and tag limits; reopen the review if the data changed.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const keep = { value: "keep", label: "Keep unchanged" };
  return (
    <Modal
      isOpen
      onClose={close}
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      ariaLabel={`Bulk edit ${section}`}
      panelClassName="max-w-xl mx-4"
    >
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            <Layers size={18} /> Bulk edit {section}
          </span>
        }
        showCloseButton={false}
      />
      <form
        onSubmit={(event) => void submit(event)}
        className="flex min-h-0 flex-1 flex-col"
        aria-label="Bulk entry changes"
      >
        <ModalBody className="space-y-4">
          <p className="text-sm text-[var(--color-textSecondary)]">
            {count} selected {section}. Only the fields you choose will change.
            This updates the draft; use Save to commit it to the protected
            database.
          </p>
          {review ? (
            <section
              aria-label="Review bulk changes"
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <h3 className="mb-2 font-medium">
                Review changes to {count} entries
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {review.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[var(--color-textMuted)]">
                Names, content, credentials and references are not changed. No
                records are deleted.
              </p>
            </section>
          ) : (
            <fieldset disabled={busy || disabled} className="space-y-4">
              {section === "documents" && (
                <>
                  <Select
                    label="Bulk document folder"
                    disabled={busy || disabled}
                    variant="form-sm"
                    title="Move selected documents; keep each current folder unless changed"
                    value={folder}
                    onChange={setFolder}
                    searchable
                    options={[
                      keep,
                      { value: "root", label: "Move to database root" },
                      ...folders.map((item) => ({
                        value: `folder:${item.id}`,
                        label: item.name,
                      })),
                    ]}
                  />
                  <Select
                    label="Bulk document icon"
                    disabled={busy || disabled}
                    variant="form-sm"
                    value={iconMode}
                    onChange={setIconMode}
                    options={[
                      keep,
                      { value: "set", label: "Change document icon" },
                    ]}
                  />
                  {iconMode === "set" && (
                    <DocumentIconPicker
                      value={icon}
                      onChange={setIcon}
                      disabled={disabled || busy}
                    />
                  )}
                </>
              )}
              {section === "people" && (
                <>
                  <Select
                    label="Bulk organization"
                    disabled={busy || disabled}
                    variant="form-sm"
                    value={organizationMode}
                    onChange={setOrganizationMode}
                    options={[
                      keep,
                      { value: "set", label: "Set organization" },
                      { value: "clear", label: "Clear organization" },
                    ]}
                  />
                  {organizationMode === "set" && (
                    <label className="block space-y-1 text-sm">
                      Organization
                      <input
                        autoFocus
                        className="sor-form-input block w-full"
                        maxLength={256}
                        value={organization}
                        onChange={(event) =>
                          setOrganization(event.target.value)
                        }
                      />
                    </label>
                  )}
                </>
              )}
              {section === "tickets" && (
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Bulk ticket status"
                    disabled={busy || disabled}
                    variant="form-sm"
                    value={status}
                    onChange={setStatus}
                    options={[
                      keep,
                      { value: "open", label: "Open" },
                      { value: "in-progress", label: "In progress" },
                      { value: "resolved", label: "Resolved" },
                      { value: "closed", label: "Closed" },
                    ]}
                  />
                  <Select
                    label="Bulk ticket priority"
                    disabled={busy || disabled}
                    variant="form-sm"
                    value={priority}
                    onChange={setPriority}
                    options={[
                      keep,
                      ...["low", "normal", "high", "urgent"].map((value) => ({
                        value,
                        label: value[0].toUpperCase() + value.slice(1),
                      })),
                    ]}
                  />
                </div>
              )}
              {section !== "documents" && (
                <>
                  <Select
                    label="Bulk tags"
                    disabled={busy || disabled}
                    variant="form-sm"
                    value={tagMode}
                    onChange={(value) => setTagMode(value as BulkTags["mode"])}
                    options={[
                      keep,
                      { value: "add", label: "Add tags (keep existing)" },
                      { value: "remove", label: "Remove selected tags" },
                      { value: "replace", label: "Replace all tags" },
                      { value: "clear", label: "Clear all tags" },
                    ]}
                  />
                  {tagMode !== "keep" && tagMode !== "clear" && (
                    <ServiceDeskTags
                      tags={tagValues}
                      suggestions={tagSuggestions}
                      disabled={busy || disabled}
                      onChange={setTagValues}
                    />
                  )}
                </>
              )}
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          {disabled && !busy && (
            <p role="alert" className="text-sm text-warning">
              The database, selected entries or document settings changed. Close
              this review and select the current entries again.
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin" /> Applying changes to
              the draft…
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          {review && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={busy || disabled}
              onClick={() => {
                setReview(null);
                setError("");
              }}
            >
              Back
            </button>
          )}
          <button
            type="submit"
            className="sor-btn sor-btn-primary"
            disabled={busy || disabled || count === 0}
          >
            {review ? "Apply to draft" : "Review changes"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
