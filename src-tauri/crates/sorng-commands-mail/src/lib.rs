pub use sorng_amavis as amavis;
pub use sorng_clamav as clamav;
pub use sorng_cyrus_sasl as cyrus_sasl;
pub use sorng_dovecot as dovecot;
pub use sorng_mailcow as mailcow;
pub use sorng_opendkim as opendkim;
pub use sorng_postfix as postfix;
pub use sorng_procmail as procmail;
pub use sorng_roundcube as roundcube;
pub use sorng_rspamd as rspamd;
pub use sorng_spamassassin as spamassassin;

// Use #[path] to reference the command files in the ops crate
#[path = "../../sorng-commands-ops/src/amavis_commands.rs"]
mod amavis_commands;
#[path = "../../sorng-commands-ops/src/clamav_commands.rs"]
mod clamav_commands;
#[path = "../../sorng-commands-ops/src/cyrus_sasl_commands.rs"]
mod cyrus_sasl_commands;
#[path = "../../sorng-commands-ops/src/dovecot_commands.rs"]
mod dovecot_commands;
#[path = "../../sorng-commands-ops/src/mailcow_commands.rs"]
mod mailcow_commands;
#[path = "../../sorng-commands-ops/src/opendkim_commands.rs"]
mod opendkim_commands;
#[path = "../../sorng-commands-ops/src/postfix_commands.rs"]
mod postfix_commands;
#[path = "../../sorng-commands-ops/src/procmail_commands.rs"]
mod procmail_commands;
#[path = "../../sorng-commands-ops/src/roundcube_commands.rs"]
mod roundcube_commands;
#[path = "../../sorng-commands-ops/src/rspamd_commands.rs"]
mod rspamd_commands;
#[path = "../../sorng-commands-ops/src/spamassassin_commands.rs"]
mod spamassassin_commands;

mod mail_handler;

pub fn is_command(command: &str) -> bool {
    mail_handler::is_command(command)
}

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    mail_handler::build()
}
