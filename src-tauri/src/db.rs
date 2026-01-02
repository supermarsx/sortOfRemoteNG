use std::sync::Arc;
use tokio::sync::Mutex;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

pub type DbServiceState = Arc<Mutex<DbService>>;

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

    pub async fn execute_query(&self, query: String) -> Result<String, String> {
        if let Some(pool) = &self.pool {
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
            // For simplicity, return number of rows
            Ok(format!("Query executed, affected {} rows", rows.len()))
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
pub async fn execute_query(state: tauri::State<'_, DbServiceState>, query: String) -> Result<String, String> {
    let db = state.lock().await;
    db.execute_query(query).await
}

#[tauri::command]
pub async fn disconnect_db(state: tauri::State<'_, DbServiceState>) -> Result<(), String> {
    let mut db = state.lock().await;
    db.disconnect_db().await
}