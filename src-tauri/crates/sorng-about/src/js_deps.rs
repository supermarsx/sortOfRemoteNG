use crate::types::{DependencyCategory, DependencyInfo};
use std::collections::HashMap;

fn categorize_js(name: &str) -> &'static str {
    match name {
        n if n.starts_with("@tauri-apps/") => "Tauri Integration",
        n if n.starts_with("react") || n == "react-dom" || n == "react-beautiful-dnd"
            || n == "react-grid-layout" || n == "react-resizable"
            || n == "react-resizable-panels" || n == "react-zoom-pan-pinch"
            || n == "react-i18next" || n == "lucide-react" => "React & UI",
        n if n == "next" || n.starts_with("eslint-config-next") => "Next.js",
        n if n == "@xterm/xterm" || n.starts_with("@xterm/addon-") => "Terminal Emulation",
        n if n == "novnc" || n == "guacamole-common-js" || n == "webssh2-frontend" => "Remote Desktop & SSH",
        n if n == "node-ssh" || n == "simple-ssh" || n == "ssh2-sftp-client"
            || n == "scp2" || n == "basic-ftp" => "SSH & File Transfer",
        n if n == "crypto-js" || n == "bcryptjs" || n == "node-forge"
            || n == "otplib" || n == "qrcode" || n == "jsqr" => "Cryptography & Auth",
        n if n == "i18next" || n == "i18next-browser-languagedetector" => "Internationalization",
        n if n == "sql.js" => "Database",
        n if n == "zod" => "Validation",
        n if n == "jszip" || n == "file-saver" => "File & Archive",
        n if n == "socks" || n == "ipaddr.js" => "Networking",
        n if n == "idb" => "Storage",
        n if n == "gifenc" => "Media",
        n if n == "@anthropic-ai/sdk" => "AI",
        // Dev dependencies
        n if n.starts_with("@types/") => "Type Definitions",
        n if n.starts_with("eslint") || n == "@eslint/js" || n == "globals" => "Linting",
        n if n == "vitest" || n.starts_with("@vitest/") || n.starts_with("@testing-library/")
            || n == "fake-indexeddb" || n == "jsdom" => "Testing",
        n if n == "vite" || n.starts_with("@vitejs/") => "Build Tooling",
        n if n == "typescript" || n.starts_with("typescript-") || n.starts_with("@webgpu/") => "TypeScript",
        n if n == "tailwindcss" || n == "postcss" || n == "autoprefixer" => "CSS & Styling",
        n if n == "prettier" => "Formatting",
        n if n == "turbo" => "Monorepo",
        _ => "Other",
    }
}

fn production_deps() -> Vec<DependencyInfo> {
    let raw: &[(&str, &str, &str)] = &[
        ("@anthropic-ai/sdk", "^0.78.0", "MIT"),
        ("@tauri-apps/api", "^2.9.1", "MIT"),
        ("@tauri-apps/plugin-dialog", "^2.4.2", "MIT"),
        ("@tauri-apps/plugin-fs", "^2.4.4", "MIT"),
        ("@xterm/addon-fit", "^0.10.0", "MIT"),
        ("@xterm/addon-web-links", "^0.11.0", "MIT"),
        ("@xterm/xterm", "^5.5.0", "MIT"),
        ("basic-ftp", "^5.1.0", "MIT"),
        ("bcryptjs", "^2.4.3", "MIT"),
        ("crypto-js", "^4.2.0", "MIT"),
        ("file-saver", "^2.0.5", "MIT"),
        ("gifenc", "^1.0.3", "MIT"),
        ("guacamole-common-js", "^1.5.0", "Apache-2.0"),
        ("i18next", "^23.7.6", "MIT"),
        ("i18next-browser-languagedetector", "^7.2.0", "MIT"),
        ("idb", "^8.0.3", "ISC"),
        ("ipaddr.js", "^2.2.0", "MIT"),
        ("jsqr", "^1.4.0", "Apache-2.0"),
        ("jszip", "^3.10.1", "MIT OR GPL-3.0"),
        ("lucide-react", "^0.344.0", "ISC"),
        ("next", "^15.3.3", "MIT"),
        ("node-forge", "^1.3.1", "BSD-3-Clause OR GPL-2.0"),
        ("node-ssh", "^13.2.1", "MIT"),
        ("novnc", "^1.2.0", "MPL-2.0"),
        ("otplib", "^12.0.1", "MIT"),
        ("qrcode", "^1.5.4", "MIT"),
        ("react", "^18.3.1", "MIT"),
        ("react-beautiful-dnd", "^13.1.1", "Apache-2.0"),
        ("react-dom", "^18.3.1", "MIT"),
        ("react-grid-layout", "^1.4.4", "MIT"),
        ("react-i18next", "^13.5.0", "MIT"),
        ("react-resizable", "^3.0.5", "MIT"),
        ("react-resizable-panels", "^0.0.55", "MIT"),
        ("react-zoom-pan-pinch", "^3.1.0", "MIT"),
        ("scp2", "^0.5.0", "MIT"),
        ("simple-ssh", "^1.0.0", "MIT"),
        ("socks", "^2.7.1", "MIT"),
        ("sql.js", "^1.8.0", "MIT"),
        ("ssh2-sftp-client", "^12.0.1", "Apache-2.0"),
        ("webssh2-frontend", "^1.0.3", "MIT"),
        ("zod", "^3.25.76", "MIT"),
    ];

    raw.iter()
        .map(|(name, version, license)| DependencyInfo {
            name: name.to_string(),
            version: version.to_string(),
            license: license.to_string(),
            authors: vec![],
            repository: String::new(),
            description: String::new(),
            category: categorize_js(name).to_string(),
        })
        .collect()
}

fn dev_deps() -> Vec<DependencyInfo> {
    let raw: &[(&str, &str, &str)] = &[
        ("@eslint/js", "^8.57.0", "MIT"),
        ("@tauri-apps/cli", "^2.9.6", "MIT"),
        ("@testing-library/jest-dom", "^6.4.2", "MIT"),
        ("@testing-library/react", "^14.2.2", "MIT"),
        ("@types/bcryptjs", "^2.4.6", "MIT"),
        ("@types/crypto-js", "^4.2.2", "MIT"),
        ("@types/file-saver", "^2.0.7", "MIT"),
        ("@types/guacamole-common-js", "^1.5.3", "MIT"),
        ("@types/jszip", "^3.4.0", "MIT"),
        ("@types/node", "^24.0.7", "MIT"),
        ("@types/node-forge", "^1.3.10", "MIT"),
        ("@types/novnc", "^0.0.27", "MIT"),
        ("@types/otplib", "^7.0.0", "MIT"),
        ("@types/qrcode", "^1.5.6", "MIT"),
        ("@types/react", "^18.3.5", "MIT"),
        ("@types/react-beautiful-dnd", "^13.1.8", "MIT"),
        ("@types/react-dom", "^18.3.0", "MIT"),
        ("@types/react-grid-layout", "^1.3.5", "MIT"),
        ("@types/react-resizable", "^3.0.7", "MIT"),
        ("@types/ssh2-sftp-client", "^9.0.6", "MIT"),
        ("@vitejs/plugin-react", "^5.1.2", "MIT"),
        ("@vitest/coverage-v8", "^1.6.1", "MIT"),
        ("@webgpu/types", "^0.1.69", "BSD-3-Clause"),
        ("autoprefixer", "^10.4.18", "MIT"),
        ("eslint", "^8.57.0", "MIT"),
        ("eslint-config-next", "^15.3.3", "MIT"),
        ("eslint-plugin-react-hooks", "^5.1.0-rc.0", "MIT"),
        ("eslint-plugin-react-refresh", "^0.4.11", "MIT"),
        ("fake-indexeddb", "^6.0.1", "Apache-2.0"),
        ("globals", "^15.9.0", "MIT"),
        ("jsdom", "^24.0.0", "MIT"),
        ("postcss", "^8.4.35", "MIT"),
        ("prettier", "^3.6.2", "MIT"),
        ("tailwindcss", "^3.4.1", "MIT"),
        ("turbo", "^2.0.0", "MIT"),
        ("typescript", "^5.5.3", "Apache-2.0"),
        ("typescript-eslint", "^8.3.0", "MIT"),
        ("vite", "^5.4.2", "MIT"),
        ("vitest", "^1.5.0", "MIT"),
    ];

    raw.iter()
        .map(|(name, version, license)| DependencyInfo {
            name: name.to_string(),
            version: version.to_string(),
            license: license.to_string(),
            authors: vec![],
            repository: String::new(),
            description: String::new(),
            category: categorize_js(name).to_string(),
        })
        .collect()
}

pub fn get_all_js_deps() -> Vec<DependencyInfo> {
    let mut all = production_deps();
    all.extend(dev_deps());
    all
}

pub fn get_deps_by_category() -> Vec<DependencyCategory> {
    let deps = get_all_js_deps();
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
