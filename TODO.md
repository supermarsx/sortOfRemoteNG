# Migration to Tauri (Rust Backend) and Next.js (Frontend) - TODO

This document outlines the comprehensive steps required to migrate the sortOfRemoteNG project from its current Vite-based React web application with Node.js backend to a Tauri desktop application with Rust backend and Next.js frontend.

## Table of Contents
- [Project Setup and Initialization](#project-setup-and-initialization)
- [Frontend Migration (Vite to Next.js)](#frontend-migration-vite-to-nextjs)
- [Backend Migration (Node.js to Rust)](#backend-migration-nodejs-to-rust)
- [Feature-Specific Migrations](#feature-specific-migrations)
- [Build and Configuration Updates](#build-and-configuration-updates)
- [Testing and Validation](#testing-and-validation)
- [Documentation and Deployment](#documentation-and-deployment)

## Project Setup and Initialization

### 1. Install Tauri CLI and Prerequisites
- [ ] Install Tauri CLI globally: `npm install -g @tauri-apps/cli`
- [ ] Install Rust toolchain if not present (via rustup)
- [ ] Verify system dependencies for Tauri (Windows SDK, etc.)
- [ ] Initialize Tauri in the project: `tauri init`
- [ ] Update project structure to accommodate `src-tauri` directory

### 2. Set up Next.js
- [ ] Install Next.js and related dependencies
- [ ] Create Next.js configuration files (`next.config.js`, etc.)
- [ ] Set up TypeScript configuration for Next.js
- [ ] Configure Tailwind CSS for Next.js
- [ ] Update package.json scripts for Next.js development

### 3. Project Structure Restructuring
- [ ] Move current `src/` to `frontend/` or similar
- [ ] Create `src-tauri/src/` for Rust code
- [ ] Set up shared types/interfaces between frontend and backend
- [ ] Update import paths throughout the codebase

## Frontend Migration (Vite to Next.js)

### 4. Convert React Components
- [ ] Migrate `App.tsx` to Next.js App Router structure
- [ ] Convert pages to Next.js pages (e.g., `pages/index.tsx`)
- [ ] Update routing from React Router to Next.js routing
- [ ] Handle static assets migration
- [ ] Update component imports and exports

### 5. Update Build Configuration
- [ ] Replace Vite config with Next.js config
- [ ] Update PostCSS and Tailwind configurations for Next.js
- [ ] Configure Tauri to build Next.js frontend
- [ ] Update ESLint configuration for Next.js

### 6. Handle Browser-specific Features
- [ ] Review and update components that rely on browser APIs
- [ ] Ensure compatibility with Tauri's webview
- [ ] Update service workers or PWA features if any

## Backend Migration (Node.js to Rust)

### 7. Set up Rust Project Structure
- [ ] Initialize Cargo.toml with necessary dependencies
- [ ] Set up Tauri configuration (`tauri.conf.json`)
- [ ] Create main.rs and lib.rs files
- [ ] Set up error handling and logging in Rust

### 8. Migrate Authentication System ✅
- ✅ Implement JWT token handling in Rust (using `jsonwebtoken` crate)
- ✅ Migrate bcrypt password hashing to Rust (using `bcrypt` crate)
- ✅ Create Tauri commands for authentication
- ✅ Update user store (from JSON/file to Rust structures)

### 9. Migrate Data Storage ✅
- ✅ Replace IndexedDB usage with Tauri's filesystem APIs
- ✅ Migrate local storage mechanisms to file-based storage in Rust
- ✅ Implement secure storage for sensitive data in Rust (password-based encryption pending)
- ✅ Update frontend storage service to use Tauri IPC
- ✅ Create Rust storage service with async file operations

### 10. Migrate Server-side Logic
- [ ] Replace Express.js routes with Tauri commands
- [ ] Migrate middleware (CORS, Helmet) to Rust equivalents
- [ ] Handle WebSocket connections in Rust (using `tokio-tungstenite` or similar)
- [ ] Migrate cron jobs to Rust (using `tokio-cron` or similar)

## Feature-Specific Migrations

### 11. SSH and Terminal Features 🚧
- ✅ Add Rust SSH crate (`ssh2`)
- ✅ Create basic SSH service module in Rust with placeholder functions
- ✅ Add Tauri commands for SSH connect/execute/disconnect
- [ ] Implement actual SSH connection logic using ssh2 crate
- [ ] Migrate WebTerminal component to use Tauri IPC
- [ ] Implement SSH key management in Rust
- [ ] Handle terminal resizing and interactions

### 12. RDP and VNC Clients 🚧
- ✅ Add Rust RDP crate (`rdp`)
- ✅ Create basic RDP service module in Rust with placeholder functions
- ✅ Add Tauri commands for RDP connect/disconnect
- ✅ Add Rust VNC crate (`vnc`)
- ✅ Create basic VNC service module in Rust with placeholder functions
- ✅ Add Tauri commands for VNC connect/disconnect
- [ ] Implement actual RDP connection logic using rdp crate
- [ ] Implement actual VNC connection logic using vnc crate
- [ ] Update canvas rendering for Tauri's webview

### 13. Database Connections 🚧
- ✅ Add Rust MySQL crate (`sqlx` with MySQL feature)
- ✅ Create basic DB service module in Rust with MySQL connection pooling
- ✅ Add Tauri commands for MySQL connect/execute/disconnect
- [ ] Implement actual query execution logic
- [ ] Migrate MySQLClient component to use IPC

### 14. File Transfer and FTP 🚧
- ✅ Add Rust FTP crate (`suppaftp`)
- ✅ Create basic FTP service module in Rust with connection and listing
- ✅ Add Tauri commands for FTP connect/list/disconnect
- [ ] Implement file upload/download logic
- [ ] Add SFTP support using ssh2
- [ ] Update FileTransferManager to use Tauri commands

### 15. Network Discovery and Scanning 🚧
- ✅ Add Rust ping crate (`tokio-ping`)
- ✅ Create basic network service module in Rust with ping and scan placeholders
- ✅ Add Tauri commands for ping and network scan
- [ ] Implement actual ping functionality using tokio-ping
- [ ] Implement actual network scanning logic
- [ ] Update NetworkDiscovery component

### 16. Security Features 🚧
- ✅ Add Rust TOTP crate (`totp-rs`)
- ✅ Create basic security service module in Rust with TOTP and encryption placeholders
- ✅ Add Tauri commands for TOTP generation/verification and data encryption/decryption
- [ ] Implement actual encryption/decryption logic using proper crypto
- [ ] Update secure storage mechanisms to use Rust encryption

### 17. Wake-on-LAN 🚧
- ✅ Create basic WOL service module in Rust with placeholder
- ✅ Add Tauri command for wake_on_lan
- [ ] Implement actual Wake-on-LAN logic using UDP packets

### 18. QR Code Generation
- [ ] Replace `qrcode` with Rust QR code library
- [ ] Implement QR code generation in backend

## Build and Configuration Updates

### 19. Update Build Scripts
- [ ] Modify package.json scripts for Tauri build process
- [ ] Configure Next.js build to work with Tauri
- [ ] Set up development scripts for both frontend and backend

### 20. Dependency Management
- [ ] Remove Node.js specific dependencies
- [ ] Add Rust crate dependencies
- [ ] Update dev dependencies for Next.js and Tauri

### 21. Configuration Files
- [ ] Update TypeScript configs for Next.js
- [ ] Configure Tauri build settings
- [ ] Update ESLint and Prettier configs

### 22. Environment and Secrets
- [ ] Set up environment variable handling in Rust
- [ ] Configure secure storage for API keys and secrets
- [ ] Update .env file handling

## Testing and Validation

### 23. Update Test Suite
- [ ] Migrate Vitest tests to Next.js compatible testing
- [ ] Add Rust unit tests using standard Rust testing framework
- [ ] Update integration tests for Tauri IPC
- [ ] Test desktop-specific features

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
- [ ] Rewrite README for Tauri + Next.js setup
- [ ] Update installation instructions
- [ ] Document development workflow
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