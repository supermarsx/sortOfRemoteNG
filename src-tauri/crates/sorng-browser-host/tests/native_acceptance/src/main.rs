fn main() {
    #[cfg(unix)]
    unsafe {
        std::process::exit(sorng_browser_host::bootstrap_platform::run_unix_entry(
            sorng_cef_acceptance::run,
        ));
    }
    #[cfg(windows)]
    {
        eprintln!(
            "Stage the client DLL with the pinned sandbox bootstrap; do not run this binary."
        );
        std::process::exit(2);
    }
}
