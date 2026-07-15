---
title: Architecture
eyebrow: Project guide
description: Follow a saved connection from the React editor through typed hooks and the Tauri command boundary into focused Rust crates.
permalink: /architecture/
---

sortOfRemoteNG is a Tauri desktop application with a Next.js and React webview and a Rust backend workspace. The boundary is deliberate: the frontend owns presentation and orchestration state, while native networking, storage, platform APIs, and protocol engines stay behind registered Tauri commands.

## Runtime layers

| Layer                      | Primary locations                                                    | Responsibility                                                                          |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Application shell          | `app/`, `src/components/`                                            | Navigation, editor surfaces, session tabs, dialogs, and responsive UI                   |
| Frontend contracts         | `src/types/`, `src/hooks/`, `src/utils/`                             | Typed connection models, normalization, persistence orchestration, and command wrappers |
| Tauri composition          | `src-tauri/src/`, `src-tauri/crates/sorng-app-*`, `sorng-commands-*` | Application state, command registration, IPC validation, and feature composition        |
| Domain and protocol crates | `src-tauri/crates/sorng-*`                                           | Protocol engines, storage, encryption, integrations, and platform-specific work         |
| Verification               | `tests/`, `e2e/`, crate tests, `.github/workflows/`                  | Unit, integration, desktop E2E, release, and platform gates                             |

## Connection lifecycle

1. The editor normalizes a protocol-aware connection record and saves it to the selected database.
2. Opening the record creates session state and selects a protocol or integration presentation.
3. Typed frontend hooks invoke a narrow registered Tauri command rather than exposing privileged primitives directly.
4. The command layer validates input, resolves referenced configuration, and delegates to the owning Rust crate.
5. Runtime events flow back into session state and optional [Behavior rules]({{ '/behaviors/' | relative_url }}).
6. Closing the session releases protocol resources and any prepared [Network Path]({{ '/network-paths/' | relative_url }}).

## Boundary rules

- A backend crate is not automatically reachable: its commands must be composed and registered.
- A registered command is not automatically a product feature: the frontend must provide a complete, validated workflow.
- Importer recognition does not imply a session implementation.
- Detached windows receive the minimum dependency snapshot they need; secrets should not be copied into general UI state.
- New protocol paths should own cleanup, error translation, and focused tests alongside connection setup.

These rules explain the conservative labels in the [protocol matrix]({{ '/protocols/' | relative_url }}).

## Architectural records

- [OPKSSH in-process boundary and dylink decision]({{ '/architecture/opkssh-dylink-adr/' | relative_url }}) records why the project keeps a narrow library seam and CLI fallback without prematurely freezing a shared-library ABI.
- [OPKSSH library contract]({{ '/architecture/opkssh-lib-contract/' | relative_url }}) describes the wrapper-facing contract and ownership boundaries.

## Adding a cross-boundary feature

Start with the smallest typed contract that represents the user workflow. Place input validation near the privileged boundary, keep protocol implementation in its domain crate, register only the commands required by the UI, and add tests at both the normalization and native boundary when behavior spans them.

Use [Testing]({{ '/testing/' | relative_url }}) to choose proportionate gates and [Security]({{ '/security-overview/' | relative_url }}) when the feature handles credentials, remote input, files, or update artifacts.
