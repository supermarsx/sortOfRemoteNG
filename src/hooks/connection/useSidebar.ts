import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnections } from '../../contexts/useConnections';
import SettingsContext, { useSettings } from '../../contexts/SettingsContext';
import { Connection } from '../../types/connection/connection';
import { SecureStorage } from '../../utils/storage/storage';
import { generateId } from '../../utils/core/id';

type SettingsContextValue = ReturnType<typeof useSettings>;

interface SidebarColorTagFilter {
  id: string;
  name: string;
  color: string;
  global: boolean;
  count: number;
}

export function useSidebar() {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const settingsContext = useContext(SettingsContext) as SettingsContextValue | undefined;
  const colorTags = settingsContext?.settings.colorTags ?? {};
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [isStorageEncrypted, setIsStorageEncrypted] = useState(false);

  useEffect(() => {
    SecureStorage.isStorageEncrypted().then(setIsStorageEncrypted);
  }, []);

  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          state.connections
            .flatMap((conn) => conn.tags || [])
            .filter((tag) => tag.trim() !== ''),
        ),
      ).sort(),
    [state.connections],
  );

  const allColorTags = useMemo<SidebarColorTagFilter[]>(() => {
    const usageCounts = new Map<string, number>();
    for (const conn of state.connections) {
      if (conn.colorTag) {
        usageCounts.set(conn.colorTag, (usageCounts.get(conn.colorTag) || 0) + 1);
      }
    }

    return Object.entries(colorTags)
      .map(([id, tag]) => ({
        id,
        name: tag.name,
        color: tag.color,
        global: tag.global,
        count: usageCounts.get(id) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [colorTags, state.connections]);

  const activeFilterCount = state.filter.tags.length + state.filter.colorTags.length + state.filter.protocols.length;

  const isStorageUnlocked = SecureStorage.isStorageUnlocked();
  const isFavoritesActive = state.filter.showFavorites;

  const handleSearch = useCallback(
    (term: string) => {
      dispatch({ type: 'SET_FILTER', payload: { searchTerm: term } });
    },
    [dispatch],
  );

  const handleTagFilter = useCallback(
    (tag: string) => {
      const currentTags = state.filter.tags;
      const newTags = currentTags.includes(tag)
        ? currentTags.filter((t) => t !== tag)
        : [...currentTags, tag];
      dispatch({ type: 'SET_FILTER', payload: { tags: newTags } });
    },
    [dispatch, state.filter.tags],
  );

  const handleColorTagFilter = useCallback(
    (tagId: string) => {
      const currentTags = state.filter.colorTags;
      const newTags = currentTags.includes(tagId)
        ? currentTags.filter((id) => id !== tagId)
        : [...currentTags, tagId];
      dispatch({ type: 'SET_FILTER', payload: { colorTags: newTags } });
    },
    [dispatch, state.filter.colorTags],
  );

  const handleNewGroup = useCallback(() => {
    const groupConnection: Connection = {
      id: generateId(),
      name: t('connections.newFolder'),
      protocol: 'rdp',
      hostname: '',
      port: 3389,
      isGroup: true,
      expanded: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_CONNECTION', payload: groupConnection });
  }, [dispatch, t]);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, [dispatch]);

  const clearFilters = useCallback(() => {
    dispatch({
      type: 'SET_FILTER',
      payload: {
        searchTerm: '',
        tags: [],
        colorTags: [],
        protocols: [],
        showRecent: false,
        showFavorites: false,
      },
    });
  }, [dispatch]);

  const expandAllFolders = useCallback(() => {
    state.connections.forEach((conn) => {
      if (conn.isGroup) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: { ...conn, expanded: true } });
      }
    });
  }, [state.connections, dispatch]);

  const collapseAllFolders = useCallback(() => {
    state.connections.forEach((conn) => {
      if (conn.isGroup) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: { ...conn, expanded: false } });
      }
    });
  }, [state.connections, dispatch]);

  return {
    t,
    state,
    dispatch,
    showFilters,
    setShowFilters,
    showSortMenu,
    setShowSortMenu,
    isStorageEncrypted,
    isStorageUnlocked,
    isFavoritesActive,
    allTags,
    allColorTags,
    activeFilterCount,
    handleSearch,
    handleTagFilter,
    handleColorTagFilter,
    handleNewGroup,
    toggleSidebar,
    clearFilters,
    expandAllFolders,
    collapseAllFolders,
  };
}
