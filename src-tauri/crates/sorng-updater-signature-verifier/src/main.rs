use std::env;
use std::path::Path;

use sorng_updater_signature_verifier::verify_artifact;

fn usage() -> &'static str {
    "Usage: sorng-updater-signature-verifier <tauri-public-key-base64> <artifact> <artifact.sig>"
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 3 {
        eprintln!("{}", usage());
        std::process::exit(2);
    }

    if let Err(error) = verify_artifact(&args[0], Path::new(&args[1]), Path::new(&args[2])) {
        eprintln!("{error}");
        std::process::exit(1);
    }

    println!("Verified updater signature for {}.", args[1]);
}
