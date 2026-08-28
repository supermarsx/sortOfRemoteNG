import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `about` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const ABOUT_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── About ────────────────────────────────────────────────────
  {
    key: "about.summary",
    label: "About Summary",
    description: "Application name, author, license, and core stack",
    tags: ["about", "version", "author", "maintainer", "license", "mit"],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.description",
    label: "Application Description",
    description:
      "Detailed overview of sortOfRemoteNG, protocol coverage, security, automation, and operations scope",
    tags: [
      "about",
      "overview",
      "description",
      "remote",
      "manager",
      "workbench",
      "protocols",
      "automation",
    ],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.project",
    label: "Project Authors",
    description: "Project authors, contributors, and maintainers",
    tags: ["author", "authors", "contributors", "maintainers", "credits"],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.frontend",
    label: "Frontend Libraries",
    description:
      "React, Next.js, TypeScript, Tailwind, xterm, and UI dependencies",
    tags: [
      "libraries",
      "react",
      "next",
      "typescript",
      "tailwind",
      "xterm",
      "ui",
    ],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.desktop-runtime",
    label: "Desktop Runtime",
    description: "Tauri, Rust, WebView2, Cargo, and runtime dependencies",
    tags: ["tauri", "rust", "webview", "desktop", "cargo"],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.backend",
    label: "Rust Backend Libraries",
    description: "Tokio, Serde, Axum, Reqwest, tracing, and backend crates",
    tags: ["rust", "tokio", "serde", "axum", "reqwest", "backend"],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.protocols",
    label: "Protocol Libraries",
    description:
      "SSH, RDP, VNC, FTP, SQL, Kafka, cloud, and infrastructure integrations",
    tags: [
      "protocol",
      "ssh",
      "rdp",
      "vnc",
      "ftp",
      "database",
      "kafka",
      "cloud",
    ],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.security",
    label: "Security Libraries",
    description:
      "TLS, cryptography, TOTP, OAuth, FIDO2, and certificate tooling",
    tags: ["security", "crypto", "tls", "rustls", "totp", "oauth", "fido2"],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.tooling",
    label: "Build and Test Tooling",
    description:
      "Vite, Vitest, Testing Library, ESLint, WebdriverIO, Docker, and cargo-chef",
    tags: [
      "build",
      "test",
      "vite",
      "vitest",
      "eslint",
      "webdriverio",
      "docker",
    ],
    section: "about",
    sectionLabel: "About",
  },
  {
    key: "about.license",
    label: "License Notices",
    description: "MIT license and third-party license acknowledgement",
    tags: ["license", "notice", "mit", "third party", "dependencies"],
    section: "about",
    sectionLabel: "About",
  },
];
