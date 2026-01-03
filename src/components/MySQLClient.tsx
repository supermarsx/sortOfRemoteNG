import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Database, Play, Save, Trash2, RefreshCw, Table, Code, BarChart3 } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { MySQLService, QueryResult, MySQLValue } from '../utils/mysqlService';

interface MySQLClientProps {
  session: ConnectionSession;
}

export const MySQLClient: React.FC<MySQLClientProps> = ({ session }) => {
  const [query, setQuery] = useState('SELECT * FROM information_schema.tables LIMIT 10;');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [tables, setTables] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'query' | 'tables' | 'structure'>('query');
  const [error, setError] = useState<string | null>(null);

  const mysqlService = useMemo(() => new MySQLService(), []);

  const loadDatabases = useCallback(async () => {
    try {
      const dbs = await mysqlService.getDatabases();
      setDatabases(dbs);
      if (dbs.length > 0) {
        setSelectedDatabase(dbs[0]);
      }
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load databases'
      );
    }
  }, [mysqlService]);

  const loadTables = useCallback(async (database: string) => {
    try {
      const tableList = await mysqlService.getTables(database);
      setTables(tableList);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load tables'
      );
    }
  }, [mysqlService]);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  useEffect(() => {
    if (selectedDatabase) {
      loadTables(selectedDatabase);
    }
  }, [selectedDatabase, loadTables]);

  const executeQuery = async () => {
    if (!query.trim()) return;

    setIsExecuting(true);
    try {
      const result = await mysqlService.executeQuery(session.connectionId, query);
      setResults(result);
      setError(null);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : 'Query execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const insertSampleQuery = (queryType: string) => {
    const sampleQueries: Record<string, string> = {
      select: 'SELECT * FROM table_name LIMIT 10;',
      insert: 'INSERT INTO table_name (column1, column2) VALUES (\'value1\', \'value2\');',
      update: 'UPDATE table_name SET column1 = \'new_value\' WHERE condition;',
      delete: 'DELETE FROM table_name WHERE condition;',
      create: 'CREATE TABLE new_table (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
      describe: 'DESCRIBE table_name;',
    };

    setQuery(sampleQueries[queryType] || '');
  };

  const formatCellValue = (value: MySQLValue): string => {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Database size={20} className="text-blue-400" />
            <span className="text-white font-medium">MySQL Client - {session.hostname}</span>
          </div>
          
          <div className="flex items-center space-x-3">
            <select
              value={selectedDatabase}
              onChange={(e) => setSelectedDatabase(e.target.value)}
              className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
            >
              {databases.map(db => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
            
            <button
              onClick={loadDatabases}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>
      {error && (
        <div className="bg-red-900/20 text-red-300 p-2 text-sm">{error}</div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            {[
              { id: 'query', label: 'Query', icon: Code },
              { id: 'tables', label: 'Tables', icon: Table },
              { id: 'structure', label: 'Structure', icon: BarChart3 },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center space-x-1 py-3 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'query' && (
              <div className="space-y-2">
                <h3 className="text-white font-medium mb-3">Quick Queries</h3>
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
                    onClick={() => insertSampleQuery(item.key)}
                    className="w-full text-left px-3 py-2 text-gray-300 hover:bg-gray-700 rounded transition-colors text-sm"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'tables' && (
              <div className="space-y-2">
                <h3 className="text-white font-medium mb-3">Tables</h3>
                {tables.map(table => (
                  <button
                    key={table}
                    onClick={() => setQuery(`SELECT * FROM ${table} LIMIT 10;`)}
                    className="w-full text-left px-3 py-2 text-gray-300 hover:bg-gray-700 rounded transition-colors text-sm flex items-center space-x-2"
                  >
                    <Table size={14} />
                    <span>{table}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'structure' && (
              <div className="space-y-2">
                <h3 className="text-white font-medium mb-3">Database Info</h3>
                <div className="text-gray-400 text-sm space-y-2">
                  <div>Database: {selectedDatabase}</div>
                  <div>Tables: {tables.length}</div>
                  <div>Connection: Active</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Query Editor */}
          <div className="bg-gray-800 border-b border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium">SQL Query</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setQuery('')}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={executeQuery}
                  disabled={isExecuting || !query.trim()}
                  className="px-4 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-sm transition-colors flex items-center space-x-2"
                >
                  {isExecuting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  <span>{isExecuting ? 'Executing...' : 'Execute'}</span>
                </button>
              </div>
            </div>
            
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your SQL query here..."
            />
          </div>

          {/* Results */}
          <div className="flex-1 overflow-hidden">
            {error ? (
              <div className="p-4 bg-red-900/20 border-l-4 border-red-500">
                <h4 className="text-red-400 font-medium mb-2">Query Error</h4>
                <p className="text-red-300 text-sm font-mono">{error}</p>
              </div>
            ) : results ? (
              <div className="h-full flex flex-col">
                {/* Result Info */}
                <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
                  <div className="text-gray-300 text-sm">
                    {results.rows.length > 0 ? (
                      `${results.rows.length} rows returned`
                    ) : (
                      `Query executed successfully`
                    )}
                  </div>
                  
                </div>

                {/* Data Table */}
                {results.rows.length > 0 && (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full">
                      <thead className="bg-gray-700 sticky top-0">
                        <tr>
                          {results.columns.map((column, index) => (
                            <th
                              key={index}
                              className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider border-r border-gray-600 last:border-r-0"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-600">
                        {results.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-gray-700">
                            {row.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className="px-4 py-3 text-sm text-gray-300 border-r border-gray-600 last:border-r-0 max-w-xs truncate"
                                title={formatCellValue(cell)}
                              >
                                {formatCellValue(cell)}
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
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <Database size={48} className="mx-auto mb-4" />
                  <p>Execute a query to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
