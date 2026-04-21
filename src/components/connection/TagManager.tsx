import React, { useState } from 'react';
import { Tag, X, Plus } from 'lucide-react';

interface TagManagerProps {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
  onCreateTag?: (tag: string) => void;
}

export const TagManager: React.FC<TagManagerProps> = ({
  tags,
  availableTags,
  onChange,
  onCreateTag,
}) => {
  const [newTag, setNewTag] = useState('');
  const [showInput, setShowInput] = useState(false);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) {
      onChange([...tags, tag]);
    }
  };

  const handleRemoveTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  const handleCreateTag = () => {
    if (newTag.trim() && !availableTags.includes(newTag.trim())) {
      onCreateTag?.(newTag.trim());
      handleAddTag(newTag.trim());
      setNewTag('');
      setShowInput(false);
    }
  };

  const unusedTags = availableTags.filter(tag => !tags.includes(tag));

  return (
    <div className="space-y-2" data-testid="tag-manager">
      {/* Selected Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 bg-primary text-[var(--color-text)] text-[11px] rounded-full"
              data-testid="tag-chip"
            >
              <Tag size={10} className="mr-1" />
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:bg-primary/90 rounded-full p-0.5"
                data-testid="tag-remove"
              >
                <X size={10} />
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
          <div className="flex flex-wrap gap-1">
            {unusedTags.map(tag => (
              <button
                key={tag}
                onClick={() => handleAddTag(tag)}
                className="inline-flex items-center px-2 py-0.5 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] text-[11px] rounded-full transition-colors"
              >
                <Plus size={10} className="mr-1" />
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create New Tag */}
      <div>
        {showInput ? (
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateTag()}
              className="flex-1 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="New tag name"
              autoFocus
              data-testid="tag-input"
            />
            <button
              onClick={handleCreateTag}
              className="px-2 py-1 bg-success hover:bg-success/90 text-[var(--color-text)] text-xs rounded transition-colors"
              data-testid="tag-create"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewTag('');
              }}
              className="px-2 py-1 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] text-xs rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex items-center px-2 py-0.5 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] text-[11px] rounded-full transition-colors"
          >
            <Plus size={10} className="mr-1" />
            Create Tag
          </button>
        )}
      </div>
    </div>
  );
};
