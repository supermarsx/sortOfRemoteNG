import { describe, it, expect } from 'vitest';
import { MySQLService, MySQLConfig } from '../src/utils/mysqlService';

const config: MySQLConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'pass',
};

describe('MySQLService', () => {
  it('returns typed results for select queries', async () => {
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
