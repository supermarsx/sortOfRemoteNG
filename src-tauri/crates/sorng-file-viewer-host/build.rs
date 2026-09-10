use std::{env, fs, path::PathBuf};

fn main() {
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest =
            PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-bin=sorng-file-viewer-host=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bin=sorng-file-viewer-host=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
    // These are trusted, pinned build inputs, never runtime paths supplied by a document.
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../../node_modules/pdfjs-dist");
    let package = root.join("package.json");
    println!("cargo:rerun-if-changed={}", package.display());
    let manifest = fs::read_to_string(&package)
        .expect("file viewer requires npm dependencies installed (pdfjs-dist 6.3.289)");
    assert!(
        manifest.contains("\"version\": \"6.3.289\""),
        "review the viewer before changing PDF.js version"
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    for name in ["pdf.min.mjs", "pdf.worker.min.mjs"] {
        let source = root.join("build").join(name);
        println!("cargo:rerun-if-changed={}", source.display());
        fs::copy(&source, output.join(name)).expect("could not bundle trusted PDF.js assets");
    }
    println!("cargo:rerun-if-changed={}", root.join("LICENSE").display());
    fs::copy(root.join("LICENSE"), output.join("pdfjs-LICENSE"))
        .expect("could not bundle PDF.js license");
}
