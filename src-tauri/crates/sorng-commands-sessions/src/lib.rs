pub use sorng_app_domains::*;

#[path = "../../../src/ai_agent_commands.rs"]
mod ai_agent_commands;
#[path = "../../../src/dashlane_commands.rs"]
mod dashlane_commands;
#[path = "../../../src/google_passwords_commands.rs"]
mod google_passwords_commands;
#[path = "../../../src/lastpass_commands.rs"]
mod lastpass_commands;
#[path = "../../../src/mongodb_commands.rs"]
mod mongodb_commands;
#[path = "../../../src/mssql_commands.rs"]
mod mssql_commands;
#[path = "../../../src/mysql_commands.rs"]
mod mysql_commands;
#[path = "../../../src/onepassword_commands.rs"]
mod onepassword_commands;
#[path = "../../../src/postgres_commands.rs"]
mod postgres_commands;
#[path = "../../../src/redis_commands.rs"]
mod redis_commands;
#[path = "../../../src/sqlite_commands.rs"]
mod sqlite_commands;

mod sessions_handler;

pub fn is_command(command: &str) -> bool {
    sessions_handler::is_command(command)
}
pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    sessions_handler::build()
}
