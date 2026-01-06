# Migration to Tauri (Rust Backend) and Vite (Frontend) - TODO

This document outlines the comprehensive steps required to migrate the sortOfRemoteNG project from its current Vite-based React web application with Node.js backend to a Tauri desktop application with Rust backend and Vite frontend.

## Table of Contents
- [Project Setup and Initialization](#project-setup-and-initialization)
- [Frontend Migration (Vite to Vite)](#frontend-migration-vite-to-vite)
- [Backend Migration (Node.js to Rust)](#backend-migration-nodejs-to-rust)
- [Feature-Specific Migrations](#feature-specific-migrations)
- [Build and Configuration Updates](#build-and-configuration-updates)
- [Testing and Validation](#testing-and-validation)
- [Documentation and Deployment](#documentation-and-deployment)

## User Requested Backlog
- [x] Add startup settings: start minimized, start maximized, reconnect previous session connections
- [x] Add tray behavior: minimize to notification area and close to notification area
- [x] Add single-click actions: open connection on single click; disconnect on single click
- [x] Auto-save connection edits without requiring manual save
- [x] Auto-open last collection on startup (with toggle setting)
- [ ] Add cloud sync targets for Google Drive, Nextcloud, and OneDrive
- [ ] Add differential backup scheduling (daily and on-demand runs)
- [ ] Add custom CSS tips plus theme import/export and custom theme manager
- [ ] Add Serpent and Twofish encryption schemes
- [x] Add global animation toggle with smooth motion defaults
- [x] Allow resizing/adjusting layout matrices
- [x] Desktop shortcut manager with tracking, editing, and folder presets
- [x] Connection diagnostics (ping, traceroute, port checks, gateway/internet tests)
- [x] mRemoteNG XML file import support
- [x] Template downloads with toast notifications
- [x] WebBrowser proxy auth fix for image loading
- [ ] Remove outer glow from Wake on LAN window
- [ ] Fix warn on closing main app (currently closes directly without warning)
- [ ] Add edit button to bulk connection editor to open full editing popup for connection
- [ ] Revamp performance metrics UI with user-friendly graphs (lightweight)
- [ ] Add filters for action log
- [ ] Match popup title icons with their secondary bar icons
- [ ] In performance metrics move update cadence and export button to secondary bar, add filters
- [ ] Remove language selector from secondary bar settings (no longer exists)
- [ ] Add syncing capabilities with extensive settings in a new settings tab
- [ ] Add config to settings welcome screen for custom title and custom message
- [ ] Add disconnect button to SSH container
- [ ] Add proxy collection management (adding, saving, editing, chaining) to Proxies and VPNs popup
- [ ] Add chaining management to create, delete and edit chains
- [ ] Fix light theme hover effects (non-existent on many elements)
- [ ] Fix light theme hover effects on Wake on LAN buttons
- [ ] Fix settings popup light theme compatibility (button hovers, group input boxes too dark)
- [ ] Move quick start message in layout to a new more adequate group
- [ ] Make HTTP basic auth fully handled by backend (never frontend), avoid browser auth windows
- [ ] Add proxy and VPN profiles management to Collections Center (with chaining, import/export)
- [ ] Add bulk Wake on LAN request functionality
- [ ] Add wake everything on LAN function
- [ ] Add Wake on LAN scripting and scheduled wake functionality
- [ ] Add connection list filters/sorting (user preference, creation, modification, recently used, alphabetical, by protocol)

## Project Setup and Initialization

### 1. Install Tauri CLI and Prerequisites
- [x] Install Tauri CLI globally: `npm install -g @tauri-apps/cli`
- [x] Install Rust toolchain if not present (via rustup)
- [x] Verify system dependencies for Tauri (Windows SDK, etc.)
- [x] Initialize Tauri in the project: `tauri init`
- [x] Update project structure to accommodate `src-tauri` directory

### 2. Set up Vite (Kept as is)
- [x] Vite was already configured
- [x] Updated scripts to use Vite for dev/build

### 3. Project Structure Restructuring
- [x] Kept `src/` for React code
- [x] Created `src-tauri/src/` for Rust code
- [x] Set up shared types/interfaces between frontend and backend
- [x] Updated import paths throughout the codebase

## Frontend Migration (Vite to Vite)

### 4. Convert React Components
- [x] `App.tsx` works with Vite
- [x] Routing handled by React Router (no change needed)
- [x] Static assets work with Vite
- [x] Component imports and exports updated

### 5. Update Build Configuration
- [x] Kept Vite config
- [x] Updated PostCSS and Tailwind configurations for Vite
- [x] Configure Tauri to build Vite frontend
- [x] Updated ESLint configuration for Vite

### 6. Handle Browser-specific Features
- [ ] Review and update components that rely on browser APIs
- [ ] Ensure compatibility with Tauri's webview
- [ ] Update service workers or PWA features if any

## Backend Migration (Node.js to Rust)

### 7. Set up Rust Project Structure
- [x] Initialize Cargo.toml with necessary dependencies
- [x] Set up Tauri configuration (`tauri.conf.json`)
- [x] Create main.rs and lib.rs files
- [x] Set up error handling and logging in Rust

### 8. Migrate Authentication System ✅
- [x] Implement JWT token handling in Rust (using `jsonwebtoken` crate)
- [x] Migrate bcrypt password hashing to Rust (using `bcrypt` crate)
- [x] Create Tauri commands for authentication
- [x] Update user store (from JSON/file to Rust structures)

### 9. Migrate Data Storage ✅
- [x] Replace IndexedDB usage with Tauri's filesystem APIs
- [x] Migrate local storage mechanisms to file-based storage in Rust
- [x] Implement secure storage for sensitive data in Rust (password-based encryption pending)
- [x] Update frontend storage service to use Tauri IPC
- [x] Create Rust storage service with async file operations

### 10. Migrate Server-side Logic
- [x] Replace Express.js routes with Tauri commands
- [x] Migrate middleware (CORS, Helmet) to Rust equivalents (not needed in Tauri)
- [x] Handle WebSocket connections in Rust (not applicable for desktop)
- [x] Migrate cron jobs to Rust (not needed for desktop)

## Feature-Specific Migrations

### 11. SSH and Terminal Features ✅
- [x] Add Rust SSH crate (`ssh2`)
- [x] Create basic SSH service module in Rust with placeholder functions
- [x] Add Tauri commands for SSH connect/execute/disconnect
- [x] Implement actual SSH connection logic using ssh2 crate
- [x] Migrate WebTerminal component to use Tauri IPC (pending)
- [x] Implement SSH key management in Rust
- [x] Add SSH Key Manager frontend component
- [ ] Handle terminal resizing and interactions

### 12. RDP and VNC Clients (Partially Implemented)
- [x] Add Rust RDP crate (`rdp`)
- [x] Create basic RDP service module in Rust with TCP connection
- [x] Add Tauri commands for RDP connect/disconnect
- [x] Add Rust VNC crate (`vnc`)
- [x] Create basic VNC service module in Rust with TCP connection
- [x] Add Tauri commands for VNC connect/disconnect
- [ ] **RDP Protocol Implementation**: Implement full RDP protocol handling (bitmaps, input, capabilities)
- [ ] **VNC Protocol Implementation**: Implement full VNC/RFB protocol handling (framebuffer updates, encodings)
- [ ] **Canvas Rendering**: Wire up backend protocol events to frontend Canvas API
- [ ] **Input Handling**: Forward keyboard/mouse events from frontend to backend protocol handlers

### 13. Database Connections ✅
- ✅ Add Rust MySQL crate (`sqlx` with MySQL feature)
- ✅ Create basic DB service module in Rust with MySQL connection pooling
- ✅ Add Tauri commands for MySQL connect/execute/disconnect
- ✅ Implement actual query execution logic
- [x] Migrate MySQLClient component to use IPC (service updated, tests pending backend)
- [x] **Connection Tunneling**: Implemented SSH tunnel support for database connections
- [x] Add phpMyAdmin-like management features (database/table CRUD, data editing, export)
- [x] **Import functionality**: Added SQL and CSV import commands

### 14. File Transfer and FTP ✅
- ✅ Add Rust FTP crate (`suppaftp`)
- ✅ Create basic FTP service module in Rust with connection and listing
- ✅ Add Tauri commands for FTP connect/list/disconnect
- ✅ Implement file upload/download logic
- [x] **ADD SFTP SUPPORT**: Implemented SFTP using ssh2 crate with connect/list functionality
- [ ] Update FileTransferManager to use Tauri commands
- [ ] **FULL SFTP SUPPORT**: Complete file upload/download for SFTP
- [ ] **SMB Client**: Implement SMB/CIFS protocol backend (currently missing)
- [ ] **FTP OVER SSH TUNNELING**: SSH port forwarding for FTP connections
- [ ] **FTP OVER HTTP/HTTPS**: HTTP proxy support for FTP connections

### 15. Network Discovery and Scanning ✅
- ✅ Add Rust ping crate (`tokio-ping`)
- ✅ Create basic network service module in Rust with ping and scan placeholders
- ✅ Add Tauri commands for ping and network scan
- ✅ Implement actual ping functionality using system ping
- ✅ Implement actual network scanning logic
- [x] **FULLY IMPLEMENT NETWORK DISCOVERY**: Added port scanning, service detection, hostname resolution, MAC address lookup
- [x] Update NetworkDiscovery component to use Tauri IPC (basic implementation done, needs enhancement)
- [x] **ADD ADVANCED NETWORK FEATURES**: Traceroute, ping with detailed results, gateway detection, port checking for diagnostics

### 15.5. VPN Integration (CLI Wrappers)
- [x] **OpenVPN**: Wrapper structure created, CLI execution stubbed.
- [x] **WireGuard**: Wrapper structure created, CLI execution stubbed.
- [ ] **Full Implementation**: Complete the CLI wrapper logic to correctly spawn and manage VPN processes.
- [ ] **State Management**: Track connection status and handle unexpected disconnections.
- [ ] **Log Parsing**: Parse stdout/stderr from VPN tools to report status/errors to UI.

### 15.6. Wake-on-LAN Functionality ✅
- ✅ Create basic WOL service module in Rust with placeholder
- ✅ Add Tauri command for wake_on_lan
- ✅ Implement actual Wake-on-LAN logic using UDP packets
- [x] **SecureOn Password Support**: Added 108-byte packets with 6-byte password
- [x] **WOL Discovery**: Added ARP table scanning to discover network devices
- [x] **WOL Quick Tool**: Added toolbar button and popup for quick WOL access
- [x] **WOL Scheduling**: Added schedule management commands for scheduled wakes
- [ ] **Wake-on-pattern**: Support for wake-on-pattern feature

### 15.8. QR Code Generation ✅
- [x] **ADD QR CODE CRATE**: Add `qrcode` and `image` Rust crates to dependencies
- [x] **IMPLEMENT QR GENERATION**: Create Tauri command for generating QR codes (SVG and PNG formats)
- [x] **ADD QR FEATURES**: Support for different formats, error correction levels, custom sizing
- [x] **INTEGRATE WITH CONNECTIONS**: Generate QR codes for connection sharing/import

### 15.9. Script Execution Engine ✅
- [x] **ADD JS RUNTIME CRATE**: Add `rquickjs` crate for embedded JavaScript execution
- [x] **IMPLEMENT SCRIPT SERVICE**: Create Rust service to handle script execution requests
- [x] **MIGRATE SCRIPT ENGINE**: Update frontend `ScriptEngine` to offload execution to Tauri backend
- [x] **SECURE EXECUTION**: Implement basic sandboxing and context isolation in Rust
- [x] **SSH INTEGRATION**: Implemented `ssh` global object (connect/exec/disconnect) in script runtime.
- [x] **ASYNC SUPPORT**: Refactored to use dedicated thread with local Tokio runtime to support async operations without blocking.
- [ ] **TYPESCRIPT SUPPORT**: Move TypeScript compilation to backend or improve frontend transpilation pipeline
- [ ] **EXPAND API**: Expose more internal APIs (DB, File, HTTP) to the script runtime safely
- [ ] **LONG-RUNNING SCRIPTS**: Improve handling of long-running scripts and timeouts in Rust

### 15.10. RustDesk Remote Desktop Integration (Skeleton)
- [x] **ADD RUSTDESK SERVICE**: Create comprehensive RustDesk service module with process management
- [x] **IMPLEMENT PROCESS SPAWNING**: Add tokio process management for RustDesk binary execution
- [x] **ADD TAURI COMMANDS**: Create IPC commands for connect/disconnect/session management
- [ ] **Actual Integration**: The current frontend is a UI mock. Needs to actually control the RustDesk process or integrate via API.
- [ ] **Binary Management**: Mechanism to download/locate the RustDesk binary on the user's system.

### 16. Security Features ✅
- ✅ Add Rust TOTP crate (`totp-rs`)
- ✅ Create basic security service module in Rust with TOTP and encryption placeholders
- ✅ Add Tauri commands for TOTP generation/verification and data encryption/decryption
- ✅ Implement actual encryption/decryption logic using AES-256-GCM
- [ ] Update secure storage mechanisms to use Rust encryption

### 17. Connection Chaining & Proxying
- [ ] **Implementation**: Implement the logic to route connections (SSH, DB, etc.) through the configured proxy/VPN chains.
- [ ] **UI Integration**: Ensure the frontend correctly passes chain configurations to the backend.

## Build and Configuration Updates

### 19. Update Build Scripts
- [x] Modify package.json scripts for Tauri build process
- [x] Configure Vite build to work with Tauri
- [x] Set up development scripts for both frontend and backend

### 20. Dependency Management
- [x] Remove Node.js specific dependencies
- [x] Add Rust crate dependencies
- [x] Update dev dependencies for Vite and Tauri

### 21. Configuration Files
- [ ] Update TypeScript configs for Vite
- [ ] Configure Tauri build settings
- [ ] Update ESLint and Prettier configs

### 22. Environment and Secrets
- [ ] Set up environment variable handling in Rust
- [ ] Configure secure storage for API keys and secrets
- [ ] Update .env file handling

## Testing and Validation

### 23. Update Test Suite
- [x] Migrate Vitest tests to Vite compatible testing
- [ ] Add Rust unit tests using standard Rust testing framework
- [ ] Update integration tests for Tauri IPC
- [x] Test desktop-specific features (252 tests passing)

### 24. Cross-platform Testing
- [ ] Test on Windows, macOS, and Linux
- [ ] Validate all remote connection features
- [ ] Performance testing for desktop application

### 25. Security Audit
- [ ] Review Rust code for security vulnerabilities
- [ ] Ensure proper sandboxing in Tauri
- [ ] Validate secure storage implementations

## Documentation and Deployment

### 26. Update Documentation
- [x] Rewrite README for Tauri + Vite setup
- [x] Update installation instructions
- [x] Document development workflow
- [ ] Create migration guide for existing users

### 27. Packaging and Distribution
- [ ] Configure Tauri for app packaging
- [ ] Set up auto-updater functionality
- [ ] Create installers for different platforms

### 28. CI/CD Updates
- [ ] Update GitHub Actions for Rust and Tauri builds
- [ ] Configure cross-platform builds
- [ ] Update release process

### 29. Final Validation
- [ ] End-to-end testing of all features
- [ ] Performance benchmarking
- [ ] User acceptance testing

## Additional Considerations

### 30. Performance Optimizations
- [ ] Optimize bundle size for desktop application
- [ ] Implement lazy loading where appropriate
- [ ] Profile and optimize Rust backend performance

### 31. Error Handling and Logging
- [ ] Implement comprehensive error handling in Rust
- [ ] Set up logging system for both frontend and backend
- [ ] Create user-friendly error messages

### 32. Internationalization
- [ ] Ensure i18n works with Next.js
- [ ] Update translation loading for desktop app

### 33. Accessibility and UI/UX
- [ ] Review UI components for desktop-specific interactions
- [ ] Ensure keyboard navigation works properly
- [ ] Update responsive design for desktop windows

This TODO list provides a comprehensive roadmap for the migration. Each item should be broken down into specific tasks and tracked individually. The migration is complex and should be done incrementally, with thorough testing at each stage.
