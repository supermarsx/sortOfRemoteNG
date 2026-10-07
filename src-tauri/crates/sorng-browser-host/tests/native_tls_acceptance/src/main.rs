fn main() {
    #[cfg(unix)]
    unsafe {
        std::process::exit(sorng_browser_host::bootstrap_platform::run_unix_entry(
            sorng_cef_tls_acceptance::run,
        ));
    }
    #[cfg(windows)]
    {
        eprintln!(
            "Stage the DLL with the pinned sandbox bootstrap. This binary cannot initialize CEF."
        );
        std::process::exit(2);
    }
}
