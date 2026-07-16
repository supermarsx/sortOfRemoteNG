import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useConnections } from '../../contexts/useConnections';
import { ConnectionSession } from '../../types/connection/connection';
import { MySQLService, QueryResult, MySQLValue } from '../../utils/services/mysqlService';

export function useMySQLClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = state.connections.find(
    candidate => candidate.id === session.connectionId,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [query, setQuery] = useState('SELECT * FROM information_schema.tables LIMIT 10;');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [tables, setTables] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'query' | 'tables' | 'structure'>('query');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const mysqlService = useMemo(() => new MySQLService(), []);
  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: 'UPDATE_SESSION',
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

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
    let active = true;

    const initialize = async () => {
      if (!connection) {
        const message = 'The saved MySQL connection could not be found.';
        if (active) {
          setError(message);
          updateSession({ status: 'error', errorMessage: message });
        }
        return;
      }

      try {
        await mysqlService.connect(session.connectionId, {
          host: connection.hostname || session.hostname,
          port: connection.port || 3306,
          user: connection.username || '',
          password: connection.password || '',
          database: connection.database,
          proxy: connection.security?.proxy,
          openvpn: connection.security?.openvpn,
        });
        if (!active) {
          await mysqlService.disconnect(session.connectionId).catch(() => {});
          return;
        }
        setConnected(true);
        setError(null);
        updateSession({ status: 'connected', errorMessage: undefined });
        await loadDatabases();
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : 'Failed to connect to MySQL';
        setConnected(false);
        setError(message);
        updateSession({ status: 'error', errorMessage: message });
      }
    };

    void initialize();
    return () => {
      active = false;
      void mysqlService.disconnect(session.connectionId).catch(() => {});
    };
  }, [
    connection,
    loadDatabases,
    mysqlService,
    session.connectionId,
    session.hostname,
    updateSession,
  ]);

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

  const formatCellValue = useCallback((value: MySQLValue | undefined): string => {
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
    connected,
    loadDatabases,
    executeQuery,
    insertSampleQuery,
    formatCellValue,
    clearQuery,
    setQueryForTable,
    session,
  };
}
