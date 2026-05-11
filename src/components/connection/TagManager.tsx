import React, { useMemo, useState } from 'react';
import { Tag, X, Plus } from 'lucide-react';

interface TagManagerProps {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
  onCreateTag?: (tag: string) => void;
}

const normalizeTagName = (tag: string) => tag.trim().replace(/\s+/g, ' ');

const getTagKey = (tag: string) => normalizeTagName(tag).toLocaleLowerCase();

const dedupeTags = (sourceTags: string[]) => {
  const seen = new Set<string>();
  const uniqueTags: string[] = [];

  sourceTags.forEach(sourceTag => {
    const normalizedTag = normalizeTagName(sourceTag);
    const key = getTagKey(normalizedTag);

    if (!normalizedTag || seen.has(key)) {
      return;
    }

    seen.add(key);
    uniqueTags.push(normalizedTag);
  });

  return uniqueTags;
};

export const TagManager: React.FC<TagManagerProps> = ({
  tags,
  availableTags,
  onChange,
  onCreateTag,
}) => {
  const [newTag, setNewTag] = useState('');
  const [showInput, setShowInput] = useState(false);

  const selectedTags = useMemo(() => dedupeTags(tags), [tags]);
  const normalizedAvailableTags = useMemo(() => dedupeTags(availableTags), [availableTags]);

  const selectedTagKeys = useMemo(
    () => new Set(selectedTags.map(tag => getTagKey(tag))),
    [selectedTags],
  );

  const findAvailableTag = (tag: string) => {
    const key = getTagKey(tag);
    return normalizedAvailableTags.find(availableTag => getTagKey(availableTag) === key);
  };

  const handleAddTag = (tag: string) => {
    const normalizedTag = normalizeTagName(tag);
    const key = getTagKey(normalizedTag);

    if (!normalizedTag || selectedTagKeys.has(key)) {
      return;
    }

    onChange([...selectedTags, normalizedTag]);
  };

  const handleRemoveTag = (tag: string) => {
    const key = getTagKey(tag);
    onChange(selectedTags.filter(selectedTag => getTagKey(selectedTag) !== key));
  };

  const handleCreateTag = () => {
    const normalizedTag = normalizeTagName(newTag);

    if (!normalizedTag) {
      return;
    }

    const existingTag = findAvailableTag(normalizedTag);
    const tagToAdd = existingTag ?? normalizedTag;

    if (!existingTag && !selectedTagKeys.has(getTagKey(normalizedTag))) {
      onCreateTag?.(normalizedTag);
    }

    handleAddTag(tagToAdd);
    setNewTag('');
    setShowInput(false);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCreateTag();
    }

    if (event.key === 'Escape') {
      setShowInput(false);
      setNewTag('');
    }
  };

  const unusedTags = normalizedAvailableTags.filter(tag => !selectedTagKeys.has(getTagKey(tag)));

  return (
    <div className="space-y-2" data-testid="tag-manager">
      {/* Selected Tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5">
          {selectedTags.map(tag => (
            <span
              key={getTagKey(tag)}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-primary px-2 text-[11px] text-[var(--color-text)]"
              data-testid="tag-chip"
              title={tag}
            >
              <Tag size={10} className="flex-shrink-0" aria-hidden="true" />
              <span className="min-w-0 max-w-[11rem] truncate leading-5">{tag}</span>
              <button
                onClick={() => handleRemoveTag(tag)}
                className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
                aria-label={`Remove tag ${tag}`}
                title={`Remove tag ${tag}`}
                data-testid="tag-remove"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Available Tags */}
      {unusedTags.length > 0 && (
        <div>
          <label className="block text-[11px] font-medium text-[var(--color-textSecondary)] mb-1">
            Available Tags
          </label>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
            {unusedTags.map(tag => (
              <button
                key={getTagKey(tag)}
                onClick={() => handleAddTag(tag)}
                className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-transparent bg-[var(--color-surfaceHover)] px-2 text-[11px] text-[var(--color-textSecondary)] transition-colors hover:border-primary/40 hover:bg-[var(--color-border)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
                aria-label={`Add tag ${tag}`}
                title={`Add tag ${tag}`}
              >
                <Plus size={10} className="flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0 max-w-[11rem] truncate leading-5">{tag}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create New Tag */}
      <div>
        {showInput ? (
          <div className="flex min-h-7 items-center gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="New tag name"
              aria-label="New tag name"
              autoFocus
              data-testid="tag-input"
            />
            <button
              onClick={handleCreateTag}
              className="h-7 rounded bg-success px-2 text-xs text-[var(--color-text)] transition-colors hover:bg-success/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
              aria-label="Add tag"
              data-testid="tag-create"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewTag('');
              }}
              className="h-7 rounded bg-[var(--color-surfaceHover)] px-2 text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
              aria-label="Cancel tag creation"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-transparent bg-[var(--color-surfaceHover)] px-2 text-[11px] text-[var(--color-textSecondary)] transition-colors hover:border-primary/40 hover:bg-[var(--color-border)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
            aria-label="Create tag"
          >
            <Plus size={10} className="flex-shrink-0" aria-hidden="true" />
            Create Tag
          </button>
        )}
      </div>
    </div>
  );
};
