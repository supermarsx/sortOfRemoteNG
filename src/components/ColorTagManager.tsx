import React, { useState } from 'react';
import { X, Plus, Palette, Edit, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ColorTag {
  id: string;
  name: string;
  color: string;
  global: boolean;
}

interface ColorTagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  colorTags: Record<string, ColorTag>;
  onUpdateColorTags: (tags: Record<string, ColorTag>) => void;
}

export const ColorTagManager: React.FC<ColorTagManagerProps> = ({
  isOpen,
  onClose,
  colorTags,
  onUpdateColorTags,
}) => {
  const { t } = useTranslation();
  const [editingTag, setEditingTag] = useState<ColorTag | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTag, setNewTag] = useState<Partial<ColorTag>>({
    name: '',
    color: '#3b82f6',
    global: true,
  });

  const predefinedColors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#64748b', '#6b7280', '#374151'
  ];

  const handleAddTag = () => {
    if (!newTag.name?.trim()) return;

    const id = crypto.randomUUID();
    const tag: ColorTag = {
      id,
      name: newTag.name.trim(),
      color: newTag.color || '#3b82f6',
      global: newTag.global || false,
    };

    onUpdateColorTags({
      ...colorTags,
      [id]: tag,
    });

    setNewTag({ name: '', color: '#3b82f6', global: true });
    setShowAddForm(false);
  };

  const handleEditTag = (tag: ColorTag) => {
    setEditingTag({ ...tag });
  };

  const handleUpdateTag = () => {
    if (!editingTag || !editingTag.name?.trim()) return;

    onUpdateColorTags({
      ...colorTags,
      [editingTag.id]: editingTag,
    });

    setEditingTag(null);
  };

  const handleDeleteTag = (tagId: string) => {
    if (confirm('Are you sure you want to delete this color tag?')) {
      const updatedTags = { ...colorTags };
      delete updatedTags[tagId];
      onUpdateColorTags(updatedTags);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
            <Palette size={20} className="text-blue-400" />
            <span>Color Tag Manager</span>
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Plus size={14} />
              <span>Add Tag</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Add Tag Form */}
          {showAddForm && (
            <div className="bg-gray-700 rounded-lg p-4 mb-6">
              <h3 className="text-white font-medium mb-4">Add New Color Tag</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tag Name
                  </label>
                  <input
                    type="text"
                    value={newTag.name || ''}
                    onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    placeholder="Enter tag name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Color
                  </label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={newTag.color || '#3b82f6'}
                      onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                      className="w-12 h-8 rounded border border-gray-500"
                    />
                    <div className="flex flex-wrap gap-2">
                      {predefinedColors.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewTag({ ...newTag, color })}
                          className={`w-6 h-6 rounded border-2 transition-all ${
                            newTag.color === color ? 'border-white scale-110' : 'border-gray-500'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={newTag.global || false}
                    onChange={(e) => setNewTag({ ...newTag, global: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Global tag (available for all connections)</span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTag}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Add Tag
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Tag Form */}
          {editingTag && (
            <div className="bg-gray-700 rounded-lg p-4 mb-6">
              <h3 className="text-white font-medium mb-4">Edit Color Tag</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tag Name
                  </label>
                  <input
                    type="text"
                    value={editingTag.name}
                    onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Color
                  </label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={editingTag.color}
                      onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                      className="w-12 h-8 rounded border border-gray-500"
                    />
                    <div className="flex flex-wrap gap-2">
                      {predefinedColors.map(color => (
                        <button
                          key={color}
                          onClick={() => setEditingTag({ ...editingTag, color })}
                          className={`w-6 h-6 rounded border-2 transition-all ${
                            editingTag.color === color ? 'border-white scale-110' : 'border-gray-500'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={editingTag.global}
                    onChange={(e) => setEditingTag({ ...editingTag, global: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Global tag</span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setEditingTag(null)}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateTag}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Color Tags List */}
          <div className="space-y-3">
            <h3 className="text-white font-medium">Existing Color Tags</h3>
            
            {Object.values(colorTags).length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Palette size={48} className="mx-auto mb-4" />
                <p>No color tags created yet</p>
                <p className="text-sm">Add a color tag to organize your connections</p>
              </div>
            ) : (
              Object.values(colorTags).map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-6 h-6 rounded border border-gray-500"
                      style={{ backgroundColor: tag.color }}
                    />
                    <div>
                      <span className="text-white font-medium">{tag.name}</span>
                      {tag.global && (
                        <span className="ml-2 text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded">
                          Global
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleEditTag(tag)}
                      className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                      title="Edit"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className="p-2 hover:bg-gray-600 rounded transition-colors text-red-400 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
