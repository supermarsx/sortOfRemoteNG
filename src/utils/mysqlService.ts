import { invoke } from '@tauri-apps/api/core';
import { ProxyConfig } from '../types/settings';

export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  proxy?: ProxyConfig;
  openvpn?: {
    enabled: boolean;
    configId?: string;
    chainPosition?: number;
  };
}

export type MySQLValue =
  | string
  | number
  | boolean
  | null
  | Date
  | Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: MySQLValue[][];
  row_count: number;
}

interface ConnectionInfo {
  config: MySQLConfig;
  connected: boolean;
  lastActivity: Date;
}

export class MySQLService {
  private connections = new Map<string, ConnectionInfo>();

  async connect(connectionId: string, config: MySQLConfig): Promise<ConnectionInfo> {
    try {
      // Use Tauri IPC to connect to MySQL database
      const result = await invoke<string>('connect_mysql', {
        host: config.host,
        port: config.port,
        username: config.user,
        password: config.password,
        database: config.database || '',
        proxy: config.proxy,
        openvpn: config.openvpn,
      });

      const connection: ConnectionInfo = {
        config,
        connected: true,
        lastActivity: new Date(),
      };

      // Store connection
      this.connections.set(connectionId, connection);

      return connection;
    } catch (error) {
      throw new Error(`Failed to connect to MySQL: ${error}`);
    }
  }

  async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Not connected to MySQL server');
    }

    try {
      // Use Tauri IPC to execute query
      const result = await invoke<QueryResult>('execute_query', {
        query,
      });

      // Update last activity
      connection.lastActivity = new Date();

      return result;
    } catch (error) {
      throw new Error(`Query execution failed: ${error}`);
    }
  }

  async getDatabases(): Promise<string[]> {
    const result = await invoke<QueryResult>('get_databases');
    return result.rows.map(row => row[0] as string);
  }

  async getTables(database: string): Promise<string[]> {
    const result = await invoke<QueryResult>('get_tables', { database });
    return result.rows.map(row => row[0] as string);
  }

  async getTableStructure(database: string, table: string): Promise<QueryResult> {
    return await invoke<QueryResult>('get_table_structure', { database, table });
  }

  async createDatabase(database: string): Promise<void> {
    await invoke('create_database', { database });
  }

  async dropDatabase(database: string): Promise<void> {
    await invoke('drop_database', { database });
  }

  async createTable(database: string, table: string, columns: string[]): Promise<void> {
    await invoke('create_table', { database, table, columns });
  }

  async dropTable(database: string, table: string): Promise<void> {
    await invoke('drop_table', { database, table });
  }

  async getTableData(database: string, table: string, limit?: number, offset?: number): Promise<QueryResult> {
    return await invoke<QueryResult>('get_table_data', { database, table, limit, offset });
  }

  async insertRow(database: string, table: string, columns: string[], values: string[]): Promise<number> {
    return await invoke<number>('insert_row', { database, table, columns, values });
  }

  async updateRow(database: string, table: string, columns: string[], values: string[], whereClause: string): Promise<number> {
    return await invoke<number>('update_row', { database, table, columns, values, whereClause });
  }

  async deleteRow(database: string, table: string, whereClause: string): Promise<number> {
    return await invoke<number>('delete_row', { database, table, whereClause });
  }

  async exportTable(database: string, table: string, format: 'csv' | 'sql'): Promise<string> {
    return await invoke<string>('export_table', { database, table, format });
  }
}
