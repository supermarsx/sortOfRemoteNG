#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod windows_host;

fn main() {
    // Never print decoder, document, URL, filesystem or OS error details.
    std::panic::set_hook(Box::new(|_| {}));
    #[cfg(target_os = "windows")]
    {
        if windows_host::run().is_err() {
            eprint!("{}", sorng_file_viewer_host::protocol::FAILURE);
            std::process::exit(1);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprint!("{}", sorng_file_viewer_host::protocol::UNSUPPORTED);
        std::process::exit(2);
    }
}
