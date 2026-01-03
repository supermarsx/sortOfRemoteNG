import React, { useState, useEffect } from 'react';
import { Search, Plus, FolderPlus, Settings, Download, Upload, ChevronLeft, ChevronRight, Filter, Tag, Lock, Unlock, FileText, Expand as ExpandAll, ListCollapse as CollapseAll, BarChart3, ScrollText, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConnectionTree } from './ConnectionTree';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { SecureStorage } from '../utils/storage';
import { generateId } from '../utils/id';
import { ImportExport } from './ImportExport';
import { SettingsDialog } from './SettingsDialog';
import { PerformanceMonitor } from './PerformanceMonitor';
import { ActionLogViewer } from './ActionLogViewer';

interface SidebarProps {
  onNewConnection: () => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (connection: Connection) => void;
  onConnect: (connection: Connection) => void;
  onShowPasswordDialog: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  onConnect,
  onShowPasswordDialog,
}) => {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const [showFilters, setShowFilters] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);

  // Get all available tags
  const allTags = Array.from(
    new Set(
      state.connections
        .flatMap(conn => conn.tags || [])
        .filter(tag => tag.trim() !== '')
    )
  ).sort();

  const handleSearch = (term: string) => {
    dispatch({ type: 'SET_FILTER', payload: { searchTerm: term } });
  };

  const handleTagFilter = (tag: string) => {
    const currentTags = state.filter.tags;
    const newTags = currentTags.includes(tag)
      ? currentTags.filter(t => t !== tag)
      : [...currentTags, tag];
    
    dispatch({ type: 'SET_FILTER', payload: { tags: newTags } });
  };

  const handleNewGroup = () => {
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
  };

  const toggleSidebar = () => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  };

  const clearFilters = () => {
    dispatch({ 
      type: 'SET_FILTER', 
      payload: { 
        searchTerm: '', 
        tags: [], 
        protocols: [],
        showRecent: false,
        showFavorites: false 
      } 
    });
  };

  const expandAllFolders = () => {
    const updatedConnections = state.connections.map(conn => 
      conn.isGroup ? { ...conn, expanded: true } : conn
    );
    updatedConnections.forEach(conn => {
      if (conn.isGroup) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: conn });
      }
    });
  };

  const collapseAllFolders = () => {
    const updatedConnections = state.connections.map(conn => 
      conn.isGroup ? { ...conn, expanded: false } : conn
    );
    updatedConnections.forEach(conn => {
      if (conn.isGroup) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: conn });
      }
    });
  };

  const isStorageUnlocked = SecureStorage.isStorageUnlocked();
  const [isStorageEncrypted, setIsStorageEncrypted] = useState(false);

  useEffect(() => {
    SecureStorage.isStorageEncrypted().then(setIsStorageEncrypted);
  }, []);

  return (
    <>
      <div className={`bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-300 ${
        state.sidebarCollapsed ? 'w-12' : 'w-80'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {!state.sidebarCollapsed && (
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold text-white">{t('connections.title')}</h2>
                {isStorageEncrypted && (
                  <div className="flex items-center">
                    {isStorageUnlocked ? (
                      <span title="Storage unlocked">
                        <Unlock size={14} className="text-green-400" />
                      </span>
                    ) : (
                      <span title="Storage locked">
                        <Lock size={14} className="text-red-400" />
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400"
              title={state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {state.sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>

        {!state.sidebarCollapsed && (
          <>
            {/* Search */}
            <div className="p-4 border-b border-gray-700">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder={t('connections.search')}
                  value={state.filter.searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                >
                  <Filter size={12} />
                  <span>{t('connections.filters')}</span>
                  {(state.filter.tags.length > 0 || state.filter.protocols.length > 0) && (
                    <span className="bg-blue-600 text-white text-xs rounded-full px-1">
                      {state.filter.tags.length + state.filter.protocols.length}
                    </span>
                  )}
                </button>
                
                <div className="flex items-center space-x-1">
                  <button
                    onClick={expandAllFolders}
                    className="p-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    title={t('connections.expandAll')}
                  >
                    <ExpandAll size={12} />
                  </button>
                  <button
                    onClick={collapseAllFolders}
                    className="p-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    title={t('connections.collapseAll')}
                  >
                    <CollapseAll size={12} />
                  </button>
                </div>
                
                {(state.filter.searchTerm || state.filter.tags.length > 0 || state.filter.protocols.length > 0) && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    {t('connections.clear')}
                  </button>
                )}
              </div>

              {showFilters && (
                <div className="mt-3 p-3 bg-gray-700 rounded-md space-y-3">
                  {/* Tag Filters */}
                  {allTags.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">
                        Filter by Tags
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {allTags.map(tag => (
                          <button
                            key={tag}
                            onClick={() => handleTagFilter(tag)}
                            className={`inline-flex items-center px-2 py-1 text-xs rounded-full transition-colors ${
                              state.filter.tags.includes(tag)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                            }`}
                          >
                            <Tag size={8} className="mr-1" />
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Filters */}
                  <div className="space-y-2">
                    <label className="flex items-center text-xs text-gray-300">
                      <input 
                        type="checkbox" 
                        className="mr-2 rounded" 
                        checked={state.filter.showRecent}
                        onChange={(e) => dispatch({ 
                          type: 'SET_FILTER', 
                          payload: { showRecent: e.target.checked } 
                        })}
                      />
                      Recent connections
                    </label>
                    <label className="flex items-center text-xs text-gray-300">
                      <input 
                        type="checkbox" 
                        className="mr-2 rounded" 
                        checked={state.filter.showFavorites}
                        onChange={(e) => dispatch({ 
                          type: 'SET_FILTER', 
                          payload: { showFavorites: e.target.checked } 
                        })}
                      />
                      Favorites only
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Toolbar */}
            <div className="p-4 border-b border-gray-700">
              <div className="flex space-x-2">
                <button
                  onClick={onNewConnection}
                  className="flex items-center justify-center px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm flex-1"
                >
                  <Plus size={14} className="mr-1" />
                  {t('connections.new')}
                </button>
                <button
                  onClick={handleNewGroup}
                  className="flex items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors text-sm"
                  title={t('connections.newFolder')}
                >
                  <FolderPlus size={14} />
                </button>
              </div>
            </div>

            {/* Connection Tree */}
            <ConnectionTree
              onConnect={onConnect}
              onEdit={onEditConnection}
              onDelete={onDeleteConnection}
            />

            {/* Footer */}
            <div className="p-4 border-t border-gray-700 mt-auto">
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setShowImportExport(true)}
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Import/Export connections"
                >
                  <FileText size={16} />
                </button>
                <button
                  onClick={() => setShowPerformanceMonitor(true)}
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Performance Monitor"
                >
                  <BarChart3 size={16} />
                </button>
                <button
                  onClick={() => setShowActionLog(true)}
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Action Log"
                >
                  <ScrollText size={16} />
                </button>
                <button
                  onClick={onShowPasswordDialog}
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Security settings"
                >
                  <Lock size={16} />
                </button>
              </div>
              <div className="mt-2">
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title={t('settings.title')}
                >
                  <Settings size={16} className="mr-2" />
                  <span className="text-sm">{t('settings.title')}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <ImportExport
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
      />
      
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      
      <PerformanceMonitor
        isOpen={showPerformanceMonitor}
        onClose={() => setShowPerformanceMonitor(false)}
      />
      
      <ActionLogViewer
        isOpen={showActionLog}
        onClose={() => setShowActionLog(false)}
      />
    </>
  );
};
