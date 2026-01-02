import { invoke } from '@tauri-apps/api/core';

export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
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

  async getDatabases(connectionId: string): Promise<string[]> {
    const result = await this.executeQuery(connectionId, 'SHOW DATABASES');
    return result.rows.map(row => row[0] as string);
  }

  async getTables(connectionId: string, database: string): Promise<string[]> {
    const result = await this.executeQuery(connectionId, `SHOW TABLES FROM ${database}`);
    return result.rows.map(row => row[0] as string);
  }

  async getTableStructure(connectionId: string, table: string): Promise<QueryResult> {
    return this.executeQuery(connectionId, `DESCRIBE ${table}`);
  }

  async disconnect(connectionId: string): Promise<void> {
    try {
      // Use Tauri IPC to disconnect from MySQL database
      await invoke('disconnect_db');
      this.connections.delete(connectionId);
    } catch (error) {
      // Even if backend disconnect fails, remove from local connections
      this.connections.delete(connectionId);
      throw new Error(`Failed to disconnect from MySQL: ${error}`);
    }
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }


  // Export/Import functionality - these would need backend implementation
  async exportDatabase(connectionId: string, database: string): Promise<string> {
    // TODO: Implement database export via backend
    throw new Error('Database export not yet implemented in backend');
  }

  async importDatabase(connectionId: string, sqlContent: string): Promise<void> {
    // TODO: Implement database import via backend
    throw new Error('Database import not yet implemented in backend');
  }
}
