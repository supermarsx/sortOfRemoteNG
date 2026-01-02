use std::sync::Arc;
use tokio::sync::Mutex;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use sqlx::{Row, Column};
use serde::{Deserialize, Serialize};

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

    pub async fn connect_mysql(&mut self, host: String, port: u16, username: String, password: String, database: String) -> Result<String, String> {
        let url = format!("mysql://{}:{}@{}:{}/{}", username, password, host, port, database);
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
}

#[tauri::command]
pub async fn connect_mysql(state: tauri::State<'_, DbServiceState>, host: String, port: u16, username: String, password: String, database: String) -> Result<String, String> {
    let mut db = state.lock().await;
    db.connect_mysql(host, port, username, password, database).await
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