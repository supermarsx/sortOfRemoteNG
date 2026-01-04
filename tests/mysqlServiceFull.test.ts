import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { mysqlService } from '../src/utils/mysqlService';

describe('mysqlService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('calls connect_mysql with correct parameters', async () => {
      mockInvoke.mockResolvedValueOnce('Connected');
      
      const config = {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'testdb',
      };
      
      const result = await mysqlService.connect(config);
      
      expect(mockInvoke).toHaveBeenCalledWith('connect_mysql', expect.objectContaining({
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'password',
        database: 'testdb',
      }));
      expect(result).toBe('Connected');
    });

    it('supports SSH tunnel configuration', async () => {
      mockInvoke.mockResolvedValueOnce('Connected via SSH tunnel');
      
      const config = {
        host: 'remote-db.example.com',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'testdb',
        sshTunnel: {
          enabled: true,
          sshHost: 'bastion.example.com',
          sshPort: 22,
          sshUsername: 'admin',
          sshPassword: 'sshpass',
        },
      };
      
      const result = await mysqlService.connect(config);
      
      expect(mockInvoke).toHaveBeenCalledWith('connect_mysql', expect.objectContaining({
        sshTunnel: expect.objectContaining({
          enabled: true,
          ssh_host: 'bastion.example.com',
        }),
      }));
    });
  });

  describe('executeQuery', () => {
    it('calls execute_query and returns results', async () => {
      const mockResult = {
        columns: ['id', 'name'],
        rows: [['1', 'Test'], ['2', 'Test2']],
        row_count: 2,
      };
      mockInvoke.mockResolvedValueOnce(mockResult);
      
      const result = await mysqlService.executeQuery('SELECT * FROM users');
      
      expect(mockInvoke).toHaveBeenCalledWith('execute_query', { query: 'SELECT * FROM users' });
      expect(result).toEqual(mockResult);
    });
  });

  describe('getDatabases', () => {
    it('returns list of databases', async () => {
      mockInvoke.mockResolvedValueOnce(['mysql', 'information_schema', 'testdb']);
      
      const result = await mysqlService.getDatabases();
      
      expect(mockInvoke).toHaveBeenCalledWith('get_databases');
      expect(result).toEqual(['mysql', 'information_schema', 'testdb']);
    });
  });

  describe('getTables', () => {
    it('returns tables for a database', async () => {
      mockInvoke.mockResolvedValueOnce(['users', 'posts', 'comments']);
      
      const result = await mysqlService.getTables('testdb');
      
      expect(mockInvoke).toHaveBeenCalledWith('get_tables', { database: 'testdb' });
      expect(result).toEqual(['users', 'posts', 'comments']);
    });
  });

  describe('getTableStructure', () => {
    it('returns table structure', async () => {
      const mockStructure = {
        columns: ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'],
        rows: [
          ['id', 'int', 'NO', 'PRI', 'NULL', 'auto_increment'],
          ['name', 'varchar(255)', 'YES', '', 'NULL', ''],
        ],
        row_count: 2,
      };
      mockInvoke.mockResolvedValueOnce(mockStructure);
      
      const result = await mysqlService.getTableStructure('testdb', 'users');
      
      expect(mockInvoke).toHaveBeenCalledWith('get_table_structure', { database: 'testdb', table: 'users' });
      expect(result).toEqual(mockStructure);
    });
  });

  describe('insertRow', () => {
    it('inserts a row and returns last insert id', async () => {
      mockInvoke.mockResolvedValueOnce(42);
      
      const result = await mysqlService.insertRow('testdb', 'users', ['name', 'email'], ['John', 'john@example.com']);
      
      expect(mockInvoke).toHaveBeenCalledWith('insert_row', {
        database: 'testdb',
        table: 'users',
        columns: ['name', 'email'],
        values: ['John', 'john@example.com'],
      });
      expect(result).toBe(42);
    });
  });

  describe('updateRow', () => {
    it('updates rows and returns affected count', async () => {
      mockInvoke.mockResolvedValueOnce(1);
      
      const result = await mysqlService.updateRow('testdb', 'users', ['name'], ['Jane'], 'id = 1');
      
      expect(mockInvoke).toHaveBeenCalledWith('update_row', {
        database: 'testdb',
        table: 'users',
        columns: ['name'],
        values: ['Jane'],
        whereClause: 'id = 1',
      });
      expect(result).toBe(1);
    });
  });

  describe('deleteRow', () => {
    it('deletes rows and returns affected count', async () => {
      mockInvoke.mockResolvedValueOnce(1);
      
      const result = await mysqlService.deleteRow('testdb', 'users', 'id = 1');
      
      expect(mockInvoke).toHaveBeenCalledWith('delete_row', {
        database: 'testdb',
        table: 'users',
        whereClause: 'id = 1',
      });
      expect(result).toBe(1);
    });
  });

  describe('exportTable', () => {
    it('exports table to CSV', async () => {
      mockInvoke.mockResolvedValueOnce('id,name\n1,Test');
      
      const result = await mysqlService.exportTable('testdb', 'users', 'csv');
      
      expect(mockInvoke).toHaveBeenCalledWith('export_table', {
        database: 'testdb',
        table: 'users',
        format: 'csv',
      });
      expect(result).toBe('id,name\n1,Test');
    });

    it('exports table to SQL', async () => {
      mockInvoke.mockResolvedValueOnce('INSERT INTO users (id, name) VALUES (1, \'Test\');');
      
      const result = await mysqlService.exportTable('testdb', 'users', 'sql');
      
      expect(mockInvoke).toHaveBeenCalledWith('export_table', {
        database: 'testdb',
        table: 'users',
        format: 'sql',
      });
    });
  });

  describe('importSql', () => {
    it('imports SQL and returns affected rows', async () => {
      mockInvoke.mockResolvedValueOnce(5);
      
      const sql = 'INSERT INTO users (name) VALUES (\'Test1\'), (\'Test2\');';
      const result = await mysqlService.importSql(sql);
      
      expect(mockInvoke).toHaveBeenCalledWith('import_sql', { sqlContent: sql });
      expect(result).toBe(5);
    });
  });

  describe('importCsv', () => {
    it('imports CSV and returns inserted count', async () => {
      mockInvoke.mockResolvedValueOnce(3);
      
      const csv = 'name,email\nJohn,john@test.com\nJane,jane@test.com';
      const result = await mysqlService.importCsv('testdb', 'users', csv, true);
      
      expect(mockInvoke).toHaveBeenCalledWith('import_csv', {
        database: 'testdb',
        table: 'users',
        csvContent: csv,
        hasHeader: true,
      });
      expect(result).toBe(3);
    });
  });
});
