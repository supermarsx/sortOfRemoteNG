import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

const mockExecuteQuery = vi.fn();
const mockGetDatabases = vi.fn();
const mockGetTables = vi.fn();

vi.mock('../../src/utils/services/mysqlService', () => ({
  MySQLService: vi.fn().mockImplementation(() => ({
    executeQuery: mockExecuteQuery,
    getDatabases: mockGetDatabases,
    getTables: mockGetTables,
  })),
}));

import { useMySQLClient } from '../../src/hooks/protocol/useMySQLClient';
import type { ConnectionSession } from '../../src/types/connection/connection';

const mockSession: ConnectionSession = {
  id: 's1',
  connectionId: 'conn-1',
  protocol: 'mysql',
  hostname: 'db.example.com',
  name: 'Test MySQL',
  status: 'connected',
  startTime: new Date(),
};

describe('useMySQLClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabases.mockResolvedValue(['testdb', 'production']);
    mockGetTables.mockResolvedValue(['users', 'orders', 'products']);
    mockExecuteQuery.mockResolvedValue({
      columns: ['id', 'name'],
      rows: [[1, 'Alice'], [2, 'Bob']],
      row_count: 2,
    });
  });

  it('has correct initial state', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    expect(result.current.query).toBe('SELECT * FROM information_schema.tables LIMIT 10;');
    expect(result.current.results).toBeNull();
    expect(result.current.isExecuting).toBe(false);
    expect(result.current.activeTab).toBe('query');
    expect(result.current.error).toBeNull();
  });

  it('loads databases on mount and selects first', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    await waitFor(() => {
      expect(result.current.databases).toEqual(['testdb', 'production']);
    });

    expect(result.current.selectedDatabase).toBe('testdb');
    expect(mockGetDatabases).toHaveBeenCalledTimes(1);
  });

  it('loads tables when selectedDatabase changes', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    await waitFor(() => {
      expect(result.current.databases.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(result.current.tables).toEqual(['users', 'orders', 'products']);
    });

    expect(mockGetTables).toHaveBeenCalledWith('testdb');
  });

  it('executeQuery calls service and stores result', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    await act(async () => {
      await result.current.executeQuery();
    });

    expect(mockExecuteQuery).toHaveBeenCalledWith('conn-1', 'SELECT * FROM information_schema.tables LIMIT 10;');
    expect(result.current.results).toEqual({
      columns: ['id', 'name'],
      rows: [[1, 'Alice'], [2, 'Bob']],
      row_count: 2,
    });
    expect(result.current.error).toBeNull();
  });

  it('executeQuery sets error on failure', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    // Wait for initial load to finish
    await waitFor(() => {
      expect(result.current.databases.length).toBeGreaterThan(0);
    });

    mockExecuteQuery.mockRejectedValueOnce(new Error('Syntax error'));

    await act(async () => {
      await result.current.executeQuery();
    });

    expect(result.current.results).toBeNull();
    expect(result.current.error).toBe('Syntax error');
  });

  it('executeQuery does nothing for empty query', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.clearQuery();
    });

    await act(async () => {
      await result.current.executeQuery();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('insertSampleQuery sets predefined SQL for select', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.insertSampleQuery('select');
    });

    expect(result.current.query).toBe('SELECT * FROM table_name LIMIT 10;');
  });

  it('insertSampleQuery sets predefined SQL for insert', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.insertSampleQuery('insert');
    });

    expect(result.current.query).toContain('INSERT INTO');
  });

  it('insertSampleQuery sets predefined SQL for create', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.insertSampleQuery('create');
    });

    expect(result.current.query).toContain('CREATE TABLE');
  });

  it('insertSampleQuery sets predefined SQL for describe', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.insertSampleQuery('describe');
    });

    expect(result.current.query).toBe('DESCRIBE table_name;');
  });

  it('insertSampleQuery sets empty string for unknown type', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.insertSampleQuery('unknown');
    });

    expect(result.current.query).toBe('');
  });

  it('formatCellValue handles null', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));
    expect(result.current.formatCellValue(null)).toBe('NULL');
  });

  it('formatCellValue handles undefined', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));
    expect(result.current.formatCellValue(undefined as any)).toBe('');
  });

  it('formatCellValue handles objects', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));
    expect(result.current.formatCellValue({ foo: 'bar' } as any)).toBe('{"foo":"bar"}');
  });

  it('formatCellValue handles strings and numbers', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));
    expect(result.current.formatCellValue('hello')).toBe('hello');
    expect(result.current.formatCellValue(42)).toBe('42');
    expect(result.current.formatCellValue(true)).toBe('true');
  });

  it('clearQuery sets query to empty string', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.clearQuery();
    });

    expect(result.current.query).toBe('');
  });

  it('setQueryForTable sets query to SELECT from table', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.setQueryForTable('users');
    });

    expect(result.current.query).toBe('SELECT * FROM users LIMIT 10;');
  });

  it('setActiveTab changes active tab', () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    act(() => {
      result.current.setActiveTab('tables');
    });

    expect(result.current.activeTab).toBe('tables');
  });

  it('setSelectedDatabase triggers table reload', async () => {
    const { result } = renderHook(() => useMySQLClient(mockSession));

    await waitFor(() => {
      expect(result.current.databases.length).toBeGreaterThan(0);
    });

    mockGetTables.mockClear();

    act(() => {
      result.current.setSelectedDatabase('production');
    });

    await waitFor(() => {
      expect(mockGetTables).toHaveBeenCalledWith('production');
    });
  });

  it('loadDatabases sets error on failure', async () => {
    mockGetDatabases.mockRejectedValueOnce(new Error('Access denied'));
    const { result } = renderHook(() => useMySQLClient(mockSession));

    await waitFor(() => {
      expect(result.current.error).toBe('Access denied');
    });
  });
});
