import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { MySQLService, MySQLConfig } from '../src/utils/mysqlService';

const config: MySQLConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'pass',
};

describe('MySQLService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns typed results for select queries', async () => {
    const mockResult = {
      columns: ['id', 'name', 'email'],
      rows: [
        [1, 'John Doe', 'john@example.com'],
        [2, 'Jane Smith', 'jane@example.com']
      ],
      row_count: 2
    };

    (invoke as any).mockResolvedValueOnce('connected'); // for connect
    (invoke as any).mockResolvedValueOnce(mockResult); // for executeQuery

    const service = new MySQLService();
    await service.connect('test', config);
    const result = await service.executeQuery('test', 'SELECT * FROM users');
    expect(Array.isArray(result.columns)).toBe(true);
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.row_count).toBe('number');
    result.rows.forEach(row => {
      row.forEach(cell => {
        expect(
          cell === null ||
            typeof cell === 'string' ||
            typeof cell === 'number' ||
            typeof cell === 'boolean' ||
            typeof cell === 'object'
        ).toBe(true);
      });
    });
  });

  it('throws when not connected', async () => {
    const service = new MySQLService();
    await expect(service.executeQuery('bad', 'SELECT 1')).rejects.toThrow(
      'Not connected to MySQL server'
    );
  });

  it('returns row count for queries', async () => {
    const mockResult = {
      columns: ['TABLE_SCHEMA', 'TABLE_NAME'],
      rows: [
        ['mysql', 'user'],
        ['mysql', 'db'],
        ['information_schema', 'tables']
      ],
      row_count: 3
    };

    (invoke as any).mockResolvedValueOnce('connected'); // for connect
    (invoke as any).mockResolvedValueOnce(mockResult); // for executeQuery

    const service = new MySQLService();
    await service.connect('count', config);
    const result = await service.executeQuery(
      'count',
      "SELECT * FROM information_schema.tables LIMIT 5"
    );
    expect(typeof result.row_count).toBe('number');
    expect(result.row_count).toBeGreaterThanOrEqual(0);
  });
});
