"use client";
import React, { useId, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { normalizeServiceDeskTags } from "../../utils/documents/serviceDesk";
import styles from "./documents.module.css";

export default function ServiceDeskTags({
  tags,
  suggestions,
  disabled,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const add = (value = draft) => {
    if (disabled || !value.trim()) return;
    try {
      const next = normalizeServiceDeskTags([...tags, value]);
      onChange(next);
      setDraft("");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The tag could not be added.",
      );
    }
  };
  return (
    <section className={styles.tagsEditor} aria-label="Record tags">
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <Tag size={14} /> Tags
      </label>
      <div className={styles.tags}>
        {tags.map((tag) => (
          <span className={styles.tag} key={tag.toLowerCase()}>
            <span>{tag}</span>
            <button
              type="button"
              className="sor-icon-btn-sm"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter((value) => value !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex max-w-sm items-center gap-2">
        <input
          id={id}
          className="sor-form-input min-w-0"
          value={draft}
          disabled={disabled}
          placeholder="Add a tag"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          aria-label="Add tag"
          disabled={disabled || !draft.trim()}
          onClick={() => add()}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Suggested tags">
        {suggestions
          .filter(
            (tag) =>
              tag.toLowerCase().includes(draft.trim().toLowerCase()) &&
              !tags.some((value) => value.toLowerCase() === tag.toLowerCase()),
          )
          .slice(0, 5)
          .map((tag) => (
            <button
              key={tag}
              type="button"
              className="sor-btn sor-btn-secondary !px-2 !py-1 !text-xs"
              aria-label={`Use tag ${tag}`}
              disabled={disabled}
              onClick={() => add(tag)}
            >
              {tag}
            </button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </section>
  );
}
