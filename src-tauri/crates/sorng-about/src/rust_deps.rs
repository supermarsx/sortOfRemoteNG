use crate::types::{DependencyCategory, DependencyInfo};
use std::collections::HashMap;

static RAW_DATA: &str = include_str!("../data/rust_deps.txt");

fn categorize(name: &str) -> &'static str {
    match name {
        // Async / Runtime
        n if n.starts_with("tokio") || n == "mio" || n == "futures" || n.starts_with("futures-")
            || n == "async-trait" || n == "async-channel" || n == "async-lock"
            || n == "async-broadcast" || n == "async-executor" || n == "async-io"
            || n == "async-process" || n == "async-signal" || n == "async-fs"
            || n == "async-net" || n == "async-task" || n == "event-listener"
            || n.starts_with("event-listener") || n == "polling" || n == "smol"
            || n == "blocking" || n == "pin-project" || n.starts_with("pin-") => "Async Runtime",

        // Cryptography
        n if n == "aes" || n == "aes-gcm" || n == "aes-kw" || n == "aead"
            || n.starts_with("sha") || n == "hmac" || n == "hkdf" || n == "pbkdf2"
            || n.starts_with("rsa") || n.starts_with("ed25519") || n.starts_with("x25519")
            || n.starts_with("curve25519") || n == "p256" || n == "p384" || n == "p521"
            || n == "ecdsa" || n == "elliptic-curve" || n.starts_with("chacha20")
            || n == "poly1305" || n == "argon2" || n == "bcrypt" || n == "scrypt"
            || n == "cipher" || n == "digest" || n == "crypto-common" || n == "block-buffer"
            || n == "generic-array" || n == "subtle" || n == "constant_time_eq"
            || n.starts_with("signature") || n == "spki" || n == "pkcs1" || n == "pkcs8"
            || n == "sec1" || n == "ctr" || n == "cbc" || n == "inout"
            || n == "rand" || n.starts_with("rand_") || n == "getrandom"
            || n == "ring" || n == "untrusted" || n == "ff" || n == "group"
            || n == "k256" || n == "der" || n == "pem-rfc7468" || n == "zeroize"
            || n.starts_with("rustls") || n == "webpki-roots" || n == "ct-logs" => "Cryptography",

        // Serialization
        n if n == "serde" || n.starts_with("serde_") || n == "bincode"
            || n == "toml" || n.starts_with("toml_") || n == "csv"
            || n.starts_with("quick-xml") || n == "rmp" || n.starts_with("rmp-")
            || n == "ciborium" || n.starts_with("ciborium-")
            || n == "postcard" || n == "ron" || n == "erased-serde"
            || n == "serdect" || n == "base64ct" || n == "base16ct" => "Serialization",

        // HTTP / Networking
        n if n == "hyper" || n.starts_with("hyper-") || n == "reqwest"
            || n == "h2" || n == "http" || n.starts_with("http-") || n == "httparse"
            || n == "httpdate" || n.starts_with("tower") || n == "axum"
            || n.starts_with("axum-") || n == "warp" || n == "actix-web"
            || n == "url" || n == "percent-encoding" || n == "idna"
            || n == "form_urlencoded" || n == "mime" || n == "mime_guess"
            || n.starts_with("cookie") || n.starts_with("headers") => "HTTP & Networking",

        // TLS / SSL
        n if n.starts_with("native-tls") || n.starts_with("openssl")
            || n == "schannel" || n.starts_with("security-framework")
            || n.starts_with("tokio-native-tls") || n.starts_with("tokio-rustls")
            || n.starts_with("hyper-tls") || n.starts_with("hyper-rustls") => "TLS & SSL",

        // SSH
        n if n.starts_with("russh") || n == "ssh-key" || n == "ssh-encoding"
            || n == "ssh-cipher" || n.starts_with("thrussh") => "SSH",

        // Database
        n if n.starts_with("sqlx") || n.starts_with("diesel") || n == "rusqlite"
            || n.starts_with("mysql") || n.starts_with("postgres")
            || n.starts_with("redis") || n.starts_with("mongodb")
            || n == "r2d2" || n == "deadpool" || n.starts_with("deadpool-")
            || n == "sea-orm" || n.starts_with("sea-") || n == "libsqlite3-sys" => "Database",

        // Tauri
        n if n.starts_with("tauri") || n == "wry" || n.starts_with("tao") => "Tauri Framework",

        // Encoding
        n if n == "base64" || n == "hex" || n == "data-encoding"
            || n == "percent-encoding" || n == "urlencoding" => "Encoding",

        // Compression
        n if n == "flate2" || n == "miniz_oxide" || n == "adler" || n == "adler2"
            || n == "brotli" || n.starts_with("brotli-") || n == "zstd"
            || n.starts_with("zstd-") || n == "lz4" || n.starts_with("lz4-")
            || n == "snap" || n == "deflate" || n == "inflate"
            || n.starts_with("libz-") || n == "gzip-header"
            || n == "zip" || n == "tar" || n == "bzip2" => "Compression",

        // Date / Time
        n if n == "chrono" || n == "time" || n.starts_with("time-")
            || n == "iana-time-zone" || n.starts_with("iana-time-zone-") => "Date & Time",

        // Logging
        n if n == "log" || n == "env_logger" || n == "tracing"
            || n.starts_with("tracing-") || n == "pretty_env_logger"
            || n == "flexi_logger" || n == "fern" || n == "slog"
            || n.starts_with("slog-") => "Logging",

        // Error handling
        n if n == "thiserror" || n.starts_with("thiserror-") || n == "anyhow"
            || n == "eyre" || n == "color-eyre" || n == "miette"
            || n == "displaydoc" || n == "quick-error" => "Error Handling",

        // CLI / Parsing
        n if n == "clap" || n.starts_with("clap_") || n == "structopt"
            || n == "nom" || n.starts_with("nom-") || n == "pest"
            || n.starts_with("pest_") || n == "regex" || n.starts_with("regex-")
            || n == "aho-corasick" || n == "memchr" || n == "glob" || n == "globset" => "Parsing & CLI",

        // OS / System
        n if n == "libc" || n == "nix" || n.starts_with("windows")
            || n.starts_with("winapi") || n == "which" || n == "sysinfo"
            || n == "sys-locale" || n == "hostname" || n == "os_info"
            || n == "os_str_bytes" || n == "same-file" || n == "walkdir"
            || n.starts_with("notify") || n == "tempfile" || n == "dunce"
            || n == "normpath" || n == "filetime" || n == "fs_extra"
            || n == "directories" || n.starts_with("dirs") || n == "home"
            || n == "ctrlc" || n == "signal-hook" || n.starts_with("signal-hook-") => "OS & System",

        // Proc macros / Build
        n if n == "proc-macro2" || n == "quote" || n == "syn"
            || n == "darling" || n.starts_with("darling_") || n == "paste"
            || n == "cfg-if" || n == "autocfg" || n == "version_check"
            || n == "cc" || n == "cmake" || n == "pkg-config"
            || n == "build-data" || n == "vergen" || n.starts_with("vergen-") => "Build & Macros",

        // Container / Orchestration
        n if n.starts_with("bollard") || n.starts_with("kube") || n == "k8s-openapi"
            || n.starts_with("docker") => "Containers & Orchestration",

        // UUID / ID
        n if n == "uuid" || n == "ulid" || n == "nanoid" => "Identifiers",

        // DNS
        n if n.starts_with("hickory") || n.starts_with("trust-dns") => "DNS",

        // Email
        n if n == "lettre" || n.starts_with("lettre-") || n == "mail-parser"
            || n == "mail-builder" || n == "mailparse" => "Email",

        // Image
        n if n == "image" || n == "png" || n == "jpeg-decoder" || n == "gif"
            || n == "ico" || n == "webp" => "Image Processing",

        // Concurrency
        n if n == "crossbeam" || n.starts_with("crossbeam-") || n == "rayon"
            || n.starts_with("rayon-") || n == "parking_lot"
            || n.starts_with("parking_lot_") || n == "dashmap"
            || n == "flume" || n == "kanal" || n == "once_cell"
            || n == "lazy_static" => "Concurrency",

        _ => "Other",
    }
}

fn parse_deps() -> Vec<DependencyInfo> {
    RAW_DATA
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() < 3 {
                return None;
            }
            let name = parts[0].to_string();
            let version = parts[1].to_string();
            let license = parts[2].to_string();
            let authors: Vec<String> = if parts.len() > 3 && !parts[3].is_empty() {
                parts[3].split(';').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect()
            } else {
                vec![]
            };
            let repository = if parts.len() > 4 { parts[4].to_string() } else { String::new() };
            let category = categorize(&name).to_string();
            Some(DependencyInfo {
                name,
                version,
                license,
                authors,
                repository,
                description: String::new(),
                category,
            })
        })
        .collect()
}

pub fn get_all_rust_deps() -> Vec<DependencyInfo> {
    parse_deps()
}

pub fn get_deps_by_category() -> Vec<DependencyCategory> {
    let deps = parse_deps();
    let mut map: HashMap<String, Vec<DependencyInfo>> = HashMap::new();
    for dep in deps {
        map.entry(dep.category.clone()).or_default().push(dep);
    }
    let mut cats: Vec<DependencyCategory> = map
        .into_iter()
        .map(|(name, dependencies)| DependencyCategory {
            name: name.clone(),
            description: format!("{} dependencies", name),
            dependencies,
        })
        .collect();
    cats.sort_by(|a, b| a.name.cmp(&b.name));
    cats
}
