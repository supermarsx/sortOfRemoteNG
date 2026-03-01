import React from 'react';
import { Search, Plus, FolderPlus, ChevronLeft, ChevronRight, Filter, Tag, Lock, Unlock, Expand as ExpandAll, ListCollapse as CollapseAll, ArrowLeftRight, Star, TableProperties, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ConnectionTree } from './ConnectionTree';
import { BulkConnectionEditor } from './BulkConnectionEditor';
import { Connection } from '../types/connection';
import { useSidebar } from '../hooks/connection/useSidebar';

type Mgr = ReturnType<typeof useSidebar>;

/* ── Sub-components ──────────────────────────────────── */

const SidebarHeader: React.FC<{ mgr: Mgr; sidebarPosition: 'left' | 'right'; onToggleSidebarPosition: () => void }> = ({ mgr, sidebarPosition, onToggleSidebarPosition }) => (
  <div className={`border-b border-[var(--color-border)] ${mgr.state.sidebarCollapsed ? "p-2" : "p-3"}`}>
    <div className={`flex items-center ${mgr.state.sidebarCollapsed ? "justify-center" : "justify-between"}`}>
      {!mgr.state.sidebarCollapsed && (
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-light text-[var(--color-text)] tracking-wide">{mgr.t('connections.title')}</h2>
          {mgr.isStorageEncrypted && (
            <div className="flex items-center">
              {mgr.isStorageUnlocked ? (
                <span title="Storage unlocked"><Unlock size={14} className="text-green-400" /></span>
              ) : (
                <span title="Storage locked"><Lock size={14} className="text-red-400" /></span>
              )}
            </div>
          )}
        </div>
      )}
      <div className={mgr.state.sidebarCollapsed ? "flex flex-col items-center gap-1" : "flex items-center space-x-1"}>
        <button onClick={onToggleSidebarPosition} className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)]" title={`Dock to ${sidebarPosition === 'left' ? 'right' : 'left'}`}>
          <ArrowLeftRight size={16} className={sidebarPosition === 'right' ? 'rotate-180' : ''} />
        </button>
        <button onClick={mgr.toggleSidebar} className="p-1 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)]" title={mgr.state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {mgr.state.sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </div>
  </div>
);

const SearchBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="p-3 border-b border-[var(--color-border)]">
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)]" />
      <input type="text" placeholder={mgr.t('connections.search')} value={mgr.state.filter.searchTerm} onChange={(e) => mgr.handleSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs" />
    </div>
    <div className="flex items-center justify-between mt-2">
      <button onClick={() => mgr.setShowFilters(!mgr.showFilters)} className="flex items-center space-x-1 px-2 py-0.5 text-[11px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors">
        <Filter size={12} />
        <span>{mgr.t('connections.filters')}</span>
        {(mgr.state.filter.tags.length > 0 || mgr.state.filter.protocols.length > 0) && (
          <span className="bg-blue-600 text-[var(--color-text)] text-xs rounded-full px-1">{mgr.state.filter.tags.length + mgr.state.filter.protocols.length}</span>
        )}
      </button>
      <div className="flex items-center space-x-1">
        <button onClick={() => mgr.dispatch({ type: 'SET_FILTER', payload: { showFavorites: !mgr.state.filter.showFavorites } })} className={`p-1 text-xs rounded transition-colors ${mgr.isFavoritesActive ? 'text-yellow-300 bg-yellow-400/20' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'}`} title={mgr.isFavoritesActive ? "Showing favorites" : "Toggle favorites"}>
          <Star size={12} />
        </button>
        <button onClick={mgr.expandAllFolders} className="p-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors" title={mgr.t('connections.expandAll')}>
          <ExpandAll size={12} />
        </button>
        <button onClick={mgr.collapseAllFolders} className="p-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors" title={mgr.t('connections.collapseAll')}>
          <CollapseAll size={12} />
        </button>
      </div>
      {(mgr.state.filter.searchTerm || mgr.state.filter.tags.length > 0 || mgr.state.filter.protocols.length > 0) && (
        <button onClick={mgr.clearFilters} className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">{mgr.t('connections.clear')}</button>
      )}
    </div>

    {mgr.showFilters && (
      <div className="mt-3 p-3 bg-[var(--color-border)] rounded-md space-y-3">
        {mgr.allTags.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-2">Filter by Tags</label>
            <div className="flex flex-wrap gap-1">
              {mgr.allTags.map(tag => (
                <button key={tag} onClick={() => mgr.handleTagFilter(tag)} className={`inline-flex items-center px-2 py-1 text-xs rounded-full transition-colors ${mgr.state.filter.tags.includes(tag) ? 'bg-blue-600 text-[var(--color-text)]' : 'bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500'}`}>
                  <Tag size={8} className="mr-1" />{tag}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2">
          <label className="flex items-center text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" className="mr-2 rounded" checked={mgr.state.filter.showRecent} onChange={(e) => mgr.dispatch({ type: 'SET_FILTER', payload: { showRecent: e.target.checked } })} />
            Recent connections
          </label>
          <label className="flex items-center text-xs text-[var(--color-textSecondary)]">
            <input type="checkbox" className="mr-2 rounded" checked={mgr.state.filter.showFavorites} onChange={(e) => mgr.dispatch({ type: 'SET_FILTER', payload: { showFavorites: e.target.checked } })} />
            Favorites only
          </label>
        </div>
        <div className="pt-2 border-t border-[var(--color-border)]">
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-2">Sort By</label>
          <div className="flex gap-2">
            <select value={mgr.state.filter.sortBy || 'name'} onChange={(e) => mgr.dispatch({ type: 'SET_FILTER', payload: { sortBy: e.target.value as 'name' | 'protocol' | 'hostname' | 'createdAt' | 'updatedAt' | 'recentlyUsed' | 'custom' } })} className="flex-1 px-2 py-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-textSecondary)] focus:border-blue-500 focus:outline-none">
              <option value="name">Name</option>
              <option value="protocol">Protocol</option>
              <option value="hostname">Hostname</option>
              <option value="createdAt">Date Created</option>
              <option value="updatedAt">Date Modified</option>
              <option value="recentlyUsed">Recently Used</option>
              <option value="custom">Custom Order</option>
            </select>
            <button onClick={() => mgr.dispatch({ type: 'SET_FILTER', payload: { sortDirection: mgr.state.filter.sortDirection === 'asc' ? 'desc' : 'asc' } })} className={`p-1.5 rounded transition-colors ${mgr.state.filter.sortDirection === 'desc' ? 'bg-blue-600 text-[var(--color-text)]' : 'bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500'}`} title={mgr.state.filter.sortDirection === 'asc' ? 'Ascending' : 'Descending'}>
              {mgr.state.filter.sortDirection === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);

const SidebarToolbar: React.FC<{ mgr: Mgr; onNewConnection: () => void }> = ({ mgr, onNewConnection }) => (
  <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center space-x-1">
    <button onClick={onNewConnection} className="p-1.5 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded transition-colors" title={mgr.t('connections.new')}>
      <Plus size={14} />
    </button>
    <button onClick={mgr.handleNewGroup} className="p-1.5 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded transition-colors" title={mgr.t('connections.newFolder')}>
      <FolderPlus size={14} />
    </button>
    <div className="flex-1" />
    <button onClick={() => mgr.setShowBulkEditor(true)} className="p-1.5 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded transition-colors" title="Bulk Edit">
      <TableProperties size={14} />
    </button>
  </div>
);

/* ── Main Component ──────────────────────────────────── */

interface SidebarProps {
  sidebarPosition: 'left' | 'right';
  onToggleSidebarPosition: () => void;
  onNewConnection: () => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (connection: Connection) => void;
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onDiagnostics: (connection: Connection) => void;
  onSessionDetach: (sessionId: string) => void;
  onShowPasswordDialog: () => void;
  enableConnectionReorder: boolean;
  onOpenImport?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sidebarPosition,
  onToggleSidebarPosition,
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  onConnect,
  onDisconnect,
  onDiagnostics,
  onSessionDetach,
  enableConnectionReorder,
  onOpenImport,
}) => {
  const mgr = useSidebar();
  const sideBorder = sidebarPosition === 'left' ? 'border-r' : 'border-l';

  return (
    <>
      <div className={`bg-[var(--color-surface)] ${sideBorder} border-[var(--color-border)] flex flex-col transition-all duration-300 h-full w-full sidebar-glow`}>
        <SidebarHeader mgr={mgr} sidebarPosition={sidebarPosition} onToggleSidebarPosition={onToggleSidebarPosition} />

        {!mgr.state.sidebarCollapsed && (
          <>
            <SearchBar mgr={mgr} />
            <SidebarToolbar mgr={mgr} onNewConnection={onNewConnection} />

            <ConnectionTree
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onEdit={onEditConnection}
              onDelete={onDeleteConnection}
              onDiagnostics={onDiagnostics}
              onSessionDetach={onSessionDetach}
              enableReorder={enableConnectionReorder}
              onOpenImport={onOpenImport}
            />

            <div className="border-t border-[var(--color-border)] mt-auto" />
          </>
        )}
      </div>

      <BulkConnectionEditor
        isOpen={mgr.showBulkEditor}
        onClose={() => mgr.setShowBulkEditor(false)}
        onEditConnection={onEditConnection}
      />
    </>
  );
};
