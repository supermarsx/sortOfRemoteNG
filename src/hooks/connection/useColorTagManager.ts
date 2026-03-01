import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { generateId } from '../../utils/id';

interface ColorTag {
  id: string;
  name: string;
  color: string;
  global: boolean;
}

export const PREDEFINED_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#64748b', '#6b7280', '#374151',
];

export function useColorTagManager(
  colorTags: Record<string, ColorTag>,
  onUpdateColorTags: (tags: Record<string, ColorTag>) => void,
) {
  const { t } = useTranslation();
  const [editingTag, setEditingTag] = useState<ColorTag | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTag, setNewTag] = useState<Partial<ColorTag>>({
    name: '',
    color: '#3b82f6',
    global: true,
  });

  const handleAddTag = useCallback(() => {
    if (!newTag.name?.trim()) return;
    const id = generateId();
    const tag: ColorTag = {
      id,
      name: newTag.name.trim(),
      color: newTag.color || '#3b82f6',
      global: newTag.global || false,
    };
    onUpdateColorTags({ ...colorTags, [id]: tag });
    setNewTag({ name: '', color: '#3b82f6', global: true });
    setShowAddForm(false);
  }, [newTag, colorTags, onUpdateColorTags]);

  const handleEditTag = useCallback((tag: ColorTag) => {
    setEditingTag({ ...tag });
  }, []);

  const handleUpdateTag = useCallback(() => {
    if (!editingTag || !editingTag.name?.trim()) return;
    onUpdateColorTags({ ...colorTags, [editingTag.id]: editingTag });
    setEditingTag(null);
  }, [editingTag, colorTags, onUpdateColorTags]);

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      if (confirm('Are you sure you want to delete this color tag?')) {
        const updatedTags = { ...colorTags };
        delete updatedTags[tagId];
        onUpdateColorTags(updatedTags);
      }
    },
    [colorTags, onUpdateColorTags],
  );

  return {
    t,
    editingTag,
    setEditingTag,
    showAddForm,
    setShowAddForm,
    newTag,
    setNewTag,
    handleAddTag,
    handleEditTag,
    handleUpdateTag,
    handleDeleteTag,
  };
}
