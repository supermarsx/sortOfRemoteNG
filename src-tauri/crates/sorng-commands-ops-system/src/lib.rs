pub use sorng_bootloader as bootloader;
pub use sorng_cron as cron;
pub use sorng_kernel as kernel_mgmt;
pub use sorng_os_detect as os_detect;
pub use sorng_proc as proc_mgmt;
pub use sorng_time_ntp as time_ntp;

mod bootloader_commands;
mod cron_commands;
mod handler;
mod kernel_mgmt_commands;
mod os_detect_commands;
mod proc_mgmt_commands;
mod time_ntp_commands;

pub use handler::{is_command, COMMAND_NAMES};

/// Keep generated command closure types inside their owning crate.
pub type Handler = Box<tauri::ipc::InvokeHandler<tauri::Wry>>;

pub fn build() -> Handler {
    Box::new(handler::build())
}
