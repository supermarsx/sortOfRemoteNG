import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock MySQLService before importing the hook
const mockGetDatabases = vi.fn();
const mockGetTables = vi.fn();
const mockExecuteQuery = vi.fn();

vi.mock('../../src/utils/services/mysqlService', () => ({
  MySQLService: vi.fn(function() {
    return {
      getDatabases: mockGetDatabases,
      getTables: mockGetTables,
      executeQuery: mockExecuteQuery,
      connect: vi.fn(),
    };
  }),
}));

import { useMySQLClient } from '../../src/hooks/protocol/useMySQLClient';
import type { ConnectionSession } from '../../src/types/connection/connection';

const makeSession = (overrides: Partial<ConnectionSession> = {}): ConnectionSession => ({
  id: 'sess-1',
  connectionId: 'conn-1',
  name: 'Test MySQL',
  status: 'connected',
  startTime: new Date(),
  protocol: 'mysql',
  hostname: '192.168.1.100',
  ...overrides,
});

describe('useMySQLClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabases.mockResolvedValue([]);
    mockGetTables.mockResolvedValue([]);
    mockExecuteQuery.mockResolvedValue({ columns: [], rows: [], row_count: 0 });
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it('starts with a default query and empty state', async () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    expect(result.current.query).toContain('SELECT');
    expect(result.current.results).toBeNull();
    expect(result.current.isExecuting).toBe(false);
    expect(result.current.databases).toEqual([]);
    expect(result.current.tables).toEqual([]);
    expect(result.current.activeTab).toBe('query');
    expect(result.current.error).toBeNull();
  });

  // ── loadDatabases ──────────────────────────────────────────────────────

  it('loadDatabases populates databases and selects the first one', async () => {
    mockGetDatabases.mockResolvedValue(['app_db', 'test_db', 'prod_db']);
    mockGetTables.mockResolvedValue(['users', 'orders']);

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await waitFor(() => {
      expect(result.current.databases).toEqual(['app_db', 'test_db', 'prod_db']);
    });

    expect(result.current.selectedDatabase).toBe('app_db');
  });

  it('loadDatabases sets error on failure', async () => {
    mockGetDatabases.mockRejectedValue(new Error('Access denied'));

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await waitFor(() => {
      expect(result.current.error).toBe('Access denied');
    });
  });

  it('loadDatabases sets generic error for non-Error rejection', async () => {
    mockGetDatabases.mockRejectedValue('connection refused');

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load databases');
    });
  });

  // ── loadTables ─────────────────────────────────────────────────────────

  it('loads tables when a database is selected', async () => {
    mockGetDatabases.mockResolvedValue(['mydb']);
    mockGetTables.mockResolvedValue(['users', 'products', 'orders']);

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await waitFor(() => {
      expect(result.current.tables).toEqual(['users', 'products', 'orders']);
    });

    expect(mockGetTables).toHaveBeenCalledWith('mydb');
  });

  it('loadTables sets error on failure', async () => {
    mockGetDatabases.mockResolvedValue(['mydb']);
    mockGetTables.mockRejectedValue(new Error('Table read error'));

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await waitFor(() => {
      expect(result.current.error).toBe('Table read error');
    });
  });

  // ── executeQuery ───────────────────────────────────────────────────────

  it('executeQuery sends query and stores results', async () => {
    mockGetDatabases.mockResolvedValue([]);
    const mockResult = { columns: ['id', 'name'], rows: [[1, 'Alice']], row_count: 1 };
    mockExecuteQuery.mockResolvedValue(mockResult);

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await act(async () => { await result.current.executeQuery(); });

    expect(result.current.results).toEqual(mockResult);
    expect(result.current.error).toBeNull();
    expect(result.current.isExecuting).toBe(false);
  });

  it('executeQuery sets error on failure', async () => {
    mockGetDatabases.mockResolvedValue([]);
    mockExecuteQuery.mockRejectedValue(new Error('Syntax error'));

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    await act(async () => { await result.current.executeQuery(); });

    expect(result.current.results).toBeNull();
    expect(result.current.error).toBe('Syntax error');
  });

  it('executeQuery does nothing when query is empty', async () => {
    mockGetDatabases.mockResolvedValue([]);

    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.clearQuery(); });

    await act(async () => { await result.current.executeQuery(); });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // ── insertSampleQuery ──────────────────────────────────────────────────

  it('insertSampleQuery sets a SELECT template', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.insertSampleQuery('select'); });

    expect(result.current.query).toContain('SELECT');
    expect(result.current.query).toContain('LIMIT');
  });

  it('insertSampleQuery sets an INSERT template', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.insertSampleQuery('insert'); });

    expect(result.current.query).toContain('INSERT INTO');
  });

  it('insertSampleQuery clears query for unknown type', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.insertSampleQuery('nonexistent'); });

    expect(result.current.query).toBe('');
  });

  // ── formatCellValue ────────────────────────────────────────────────────

  it('formatCellValue handles null, undefined, objects, and primitives', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    expect(result.current.formatCellValue(null)).toBe('NULL');
    expect(result.current.formatCellValue(undefined)).toBe('');
    expect(result.current.formatCellValue({ key: 'val' })).toBe('{"key":"val"}');
    expect(result.current.formatCellValue(42)).toBe('42');
    expect(result.current.formatCellValue('hello')).toBe('hello');
    expect(result.current.formatCellValue(true)).toBe('true');
  });

  // ── clearQuery ─────────────────────────────────────────────────────────

  it('clearQuery sets query to empty string', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    expect(result.current.query).not.toBe('');

    act(() => { result.current.clearQuery(); });

    expect(result.current.query).toBe('');
  });

  // ── setQueryForTable ───────────────────────────────────────────────────

  it('setQueryForTable builds a SELECT statement for the given table', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.setQueryForTable('users'); });

    expect(result.current.query).toBe('SELECT * FROM users LIMIT 10;');
  });

  // ── Tab switching ──────────────────────────────────────────────────────

  it('setActiveTab changes the active tab', () => {
    const { result } = renderHook(() => useMySQLClient(makeSession()));

    act(() => { result.current.setActiveTab('tables'); });

    expect(result.current.activeTab).toBe('tables');
  });
});
