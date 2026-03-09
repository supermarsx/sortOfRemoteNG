use crate::js_deps;
use crate::licenses;
use crate::rust_deps;
use crate::types::*;
use crate::workspace_crates;
use std::sync::{Arc, Mutex};

pub type AboutServiceState = Arc<Mutex<AboutService>>;

pub struct AboutService;

impl AboutService {
    pub fn new() -> AboutServiceState {
        Arc::new(Mutex::new(Self))
    }

    pub fn get_app_info(&self) -> AppInfo {
        AppInfo {
            name: "SortOfRemoteNG".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            identifier: "com.sortofremote.ng".to_string(),
            description: "A comprehensive remote connection manager for IT professionals — supporting SSH, RDP, VNC, Telnet, SFTP, serial, and many more protocols with advanced management capabilities.".to_string(),
            copyright: "Copyright 2025 Mariana M".to_string(),
            license: "MIT".to_string(),
            homepage: "https://github.com/sortofremoteng".to_string(),
            repository: "https://github.com/sortofremoteng/sortofremoteng".to_string(),
            authors: vec!["Mariana M".to_string()],
            build_info: BuildInfo {
                rust_version: "1.77.2+".to_string(),
                target: std::env::consts::ARCH.to_string() + "-" + std::env::consts::OS,
                profile: if cfg!(debug_assertions) { "debug" } else { "release" }.to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        }
    }

    pub fn get_license_summary(&self) -> LicenseSummary {
        let rust = rust_deps::get_all_rust_deps();
        let js = js_deps::get_all_js_deps();
        let crates = workspace_crates::get_all_workspace_crates();

        let mut license_map: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();
        for dep in &rust {
            *license_map.entry(dep.license.clone()).or_insert(0) += 1;
        }
        for dep in &js {
            *license_map.entry(dep.license.clone()).or_insert(0) += 1;
        }

        let mut distribution: Vec<LicenseCount> = license_map
            .into_iter()
            .map(|(license, count)| LicenseCount { license, count })
            .collect();
        distribution.sort_by(|a, b| b.count.cmp(&a.count));

        LicenseSummary {
            total_rust_deps: rust.len() as u32,
            total_js_deps: js.len() as u32,
            total_workspace_crates: crates.len() as u32,
            license_distribution: distribution,
        }
    }

    pub fn get_about(&self) -> AboutResponse {
        AboutResponse {
            app: self.get_app_info(),
            summary: self.get_license_summary(),
        }
    }

    pub fn get_all_license_texts(&self) -> Vec<LicenseEntry> {
        licenses::get_all_license_texts()
    }

    pub fn get_license_text(&self, identifier: &str) -> Option<LicenseEntry> {
        licenses::get_license_text(identifier)
    }

    pub fn get_rust_dependencies(&self) -> Vec<DependencyInfo> {
        rust_deps::get_all_rust_deps()
    }

    pub fn get_rust_deps_by_category(&self) -> Vec<DependencyCategory> {
        rust_deps::get_deps_by_category()
    }

    pub fn get_js_dependencies(&self) -> Vec<DependencyInfo> {
        js_deps::get_all_js_deps()
    }

    pub fn get_js_deps_by_category(&self) -> Vec<DependencyCategory> {
        js_deps::get_deps_by_category()
    }

    pub fn get_workspace_crates(&self) -> Vec<WorkspaceCrateInfo> {
        workspace_crates::get_all_workspace_crates()
    }

    pub fn get_workspace_crates_by_category(&self) -> Vec<DependencyCategory> {
        workspace_crates::get_crates_by_category()
    }

    pub fn get_credits(&self) -> CreditsResponse {
        CreditsResponse {
            project_authors: vec!["Mariana M".to_string()],
            acknowledgments: get_acknowledgments(),
            special_thanks: vec![
                "The Rust Programming Language community".to_string(),
                "The Tauri framework team and contributors".to_string(),
                "The React ecosystem maintainers".to_string(),
                "The Node.js community".to_string(),
                "All open-source contributors whose work makes this project possible".to_string(),
            ],
        }
    }

    pub fn search_dependencies(&self, query: &str) -> Vec<DependencyInfo> {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();
        for dep in rust_deps::get_all_rust_deps() {
            if dep.name.to_lowercase().contains(&query_lower)
                || dep.description.to_lowercase().contains(&query_lower)
                || dep.category.to_lowercase().contains(&query_lower)
            {
                results.push(dep);
            }
        }
        for dep in js_deps::get_all_js_deps() {
            if dep.name.to_lowercase().contains(&query_lower)
                || dep.description.to_lowercase().contains(&query_lower)
                || dep.category.to_lowercase().contains(&query_lower)
            {
                results.push(dep);
            }
        }
        results
    }

    pub fn get_deps_by_license(&self, license: &str) -> Vec<DependencyInfo> {
        let license_lower = license.to_lowercase();
        let mut results = Vec::new();
        for dep in rust_deps::get_all_rust_deps() {
            if dep.license.to_lowercase().contains(&license_lower) {
                results.push(dep);
            }
        }
        for dep in js_deps::get_all_js_deps() {
            if dep.license.to_lowercase().contains(&license_lower) {
                results.push(dep);
            }
        }
        results
    }
}

fn get_acknowledgments() -> Vec<Acknowledgment> {
    vec![
        Acknowledgment {
            name: "Tauri Contributors".to_string(),
            role: "Application framework".to_string(),
            url: "https://github.com/tauri-apps/tauri".to_string(),
        },
        Acknowledgment {
            name: "Tokio Contributors".to_string(),
            role: "Async runtime".to_string(),
            url: "https://github.com/tokio-rs/tokio".to_string(),
        },
        Acknowledgment {
            name: "Serde Contributors".to_string(),
            role: "Serialization framework".to_string(),
            url: "https://github.com/serde-rs/serde".to_string(),
        },
        Acknowledgment {
            name: "RustCrypto Contributors".to_string(),
            role: "Cryptography libraries".to_string(),
            url: "https://github.com/RustCrypto".to_string(),
        },
        Acknowledgment {
            name: "Hyper Contributors".to_string(),
            role: "HTTP implementation".to_string(),
            url: "https://github.com/hyperium/hyper".to_string(),
        },
        Acknowledgment {
            name: "Reqwest Contributors".to_string(),
            role: "HTTP client".to_string(),
            url: "https://github.com/seanmonstar/reqwest".to_string(),
        },
        Acknowledgment {
            name: "Russh Contributors".to_string(),
            role: "SSH protocol implementation".to_string(),
            url: "https://github.com/warp-tech/russh".to_string(),
        },
        Acknowledgment {
            name: "React Team (Meta)".to_string(),
            role: "UI framework".to_string(),
            url: "https://github.com/facebook/react".to_string(),
        },
        Acknowledgment {
            name: "Vercel / Next.js Team".to_string(),
            role: "React framework".to_string(),
            url: "https://github.com/vercel/next.js".to_string(),
        },
        Acknowledgment {
            name: "Tailwind CSS Team".to_string(),
            role: "CSS framework".to_string(),
            url: "https://github.com/tailwindlabs/tailwindcss".to_string(),
        },
        Acknowledgment {
            name: "noVNC Contributors".to_string(),
            role: "VNC client library".to_string(),
            url: "https://github.com/novnc/noVNC".to_string(),
        },
        Acknowledgment {
            name: "xterm.js Contributors".to_string(),
            role: "Terminal emulator".to_string(),
            url: "https://github.com/xtermjs/xterm.js".to_string(),
        },
        Acknowledgment {
            name: "Lucide Contributors".to_string(),
            role: "Icon library".to_string(),
            url: "https://github.com/lucide-icons/lucide".to_string(),
        },
        Acknowledgment {
            name: "Apache Guacamole Contributors".to_string(),
            role: "Remote desktop gateway protocol".to_string(),
            url: "https://github.com/apache/guacamole-client".to_string(),
        },
        Acknowledgment {
            name: "Bollard Contributors".to_string(),
            role: "Docker API client".to_string(),
            url: "https://github.com/fussybeaver/bollard".to_string(),
        },
        Acknowledgment {
            name: "kube-rs Contributors".to_string(),
            role: "Kubernetes client".to_string(),
            url: "https://github.com/kube-rs/kube".to_string(),
        },
        Acknowledgment {
            name: "lettre Contributors".to_string(),
            role: "Email client".to_string(),
            url: "https://github.com/lettre/lettre".to_string(),
        },
        Acknowledgment {
            name: "trust-dns Contributors".to_string(),
            role: "DNS resolver".to_string(),
            url: "https://github.com/hickory-dns/hickory-dns".to_string(),
        },
        Acknowledgment {
            name: "SQLx Contributors".to_string(),
            role: "Database client".to_string(),
            url: "https://github.com/launchbadge/sqlx".to_string(),
        },
        Acknowledgment {
            name: "Zod Contributors".to_string(),
            role: "TypeScript schema validation".to_string(),
            url: "https://github.com/colinhacks/zod".to_string(),
        },
        Acknowledgment {
            name: "i18next Contributors".to_string(),
            role: "Internationalization framework".to_string(),
            url: "https://github.com/i18next/i18next".to_string(),
        },
        Acknowledgment {
            name: "mRemoteNG Contributors".to_string(),
            role: "Inspiration and connection file format".to_string(),
            url: "https://github.com/mRemoteNG/mRemoteNG".to_string(),
        },
    ]
}
