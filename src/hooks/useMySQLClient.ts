import { useState, useEffect, useCallback, useMemo } from 'react';
import { ConnectionSession } from '../types/connection';
import { MySQLService, QueryResult, MySQLValue } from '../utils/mysqlService';

export function useMySQLClient(session: ConnectionSession) {
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

  const executeQuery = useCallback(async () => {
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
  }, [query, session.connectionId, mysqlService]);

  const insertSampleQuery = useCallback((queryType: string) => {
    const sampleQueries: Record<string, string> = {
      select: 'SELECT * FROM table_name LIMIT 10;',
      insert: 'INSERT INTO table_name (column1, column2) VALUES (\'value1\', \'value2\');',
      update: 'UPDATE table_name SET column1 = \'new_value\' WHERE condition;',
      delete: 'DELETE FROM table_name WHERE condition;',
      create: 'CREATE TABLE new_table (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
      describe: 'DESCRIBE table_name;',
    };
    setQuery(sampleQueries[queryType] || '');
  }, []);

  const formatCellValue = useCallback((value: MySQLValue): string => {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }, []);

  const clearQuery = useCallback(() => setQuery(''), []);

  const setQueryForTable = useCallback((table: string) => {
    setQuery(`SELECT * FROM ${table} LIMIT 10;`);
  }, []);

  return {
    query,
    setQuery,
    results,
    isExecuting,
    databases,
    selectedDatabase,
    setSelectedDatabase,
    tables,
    activeTab,
    setActiveTab,
    error,
    loadDatabases,
    executeQuery,
    insertSampleQuery,
    formatCellValue,
    clearQuery,
    setQueryForTable,
    session,
  };
}
