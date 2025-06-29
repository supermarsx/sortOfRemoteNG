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
    <div className="space-y-3">
      {/* Selected Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-1 bg-blue-600 text-white text-xs rounded-full"
            >
              <Tag size={10} className="mr-1" />
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:bg-blue-700 rounded-full p-0.5"
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
          <label className="block text-xs font-medium text-gray-400 mb-2">
            Available Tags
          </label>
          <div className="flex flex-wrap gap-1">
            {unusedTags.map(tag => (
              <button
                key={tag}
                onClick={() => handleAddTag(tag)}
                className="inline-flex items-center px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-full transition-colors"
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
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="New tag name"
              autoFocus
            />
            <button
              onClick={handleCreateTag}
              className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewTag('');
              }}
              className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex items-center px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-full transition-colors"
          >
            <Plus size={10} className="mr-1" />
            Create Tag
          </button>
        )}
      </div>
    </div>
  );
};
