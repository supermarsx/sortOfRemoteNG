import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Code,
  Cpu,
  ExternalLink,
  Globe,
  Info,
  Network,
  Scale,
  Server,
  Shield,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
} from "../../ui/settings/SettingsPrimitives";

interface CreditItem {
  name: string;
  author: string;
  detail: string;
  license?: string;
}

interface CreditGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  items: CreditItem[];
}

interface AppDescriptionHighlight {
  title: string;
  detail: string;
  icon: LucideIcon;
}

const SUMMARY_ITEMS = [
  { label: "Application", value: "sortOfRemoteNG" },
  { label: "Author", value: "Mariana Mota" },
  { label: "License", value: "MIT" },
  { label: "Core stack", value: "Tauri, Rust, React, Next.js" },
];

const APP_DESCRIPTION_PARAGRAPHS = [
  "sortOfRemoteNG is a desktop remote-operations workbench for people who move between terminals, remote desktops, admin consoles, cloud panels, and infrastructure APIs all day. It brings connection inventory, session launch, credential handling, diagnostics, recording, and automation into one local application instead of scattering those workflows across disconnected tools.",
  "The project is a spiritual successor to mRemoteNG with a wider protocol surface and a more modern runtime. It is designed around collections, tabs, tags, search, import/export, quick connect, detached windows, and tool panels so that a large remote estate can be scanned, grouped, opened, repaired, and revisited without losing context.",
  "The app pairs a Tauri 2 desktop shell with a Next.js and React interface, backed by a Rust workspace of purpose-scoped service crates. That split keeps the UI responsive while native backends own protocol sessions, secure storage, file transfer, tunneling, diagnostics, schedulers, recorders, and platform integration through explicit Tauri commands.",
  "Its scope is intentionally broad: SSH, RDP, VNC, SFTP, SMB, serial, web, VPN, BMC, cloud, database, monitoring, mail, security, and ops surfaces are treated as parts of the same daily workflow. Optional AI, MCP, scripting, command palette, session recording, replay, and infrastructure modules are meant to live beside normal remote sessions rather than becoming separate products.",
];

const APP_DESCRIPTION_HIGHLIGHTS: AppDescriptionHighlight[] = [
  {
    title: "Remote Session Hub",
    icon: Network,
    detail: "Launch and manage shell, desktop, web, file-transfer, serial, VPN, BMC, and cloud-console workflows from one connection model.",
  },
  {
    title: "Inventory & Migration",
    icon: Globe,
    detail: "Organize hosts with collections, tabs, tags, favorites, search, import/export paths, and compatibility-minded mRemoteNG-style workflows.",
  },
  {
    title: "Security & Secrets",
    icon: Shield,
    detail: "Keep credentials, keys, TOTP entries, vault integrations, biometric flows, and clipboard-sensitive operations close to the local desktop boundary.",
  },
  {
    title: "Native Protocol Backends",
    icon: Cpu,
    detail: "Use Rust service crates for protocol drivers, long-running sessions, diagnostics, storage, platform calls, and event streams behind the React UI.",
  },
  {
    title: "Operations Surface",
    icon: Server,
    detail: "Bring infrastructure, cloud, database, monitoring, mail, container, Kubernetes, and automation panels into the same workspace as direct remote access.",
  },
  {
    title: "Automation & Observability",
    icon: Wrench,
    detail: "Support scripts, AI-assisted workflows, MCP, scheduled tasks, command history, session recording, replay, and diagnostics as first-class companion tools.",
  },
];

const CREDIT_GROUPS: CreditGroup[] = [
  {
    id: "project",
    title: "Project Authors & Maintainers",
    icon: Info,
    items: [
      {
        name: "sortOfRemoteNG",
        author: "Mariana Mota",
        detail: "Primary application design, implementation, packaging, and project direction.",
        license: "MIT",
      },
      {
        name: "sortOfRemoteNG contributors",
        author: "Project contributors",
        detail: "Testing, fixes, documentation, protocol coverage, and release support.",
      },
      {
        name: "Open-source maintainers",
        author: "Upstream communities",
        detail: "The application depends on a broad ecosystem of libraries, tools, specifications, and protocol projects.",
      },
    ],
  },
  {
    id: "frontend",
    title: "Frontend & Interface Libraries",
    icon: Globe,
    items: [
      { name: "React", author: "Meta and React contributors", detail: "Component model and UI rendering.", license: "MIT" },
      { name: "React DOM", author: "Meta and React contributors", detail: "Browser DOM renderer for React.", license: "MIT" },
      { name: "Next.js", author: "Vercel and contributors", detail: "Application framework and static export pipeline.", license: "MIT" },
      { name: "TypeScript", author: "Microsoft and contributors", detail: "Typed JavaScript language tooling.", license: "Apache-2.0" },
      { name: "Tailwind CSS", author: "Tailwind Labs and contributors", detail: "Utility styling framework used by the application UI.", license: "MIT" },
      { name: "Lucide React", author: "Lucide contributors", detail: "Icon set used throughout controls and settings.", license: "ISC" },
      { name: "i18next", author: "i18next maintainers", detail: "Localization engine for translated UI strings.", license: "MIT" },
      { name: "react-i18next", author: "i18next maintainers", detail: "React bindings for localized UI text.", license: "MIT" },
      { name: "@hello-pangea/dnd", author: "Hello Pangea contributors", detail: "Drag-and-drop behavior for ordered UI surfaces.", license: "Apache-2.0" },
      { name: "React Grid Layout", author: "React Grid Layout contributors", detail: "Resizable dashboard-style grid layout support.", license: "MIT" },
      { name: "React Resizable", author: "React Grid Layout contributors", detail: "Resizable panel and layout primitives.", license: "MIT" },
      { name: "React Resizable Panels", author: "Brian Vaughn and contributors", detail: "Split-panel resizing interactions.", license: "MIT" },
      { name: "react-zoom-pan-pinch", author: "BetterTyped contributors", detail: "Pan and zoom interaction support.", license: "MIT" },
      { name: "xterm.js", author: "xterm.js contributors", detail: "Terminal emulator for SSH and shell sessions.", license: "MIT" },
      { name: "@xterm/addon-fit", author: "xterm.js contributors", detail: "Terminal viewport fitting.", license: "MIT" },
      { name: "@xterm/addon-web-links", author: "xterm.js contributors", detail: "Clickable terminal web links.", license: "MIT" },
      { name: "qrcode", author: "QRCode package contributors", detail: "QR code generation.", license: "MIT" },
      { name: "jsQR", author: "Cooper Semantics and contributors", detail: "QR code scanning and decoding.", license: "Apache-2.0" },
      { name: "gifenc", author: "Matt DesLauriers and contributors", detail: "GIF encoding for visual export workflows.", license: "MIT" },
      { name: "JSZip", author: "Stuk and contributors", detail: "Zip archive import/export support.", license: "MIT" },
      { name: "FileSaver.js", author: "Eli Grey and contributors", detail: "Browser-side file saving.", license: "MIT" },
      { name: "idb", author: "Jake Archibald and contributors", detail: "IndexedDB promise wrapper.", license: "ISC" },
      { name: "sql.js", author: "sql.js contributors", detail: "SQLite compiled to WebAssembly for browser-side data work.", license: "MIT" },
      { name: "Zod", author: "Zod contributors", detail: "Runtime schema validation.", license: "MIT" },
      { name: "ipaddr.js", author: "ipaddr.js contributors", detail: "IP address parsing and range utilities.", license: "MIT" },
    ],
  },
  {
    id: "desktop-runtime",
    title: "Desktop Shell & Runtime",
    icon: Cpu,
    items: [
      { name: "Tauri", author: "Tauri Programme and contributors", detail: "Desktop application shell, commands, and plugin host.", license: "MIT OR Apache-2.0" },
      { name: "@tauri-apps/api", author: "Tauri Programme and contributors", detail: "Frontend bridge to Tauri commands and events.", license: "MIT OR Apache-2.0" },
      { name: "Tauri Dialog Plugin", author: "Tauri Programme and contributors", detail: "Native file and message dialogs.", license: "MIT OR Apache-2.0" },
      { name: "Tauri FS Plugin", author: "Tauri Programme and contributors", detail: "Safe filesystem access from the desktop shell.", license: "MIT OR Apache-2.0" },
      { name: "Tauri Updater Plugin", author: "Tauri Programme and contributors", detail: "Application update plumbing.", license: "MIT OR Apache-2.0" },
      { name: "Tauri Window State Plugin", author: "Tauri Programme and contributors", detail: "Window size, position, and state persistence.", license: "MIT OR Apache-2.0" },
      { name: "WebView2", author: "Microsoft", detail: "Windows webview runtime used by Tauri on Windows." },
      { name: "Rust", author: "Rust Project contributors", detail: "Backend language, package manager, and native runtime ecosystem.", license: "MIT OR Apache-2.0" },
      { name: "Cargo", author: "Rust Project contributors", detail: "Rust package manager, workspace, and build orchestration.", license: "MIT OR Apache-2.0" },
      { name: "Node.js", author: "OpenJS Foundation and contributors", detail: "JavaScript tooling runtime.", license: "MIT" },
    ],
  },
  {
    id: "backend",
    title: "Rust Backend & Service Libraries",
    icon: Server,
    items: [
      { name: "Tokio", author: "Tokio project contributors", detail: "Async runtime for network and service operations.", license: "MIT" },
      { name: "Futures", author: "Rust async ecosystem contributors", detail: "Future and stream utilities.", license: "MIT OR Apache-2.0" },
      { name: "async-trait", author: "David Tolnay and contributors", detail: "Async trait method support.", license: "MIT OR Apache-2.0" },
      { name: "Serde", author: "Serde contributors", detail: "Serialization and deserialization.", license: "MIT OR Apache-2.0" },
      { name: "serde_json", author: "Serde contributors", detail: "JSON support for Rust data structures.", license: "MIT OR Apache-2.0" },
      { name: "serde_yaml", author: "Serde YAML contributors", detail: "YAML configuration parsing.", license: "MIT OR Apache-2.0" },
      { name: "Axum", author: "Tokio project contributors", detail: "Embedded HTTP API routing.", license: "MIT" },
      { name: "Reqwest", author: "seanmonstar and contributors", detail: "HTTP client support.", license: "MIT OR Apache-2.0" },
      { name: "url", author: "Servo and url contributors", detail: "URL parsing and normalization.", license: "MIT OR Apache-2.0" },
      { name: "bytes", author: "Tokio project contributors", detail: "Efficient byte buffers.", license: "MIT" },
      { name: "uuid", author: "uuid-rs contributors", detail: "Unique identifiers for sessions and records.", license: "MIT OR Apache-2.0" },
      { name: "chrono", author: "Chrono contributors", detail: "Date and time handling.", license: "MIT OR Apache-2.0" },
      { name: "dirs", author: "dirs-rs contributors", detail: "Platform-specific user directory lookup.", license: "MIT OR Apache-2.0" },
      { name: "regex", author: "Rust regex contributors", detail: "Regular expression matching.", license: "MIT OR Apache-2.0" },
      { name: "thiserror", author: "David Tolnay and contributors", detail: "Typed error definitions.", license: "MIT OR Apache-2.0" },
      { name: "tracing", author: "Tokio project contributors", detail: "Structured diagnostics and telemetry.", license: "MIT" },
      { name: "tracing-subscriber", author: "Tokio project contributors", detail: "Trace filtering and output formatting.", license: "MIT" },
      { name: "log", author: "Rust logging contributors", detail: "Logging facade for Rust crates.", license: "MIT OR Apache-2.0" },
      { name: "base64", author: "base64 contributors", detail: "Base64 encoding and decoding.", license: "MIT OR Apache-2.0" },
      { name: "rand", author: "Rust Rand contributors", detail: "Random value generation.", license: "MIT OR Apache-2.0" },
      { name: "which", author: "which-rs contributors", detail: "Executable discovery on the host system.", license: "MIT" },
      { name: "cpal", author: "Rust audio contributors", detail: "Cross-platform audio device access.", license: "Apache-2.0" },
    ],
  },
  {
    id: "protocols",
    title: "Remote Access, Protocol & Infrastructure Libraries",
    icon: Network,
    items: [
      { name: "libssh2 / ssh2", author: "libssh2 and ssh2-rs contributors", detail: "SSH transport and authentication support.", license: "MIT" },
      { name: "OpenSSL", author: "OpenSSL Project", detail: "TLS and cryptographic primitives used by native dependencies.", license: "Apache-2.0" },
      { name: "IronRDP", author: "Devolutions and contributors", detail: "RDP protocol stack and session handling.", license: "MIT OR Apache-2.0" },
      { name: "OpenH264", author: "Cisco and contributors", detail: "Software H.264 decode path for RDP media features.", license: "BSD" },
      { name: "noVNC", author: "noVNC contributors", detail: "Browser VNC client code and protocol utilities.", license: "MPL-2.0" },
      { name: "vnc-rs", author: "vnc-rs contributors", detail: "Rust VNC protocol support.", license: "MIT" },
      { name: "Apache Guacamole common JS", author: "Apache Software Foundation", detail: "Remote desktop client-side protocol helpers.", license: "Apache-2.0" },
      { name: "WebSSH2 Frontend", author: "WebSSH2 contributors", detail: "Web terminal SSH frontend components.", license: "MIT" },
      { name: "suppaftp", author: "suppaftp contributors", detail: "FTP client implementation.", license: "MIT" },
      { name: "SQLx", author: "LaunchBadge and contributors", detail: "Async SQL database access.", license: "MIT OR Apache-2.0" },
      { name: "Tiberius", author: "Tiberius contributors", detail: "Microsoft SQL Server protocol support.", license: "MIT OR Apache-2.0" },
      { name: "Redis Rust Client", author: "redis-rs contributors", detail: "Redis protocol and client support.", license: "BSD-3-Clause" },
      { name: "MongoDB Rust Driver", author: "MongoDB Inc. and contributors", detail: "MongoDB database integration.", license: "Apache-2.0" },
      { name: "rusqlite / SQLite", author: "SQLite and Rust SQLite contributors", detail: "SQLite database integration.", license: "MIT / public domain" },
      { name: "rdkafka / librdkafka", author: "Confluent and rdkafka contributors", detail: "Kafka client integration and native broker protocol support.", license: "MIT / BSD-2-Clause" },
      { name: "lettre", author: "lettre contributors", detail: "SMTP mail transport.", license: "MIT OR Apache-2.0" },
      { name: "trust-dns", author: "trust-dns contributors", detail: "DNS protocol and resolver utilities.", license: "MIT OR Apache-2.0" },
      { name: "Quinn", author: "Quinn contributors", detail: "QUIC transport support.", license: "MIT OR Apache-2.0" },
      { name: "tokio-tungstenite", author: "tungstenite and Tokio contributors", detail: "WebSocket client and stream support.", license: "MIT" },
      { name: "defguard_wireguard_rs", author: "Defguard and contributors", detail: "WireGuard management support.", license: "MIT" },
      { name: "OpenPubkey OPKSSH", author: "OpenPubkey contributors", detail: "OPKSSH integration and vendored metadata support.", license: "Apache-2.0" },
      { name: "Win32 / windows-rs", author: "Microsoft and contributors", detail: "Windows platform bindings and native integration.", license: "MIT OR Apache-2.0" },
      { name: "AWS SDK ecosystem", author: "AWS and Smithy Rust contributors", detail: "AWS service integration surface.", license: "Apache-2.0" },
      { name: "Azure SDK ecosystem", author: "Microsoft and contributors", detail: "Azure service integration surface.", license: "MIT" },
      { name: "Google Cloud APIs", author: "Google and contributors", detail: "GCP service integration surface.", license: "Apache-2.0" },
      { name: "Docker APIs", author: "Docker and Rust API contributors", detail: "Container and compose integration surface.", license: "Apache-2.0" },
      { name: "Kubernetes APIs", author: "Kubernetes and kube-rs contributors", detail: "Cluster and workload integration surface.", license: "Apache-2.0" },
      { name: "HashiCorp ecosystem", author: "HashiCorp and contributors", detail: "Vault, Consul, Terraform, and infrastructure integration surface.", license: "MPL-2.0 / Apache-2.0" },
    ],
  },
  {
    id: "security",
    title: "Security, Identity & Cryptography",
    icon: Shield,
    items: [
      { name: "rustls", author: "rustls contributors", detail: "Modern TLS implementation for Rust.", license: "Apache-2.0 OR ISC OR MIT" },
      { name: "tokio-rustls", author: "rustls and Tokio contributors", detail: "Async TLS integration.", license: "MIT OR Apache-2.0" },
      { name: "rustls-native-certs", author: "rustls contributors", detail: "Platform trust store loading.", license: "Apache-2.0 OR ISC OR MIT" },
      { name: "ring", author: "Brian Smith and contributors", detail: "Cryptographic primitives used by rustls.", license: "MIT AND ISC AND OpenSSL" },
      { name: "RustCrypto AES-GCM", author: "RustCrypto contributors", detail: "Authenticated encryption support.", license: "MIT OR Apache-2.0" },
      { name: "RustCrypto SHA-2", author: "RustCrypto contributors", detail: "SHA-2 hashing algorithms.", license: "MIT OR Apache-2.0" },
      { name: "RustCrypto HMAC", author: "RustCrypto contributors", detail: "Message authentication codes.", license: "MIT OR Apache-2.0" },
      { name: "PBKDF2", author: "RustCrypto contributors", detail: "Password-based key derivation.", license: "MIT OR Apache-2.0" },
      { name: "secrecy", author: "iqlusion and contributors", detail: "Secret value wrappers that avoid accidental exposure.", license: "Apache-2.0 OR MIT" },
      { name: "zeroize", author: "iqlusion and contributors", detail: "Memory zeroing for secret-bearing buffers.", license: "Apache-2.0 OR MIT" },
      { name: "totp-rs", author: "totp-rs contributors", detail: "Time-based one-time password generation and validation.", license: "MIT" },
      { name: "YubiKey / FIDO2 ecosystem", author: "Yubico and Rust security contributors", detail: "Security-key and hardware-backed SSH workflows.", license: "Apache-2.0 / MIT" },
      { name: "OAuth2", author: "oauth2-rs contributors", detail: "OAuth authentication flows.", license: "MIT OR Apache-2.0" },
      { name: "picky", author: "Devolutions and contributors", detail: "PKI, certificate, and Kerberos-related parsing utilities.", license: "MIT OR Apache-2.0" },
      { name: "x509-parser", author: "x509-parser contributors", detail: "X.509 certificate parsing.", license: "MIT OR Apache-2.0" },
    ],
  },
  {
    id: "tooling",
    title: "Build, Test & Release Tooling",
    icon: Wrench,
    items: [
      { name: "Vite", author: "Vite contributors", detail: "Frontend build and test tooling foundation.", license: "MIT" },
      { name: "Vitest", author: "Vitest contributors", detail: "Frontend unit test runner.", license: "MIT" },
      { name: "Testing Library", author: "Testing Library contributors", detail: "React component testing helpers.", license: "MIT" },
      { name: "jsdom", author: "jsdom contributors", detail: "DOM implementation for tests.", license: "MIT" },
      { name: "fake-indexeddb", author: "fake-indexeddb contributors", detail: "IndexedDB test implementation.", license: "Apache-2.0" },
      { name: "ESLint", author: "OpenJS Foundation and contributors", detail: "JavaScript and TypeScript linting.", license: "MIT" },
      { name: "typescript-eslint", author: "typescript-eslint contributors", detail: "TypeScript-aware ESLint rules.", license: "MIT" },
      { name: "Prettier", author: "Prettier contributors", detail: "Code formatting.", license: "MIT" },
      { name: "WebdriverIO", author: "OpenJS Foundation and contributors", detail: "Desktop and browser E2E test runner.", license: "MIT" },
      { name: "WDIO Tauri Service", author: "WebdriverIO and Tauri contributors", detail: "Tauri app automation support.", license: "MIT" },
      { name: "Turbo", author: "Vercel and contributors", detail: "Task orchestration for JavaScript workflows.", license: "MPL-2.0" },
      { name: "PostCSS", author: "PostCSS contributors", detail: "CSS transform pipeline.", license: "MIT" },
      { name: "Autoprefixer", author: "Autoprefixer contributors", detail: "CSS browser prefixing.", license: "MIT" },
      { name: "Docker", author: "Docker and contributors", detail: "Containerized test and artifact workflows.", license: "Apache-2.0" },
      { name: "cargo-chef", author: "cargo-chef contributors", detail: "Rust dependency caching for Docker builds.", license: "MIT OR Apache-2.0" },
      { name: "MSYS2", author: "MSYS2 contributors", detail: "Windows GNU native build dependencies.", license: "Various open-source licenses" },
    ],
  },
];

const CREDIT_REPOSITORY_URLS: Record<string, string> = {
  "sortOfRemoteNG": "https://github.com/supermarsx/sortOfRemoteNG",
  "sortOfRemoteNG contributors": "https://github.com/supermarsx/sortOfRemoteNG/graphs/contributors",
  "Open-source maintainers": "https://github.com/explore",
  "React": "https://github.com/facebook/react",
  "React DOM": "https://github.com/facebook/react",
  "Next.js": "https://github.com/vercel/next.js",
  "TypeScript": "https://github.com/microsoft/TypeScript",
  "Tailwind CSS": "https://github.com/tailwindlabs/tailwindcss",
  "Lucide React": "https://github.com/lucide-icons/lucide",
  "i18next": "https://github.com/i18next/i18next",
  "react-i18next": "https://github.com/i18next/react-i18next",
  "@hello-pangea/dnd": "https://github.com/hello-pangea/dnd",
  "React Grid Layout": "https://github.com/react-grid-layout/react-grid-layout",
  "React Resizable": "https://github.com/react-grid-layout/react-resizable",
  "React Resizable Panels": "https://github.com/bvaughn/react-resizable-panels",
  "react-zoom-pan-pinch": "https://github.com/BetterTyped/react-zoom-pan-pinch",
  "xterm.js": "https://github.com/xtermjs/xterm.js",
  "@xterm/addon-fit": "https://github.com/xtermjs/xterm.js",
  "@xterm/addon-web-links": "https://github.com/xtermjs/xterm.js",
  "qrcode": "https://github.com/soldair/node-qrcode",
  "jsQR": "https://github.com/cozmo/jsQR",
  "gifenc": "https://github.com/mattdesl/gifenc",
  "JSZip": "https://github.com/Stuk/jszip",
  "FileSaver.js": "https://github.com/eligrey/FileSaver.js",
  "idb": "https://github.com/jakearchibald/idb",
  "sql.js": "https://github.com/sql-js/sql.js",
  "Zod": "https://github.com/colinhacks/zod",
  "ipaddr.js": "https://github.com/whitequark/ipaddr.js",
  "Tauri": "https://github.com/tauri-apps/tauri",
  "@tauri-apps/api": "https://github.com/tauri-apps/tauri",
  "Tauri Dialog Plugin": "https://github.com/tauri-apps/plugins-workspace",
  "Tauri FS Plugin": "https://github.com/tauri-apps/plugins-workspace",
  "Tauri Updater Plugin": "https://github.com/tauri-apps/plugins-workspace",
  "Tauri Window State Plugin": "https://github.com/tauri-apps/plugins-workspace",
  "WebView2": "https://github.com/MicrosoftEdge/WebView2Samples",
  "Rust": "https://github.com/rust-lang/rust",
  "Cargo": "https://github.com/rust-lang/cargo",
  "Node.js": "https://github.com/nodejs/node",
  "Tokio": "https://github.com/tokio-rs/tokio",
  "Futures": "https://github.com/rust-lang/futures-rs",
  "async-trait": "https://github.com/dtolnay/async-trait",
  "Serde": "https://github.com/serde-rs/serde",
  "serde_json": "https://github.com/serde-rs/json",
  "serde_yaml": "https://github.com/dtolnay/serde-yaml",
  "Axum": "https://github.com/tokio-rs/axum",
  "Reqwest": "https://github.com/seanmonstar/reqwest",
  "url": "https://github.com/servo/rust-url",
  "bytes": "https://github.com/tokio-rs/bytes",
  "uuid": "https://github.com/uuid-rs/uuid",
  "chrono": "https://github.com/chronotope/chrono",
  "dirs": "https://github.com/dirs-dev/dirs-rs",
  "regex": "https://github.com/rust-lang/regex",
  "thiserror": "https://github.com/dtolnay/thiserror",
  "tracing": "https://github.com/tokio-rs/tracing",
  "tracing-subscriber": "https://github.com/tokio-rs/tracing",
  "log": "https://github.com/rust-lang/log",
  "base64": "https://github.com/marshallpierce/rust-base64",
  "rand": "https://github.com/rust-random/rand",
  "which": "https://github.com/harryfei/which-rs",
  "cpal": "https://github.com/RustAudio/cpal",
  "libssh2 / ssh2": "https://github.com/alexcrichton/ssh2-rs",
  "OpenSSL": "https://github.com/openssl/openssl",
  "IronRDP": "https://github.com/Devolutions/IronRDP",
  "OpenH264": "https://github.com/cisco/openh264",
  "noVNC": "https://github.com/novnc/noVNC",
  "vnc-rs": "https://crates.io/crates/vnc-rs",
  "Apache Guacamole common JS": "https://github.com/apache/guacamole-client",
  "WebSSH2 Frontend": "https://github.com/billchurch/webssh2",
  "suppaftp": "https://github.com/veeso/suppaftp",
  "SQLx": "https://github.com/launchbadge/sqlx",
  "Tiberius": "https://github.com/prisma/tiberius",
  "Redis Rust Client": "https://github.com/redis-rs/redis-rs",
  "MongoDB Rust Driver": "https://github.com/mongodb/mongo-rust-driver",
  "rusqlite / SQLite": "https://github.com/rusqlite/rusqlite",
  "rdkafka / librdkafka": "https://github.com/fede1024/rust-rdkafka",
  "lettre": "https://github.com/lettre/lettre",
  "trust-dns": "https://github.com/hickory-dns/hickory-dns",
  "Quinn": "https://github.com/quinn-rs/quinn",
  "tokio-tungstenite": "https://github.com/snapview/tokio-tungstenite",
  "defguard_wireguard_rs": "https://github.com/DefGuard/wireguard-rs",
  "OpenPubkey OPKSSH": "https://github.com/openpubkey/opkssh",
  "Win32 / windows-rs": "https://github.com/microsoft/windows-rs",
  "AWS SDK ecosystem": "https://github.com/awslabs/aws-sdk-rust",
  "Azure SDK ecosystem": "https://github.com/Azure/azure-sdk-for-rust",
  "Google Cloud APIs": "https://github.com/googleapis/google-cloud-rust",
  "Docker APIs": "https://github.com/fussybeaver/bollard",
  "Kubernetes APIs": "https://github.com/kube-rs/kube",
  "HashiCorp ecosystem": "https://github.com/hashicorp",
  "rustls": "https://github.com/rustls/rustls",
  "tokio-rustls": "https://github.com/rustls/tokio-rustls",
  "rustls-native-certs": "https://github.com/rustls/rustls-native-certs",
  "ring": "https://github.com/briansmith/ring",
  "RustCrypto AES-GCM": "https://github.com/RustCrypto/AEADs",
  "RustCrypto SHA-2": "https://github.com/RustCrypto/hashes",
  "RustCrypto HMAC": "https://github.com/RustCrypto/MACs",
  "PBKDF2": "https://github.com/RustCrypto/password-hashes",
  "secrecy": "https://github.com/iqlusioninc/crates",
  "zeroize": "https://github.com/RustCrypto/utils/tree/master/zeroize",
  "totp-rs": "https://github.com/constantoine/totp-rs",
  "YubiKey / FIDO2 ecosystem": "https://github.com/Yubico/yubico.rs",
  "OAuth2": "https://github.com/ramosbugs/oauth2-rs",
  "picky": "https://github.com/Devolutions/picky-rs",
  "x509-parser": "https://github.com/rusticata/x509-parser",
  "Vite": "https://github.com/vitejs/vite",
  "Vitest": "https://github.com/vitest-dev/vitest",
  "Testing Library": "https://github.com/testing-library/react-testing-library",
  "jsdom": "https://github.com/jsdom/jsdom",
  "fake-indexeddb": "https://github.com/dumbmatter/fakeIndexedDB",
  "ESLint": "https://github.com/eslint/eslint",
  "typescript-eslint": "https://github.com/typescript-eslint/typescript-eslint",
  "Prettier": "https://github.com/prettier/prettier",
  "WebdriverIO": "https://github.com/webdriverio/webdriverio",
  "WDIO Tauri Service": "https://github.com/webdriverio/webdriverio/tree/main/packages/wdio-tauri-service",
  "Turbo": "https://github.com/vercel/turborepo",
  "PostCSS": "https://github.com/postcss/postcss",
  "Autoprefixer": "https://github.com/postcss/autoprefixer",
  "Docker": "https://github.com/docker",
  "cargo-chef": "https://github.com/LukeMathWalker/cargo-chef",
  "MSYS2": "https://github.com/msys2/msys2-installer",
};

const openRepositoryUrl = (url: string) => {
  void invoke("open_url_external", { url }).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
};

const AboutSettings: React.FC = () => (
  <div className="space-y-6">
    <SectionHeading
      icon={<Info className="w-5 h-5" />}
      title="About"
      description="Application credits, maintainers, major libraries, and upstream projects used by sortOfRemoteNG."
    />

    <div
      data-setting-key="about.summary"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {SUMMARY_ITEMS.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3"
        >
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
            {item.label}
          </div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">
            {item.value}
          </div>
        </div>
      ))}
    </div>

    <div className="space-y-4" data-setting-key="about.description">
      <SectionHeader
        icon={<Info className="w-4 h-4 text-primary" />}
        title="Application Description"
      />
      <Card>
        <div className="space-y-4">
          <div className="space-y-3 text-sm leading-relaxed text-[var(--color-textSecondary)]">
            {APP_DESCRIPTION_PARAGRAPHS.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {APP_DESCRIPTION_HIGHLIGHTS.map((highlight) => {
              const HighlightIcon = highlight.icon;
              return (
                <div
                  key={highlight.title}
                  className="rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-background)]/70 p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <HighlightIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {highlight.title}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--color-textMuted)]">
                        {highlight.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>

    <div className="space-y-4" data-setting-key="about.license">
      <SectionHeader
        icon={<Scale className="w-4 h-4 text-primary" />}
        title="License & Warranty"
      />
      <Card>
        <div className="flex flex-col gap-2 text-sm text-[var(--color-textSecondary)]">
          <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
            <Archive className="w-4 h-4 text-primary" />
            MIT License, copyright 2025 Mariana Mota
          </div>
          <p>
            Third-party packages remain governed by their own licenses and notices.
            This list is a human-readable credit surface for major runtime,
            protocol, UI, build, and test dependencies.
          </p>
        </div>
      </Card>
    </div>

    {CREDIT_GROUPS.map((group) => {
      const Icon = group.icon;
      return (
        <div key={group.id} className="space-y-4" data-setting-key={`about.${group.id}`}>
          <SectionHeader
            icon={<Icon className="w-4 h-4 text-primary" />}
            title={`${group.title} (${group.items.length})`}
          />
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {group.items.map((item) => {
                const repositoryUrl = CREDIT_REPOSITORY_URLS[item.name];
                return (
                  <div
                    key={`${group.id}-${item.name}`}
                    className="rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-background)]/70 p-3"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--color-text)] break-words">
                          {item.name}
                        </div>
                        <div className="text-xs text-[var(--color-textSecondary)] break-words">
                          {item.author}
                        </div>
                      </div>
                      {item.license && (
                        <span className="max-w-full break-words rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {item.license}
                        </span>
                      )}
                      {repositoryUrl && (
                        <a
                          href={repositoryUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            event.preventDefault();
                            openRepositoryUrl(repositoryUrl);
                          }}
                          aria-label={`Open ${item.name} repository`}
                          title={`Open ${item.name} repository`}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] transition-colors hover:border-primary/60 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--color-textMuted)]">
                      {item.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      );
    })}

    <Card className="border-primary/30 bg-primary/5">
      <div className="flex items-start gap-3">
        <Code className="w-4 h-4 text-primary mt-0.5" />
        <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
          Names and license labels here are intended as a practical in-app
          acknowledgement of major dependencies. The authoritative dependency
          graph and license metadata remain in package manifests, lockfiles,
          vendored documentation, and upstream project repositories.
        </p>
      </div>
    </Card>
  </div>
);

export default AboutSettings;