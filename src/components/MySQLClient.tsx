import React from 'react';
import { Database, Play, RefreshCw, Table, Code, BarChart3 } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useMySQLClient } from '../hooks/protocol/useMySQLClient';

type Mgr = ReturnType<typeof useMySQLClient>;

/* ── sub-components ── */

const MySQLHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <Database size={20} className="text-blue-400" />
        <span className="text-[var(--color-text)] font-medium">MySQL Client - {mgr.session.hostname}</span>
      </div>
      <div className="flex items-center space-x-3">
        <select
          value={mgr.selectedDatabase}
          onChange={(e) => mgr.setSelectedDatabase(e.target.value)}
          className="px-3 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
        >
          {mgr.databases.map(db => (
            <option key={db} value={db}>{db}</option>
          ))}
        </select>
        <button
          onClick={mgr.loadDatabases}
          className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  </div>
);

const SidebarTabs: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex border-b border-[var(--color-border)]">
    {([
      { id: 'query' as const, label: 'Query', icon: Code },
      { id: 'tables' as const, label: 'Tables', icon: Table },
      { id: 'structure' as const, label: 'Structure', icon: BarChart3 },
    ] as const).map(tab => {
      const Icon = tab.icon;
      return (
        <button
          key={tab.id}
          onClick={() => mgr.setActiveTab(tab.id)}
          className={`flex-1 flex items-center justify-center space-x-1 py-3 text-sm transition-colors ${
            mgr.activeTab === tab.id
              ? 'bg-blue-600 text-[var(--color-text)]'
              : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'
          }`}
        >
          <Icon size={14} />
          <span>{tab.label}</span>
        </button>
      );
    })}
  </div>
);

const SidebarContent: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto p-4">
    {mgr.activeTab === 'query' && (
      <div className="space-y-2">
        <h3 className="text-[var(--color-text)] font-medium mb-3">Quick Queries</h3>
        {[
          { label: 'SELECT', key: 'select' },
          { label: 'INSERT', key: 'insert' },
          { label: 'UPDATE', key: 'update' },
          { label: 'DELETE', key: 'delete' },
          { label: 'CREATE TABLE', key: 'create' },
          { label: 'DESCRIBE', key: 'describe' },
        ].map(item => (
          <button
            key={item.key}
            onClick={() => mgr.insertSampleQuery(item.key)}
            className="w-full text-left px-3 py-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] rounded transition-colors text-sm"
          >
            {item.label}
          </button>
        ))}
      </div>
    )}
    {mgr.activeTab === 'tables' && (
      <div className="space-y-2">
        <h3 className="text-[var(--color-text)] font-medium mb-3">Tables</h3>
        {mgr.tables.map(table => (
          <button
            key={table}
            onClick={() => mgr.setQueryForTable(table)}
            className="w-full text-left px-3 py-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] rounded transition-colors text-sm flex items-center space-x-2"
          >
            <Table size={14} />
            <span>{table}</span>
          </button>
        ))}
      </div>
    )}
    {mgr.activeTab === 'structure' && (
      <div className="space-y-2">
        <h3 className="text-[var(--color-text)] font-medium mb-3">Database Info</h3>
        <div className="text-[var(--color-textSecondary)] text-sm space-y-2">
          <div>Database: {mgr.selectedDatabase}</div>
          <div>Tables: {mgr.tables.length}</div>
          <div>Connection: Active</div>
        </div>
      </div>
    )}
  </div>
);

const QueryEditor: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[var(--color-text)] font-medium">SQL Query</h3>
      <div className="flex items-center space-x-2">
        <button
          onClick={mgr.clearQuery}
          className="px-3 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded text-sm transition-colors"
        >
          Clear
        </button>
        <button
          onClick={mgr.executeQuery}
          disabled={mgr.isExecuting || !mgr.query.trim()}
          className="px-4 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-[var(--color-text)] rounded text-sm transition-colors flex items-center space-x-2"
        >
          {mgr.isExecuting ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          <span>{mgr.isExecuting ? 'Executing...' : 'Execute'}</span>
        </button>
      </div>
    </div>
    <textarea
      value={mgr.query}
      onChange={(e) => mgr.setQuery(e.target.value)}
      className="w-full h-32 px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Enter your SQL query here..."
    />
  </div>
);

const QueryResults: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-hidden">
    {mgr.error ? (
      <div className="p-4 bg-red-900/20 border-l-4 border-red-500">
        <h4 className="text-red-400 font-medium mb-2">Query Error</h4>
        <p className="text-red-300 text-sm font-mono">{mgr.error}</p>
      </div>
    ) : mgr.results ? (
      <div className="h-full flex flex-col">
        <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
          <div className="text-[var(--color-textSecondary)] text-sm">
            {mgr.results.rows.length > 0
              ? `${mgr.results.rows.length} rows returned`
              : `Query executed successfully`}
          </div>
        </div>
        {mgr.results.rows.length > 0 && (
          <div className="flex-1 overflow-auto">
            <table className="sor-data-table w-full">
              <thead className="bg-[var(--color-border)] sticky top-0">
                <tr>
                  {mgr.results.columns.map((column, index) => (
                    <th
                      key={index}
                      className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider border-r border-[var(--color-border)] last:border-r-0"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {mgr.results.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-[var(--color-border)]">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-4 py-3 text-sm text-[var(--color-textSecondary)] border-r border-[var(--color-border)] last:border-r-0 max-w-xs truncate"
                        title={mgr.formatCellValue(cell)}
                      >
                        {mgr.formatCellValue(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    ) : (
      <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)]">
        <div className="text-center">
          <Database size={48} className="mx-auto mb-4" />
          <p>Execute a query to see results</p>
        </div>
      </div>
    )}
  </div>
);

/* ── main component ── */

interface MySQLClientProps {
  session: ConnectionSession;
}

export const MySQLClient: React.FC<MySQLClientProps> = ({ session }) => {
  const mgr = useMySQLClient(session);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      <MySQLHeader mgr={mgr} />
      {mgr.error && (
        <div className="bg-red-900/20 text-red-300 p-2 text-sm">{mgr.error}</div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col">
          <SidebarTabs mgr={mgr} />
          <SidebarContent mgr={mgr} />
        </div>
        <div className="flex-1 flex flex-col">
          <QueryEditor mgr={mgr} />
          <QueryResults mgr={mgr} />
        </div>
      </div>
    </div>
  );
};
