# RDP Lifecycle, Virtual Channels, and Frame Flow Improvement Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Planning Constraints](#2-planning-constraints)
3. [Current State Summary](#3-current-state-summary)
4. [Target Architecture](#4-target-architecture)
5. [Workstream 1: Lifecycle State Machine](#5-workstream-1-lifecycle-state-machine)
6. [Workstream 2: Virtual Channel Manager](#6-workstream-2-virtual-channel-manager)
7. [Workstream 3: Backpressure Frame Flows](#7-workstream-3-backpressure-frame-flows)
8. [Workstream 4: Diagnostics and Observability](#8-workstream-4-diagnostics-and-observability)
9. [Workstream 5: Security and Correctness Gates](#9-workstream-5-security-and-correctness-gates)
10. [File-by-File Change Map](#10-file-by-file-change-map)
11. [Testing Strategy](#11-testing-strategy)
12. [Phased Rollout](#12-phased-rollout)
13. [Success Metrics](#13-success-metrics)
14. [Risks and Mitigations](#14-risks-and-mitigations)
15. [Open Decisions](#15-open-decisions)
16. [Completion Execution Tracker](#16-completion-execution-tracker)

---

## 1. Executive Summary

The current RDP implementation already has strong foundations:

- A Rust RDP backend in `src-tauri/crates/sorng-rdp/` built on IronRDP.
- A separate heavy vendor crate, `src-tauri/crates/sorng-rdp-vendor/`, to isolate the IronRDP and codec dependency graph.
- A per-session runner in `src-tauri/crates/sorng-rdp/src/rdp/session_runner.rs`.
- Efficient wake signaling in `src-tauri/crates/sorng-rdp/src/rdp/wake_channel.rs` and `src-tauri/crates/sorng-rdp/src/rdp/session_poller.rs`.
- Binary frame delivery through `src-tauri/crates/sorng-rdp/src/rdp/frame_channel.rs`.
- Frontend render scheduling in `src/components/rdp/rdpFramePipeline.ts` and renderer abstraction in `src/components/rdp/rdpRenderers.ts`.
- Protocol-specific channel modules such as `src-tauri/crates/sorng-rdp/src/rdp/rdpdr/mod.rs`, `src-tauri/crates/sorng-rdp/src/rdp/clipboard.rs`, and `src-tauri/crates/sorng-rdp/src/rdp/audin.rs`.

The next architecture step is to stop treating RDP as a single long-running loop with several side modules. RDP should be modeled as three coordinated systems:

| System            | Current shape                                                             | Target shape                                                                                                         |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Session lifecycle | Mostly implicit in `session_runner.rs`, with phase stats in `stats.rs`    | Explicit typed lifecycle state machine with guarded transitions and observable state snapshots                       |
| Virtual channels  | Per-module channel behavior with no central lifecycle or dependency graph | Unified virtual channel manager with channel state, lifecycle hooks, fault isolation, and channel-level flow budgets |
| Frame delivery    | Backend pushes frames; frontend schedules and renders from bounded queues | Credit/backpressure-aware frame flow with render telemetry, bounded buffers, coalescing, and diagnostics             |

This plan uses the useful historical lesson from old Terminal Services/RDP architecture: lifecycle, channels, and flow control need to be first-class. It does not copy old NT5-era implementation details, protocol code, crypto, constants, or assumptions. The goal is to make the existing IronRDP-based client more resilient, observable, testable, and ready for beta-quality RDP sessions.

---

## 2. Planning Constraints

### 2.1 Non-negotiable constraints

- Do not fork or rewrite IronRDP protocol internals unless upstream limitations make it unavoidable.
- Do not copy code from external historical source trees.
- Preserve the `sorng-rdp-vendor` dynamic-linking boundary.
- Keep Tauri commands fast; long-running RDP work stays inside per-session actors.
- Preserve Canvas2D as the reliable rendering fallback while improving GPU and worker paths.
- Avoid unbounded backend queues, frontend queues, frame stores, virtual channel buffers, or diagnostics buffers.
- Every lifecycle or channel refactor must include regression tests before it is considered complete.

### 2.2 What this plan optimizes for

- Fewer hung sessions during activation, reactivation, reconnect, detach, and shutdown.
- Channel behavior that is inspectable and recoverable instead of hidden inside protocol modules.
- Predictable memory use when the frontend renderer lags or a session produces bursty graphics.
- Better compatibility with self-signed RDP servers without silently weakening trust behavior.
- A path to richer diagnostics for users and developers.

### 2.3 What this plan does not assume

- That all legacy RDP servers must be supported equally.
- That frame drops are always acceptable.
- That every virtual channel can be reset the same way during reactivation.
- That a single global queue policy is sufficient for graphics, pointer, input, clipboard, audio, and drive redirection.
- That live Docker/xrdp tests can cover every server-side RDP edge case.

---

## 3. Current State Summary

### 3.1 Session lifecycle

The current session lifecycle is centered on `src-tauri/crates/sorng-rdp/src/rdp/session_runner.rs`. The runner owns connection setup, activation, output processing, command handling, reactivation behavior, reconnect decisions, and teardown.

`src-tauri/crates/sorng-rdp/src/rdp/stats.rs` already has useful phase concepts, but those phases are closer to instrumentation than the source of truth for session control.

Strengths:

- Reactivation is already recognized as a meaningful protocol event.
- Reconnect behavior has a testable shape.
- Session polling has moved away from timeout polling toward wake-driven behavior.
- The per-session actor model aligns with the app architecture in `ARCHITECTURE.md`.

Weaknesses:

- Valid and invalid lifecycle transitions are not centrally declared.
- Error handling does not always carry enough context about the phase where the failure happened.
- Frontend status events can lag behind actual backend state.
- Detach/reattach, reactivation, reconnect, and disconnect are separate concerns in code even though they affect the same lifecycle graph.

### 3.2 Virtual channels

Virtual channel behavior is currently distributed across feature modules:

- Device redirection: `src-tauri/crates/sorng-rdp/src/rdp/rdpdr/mod.rs`.
- Clipboard: `src-tauri/crates/sorng-rdp/src/rdp/clipboard.rs`.
- Audio: `src-tauri/crates/sorng-rdp/src/rdp/audin.rs`.
- Graphics dynamic channels: `src-tauri/crates/sorng-rdp/src/gfx/processor.rs`.

Strengths:

- Channel modules are already separated by capability.
- RDPDR has its own state machine and tests.
- Clipboard and drive redirection have focused protocol ownership.

Weaknesses:

- There is no single registry of enabled channels, disabled channels, failed channels, and ready channels.
- Channel lifecycle is not consistently tied to session lifecycle.
- Channel dependency order is implicit.
- Channel failure isolation is not formalized.
- Channel buffering and flow policy are not coordinated.

### 3.3 Frame flow

Frame flow crosses both backend and frontend code:

- Backend output processing: `src-tauri/crates/sorng-rdp/src/rdp/frame_delivery.rs`.
- Backend binary transport: `src-tauri/crates/sorng-rdp/src/rdp/frame_channel.rs`.
- Backend persistence/snapshot support: `src-tauri/crates/sorng-rdp/src/rdp/frame_store.rs`.
- Frontend scheduling: `src/components/rdp/rdpFramePipeline.ts`.
- Frontend renderers: `src/components/rdp/rdpRenderers.ts`.

Strengths:

- Binary frame delivery avoids JSON overhead.
- Frontend rendering already has multiple implementation paths.
- Frame persistence enables detach/reattach and snapshots.
- The frontend pipeline already has queue limits and scheduling modes.

Weaknesses:

- Backend delivery is not credit-aware.
- The backend does not have a first-class view of frontend render latency.
- Coalescing/drop policy is not explicit enough for bursty graphics.
- Frame store and live frame transport need separate budgets.
- Diagnostics do not expose enough queue, drop, latency, or memory information.

### 3.4 Known bugs and gating issues to fold into this effort

The architecture work should include or depend on closing these existing RDP issues:

| Issue                                     | Why it matters to this plan                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Worker/WebCodecs `toDataView()` scope bug | Frame-flow work must not build on a broken fast path.                                   |
| `drive_redirection_enabled` no-op         | Virtual channel manager needs trustworthy enable/disable gates.                         |
| Certificate trust prompt gap              | Lifecycle errors should distinguish trust failure, user rejection, and network failure. |
| Plaintext RDP password lifetime           | Lifecycle state snapshots and diagnostics must never retain secrets.                    |

---

## 4. Target Architecture

### 4.1 Target layering

```text
Frontend React/Tauri
  |
  | commands, frame acks, render telemetry, detach/attach events
  v
RDP Session Actor
  |
  +-- LifecycleStateMachine
  |     owns session state, guarded transitions, terminal reason
  |
  +-- VirtualChannelManager
  |     owns channel registry, channel states, channel lifecycle hooks
  |
  +-- FrameFlowController
  |     owns frame credits, queue budgets, coalescing, render feedback
  |
  +-- IronRDP active stage
        owns protocol encode/decode and server interaction
```

### 4.2 Design principles

1. The lifecycle state machine is the source of truth for session state.
2. Virtual channels follow lifecycle transitions instead of inventing their own session model.
3. Frame flow is bounded at every boundary: protocol output, backend transport, frame store, Tauri channel, frontend queue, renderer.
4. Input, pointer, and control-plane messages have different priority from bulk graphics and file redirection.
5. Diagnostics report state snapshots, not secrets or raw protocol payloads.
6. Every new state or queue policy has a focused unit test.

### 4.3 Target runtime responsibilities

| Runtime component       | Owns                                                                               | Does not own                                                   |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `LifecycleStateMachine` | Session state, transition rules, failure classification, state snapshots           | Protocol parsing, virtual channel payloads, renderer details   |
| `VirtualChannelManager` | Channel registry, channel state, channel routing, init ordering, failure isolation | Raw IronRDP transport, frontend rendering                      |
| `FrameFlowController`   | Frame budgets, backpressure state, drop/coalesce policy, render telemetry          | Protocol negotiation, clipboard/device messages                |
| `session_runner.rs`     | Actor orchestration and integration with IronRDP                                   | Ad hoc hidden state decisions that belong to the state machine |
| Frontend RDP pipeline   | Render scheduling, render telemetry, visible diagnostics                           | Backend lifecycle decisions                                    |

---

## 5. Workstream 1: Lifecycle State Machine

### 5.1 Goal

Make RDP session lifecycle explicit, typed, observable, and testable. The session runner should dispatch events into a state machine and act on transition outcomes instead of manually coordinating scattered phase flags.

### 5.2 Proposed state model

Add a new module:

- `src-tauri/crates/sorng-rdp/src/rdp/session_state.rs`

Core enum shape:

```rust
pub enum SessionState {
    Idle,
    Resolving,
    Connecting,
    NegotiatingSecurity,
    Authenticating,
    Activating,
    Active(ActiveSubstate),
    Reactivating(ReactivationContext),
    Reconnecting(ReconnectContext),
    Draining(DrainReason),
    Disconnecting(DisconnectReason),
    Terminated(TerminationReason),
}
```

Active substates:

```rust
pub enum ActiveSubstate {
    Running,
    FrontendDetached,
    FrontendBackpressured,
    ChannelsRecovering,
    ServerIdle,
}
```

Important event types:

```rust
pub enum SessionEvent {
    UserConnect,
    TcpConnected,
    TlsReady,
    CredSspReady,
    ActivationStarted,
    ActivationComplete,
    DeactivateAllReceived,
    ReactivationComplete,
    FrontendDetached,
    FrontendAttached,
    BackpressureRaised,
    BackpressureCleared,
    ChannelFault { channel: ChannelName },
    ChannelRecovered { channel: ChannelName },
    NetworkLost,
    ReconnectTimerElapsed,
    UserDisconnect,
    ServerClosed,
    FatalError { class: FailureClass },
}
```

Transition result:

```rust
pub struct TransitionOutcome {
    pub previous: SessionState,
    pub next: SessionState,
    pub actions: Vec<SessionAction>,
    pub emitted_snapshot: SessionStateSnapshot,
}
```

The state machine returns actions. The runner executes them.

Examples:

- `ActivationComplete` from `Activating` returns `EnterActive`, `InitializeVirtualChannels`, and `EmitStateSnapshot`.
- `DeactivateAllReceived` from `Active(_)` returns `PauseFrameDelivery`, `DeactivateChannels`, and `StartReactivation`.
- `NetworkLost` from `Active(_)` returns `FreezeFrameStore`, `MarkChannelsSuspended`, and `StartReconnectTimer`.
- `UserDisconnect` from any non-terminal state returns `DrainQueues`, `CloseChannels`, and `CloseTransport`.

### 5.3 Transition table

| Current state                   | Event                       | Next state                      | Required actions                                                     |
| ------------------------------- | --------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `Idle`                          | `UserConnect`               | `Resolving`                     | Resolve host, emit connecting snapshot                               |
| `Resolving`                     | host resolved               | `Connecting`                    | Open TCP transport                                                   |
| `Connecting`                    | `TcpConnected`              | `NegotiatingSecurity`           | Start X.224/TLS/CredSSP path                                         |
| `NegotiatingSecurity`           | `TlsReady` / `CredSspReady` | `Authenticating`                | Continue auth and cert policy handling                               |
| `Authenticating`                | auth complete               | `Activating`                    | Run RDP activation sequence                                          |
| `Activating`                    | `ActivationComplete`        | `Active(Running)`               | Init channels, start frame flow                                      |
| `Active(_)`                     | `DeactivateAllReceived`     | `Reactivating`                  | Pause frame flow, suspend channels, re-run activation                |
| `Reactivating`                  | `ReactivationComplete`      | `Active(Running)`               | Resume channels, refresh surfaces, emit recovery event               |
| `Active(_)`                     | `FrontendDetached`          | `Active(FrontendDetached)`      | Keep backend alive, stop live render pushes, keep frame store budget |
| `Active(FrontendDetached)`      | `FrontendAttached`          | `Active(Running)`               | Send snapshot, resume frame pushes                                   |
| `Active(_)`                     | `BackpressureRaised`        | `Active(FrontendBackpressured)` | Enable coalescing/drop policy                                        |
| `Active(FrontendBackpressured)` | `BackpressureCleared`       | `Active(Running)`               | Resume normal frame policy                                           |
| `Active(_)`                     | `NetworkLost`               | `Reconnecting`                  | Freeze channel state, schedule reconnect                             |
| `Reconnecting`                  | reconnect success           | `Activating` or `Reactivating`  | Rebuild transport and activation state                               |
| any non-terminal                | `UserDisconnect`            | `Disconnecting`                 | Drain, close, emit disconnecting snapshot                            |
| `Disconnecting`                 | close complete              | `Terminated(UserRequested)`     | Release resources                                                    |
| any non-terminal                | fatal error                 | `Terminated(Failed)`            | Release resources, preserve failure context                          |

### 5.4 Failure classification

Add typed failure categories so reconnect and UI decisions are less guessy:

| Failure class         | Examples                                    | Retry behavior                                     |
| --------------------- | ------------------------------------------- | -------------------------------------------------- |
| `TrustRejected`       | User rejected certificate, pin mismatch     | Do not retry automatically                         |
| `AuthRejected`        | Bad credentials, account locked             | Do not retry automatically                         |
| `NetworkTransient`    | Timeout, reset, route loss                  | Retry with backoff if policy allows                |
| `ServerClosed`        | Clean server close                          | Retry only if session policy says so               |
| `ProtocolViolation`   | Invalid PDU sequence                        | Do not retry blindly; emit diagnostic              |
| `ChannelFault`        | Clipboard/RDPDR/AUDIN parser or state error | Isolate channel if possible                        |
| `RendererUnavailable` | Frontend cannot attach renderer             | Keep session alive if detached fallback is allowed |

### 5.5 Lifecycle snapshots

State snapshots should be serializable and safe for frontend diagnostics:

```rust
pub struct SessionStateSnapshot {
    pub session_id: String,
    pub state: String,
    pub active_substate: Option<String>,
    pub phase_started_at_ms: u64,
    pub transition_count: u64,
    pub reconnect_attempt: u32,
    pub last_failure_class: Option<String>,
    pub channel_summary: ChannelSummary,
    pub frame_flow_summary: FrameFlowSummary,
}
```

Rules:

- No hostname credentials, password, NTLM material, Kerberos tokens, certificate private data, or raw PDUs.
- Certificate fingerprints are allowed only if already exposed through trust UI.
- Errors should be structured enough to power UI and tests.

### 5.6 Implementation steps

1. Add `session_state.rs` with pure transition logic and unit tests.
2. Keep current runner behavior but mirror transitions in the state machine.
3. Replace string/phase updates in `session_runner.rs` with state machine events.
4. Emit state snapshots through existing RDP event plumbing in `src-tauri/crates/sorng-rdp/src/rdp/types.rs`.
5. Update frontend RDP session manager code to consume the new state snapshot without changing visible UI first.
6. Add diagnostics UI only after backend snapshots are stable.

### 5.7 Acceptance criteria

- Every public session status maps to a `SessionState`.
- Invalid transitions are rejected in unit tests.
- Reactivation and reconnect are separate states with separate reasons.
- User disconnect is idempotent from every non-terminal state.
- No state snapshot can include secret-bearing fields.
- Existing RDP connection smoke tests still pass.

---

## 6. Workstream 2: Virtual Channel Manager

### 6.1 Goal

Create a unified virtual channel management layer that makes channel lifecycle, readiness, failure, ordering, and flow policy visible and testable.

### 6.2 Proposed module layout

```text
src-tauri/crates/sorng-rdp/src/rdp/virtual_channels/
  mod.rs
  manager.rs
  registry.rs
  channel.rs
  lifecycle.rs
  flow.rs
  diagnostics.rs
  errors.rs
```

Initial adapters:

- `rdpdr_adapter.rs` for `src-tauri/crates/sorng-rdp/src/rdp/rdpdr/mod.rs`.
- `cliprdr_adapter.rs` for `src-tauri/crates/sorng-rdp/src/rdp/clipboard.rs`.
- `audin_adapter.rs` for `src-tauri/crates/sorng-rdp/src/rdp/audin.rs`.
- `gfx_adapter.rs` for `src-tauri/crates/sorng-rdp/src/gfx/processor.rs` if the dynamic graphics channel can be cleanly represented without fighting IronRDP abstractions.

### 6.3 Channel trait

The trait should be small and lifecycle-oriented. Protocol-specific modules keep protocol details.

```rust
pub trait VirtualChannel: Send {
    fn name(&self) -> ChannelName;
    fn kind(&self) -> ChannelKind;
    fn priority(&self) -> ChannelPriority;
    fn state(&self) -> ChannelState;

    fn on_session_event(&mut self, event: &ChannelLifecycleEvent) -> ChannelResult<Vec<ChannelAction>>;
    fn on_server_data(&mut self, data: ChannelData) -> ChannelResult<Vec<ChannelAction>>;
    fn on_client_command(&mut self, command: ChannelCommand) -> ChannelResult<Vec<ChannelAction>>;
    fn on_flow_update(&mut self, flow: ChannelFlowSnapshot) -> ChannelResult<Vec<ChannelAction>>;
    fn diagnostics(&self) -> ChannelDiagnostics;
}
```

### 6.4 Channel states

```rust
pub enum ChannelState {
    Disabled(DisableReason),
    Registered,
    WaitingServerAnnounce,
    Negotiating,
    Ready,
    Suspended(SuspendReason),
    Recovering(RecoveryReason),
    Failed(ChannelFailure),
    Closed,
}
```

### 6.5 Channel priorities

Different channel classes need different behavior under pressure:

| Priority    | Channels/events                                                 | Policy                                                                  |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Critical    | Lifecycle control, disconnect, reconnect, reactivation          | Never drop; bounded queue with immediate error if blocked               |
| High        | Input, pointer shape, focus, resize                             | Prefer latest event; coalesce pointer movement if needed                |
| Interactive | Clipboard text, audio control, small device metadata            | Bounded queue; short timeout; visible fault if stuck                    |
| Bulk        | Drive redirection file I/O, printer data, large clipboard files | Backpressure-aware; can pause/resume; never block graphics indefinitely |
| Graphics    | Bitmap/GFX/H.264 frames                                         | Coalesce/drop superseded frames according to frame-flow policy          |

### 6.6 Dependency and ordering graph

Declare channel dependencies centrally:

| Channel      | Depends on                                   | Initialization order              | Reactivation behavior                                    |
| ------------ | -------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| RDPGFX       | Active graphics capability negotiation       | After activation                  | Recreate surfaces or refresh surfaces after reactivation |
| RDPDR        | Device redirection enabled and negotiated    | Early after activation            | Suspend I/O, re-announce if required                     |
| CLIPRDR      | Clipboard enabled and server channel present | After static channel registration | Re-sync formats after reactivation                       |
| AUDIN/RDPSND | Audio enabled and codecs negotiated          | After activation                  | Flush and renegotiate if server requires                 |

### 6.7 Channel failure isolation

Rules:

- A parser/state failure in RDPDR should not take down CLIPRDR unless IronRDP itself reports a fatal protocol error.
- A stuck bulk device operation should not block graphics or input.
- Failed optional channels should produce diagnostics and UI warnings, not silent partial behavior.
- Required channel failures should become typed lifecycle failures.

### 6.8 Drive redirection gate fix

Before or during this workstream, fix the known `drive_redirection_enabled` no-op in `session_runner.rs`.

Acceptance criteria:

- When drive redirection is disabled, RDPDR drive devices are not registered.
- When specific devices are disabled, they do not appear in channel diagnostics.
- Unit tests cover enabled, disabled, empty-list, and mixed-device cases.

### 6.9 Implementation steps

1. Introduce channel names, states, priorities, diagnostics, and manager skeleton.
2. Register existing channels without changing behavior.
3. Add readiness snapshots and channel diagnostics.
4. Move enable/disable gates into the manager.
5. Adapt RDPDR to report lifecycle state through the manager.
6. Adapt clipboard and audio.
7. Add channel reactivation hooks.
8. Add failure isolation and fault-injection tests.

### 6.10 Acceptance criteria

- Every enabled RDP channel has a `ChannelState` visible through diagnostics.
- Channel enable/disable configuration is enforced in one place.
- Reactivation calls channel suspend/resume hooks in deterministic order.
- Optional channel failure does not terminate the session unless configured as fatal.
- Existing RDPDR, clipboard, and renderer tests continue passing.

---

## 7. Workstream 3: Backpressure Frame Flows

### 7.1 Goal

Create bounded, observable, adaptive frame flow across backend protocol output, Tauri transport, frontend frame queue, renderer, and frame store.

### 7.2 Current flow

```text
IronRDP ActiveStageOutput
  -> frame_delivery.rs
  -> frame_channel.rs
  -> Tauri binary channel
  -> rdpFramePipeline.ts
  -> selected renderer in rdpRenderers.ts
  -> canvas/webgl/webgpu/worker/webcodecs
```

The frontend has queue behavior, but the backend does not yet make enough decisions from frontend render pressure.

### 7.3 Target flow

```text
IronRDP ActiveStageOutput
  -> FrameFlowController.ingest(output)
  -> classify frame/event priority
  -> update live frame budget and frame store budget
  -> deliver, coalesce, defer, or drop superseded frame
  -> frame_channel.rs
  -> frontend pipeline
  -> renderer emits FrameRenderTelemetry
  -> backend receives BackpressureUpdate command/event
  -> FrameFlowController adjusts budgets
```

### 7.4 Proposed backend module

Add:

- `src-tauri/crates/sorng-rdp/src/rdp/frame_flow_control.rs`

Core types:

```rust
pub struct FrameFlowController {
    live_budget: FrameBudget,
    store_budget: FrameBudget,
    telemetry: RenderTelemetryWindow,
    policy: FrameFlowPolicy,
    counters: FrameFlowCounters,
}

pub struct FrameBudget {
    pub max_frames: usize,
    pub max_bytes: usize,
    pub max_latency_ms: u64,
}

pub enum FrameDisposition {
    DeliverNow(FrameEnvelope),
    Coalesce(FrameEnvelope),
    Defer(FrameEnvelope),
    DropSuperseded { reason: DropReason },
    EnterBackpressure { reason: BackpressureReason },
}
```

### 7.5 Frame classification

| Data type                     | Priority        | Drop/coalesce policy                                                   |
| ----------------------------- | --------------- | ---------------------------------------------------------------------- |
| Pointer visibility/shape      | High            | Keep latest; do not let old pointer updates backlog                    |
| Desktop resize/surface reset  | Critical        | Never drop; flush incompatible queued frames                           |
| Full-frame bitmap/H.264 frame | Graphics        | Drop superseded frames if newer full frame exists                      |
| Dirty-rect bitmap update      | Graphics        | Coalesce when rectangles overlap or newer update supersedes old pixels |
| Snapshot for detach/reattach  | Store           | Keep latest complete surface; bounded history                          |
| Recording frame               | Store/recording | Follow recording policy; do not reuse live drop policy blindly         |
| Diagnostics frame metadata    | Low             | Sample under pressure                                                  |

### 7.6 Frontend telemetry

Add a frontend hook:

- `src/components/rdp/useRdpFrameBackpressure.ts`

Telemetry payload:

```ts
export interface RdpFrameBackpressureUpdate {
  sessionId: string;
  renderer: string;
  queueDepth: number;
  queuedBytes?: number;
  lastFrameRenderMs: number;
  averageRenderMs: number;
  p95RenderMs?: number;
  droppedFrames: number;
  presentedFrames: number;
  isVisible: boolean;
  isDetached: boolean;
  timestampMs: number;
}
```

Rules:

- Send telemetry at a capped cadence, for example 4 Hz while active and 1 Hz while detached/backpressured.
- Send immediate updates when queue depth crosses high/low watermarks.
- Do not send per-frame IPC acknowledgements unless testing proves it is necessary.
- Keep the payload small and numeric.

### 7.7 Backpressure policy

Default budgets should be conservative and configurable:

| Budget                            | Initial target                                            |
| --------------------------------- | --------------------------------------------------------- |
| Frontend live queue               | Already bounded; formalize threshold in shared constants  |
| Backend pending live frames       | 2 to 3 frames or equivalent byte budget                   |
| Backend frame store live snapshot | Latest complete surface plus small history                |
| Backpressure high watermark       | Frontend queue depth >= 75% or average render > 32 ms     |
| Backpressure low watermark        | Frontend queue depth <= 25% and average render < 20 ms    |
| Severe pressure                   | Render latency > 500 ms or repeated channel send failures |

When pressure rises:

1. Enter `Active(FrontendBackpressured)` in the lifecycle state machine.
2. Coalesce graphics updates by surface/region.
3. Prefer latest full-frame update over older partial updates when safe.
4. Pause nonessential diagnostics frame metadata.
5. Keep input, pointer, lifecycle, and disconnect responsive.

When pressure clears:

1. Emit a state transition back to `Active(Running)`.
2. Flush one current surface snapshot if the renderer may have missed intermediate updates.
3. Resume normal frame cadence.

### 7.8 Detach/reattach behavior

Detached sessions should have a different flow policy:

- Stop sending live frames to a nonexistent renderer.
- Keep one current surface snapshot in `frame_store.rs`.
- Optionally keep low-frequency thumbnails if UI needs them.
- Keep protocol session alive unless the user explicitly disconnects.
- On reattach, send surface metadata, latest snapshot, then resume live frames.

### 7.9 Renderer fast-path stabilization

Before depending on worker/WebCodecs performance for flow-control validation, fix the known `toDataView()` worker-scope issue in `src/components/rdp/rdpRenderers.ts` and keep `tests/rdp/rendererWorkers.test.ts` green.

### 7.10 Acceptance criteria

- Under synthetic slow rendering, backend memory remains bounded.
- Under normal rendering, added flow control does not visibly increase latency.
- Detach stops live frame pushes but preserves reattach snapshot behavior.
- Severe render pressure does not block input or disconnect.
- Diagnostics expose queue depth, render latency, dropped/coalesced frames, and current policy.

---

## 8. Workstream 4: Diagnostics and Observability

### 8.1 Goal

Expose enough live RDP internals to debug sessions without opening raw protocol traces or leaking sensitive data.

### 8.2 Backend diagnostics

Extend or add diagnostics types near:

- `src-tauri/crates/sorng-rdp/src/rdp/diagnostics.rs`.
- `src-tauri/crates/sorng-rdp/src/rdp/diagnostics_cmds.rs`.
- `src-tauri/crates/sorng-rdp/src/rdp/types.rs`.

Snapshot sections:

| Section    | Fields                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| Lifecycle  | current state, active substate, last transition, transition count, reconnect attempt       |
| Transport  | connected/disconnected, TLS mode, cert validation policy result, RTT estimate if available |
| Channels   | per-channel enabled/state/priority/last error/message counts/queue depth                   |
| Frame flow | live queue, store budget, renderer telemetry, dropped/coalesced/delivered counters         |
| Frontend   | attached/detached, renderer name, visibility, last telemetry timestamp                     |

### 8.3 Frontend diagnostics panel

Add a compact RDP session diagnostics view after backend snapshots are stable. Candidate locations:

- Existing RDP session panel under `src/components/rdp/`.
- Session manager detail view in `src/components/rdp/RDPSessionManager.tsx` if present.
- Developer-focused diagnostics entry if there is an existing diagnostics surface.

UI requirements:

- Show current lifecycle state and last failure class.
- Show channel rows with state, priority, and error status.
- Show frame-flow counters and current renderer.
- Avoid raw PDU display.
- Avoid secrets and raw certificate bodies.

### 8.4 Tracing

Add structured tracing spans:

| Span                       | Key fields                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| `rdp.lifecycle.transition` | session id, previous state, next state, event, duration           |
| `rdp.channel.transition`   | session id, channel, previous state, next state, reason           |
| `rdp.frame.backpressure`   | session id, policy, queue depth, average render ms, dropped count |
| `rdp.reconnect.attempt`    | session id, attempt, failure class, backoff ms                    |

---

## 9. Workstream 5: Security and Correctness Gates

### 9.1 Goal

Make sure the architecture refactor does not preserve known unsafe behavior or introduce new secret-retention paths.

### 9.2 Credential lifetime

The known plaintext password lifetime issue in `src-tauri/crates/sorng-rdp/src/rdp/types.rs` should be handled before broad diagnostics rollout.

Requirements:

- Secret-bearing RDP fields should use an existing secret wrapper if the repo has one, or a dedicated secret type with redaction and explicit drop behavior.
- Diagnostics and state snapshots must not clone or serialize secrets.
- Tests should assert redacted debug/serialization behavior for session config snapshots.

### 9.3 Certificate trust behavior

Certificate trust should integrate with lifecycle classification:

- User rejects trust prompt -> `Terminated(TrustRejected)`.
- Certificate pin mismatch -> `Terminated(TrustRejected)` with a strong UI warning.
- User chooses one-time trust -> active session can proceed but snapshot records policy as one-time trust.
- Ignore mode -> snapshot records weaker policy without exposing certificate body.

### 9.4 Channel gating correctness

Channel configuration gates should be centralized in the virtual channel manager. Tests should prove disabled channels remain disabled across:

- Fresh connect.
- Reactivation.
- Reconnect.
- Detach/reattach.
- Settings changes applied before reconnect.

### 9.5 Safe degradation

When a feature fails, degradation should be explicit:

| Feature failure          | Expected behavior                                                         |
| ------------------------ | ------------------------------------------------------------------------- |
| WebCodecs unavailable    | Fall back to Canvas2D/WebGL path and emit renderer diagnostic             |
| Clipboard channel failed | Session remains active; clipboard shows disabled/faulted status           |
| Drive redirection failed | Session remains active; device channel shows fault; no hidden retry storm |
| Audio failed             | Session remains active; audio status shows unavailable                    |
| Cert trust rejected      | Session stops; no auto-reconnect                                          |

---

## 10. File-by-File Change Map

### 10.1 Backend Rust

| File                                                             | Change                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src-tauri/crates/sorng-rdp/src/rdp/session_state.rs`            | New lifecycle state machine, events, transition outcomes, tests.                                  |
| `src-tauri/crates/sorng-rdp/src/rdp/session_runner.rs`           | Integrate state machine, dispatch actions, remove duplicated lifecycle decisions.                 |
| `src-tauri/crates/sorng-rdp/src/rdp/stats.rs`                    | Align existing phase stats with `SessionStateSnapshot`; avoid competing state sources.            |
| `src-tauri/crates/sorng-rdp/src/rdp/types.rs`                    | Add safe state/channel/frame diagnostic event types; remove secret-bearing snapshot paths.        |
| `src-tauri/crates/sorng-rdp/src/rdp/session_poller.rs`           | Surface poller wake/network events as typed lifecycle events if needed.                           |
| `src-tauri/crates/sorng-rdp/src/rdp/wake_channel.rs`             | Add wake messages for backpressure updates and frontend attach/detach if not already represented. |
| `src-tauri/crates/sorng-rdp/src/rdp/virtual_channels/mod.rs`     | New channel manager module root.                                                                  |
| `src-tauri/crates/sorng-rdp/src/rdp/virtual_channels/manager.rs` | New registry, lifecycle dispatch, channel state snapshots.                                        |
| `src-tauri/crates/sorng-rdp/src/rdp/virtual_channels/flow.rs`    | Channel-level queue budgets and priority metadata.                                                |
| `src-tauri/crates/sorng-rdp/src/rdp/rdpdr/mod.rs`                | Adapt to channel lifecycle; fix drive enablement gate; expose diagnostics.                        |
| `src-tauri/crates/sorng-rdp/src/rdp/clipboard.rs`                | Adapt to channel lifecycle; add re-sync hooks and fault snapshots.                                |
| `src-tauri/crates/sorng-rdp/src/rdp/audin.rs`                    | Adapt to channel lifecycle if audio is active in the current implementation.                      |
| `src-tauri/crates/sorng-rdp/src/gfx/processor.rs`                | Bridge dynamic graphics channel state and frame-flow metadata where practical.                    |
| `src-tauri/crates/sorng-rdp/src/rdp/frame_flow_control.rs`       | New frame backpressure policy, budgets, counters, and disposition logic.                          |
| `src-tauri/crates/sorng-rdp/src/rdp/frame_delivery.rs`           | Route output through `FrameFlowController`; classify outputs.                                     |
| `src-tauri/crates/sorng-rdp/src/rdp/frame_channel.rs`            | Add bounded delivery accounting and send-failure classification.                                  |
| `src-tauri/crates/sorng-rdp/src/rdp/frame_store.rs`              | Separate live, snapshot, detach, and recording budgets.                                           |
| `src-tauri/crates/sorng-rdp/src/rdp/diagnostics.rs`              | Add lifecycle/channel/frame-flow diagnostics snapshot.                                            |
| `src-tauri/crates/sorng-rdp/src/rdp/diagnostics_cmds.rs`         | Expose diagnostics through Tauri command if existing command shape supports it.                   |
| `src-tauri/crates/sorng-rdp/tests/reconnect.rs`                  | Add lifecycle graph assertions around reconnect/reactivation.                                     |
| `src-tauri/crates/sorng-rdp/tests/rdpdr_e2e.rs`                  | Add channel gating and reactivation coverage.                                                     |
| `src-tauri/crates/sorng-rdp/tests/rdpdr_fuzzish.rs`              | Add channel failure isolation cases where useful.                                                 |

### 10.2 Frontend TypeScript

| File                                            | Change                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/components/rdp/rdpFramePipeline.ts`        | Emit render telemetry, expose queue depth, integrate high/low watermark events.          |
| `src/components/rdp/rdpRenderers.ts`            | Fix worker/WebCodecs helper scope; ensure renderer telemetry works across all renderers. |
| `src/components/rdp/useRdpFrameBackpressure.ts` | New hook for throttled telemetry and backpressure reporting.                             |
| `src/components/rdp/RDPSessionManager.tsx`      | Consume lifecycle snapshots and optionally surface diagnostics.                          |
| `src/types/rdp.ts` or nearest RDP type file     | Mirror new Rust diagnostic and telemetry payloads.                                       |
| `tests/rdp/rendererWorkers.test.ts`             | Keep worker/WebCodecs regression coverage green.                                         |
| `tests/rdp/rdpFramePipeline*.test.ts`           | Add slow-render, queue pressure, detach/reattach, and coalescing tests.                  |

### 10.3 Documentation

| File                                                           | Change                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ARCHITECTURE.md`                                              | Add a short RDP session actor subsection after implementation lands. |
| `docs/testing/`                                                | Add RDP diagnostics and live fixture runbook if needed.              |
| `docs/plans/rdp-lifecycle-virtual-channels-frame-flow-plan.md` | This plan. Keep updated as phases complete.                          |

---

## 11. Testing Strategy

### 11.1 Unit tests

| Area                    | Tests                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Lifecycle state machine | Valid transitions, invalid transitions, idempotent disconnect, fatal from any state, reactivation from active only. |
| Failure classification  | Trust rejection, auth rejection, transient network loss, protocol violation, channel fault.                         |
| Virtual channel manager | Registration, enable/disable, ordering, duplicate channel rejection, failed optional channel isolation.             |
| RDPDR gate              | Disabled drive redirection registers no drive devices.                                                              |
| Frame flow controller   | Budget accounting, high/low watermark transitions, coalescing, drop counters, detach policy.                        |
| Secret safety           | Diagnostics serialization redacts or omits secret fields.                                                           |

### 11.2 Frontend tests

| Area              | Tests                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Renderer workers  | Worker/WebCodecs helpers available in worker scope.                        |
| Frame telemetry   | Queue depth and render latency reported at capped cadence.                 |
| Backpressure hook | High/low watermark events emitted once per threshold crossing.             |
| Detach/reattach   | Detached state suppresses live frame sends and reattach requests snapshot. |
| Diagnostics UI    | States and channel rows render without exposing secret fields.             |

### 11.3 Integration tests

| Area              | Tests                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Reconnect         | Network loss from active state enters `Reconnecting`, retries when transient, terminates on permanent classes. |
| Reactivation      | `DeactivateAll` enters `Reactivating`, suspends channels, resumes channels, refreshes frame state.             |
| Multi-channel     | Clipboard and drive redirection active together; one channel fault does not kill the other.                    |
| Backpressure      | Synthetic slow frontend keeps backend memory bounded and session responsive.                                   |
| Certificate trust | Reject/accept/ignore trust flows produce correct lifecycle states.                                             |

### 11.4 Commands to validate focused slices

Use the smallest reliable command per phase:

```powershell
npx vitest --run tests/rdp/rendererWorkers.test.ts
npx vitest --run tests/rdp
cargo test --manifest-path src-tauri/Cargo.toml -p sorng-rdp session_state
cargo test --manifest-path src-tauri/Cargo.toml -p sorng-rdp rdpdr
cargo test --manifest-path src-tauri/Cargo.toml -p sorng-rdp reconnect
cargo check --manifest-path src-tauri/Cargo.toml -p sorng-rdp --tests
```

On this Windows GNU workspace, use an isolated `CARGO_TARGET_DIR` when the shared target lock is busy.

---

## 12. Phased Rollout

### Phase 0: Baseline and bug gates

Goal: Make sure the refactor starts from a trustworthy baseline.

Deliverables:

- Confirm current RDP test baseline.
- Fix or explicitly schedule the worker/WebCodecs `toDataView()` bug.
- Fix or explicitly schedule the drive redirection gate bug.
- Decide the secret-wrapper approach for RDP passwords.
- Record current frame memory, frame latency, and reconnect behavior if measurement tools exist.

Exit criteria:

- Focused RDP frontend tests pass.
- Focused `sorng-rdp` compile/test gate passes or blockers are documented.
- Known P0/P1/P2 bugs are either closed or assigned to a blocking phase below.

### Phase 1: Pure lifecycle state machine

Goal: Add the state machine without changing runtime behavior.

Deliverables:

- `session_state.rs` with pure transition logic.
- Unit tests for the lifecycle graph.
- Mapping from existing phase/status events to new state snapshots.

Exit criteria:

- State machine unit tests pass.
- No visible behavior change required yet.
- Snapshot serialization is secret-safe.

### Phase 2: Lifecycle integration

Goal: Make `session_runner.rs` use the state machine as the source of truth.

Deliverables:

- Runner dispatches lifecycle events.
- Reconnect, reactivation, detach/attach, and disconnect paths emit typed transitions.
- Failure classification added for trust/auth/network/protocol/channel failures.

Exit criteria:

- Existing reconnect and RDP smoke tests pass.
- Logs show typed transitions.
- Invalid transitions are impossible or reported as internal errors.

### Phase 3: Virtual channel manager skeleton

Goal: Introduce manager and diagnostics without moving all channel internals at once.

Deliverables:

- Channel names, states, priorities, and diagnostics.
- Manager registry of enabled channels.
- Enable/disable gates centralized.
- RDPDR gate fix covered by tests.

Exit criteria:

- Channel diagnostics show disabled/registered/ready/faulted states.
- Drive redirection disabled means no drive device registration.
- Existing channel behavior preserved.

### Phase 4: Virtual channel lifecycle integration

Goal: Make channel behavior follow session lifecycle transitions.

Deliverables:

- RDPDR adapter with suspend/resume/reactivation behavior.
- Clipboard adapter with format re-sync behavior.
- Audio adapter if active.
- Optional GFX channel diagnostics bridge.
- Channel failure isolation tests.

Exit criteria:

- Reactivation suspends and resumes channel state in deterministic order.
- Optional channel failures do not terminate the session.
- Channel state is visible in diagnostics.

### Phase 5: Frame flow controller backend

Goal: Bound backend frame behavior before adding richer frontend feedback.

Deliverables:

- `frame_flow_control.rs`.
- Frame classification.
- Live and store budgets.
- Drop/coalesce counters.
- Detach policy for live frame suppression.

Exit criteria:

- Backend frame buffers stay bounded in unit tests.
- Detach keeps snapshot state without live pushes.
- Normal frame delivery remains unchanged when pressure is absent.

### Phase 6: Frontend telemetry and adaptive backpressure

Goal: Feed renderer pressure back into backend policy.

Deliverables:

- `useRdpFrameBackpressure.ts`.
- Telemetry from `rdpFramePipeline.ts`.
- Backend backpressure wake command/event.
- High/low watermark behavior.

Exit criteria:

- Synthetic slow-render tests trigger backpressure.
- Recovery tests clear backpressure.
- Input and disconnect remain responsive under pressure.

### Phase 7: Diagnostics UI and documentation

Goal: Make the new architecture inspectable.

Deliverables:

- Backend diagnostics snapshot command/event.
- Compact frontend diagnostics panel.
- `ARCHITECTURE.md` RDP subsection.
- RDP testing runbook updates.

Exit criteria:

- Users/developers can see lifecycle, channel, and frame-flow state.
- Diagnostics contain no secrets.
- Plan is updated with completed phases and remaining work.

---

## 13. Success Metrics

### 13.1 Reliability

- Reactivation no longer causes hung sessions in covered tests.
- User disconnect completes from every non-terminal state.
- Optional channel failure does not terminate the whole RDP session.
- Reconnect attempts stop for trust/auth failures and continue only for retryable network failures.

### 13.2 Performance and memory

- Backend live frame queue remains below configured frame/byte budget under slow frontend rendering.
- Frontend render queue remains below high watermark during normal sessions.
- Severe render pressure causes bounded frame drops/coalescing instead of unbounded memory growth.
- Backpressure adds no measurable latency when the renderer is healthy.

### 13.3 Observability

- Every session can produce a lifecycle snapshot.
- Every enabled channel can report a state.
- Frame diagnostics show delivered, dropped, coalesced, queued, and render-latency counters.
- Logs include structured transition spans.

### 13.4 Security and correctness

- RDP password material is not serialized in diagnostics or cloned into long-lived snapshots.
- Certificate trust outcomes are typed and visible.
- Disabled channels stay disabled across connect, reactivation, reconnect, and detach/reattach.

---

## 14. Risks and Mitigations

| Risk                                            | Impact                                    | Mitigation                                                                                     |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Duplicating IronRDP internal state              | Confusing bugs and impossible transitions | Model only app/session lifecycle; keep protocol internals inside IronRDP.                      |
| Refactoring `session_runner.rs` all at once     | High regression risk                      | Add pure state machine first, then integrate one event family at a time.                       |
| Channel manager fights existing channel modules | Large rewrite with little value           | Start as registry/diagnostics/gating layer; adapt modules gradually.                           |
| Backpressure drops meaningful frames            | Visual artifacts or stale screen          | Only drop superseded graphics updates; preserve resize/surface reset/pointer/control events.   |
| Telemetry IPC becomes noisy                     | More overhead than benefit                | Cap telemetry cadence and emit immediately only on threshold crossings.                        |
| Diagnostics leak sensitive data                 | Security regression                       | Use explicit safe snapshot types and tests for redaction/serialization.                        |
| Live xrdp cannot reproduce all edge cases       | False confidence                          | Combine unit state-machine tests, mocked channel tests, fuzzish parser tests, and live smokes. |
| Detach policy diverges from live render policy  | Reattach artifacts                        | Treat detach as its own flow mode with snapshot-first reattach tests.                          |

---

## 15. Open Decisions

1. Should Phase 1 introduce a new frontend-visible event name, or should it extend the existing RDP status event payload?
2. Should channel manager diagnostics be always available, or hidden behind a developer/diagnostics feature flag?
3. What is the initial frame byte budget for high-DPI multi-monitor sessions?
4. Should frame backpressure be driven by frontend telemetry only, or also by backend channel send latency?
5. Should severe pressure prefer lower frame rate, region coalescing, or renderer fallback first?
6. How much legacy server compatibility should be tested beyond xrdp and modern Windows Server?
7. Should certificate trust prompts block the lifecycle state machine in `Authenticating`, or be modeled as a nested `AwaitingTrustDecision` state?
8. Should RDPDR bulk file operations have independent pause/resume controls in the diagnostics UI?

---

## 16. Completion Execution Tracker

This section is the implementation board for finishing the RDP review work. It turns the broad workstreams above into concrete mergeable slices. Each slice should be kept small enough to validate with focused tests before moving to the next one.

### 16.1 Current completion state

| Area                            | Status                    | Evidence                                                                                                                                                | Remaining work                                                                                |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Review and architecture plan    | Done                      | This plan exists and records lifecycle/channel/frame-flow goals.                                                                                        | Keep this tracker updated as slices land.                                                     |
| Pure lifecycle model            | Done                      | `src-tauri/crates/sorng-rdp/src/rdp/session_state.rs` has typed states, events, actions, snapshots, and unit tests.                                     | Continue expanding event coverage only when new runner cases are wired.                       |
| Runtime lifecycle observability | In progress               | `RdpStatsEvent` carries lifecycle snapshots and the runner emits `rdp://lifecycle` beside stats.                                                        | Move from phase-derived snapshots to event-driven transitions at high-value runner points.    |
| Frontend lifecycle consumption  | In progress               | `useRDPClient` listens for `rdp://lifecycle`; internals panel can show lifecycle state and transition count.                                            | Add richer diagnostics rows after channel/frame summaries exist.                              |
| Drive redirection gate          | Covered                   | `effective_drive_redirections()` and `should_register_rdpdr()` exist in `session_runner.rs`; `cargo test -p sorng-rdp --test redirection_flags` passes. | Keep coverage in sync when SVC/DVC drive registration changes.                                |
| Credential lifetime             | Covered for current paths | `RdpActiveConnection.cached_password` uses `SecretString`; `cargo test -p sorng-rdp --test credential_hygiene` passes.                                  | Re-audit if new startup, reconnect, snapshot, or diagnostics paths clone credentials.         |
| Worker/WebCodecs fast path      | Covered                   | Focused renderer worker Vitest coverage passes and the worker-scope helper bug is not reproducing.                                                      | Keep worker tests in the pre-merge focused set when frame fast-path code changes.             |
| Certificate trust lifecycle     | In progress elsewhere     | Trust settings work exists in frontend and cert trust backend.                                                                                          | Map trust accept/reject/mismatch to lifecycle failure classes and tests.                      |
| Virtual channel manager         | Not started               | Existing channels remain per-module.                                                                                                                    | Add registry/diagnostics skeleton, then adapt RDPDR, CLIPRDR, AUDIN, and optional GFX bridge. |
| Backpressure frame controller   | Not started               | Frontend queue exists; backend is not credit-aware.                                                                                                     | Add backend frame budgets, frontend telemetry, high/low watermarks, coalescing counters.      |
| Diagnostics UI                  | Partial                   | RDP internals panel exists and now receives lifecycle information.                                                                                      | Add channel rows, frame-flow counters, last failure class, and queue state.                   |

### 16.2 Finish order

#### 16.2.1 Lifecycle observability gate

- Keep `RdpStatsEvent.lifecycle` optional for backward compatibility.
- Emit `rdp://lifecycle` at stats cadence first.
- Then wire event-driven transitions for attach, detach, reactivation, reconnect, shutdown, server close, and protocol errors.
- Validation: `cargo test -p sorng-rdp session_state`, `cargo test -p sorng-rdp stats`, `npx tsc --noEmit`, focused RDP client/internals tests.

#### 16.2.2 RDP review bug closure gate

- Reconfirm worker/WebCodecs tests and fix worker helper scope if still present.
- Reconfirm drive-redirection enable/disable coverage for SVC and DVC registration.
- Reconfirm RDP certificate trust prompt behavior and typed reject/mismatch handling.
- Reconfirm no secret-bearing lifecycle/stat/diagnostic snapshot serializes password-like fields.
- Validation: focused Vitest renderer/security tests, `cargo test -p sorng-rdp redirection_flags credential_hygiene cert_trust`.

#### 16.2.3 Virtual channel registry skeleton

- Add `rdp/virtual_channels/` with channel name, kind, priority, state, summary, and diagnostics types.
- Start as an observability/gating layer, not a protocol rewrite.
- Feed `ChannelSummary` in lifecycle snapshots from the registry.
- Validation: pure unit tests for registration, duplicate rejection, disabled channels, and summary counts.

#### 16.2.4 Virtual channel adapters

- Adapt RDPDR first because it has the largest device-gating risk.
- Adapt CLIPRDR next because it is user-visible and can fail independently.
- Adapt AUDIN/RDPSND after audio behavior is confirmed.
- Add optional RDPGFX bridge if IronRDP dynamic-channel boundaries allow it without protocol churn.
- Validation: existing RDPDR tests, clipboard tests, fuzzish parser tests, and multi-channel failure-isolation unit tests.

#### 16.2.5 Frame-flow controller skeleton

- Add backend `frame_flow_control.rs` with budgets, counters, and dispositions.
- Start with accounting-only mode so behavior is observable before drops/coalescing are enabled.
- Separate live frame budget from frame-store snapshot budget.
- Validation: pure unit tests for budget accounting and no behavior change under no pressure.

#### 16.2.6 Adaptive backpressure

- Add frontend render telemetry at capped cadence.
- Add backend high/low watermark state and `Active(FrontendBackpressured)` transitions.
- Enable safe coalescing/drop only for superseded graphics, never lifecycle/input/resize/pointer-critical events.
- Validation: synthetic slow-render tests, detach/reattach snapshot tests, input responsiveness tests.

#### 16.2.7 Diagnostics finish

- Extend RDP internals with lifecycle, channel, frame-flow, and last failure sections.
- Keep diagnostics compact and numeric by default.
- Avoid raw PDUs, credentials, certificate PEM, or token material.
- Validation: component tests for display and redaction.

#### 16.2.8 Final beta gate

- Run focused frontend RDP suites.
- Run focused Rust `sorng-rdp` tests.
- Run `npx tsc --noEmit`.
- Run live Docker/xrdp smoke when the host environment is available.
- Update this tracker with pass/fail evidence and any deferred decisions.

### 16.3 Definition of done

The RDP review work is fully done only when all of these are true:

- Lifecycle snapshots are emitted and consumed by frontend diagnostics.
- Session runner uses event-driven lifecycle transitions for all major exits and recoveries.
- Virtual channels have a central registry, state summary, and failure-isolation tests.
- Drive redirection gates are tested for disabled, empty, mixed-device, and enabled cases.
- Frame flow has bounded backend budgets and frontend render telemetry.
- Slow-render tests prove memory stays bounded while input/disconnect remain responsive.
- Certificate trust outcomes map to typed lifecycle classes.
- Secret-bearing fields are excluded from lifecycle, stats, diagnostics, and logs.
- Focused Rust and TypeScript validation gates are green.
- Any live-environment gaps are documented as lab-only, not silently ignored.

---

## Final Recommendation

Treat Phases 1 through 4 as beta-readiness work. The lifecycle state machine and virtual channel manager reduce correctness risk and make failures easier to reason about.

Treat Phases 5 through 7 as performance and supportability work. Backpressure and diagnostics will make long-running sessions safer, especially on slow renderers, detached sessions, high-latency hosts, and future multi-monitor/H.264-heavy workloads.

The plan should be implemented in narrow slices: pure state logic first, then runner integration, then channel visibility, then channel lifecycle, then frame-flow control. That order gives the team a better RDP architecture without turning the protocol stack into a risky rewrite.
