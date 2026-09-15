#[cfg(feature = "kafka")]
pub use sorng_kafka as kafka;
pub use sorng_rabbitmq as rabbitmq;

mod handler;
#[cfg(feature = "kafka")]
mod kafka_commands;
mod rabbitmq_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
