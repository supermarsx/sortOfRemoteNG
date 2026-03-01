import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnections } from '../../contexts/useConnections';
import { Connection } from '../../types/connection';
import { SecureStorage } from '../../utils/storage';
import { generateId } from '../../utils/id';

export function useSidebar() {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
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

  const handleNewGroup = useCallback(() => {
    const groupConnection: Connection = {
      id: generateId(),
      name: t('connections.newFolder'),
      protocol: 'rdp',
      hostname: '',
      port: 3389,
      isGroup: true,
      expanded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
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
    showBulkEditor,
    setShowBulkEditor,
    isStorageEncrypted,
    isStorageUnlocked,
    isFavoritesActive,
    allTags,
    handleSearch,
    handleTagFilter,
    handleNewGroup,
    toggleSidebar,
    clearFilters,
    expandAllFolders,
    collapseAllFolders,
  };
}
