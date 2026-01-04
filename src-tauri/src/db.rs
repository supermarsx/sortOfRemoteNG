use std::sync::Arc;
use tokio::sync::Mutex;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use sqlx::{Row, Column};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenVPNConfig {
    pub enabled: bool,
    pub config_id: Option<String>,
    pub chain_position: Option<u16>,
}

pub type DbServiceState = Arc<Mutex<DbService>>;

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
}

pub struct DbService {
    pool: Option<MySqlPool>,
}

impl DbService {
    pub fn new() -> DbServiceState {
        Arc::new(Mutex::new(DbService { pool: None }))
    }

    pub async fn connect_mysql(&mut self, host: String, port: u16, username: String, password: String, database: String, proxy: Option<ProxyConfig>, openvpn: Option<OpenVPNConfig>) -> Result<String, String> {
        // Handle OpenVPN connection first
        if let Some(openvpn_config) = openvpn {
            if openvpn_config.enabled {
                // Establish OpenVPN connection before MySQL connection
                // This would require integrating with the OpenVPN service
                // For now, we'll proceed with direct connection
            }
        }

        // Handle proxy connection
        let actual_host = if let Some(_proxy_config) = proxy {
            // Establish proxy connection and get local port
            // This would require integrating with the proxy service
            // For now, use direct connection
            host
        } else {
            host
        };

        let url = format!("mysql://{}:{}@{}:{}/{}", username, password, actual_host, port, database);
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .map_err(|e| e.to_string())?;
        self.pool = Some(pool);
        Ok("Connected to MySQL".to_string())
    }

    pub async fn execute_query(&self, query: String) -> Result<QueryResult, String> {
        if let Some(pool) = &self.pool {
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            if rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                });
            }

            // Get column names from the first row
            let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();

            // Convert rows to string vectors
            let mut result_rows = Vec::new();
            for row in rows {
                let mut row_data = Vec::new();
                for (i, _) in columns.iter().enumerate() {
                    let value: String = row.try_get(i).unwrap_or("NULL".to_string());
                    row_data.push(value);
                }
                result_rows.push(row_data);
            }

            let row_count = result_rows.len();

            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
            })
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn disconnect_db(&mut self) -> Result<(), String> {
        self.pool = None;
        Ok(())
    }

    pub async fn get_databases(&self) -> Result<Vec<String>, String> {
        if let Some(pool) = &self.pool {
            let rows = sqlx::query("SHOW DATABASES")
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let databases = rows.iter()
                .map(|row| row.try_get::<String, _>(0).unwrap_or_default())
                .collect();

            Ok(databases)
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_tables(&self, database: String) -> Result<Vec<String>, String> {
        if let Some(pool) = &self.pool {
            let query = format!("SHOW TABLES FROM {}", database);
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let tables = rows.iter()
                .map(|row| row.try_get::<String, _>(0).unwrap_or_default())
                .collect();

            Ok(tables)
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_table_structure(&self, database: String, table: String) -> Result<QueryResult, String> {
        if let Some(_pool) = &self.pool {
            let query = format!("DESCRIBE `{}`.`{}`", database, table);
            self.execute_query(query).await
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn create_database(&self, database: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("CREATE DATABASE `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn drop_database(&self, database: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("DROP DATABASE `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn create_table(&self, database: String, table: String, columns: Vec<String>) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let columns_str = columns.join(", ");
            let query = format!("CREATE TABLE `{}`.`{}` ({})", database, table, columns_str);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn drop_table(&self, database: String, table: String) -> Result<(), String> {
        if let Some(pool) = &self.pool {
            let query = format!("DROP TABLE `{}`.`{}`", database, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn get_table_data(&self, database: String, table: String, limit: Option<u32>, offset: Option<u32>) -> Result<QueryResult, String> {
        if let Some(_pool) = &self.pool {
            let limit_clause = if let Some(l) = limit {
                if let Some(o) = offset {
                    format!(" LIMIT {} OFFSET {}", l, o)
                } else {
                    format!(" LIMIT {}", l)
                }
            } else {
                "".to_string()
            };

            let query = format!("SELECT * FROM `{}`.`{}`{}", database, table, limit_clause);
            self.execute_query(query).await
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn insert_row(&self, database: String, table: String, columns: Vec<String>, values: Vec<String>) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let columns_str = columns.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ");
            let placeholders = vec!["?"; values.len()].join(", ");
            let query = format!("INSERT INTO `{}`.`{}` ({}) VALUES ({})", database, table, columns_str, placeholders);

            let mut query_builder = sqlx::query(&query);
            for value in &values {
                query_builder = query_builder.bind(value);
            }

            let result = query_builder
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.last_insert_id())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn update_row(&self, database: String, table: String, columns: Vec<String>, values: Vec<String>, where_clause: String) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let set_clause = columns.iter()
                .enumerate()
                .map(|(_i, col)| format!("`{}` = ?", col))
                .collect::<Vec<_>>()
                .join(", ");

            let query = format!("UPDATE `{}`.`{}` SET {} WHERE {}", database, table, set_clause, where_clause);

            let mut query_builder = sqlx::query(&query);
            for value in &values {
                query_builder = query_builder.bind(value);
            }

            let result = query_builder
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.rows_affected())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn delete_row(&self, database: String, table: String, where_clause: String) -> Result<u64, String> {
        if let Some(pool) = &self.pool {
            let query = format!("DELETE FROM `{}`.`{}` WHERE {}", database, table, where_clause);

            let result = sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

            Ok(result.rows_affected())
        } else {
            Err("No database connection".to_string())
        }
    }

    pub async fn export_table(&self, database: String, table: String, format: String) -> Result<String, String> {
        self.export_table_chunked(database, table, format, None, None).await
    }

    pub async fn export_table_chunked(&self, database: String, table: String, format: String, chunk_size: Option<u32>, max_chunks: Option<u32>) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let chunk_size = chunk_size.unwrap_or(1000); // Default chunk size
            let max_chunks = max_chunks.unwrap_or(100); // Default max chunks to prevent runaway exports

            match format.as_str() {
                "csv" => {
                    self.export_table_csv_chunked(database, table, chunk_size, max_chunks).await
                }
                "sql" => {
                    self.export_table_sql_chunked(database, table, chunk_size, max_chunks).await
                }
                _ => Err("Unsupported export format. Use 'csv' or 'sql'".to_string())
            }
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn export_table_csv_chunked(&self, database: String, table: String, chunk_size: u32, max_chunks: u32) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            // Get table structure first for headers
            let structure = self.get_table_structure(database.clone(), table.clone()).await?;
            let columns = structure.columns;

            let mut csv = String::new();
            // Add headers
            csv.push_str(&columns.join(","));
            csv.push('\n');

            // Export data in chunks
            let mut offset = 0u32;
            let mut chunks_processed = 0u32;

            loop {
                if chunks_processed >= max_chunks {
                    csv.push_str("-- Export truncated due to max_chunks limit\n");
                    break;
                }

                let data = self.get_table_data(database.clone(), table.clone(), Some(chunk_size), Some(offset)).await?;

                if data.rows.is_empty() {
                    break; // No more data
                }

                // Add data rows
                for row in &data.rows {
                    let csv_row = row.iter()
                        .map(|cell| {
                            if cell.contains(',') || cell.contains('"') || cell.contains('\n') {
                                format!("\"{}\"", cell.replace("\"", "\"\""))
                            } else {
                                cell.clone()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    csv.push_str(&csv_row);
                    csv.push('\n');
                }

                offset += chunk_size;
                chunks_processed += 1;

                // Break if we got less than chunk_size (last chunk)
                if data.rows.len() < chunk_size as usize {
                    break;
                }
            }

            Ok(csv)
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn export_table_sql_chunked(&self, database: String, table: String, chunk_size: u32, max_chunks: u32) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let mut sql = String::new();

            // Add header
            sql.push_str(&format!("-- Export of table `{}`.`{}`\n", database, table));
            sql.push_str(&format!("-- Generated at {}\n", chrono::Utc::now().to_rfc3339()));
            sql.push_str("-- Chunked export\n\n");

            // Get table structure and create CREATE TABLE statement
            let structure = self.get_table_structure(database.clone(), table.clone()).await?;
            sql.push_str(&self.generate_create_table_sql(database.clone(), table.clone(), structure).await?);
            sql.push_str("\n");

            // Export data in chunks
            let mut offset = 0u32;
            let mut chunks_processed = 0u32;
            let mut total_rows = 0usize;

            loop {
                if chunks_processed >= max_chunks {
                    sql.push_str(&format!("-- Export truncated due to max_chunks limit ({} rows exported)\n", total_rows));
                    break;
                }

                let data = self.get_table_data(database.clone(), table.clone(), Some(chunk_size), Some(offset)).await?;

                if data.rows.is_empty() {
                    break; // No more data
                }

                // Add INSERT statements for this chunk
                for row in &data.rows {
                    let columns_str = data.columns.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ");
                    let values_str = row.iter()
                        .map(|v| self.escape_sql_value(v))
                        .collect::<Vec<_>>()
                        .join(", ");
                    sql.push_str(&format!("INSERT INTO `{}` ({}) VALUES ({});\n", table, columns_str, values_str));
                    total_rows += 1;
                }

                offset += chunk_size;
                chunks_processed += 1;

                // Break if we got less than chunk_size (last chunk)
                if data.rows.len() < chunk_size as usize {
                    break;
                }
            }

            sql.push_str(&format!("\n-- Export completed: {} rows exported in {} chunks\n", total_rows, chunks_processed));
            Ok(sql)
        } else {
            Err("No database connection".to_string())
        }
    }

    async fn generate_create_table_sql(&self, _database: String, table: String, structure: QueryResult) -> Result<String, String> {
        let mut sql = format!("CREATE TABLE `{}` (\n", table);

        let mut column_defs = Vec::new();
        for row in structure.rows {
            let field = &row[0];
            let r#type = &row[1];
            let null = &row[2];
            let key = &row[3];
            let default = &row[4];
            let extra = &row[5];

            let mut col_def = format!("  `{}` {}", field, r#type);

            if null == "NO" {
                col_def.push_str(" NOT NULL");
            }

            if !default.is_empty() && default != "NULL" {
                col_def.push_str(&format!(" DEFAULT {}", self.escape_sql_value(default)));
            }

            if !extra.is_empty() {
                col_def.push_str(&format!(" {}", extra));
            }

            if key == "PRI" {
                col_def.push_str(" PRIMARY KEY");
            }

            column_defs.push(col_def);
        }

        sql.push_str(&column_defs.join(",\n"));
        sql.push_str("\n);");

        Ok(sql)
    }

    fn escape_sql_value(&self, value: &str) -> String {
        if value == "NULL" {
            "NULL".to_string()
        } else {
            format!("'{}'", value.replace("'", "''").replace("\\", "\\\\"))
        }
    }

    pub async fn export_database(&self, database: String, format: String, include_data: bool) -> Result<String, String> {
        self.export_database_chunked(database, format, include_data, None, None).await
    }

    pub async fn export_database_chunked(&self, database: String, _format: String, include_data: bool, chunk_size: Option<u32>, max_chunks: Option<u32>) -> Result<String, String> {
        if let Some(_pool) = &self.pool {
            let mut output = String::new();

            // Add header
            output.push_str(&format!("-- Export of database `{}`\n", database));
            output.push_str(&format!("-- Generated at {}\n", chrono::Utc::now().to_rfc3339()));
            output.push_str("-- Complete database export\n\n");

            // Create database
            output.push_str(&format!("CREATE DATABASE IF NOT EXISTS `{}`;\n", database));
            output.push_str(&format!("USE `{}`;\n\n", database));

            // Get all tables
            let tables = self.get_tables(database.clone()).await?;

            for table in &tables {
                // Export table structure
                let structure = self.get_table_structure(database.clone(), table.clone()).await?;
                output.push_str(&self.generate_create_table_sql(database.clone(), table.clone(), structure).await?);
                output.push_str(";\n\n");

                // Export table data if requested
                if include_data {
                    let table_sql = if let Some(chunk_size) = chunk_size {
                        if let Some(max_chunks) = max_chunks {
                            self.export_table_sql_chunked(database.clone(), table.clone(), chunk_size, max_chunks).await?
                        } else {
                            self.export_table_sql_chunked(database.clone(), table.clone(), chunk_size, 100).await?
                        }
                    } else {
                        self.export_table_sql_chunked(database.clone(), table.clone(), 1000, 100).await?
                    };

                    // Extract just the INSERT statements (skip the header)
                    let insert_statements: String = table_sql.lines()
                        .filter(|line| line.starts_with("INSERT"))
                        .collect::<Vec<_>>()
                        .join("\n");

                    if !insert_statements.is_empty() {
                        output.push_str(&insert_statements);
                        output.push_str("\n\n");
                    }
                }
            }

            output.push_str(&format!("-- Database export completed: {} tables exported\n", tables.len()));
            Ok(output)
        } else {
            Err("No database connection".to_string())
        }
    }
}

#[tauri::command]
pub async fn connect_mysql(state: tauri::State<'_, DbServiceState>, host: String, port: u16, username: String, password: String, database: String, proxy: Option<ProxyConfig>, openvpn: Option<OpenVPNConfig>) -> Result<String, String> {
    let mut db = state.lock().await;
    db.connect_mysql(host, port, username, password, database, proxy, openvpn).await
}

#[tauri::command]
pub async fn execute_query(state: tauri::State<'_, DbServiceState>, query: String) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.execute_query(query).await
}

#[tauri::command]
pub async fn disconnect_db(state: tauri::State<'_, DbServiceState>) -> Result<(), String> {
    let mut db = state.lock().await;
    db.disconnect_db().await
}

#[tauri::command]
pub async fn get_databases(state: tauri::State<'_, DbServiceState>) -> Result<Vec<String>, String> {
    let db = state.lock().await;
    db.get_databases().await
}

#[tauri::command]
pub async fn get_tables(state: tauri::State<'_, DbServiceState>, database: String) -> Result<Vec<String>, String> {
    let db = state.lock().await;
    db.get_tables(database).await
}

#[tauri::command]
pub async fn get_table_structure(state: tauri::State<'_, DbServiceState>, database: String, table: String) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.get_table_structure(database, table).await
}

#[tauri::command]
pub async fn create_database(state: tauri::State<'_, DbServiceState>, database: String) -> Result<(), String> {
    let db = state.lock().await;
    db.create_database(database).await
}

#[tauri::command]
pub async fn drop_database(state: tauri::State<'_, DbServiceState>, database: String) -> Result<(), String> {
    let db = state.lock().await;
    db.drop_database(database).await
}

#[tauri::command]
pub async fn create_table(state: tauri::State<'_, DbServiceState>, database: String, table: String, columns: Vec<String>) -> Result<(), String> {
    let db = state.lock().await;
    db.create_table(database, table, columns).await
}

#[tauri::command]
pub async fn drop_table(state: tauri::State<'_, DbServiceState>, database: String, table: String) -> Result<(), String> {
    let db = state.lock().await;
    db.drop_table(database, table).await
}

#[tauri::command]
pub async fn get_table_data(state: tauri::State<'_, DbServiceState>, database: String, table: String, limit: Option<u32>, offset: Option<u32>) -> Result<QueryResult, String> {
    let db = state.lock().await;
    db.get_table_data(database, table, limit, offset).await
}

#[tauri::command]
pub async fn insert_row(state: tauri::State<'_, DbServiceState>, database: String, table: String, columns: Vec<String>, values: Vec<String>) -> Result<u64, String> {
    let db = state.lock().await;
    db.insert_row(database, table, columns, values).await
}

#[tauri::command]
pub async fn update_row(state: tauri::State<'_, DbServiceState>, database: String, table: String, columns: Vec<String>, values: Vec<String>, where_clause: String) -> Result<u64, String> {
    let db = state.lock().await;
    db.update_row(database, table, columns, values, where_clause).await
}

#[tauri::command]
pub async fn delete_row(state: tauri::State<'_, DbServiceState>, database: String, table: String, where_clause: String) -> Result<u64, String> {
    let db = state.lock().await;
    db.delete_row(database, table, where_clause).await
}

#[tauri::command]
pub async fn export_table(state: tauri::State<'_, DbServiceState>, database: String, table: String, format: String) -> Result<String, String> {
    let db = state.lock().await;
    db.export_table(database, table, format).await
}

#[tauri::command]
pub async fn export_table_chunked(state: tauri::State<'_, DbServiceState>, database: String, table: String, format: String, chunk_size: Option<u32>, max_chunks: Option<u32>) -> Result<String, String> {
    let db = state.lock().await;
    db.export_table_chunked(database, table, format, chunk_size, max_chunks).await
}

#[tauri::command]
pub async fn export_database(state: tauri::State<'_, DbServiceState>, database: String, format: String, include_data: bool) -> Result<String, String> {
    let db = state.lock().await;
    db.export_database(database, format, include_data).await
}

#[tauri::command]
pub async fn export_database_chunked(state: tauri::State<'_, DbServiceState>, database: String, format: String, include_data: bool, chunk_size: Option<u32>, max_chunks: Option<u32>) -> Result<String, String> {
    let db = state.lock().await;
    db.export_database_chunked(database, format, include_data, chunk_size, max_chunks).await
}
