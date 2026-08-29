use std::path::Path;

fn main() {
    println!("cargo:rerun-if-env-changed=OPENH264_LIB_DIR");

    if std::env::var_os("CARGO_FEATURE_SOFTWARE_DECODE_DYNAMIC").is_none() {
        return;
    }

    if let Some(directory) = std::env::var_os("OPENH264_LIB_DIR") {
        let directory = Path::new(&directory);
        if directory.as_os_str().is_empty() {
            panic!("OPENH264_LIB_DIR must not be empty");
        }
        println!("cargo:rustc-link-search=native={}", directory.display());
    }

    println!("cargo:rustc-link-lib=dylib=openh264");
}
