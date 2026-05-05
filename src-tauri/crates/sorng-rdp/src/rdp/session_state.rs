use std::fmt;

use serde::{Deserialize, Serialize};

use super::stats::ConnectionPhase;

pub type ChannelName = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActiveSubstate {
    Running,
    FrontendDetached,
    FrontendBackpressured,
    ChannelsRecovering,
    ServerIdle,
}

impl ActiveSubstate {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::FrontendDetached => "frontend_detached",
            Self::FrontendBackpressured => "frontend_backpressured",
            Self::ChannelsRecovering => "channels_recovering",
            Self::ServerIdle => "server_idle",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureClass {
    TrustRejected,
    AuthRejected,
    NetworkTransient,
    ServerClosed,
    ProtocolViolation,
    ChannelFault,
    RendererUnavailable,
}

impl FailureClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TrustRejected => "trust_rejected",
            Self::AuthRejected => "auth_rejected",
            Self::NetworkTransient => "network_transient",
            Self::ServerClosed => "server_closed",
            Self::ProtocolViolation => "protocol_violation",
            Self::ChannelFault => "channel_fault",
            Self::RendererUnavailable => "renderer_unavailable",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReactivationReason {
    DeactivateAll,
    ManualRecovery,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactivationContext {
    pub reason: ReactivationReason,
    pub started_at_ms: u64,
}

impl ReactivationContext {
    pub fn deactivate_all(started_at_ms: u64) -> Self {
        Self {
            reason: ReactivationReason::DeactivateAll,
            started_at_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReconnectReason {
    NetworkLost,
    Manual,
    ServerClosed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectContext {
    pub attempt: u32,
    pub reason: ReconnectReason,
    pub started_at_ms: u64,
}

impl ReconnectContext {
    pub fn network_lost(attempt: u32, started_at_ms: u64) -> Self {
        Self {
            attempt,
            reason: ReconnectReason::NetworkLost,
            started_at_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrainReason {
    UserRequested,
    ServerClosed,
    Failure(FailureClass),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisconnectReason {
    UserRequested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminationReason {
    UserRequested,
    ServerClosed,
    Failed(FailureClass),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

impl Default for SessionState {
    fn default() -> Self {
        Self::Idle
    }
}

impl SessionState {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Resolving => "resolving",
            Self::Connecting => "connecting",
            Self::NegotiatingSecurity => "negotiating_security",
            Self::Authenticating => "authenticating",
            Self::Activating => "activating",
            Self::Active(_) => "active",
            Self::Reactivating(_) => "reactivating",
            Self::Reconnecting(_) => "reconnecting",
            Self::Draining(_) => "draining",
            Self::Disconnecting(_) => "disconnecting",
            Self::Terminated(_) => "terminated",
        }
    }

    pub fn active_substate(&self) -> Option<&ActiveSubstate> {
        match self {
            Self::Active(substate) => Some(substate),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Terminated(_))
    }

    pub fn from_public_status(status: &str) -> Option<Self> {
        Some(match status {
            "initializing" => Self::Idle,
            "connecting" => Self::Connecting,
            "negotiating" => Self::NegotiatingSecurity,
            "connected" => Self::Active(ActiveSubstate::Running),
            "reconnecting" => Self::Reconnecting(ReconnectContext::network_lost(0, 0)),
            "disconnected" => Self::Terminated(TerminationReason::ServerClosed),
            "error" => Self::Terminated(TerminationReason::Failed(FailureClass::ProtocolViolation)),
            _ => return None,
        })
    }

    pub fn from_phase_str(phase: &str) -> Option<Self> {
        Some(match phase {
            "initializing" => Self::Idle,
            "configuring" => Self::Resolving,
            "tcp_connect" | "connecting" => Self::Connecting,
            "negotiating" | "tls_upgrade" | "tls_handshake" => Self::NegotiatingSecurity,
            "authenticating" | "credssp" => Self::Authenticating,
            "capability_exchange" => Self::Activating,
            "active" | "connected" => Self::Active(ActiveSubstate::Running),
            "reactivating" => Self::Reactivating(ReactivationContext::deactivate_all(0)),
            "reconnecting" => Self::Reconnecting(ReconnectContext::network_lost(0, 0)),
            "disconnected" | "terminated" => Self::Terminated(TerminationReason::ServerClosed),
            "error" => Self::Terminated(TerminationReason::Failed(FailureClass::ProtocolViolation)),
            _ => return None,
        })
    }
}

impl From<ConnectionPhase> for SessionState {
    fn from(phase: ConnectionPhase) -> Self {
        match phase {
            ConnectionPhase::Initializing => Self::Idle,
            ConnectionPhase::TcpConnect => Self::Connecting,
            ConnectionPhase::TlsHandshake | ConnectionPhase::Negotiating => {
                Self::NegotiatingSecurity
            }
            ConnectionPhase::CredSSP => Self::Authenticating,
            ConnectionPhase::CapabilityExchange => Self::Activating,
            ConnectionPhase::Active => Self::Active(ActiveSubstate::Running),
            ConnectionPhase::Reactivating => {
                Self::Reactivating(ReactivationContext::deactivate_all(0))
            }
            ConnectionPhase::Reconnecting => {
                Self::Reconnecting(ReconnectContext::network_lost(0, 0))
            }
            ConnectionPhase::Disconnected | ConnectionPhase::Terminated => {
                Self::Terminated(TerminationReason::ServerClosed)
            }
            ConnectionPhase::Error => {
                Self::Terminated(TerminationReason::Failed(FailureClass::ProtocolViolation))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    UserConnect,
    HostResolved,
    TcpConnected,
    TlsReady,
    CredSspReady,
    AuthenticationComplete,
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
    CloseComplete,
    ServerClosed,
    FatalError { class: FailureClass },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionAction {
    ResolveHost,
    OpenTcpTransport,
    StartSecurityNegotiation,
    StartAuthentication,
    StartActivation,
    EnterActive,
    InitializeVirtualChannels,
    StartFrameFlow,
    PauseFrameDelivery,
    DeactivateChannels,
    StartReactivation,
    ResumeChannels,
    RefreshSurfaces,
    ResumeFrameDelivery,
    StopLiveFramePushes,
    KeepFrameStoreBudget,
    SendCurrentSnapshot,
    ResumeFramePushes,
    EnterFrameBackpressure,
    ExitFrameBackpressure,
    FreezeFrameStore,
    MarkChannelsSuspended,
    StartReconnectTimer,
    DrainQueues,
    CloseChannels,
    CloseTransport,
    ReleaseResources,
    EmitRecoveryEvent,
    EmitStateSnapshot,
    MarkChannelFaulted(ChannelName),
    MarkChannelRecovered(ChannelName),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    pub enabled_count: u16,
    pub ready_count: u16,
    pub failed_count: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FrameFlowSummary {
    pub queued_frames: u16,
    pub delivered_frames: u64,
    pub dropped_frames: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateSnapshot {
    pub session_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_substate: Option<String>,
    pub phase_started_at_ms: u64,
    pub transition_count: u64,
    pub reconnect_attempt: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure_class: Option<String>,
    pub channel_summary: ChannelSummary,
    pub frame_flow_summary: FrameFlowSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransitionOutcome {
    pub previous: SessionState,
    pub next: SessionState,
    pub actions: Vec<SessionAction>,
    pub emitted_snapshot: SessionStateSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidTransition {
    pub state: SessionState,
    pub event: SessionEvent,
}

impl fmt::Display for InvalidTransition {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid RDP lifecycle transition from {:?} on {:?}",
            self.state, self.event
        )
    }
}

impl std::error::Error for InvalidTransition {}

#[derive(Debug, Clone)]
pub struct LifecycleStateMachine {
    session_id: String,
    state: SessionState,
    phase_started_at_ms: u64,
    transition_count: u64,
    reconnect_attempt: u32,
    last_failure_class: Option<FailureClass>,
    channel_summary: ChannelSummary,
    frame_flow_summary: FrameFlowSummary,
}

impl LifecycleStateMachine {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self::new_at(session_id, 0)
    }

    pub fn new_at(session_id: impl Into<String>, now_ms: u64) -> Self {
        Self {
            session_id: session_id.into(),
            state: SessionState::Idle,
            phase_started_at_ms: now_ms,
            transition_count: 0,
            reconnect_attempt: 0,
            last_failure_class: None,
            channel_summary: ChannelSummary::default(),
            frame_flow_summary: FrameFlowSummary::default(),
        }
    }

    pub fn with_state(session_id: impl Into<String>, state: SessionState, now_ms: u64) -> Self {
        Self {
            state,
            phase_started_at_ms: now_ms,
            ..Self::new_at(session_id, now_ms)
        }
    }

    pub fn state(&self) -> &SessionState {
        &self.state
    }

    pub fn transition_count(&self) -> u64 {
        self.transition_count
    }

    pub fn set_channel_summary(&mut self, summary: ChannelSummary) {
        self.channel_summary = summary;
    }

    pub fn set_frame_flow_summary(&mut self, summary: FrameFlowSummary) {
        self.frame_flow_summary = summary;
    }

    pub fn snapshot(&self) -> SessionStateSnapshot {
        SessionStateSnapshot {
            session_id: self.session_id.clone(),
            state: self.state.name().to_string(),
            active_substate: self
                .state
                .active_substate()
                .map(|substate| substate.as_str().to_string()),
            phase_started_at_ms: self.phase_started_at_ms,
            transition_count: self.transition_count,
            reconnect_attempt: self.reconnect_attempt,
            last_failure_class: self
                .last_failure_class
                .as_ref()
                .map(|class| class.as_str().to_string()),
            channel_summary: self.channel_summary.clone(),
            frame_flow_summary: self.frame_flow_summary.clone(),
        }
    }

    pub fn transition(
        &mut self,
        event: SessionEvent,
        now_ms: u64,
    ) -> Result<TransitionOutcome, InvalidTransition> {
        let previous = self.state.clone();
        let spec = self.transition_spec(&previous, &event, now_ms)?;
        let next = spec.next;
        let state_changed = previous != next;

        if state_changed {
            self.phase_started_at_ms = now_ms;
            self.transition_count += 1;
        }

        if let Some(class) = spec.failure_class {
            self.last_failure_class = Some(class);
        }

        if let SessionState::Reconnecting(context) = &next {
            self.reconnect_attempt = context.attempt;
        }

        self.state = next.clone();

        let mut actions = spec.actions;
        if !actions.contains(&SessionAction::EmitStateSnapshot) {
            actions.push(SessionAction::EmitStateSnapshot);
        }

        Ok(TransitionOutcome {
            previous,
            next,
            actions,
            emitted_snapshot: self.snapshot(),
        })
    }

    fn transition_spec(
        &self,
        state: &SessionState,
        event: &SessionEvent,
        now_ms: u64,
    ) -> Result<TransitionSpec, InvalidTransition> {
        use SessionAction::*;
        use SessionEvent::*;
        use SessionState::*;

        match (state, event) {
            (Idle, UserConnect) => Ok(TransitionSpec::new(Resolving, vec![ResolveHost])),
            (Resolving, HostResolved) => {
                Ok(TransitionSpec::new(Connecting, vec![OpenTcpTransport]))
            }
            (Connecting, TcpConnected) => Ok(TransitionSpec::new(
                NegotiatingSecurity,
                vec![StartSecurityNegotiation],
            )),
            (NegotiatingSecurity, TlsReady | CredSspReady) => Ok(TransitionSpec::new(
                Authenticating,
                vec![StartAuthentication],
            )),
            (Authenticating, AuthenticationComplete | ActivationStarted) => {
                Ok(TransitionSpec::new(Activating, vec![StartActivation]))
            }
            (Activating, ActivationComplete) => Ok(TransitionSpec::new(
                Active(ActiveSubstate::Running),
                vec![EnterActive, InitializeVirtualChannels, StartFrameFlow],
            )),
            (Active(_), DeactivateAllReceived) => Ok(TransitionSpec::new(
                Reactivating(ReactivationContext::deactivate_all(now_ms)),
                vec![PauseFrameDelivery, DeactivateChannels, StartReactivation],
            )),
            (Reactivating(_), ReactivationComplete) => Ok(TransitionSpec::new(
                Active(ActiveSubstate::Running),
                vec![
                    ResumeChannels,
                    RefreshSurfaces,
                    ResumeFrameDelivery,
                    EmitRecoveryEvent,
                ],
            )),
            (Active(ActiveSubstate::FrontendDetached), FrontendAttached) => {
                Ok(TransitionSpec::new(
                    Active(ActiveSubstate::Running),
                    vec![SendCurrentSnapshot, ResumeFramePushes],
                ))
            }
            (Active(_), FrontendDetached) => Ok(TransitionSpec::new(
                Active(ActiveSubstate::FrontendDetached),
                vec![StopLiveFramePushes, KeepFrameStoreBudget],
            )),
            (Active(ActiveSubstate::FrontendBackpressured), BackpressureCleared) => Ok(
                TransitionSpec::new(Active(ActiveSubstate::Running), vec![ExitFrameBackpressure]),
            ),
            (Active(_), BackpressureRaised) => Ok(TransitionSpec::new(
                Active(ActiveSubstate::FrontendBackpressured),
                vec![EnterFrameBackpressure],
            )),
            (Active(ActiveSubstate::ChannelsRecovering), ChannelRecovered { channel }) => {
                Ok(TransitionSpec::new(
                    Active(ActiveSubstate::Running),
                    vec![MarkChannelRecovered(channel.clone())],
                ))
            }
            (Active(_), ChannelFault { channel }) => Ok(TransitionSpec::with_failure(
                Active(ActiveSubstate::ChannelsRecovering),
                vec![MarkChannelFaulted(channel.clone())],
                FailureClass::ChannelFault,
            )),
            (Active(_), NetworkLost) => {
                let attempt = self.reconnect_attempt.saturating_add(1);
                Ok(TransitionSpec::with_failure(
                    Reconnecting(ReconnectContext::network_lost(attempt, now_ms)),
                    vec![FreezeFrameStore, MarkChannelsSuspended, StartReconnectTimer],
                    FailureClass::NetworkTransient,
                ))
            }
            (Reconnecting(context), ReconnectTimerElapsed) => {
                let attempt = context.attempt.saturating_add(1);
                Ok(TransitionSpec::new(
                    Reconnecting(ReconnectContext::network_lost(attempt, now_ms)),
                    vec![OpenTcpTransport],
                ))
            }
            (Reconnecting(_), TcpConnected) => Ok(TransitionSpec::new(
                NegotiatingSecurity,
                vec![StartSecurityNegotiation],
            )),
            (Disconnecting(reason), UserDisconnect) => Ok(TransitionSpec::new(
                Disconnecting(reason.clone()),
                Vec::new(),
            )),
            (Terminated(reason), UserDisconnect | ServerClosed) => {
                Ok(TransitionSpec::new(Terminated(reason.clone()), Vec::new()))
            }
            (Disconnecting(DisconnectReason::UserRequested), CloseComplete) => {
                Ok(TransitionSpec::new(
                    Terminated(TerminationReason::UserRequested),
                    vec![ReleaseResources],
                ))
            }
            (state, UserDisconnect) if !state.is_terminal() => Ok(TransitionSpec::new(
                Disconnecting(DisconnectReason::UserRequested),
                vec![DrainQueues, CloseChannels, CloseTransport],
            )),
            (state, ServerClosed) if !state.is_terminal() => Ok(TransitionSpec::with_failure(
                Terminated(TerminationReason::ServerClosed),
                vec![ReleaseResources],
                FailureClass::ServerClosed,
            )),
            (state, FatalError { class }) if !state.is_terminal() => {
                Ok(TransitionSpec::with_failure(
                    Terminated(TerminationReason::Failed(class.clone())),
                    vec![ReleaseResources],
                    class.clone(),
                ))
            }
            _ => Err(InvalidTransition {
                state: state.clone(),
                event: event.clone(),
            }),
        }
    }
}

struct TransitionSpec {
    next: SessionState,
    actions: Vec<SessionAction>,
    failure_class: Option<FailureClass>,
}

impl TransitionSpec {
    fn new(next: SessionState, actions: Vec<SessionAction>) -> Self {
        Self {
            next,
            actions,
            failure_class: None,
        }
    }

    fn with_failure(
        next: SessionState,
        actions: Vec<SessionAction>,
        failure_class: FailureClass,
    ) -> Self {
        Self {
            next,
            actions,
            failure_class: Some(failure_class),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_reaches_active_running() {
        let mut machine = LifecycleStateMachine::new("session-1");

        assert_eq!(
            machine
                .transition(SessionEvent::UserConnect, 10)
                .unwrap()
                .next,
            SessionState::Resolving
        );
        assert_eq!(
            machine
                .transition(SessionEvent::HostResolved, 20)
                .unwrap()
                .next,
            SessionState::Connecting
        );
        assert_eq!(
            machine
                .transition(SessionEvent::TcpConnected, 30)
                .unwrap()
                .next,
            SessionState::NegotiatingSecurity
        );
        assert_eq!(
            machine.transition(SessionEvent::TlsReady, 40).unwrap().next,
            SessionState::Authenticating
        );
        assert_eq!(
            machine
                .transition(SessionEvent::AuthenticationComplete, 50)
                .unwrap()
                .next,
            SessionState::Activating
        );

        let outcome = machine
            .transition(SessionEvent::ActivationComplete, 60)
            .unwrap();

        assert_eq!(outcome.next, SessionState::Active(ActiveSubstate::Running));
        assert!(outcome
            .actions
            .contains(&SessionAction::InitializeVirtualChannels));
        assert_eq!(outcome.emitted_snapshot.state, "active");
        assert_eq!(
            outcome.emitted_snapshot.active_substate.as_deref(),
            Some("running")
        );
        assert_eq!(outcome.emitted_snapshot.transition_count, 6);
    }

    #[test]
    fn invalid_transition_is_rejected_without_changing_state() {
        let mut machine = LifecycleStateMachine::new("session-1");

        let error = machine
            .transition(SessionEvent::ActivationComplete, 10)
            .unwrap_err();

        assert_eq!(error.state, SessionState::Idle);
        assert_eq!(machine.state(), &SessionState::Idle);
        assert_eq!(machine.transition_count(), 0);
    }

    #[test]
    fn user_disconnect_is_idempotent_from_non_terminal_states() {
        let states = vec![
            SessionState::Idle,
            SessionState::Resolving,
            SessionState::Connecting,
            SessionState::NegotiatingSecurity,
            SessionState::Authenticating,
            SessionState::Activating,
            SessionState::Active(ActiveSubstate::Running),
            SessionState::Active(ActiveSubstate::FrontendDetached),
            SessionState::Reactivating(ReactivationContext::deactivate_all(0)),
            SessionState::Reconnecting(ReconnectContext::network_lost(1, 0)),
            SessionState::Draining(DrainReason::UserRequested),
        ];

        for state in states {
            let mut machine = LifecycleStateMachine::with_state("session-1", state, 0);

            let first = machine
                .transition(SessionEvent::UserDisconnect, 10)
                .unwrap();
            assert_eq!(
                first.next,
                SessionState::Disconnecting(DisconnectReason::UserRequested)
            );
            assert!(first.actions.contains(&SessionAction::DrainQueues));
            let count_after_first = machine.transition_count();

            let second = machine
                .transition(SessionEvent::UserDisconnect, 20)
                .unwrap();
            assert_eq!(
                second.next,
                SessionState::Disconnecting(DisconnectReason::UserRequested)
            );
            assert!(!second.actions.contains(&SessionAction::DrainQueues));
            assert_eq!(machine.transition_count(), count_after_first);
        }
    }

    #[test]
    fn reactivation_and_reconnect_are_distinct_states() {
        let mut reactivation_machine = LifecycleStateMachine::with_state(
            "session-1",
            SessionState::Active(ActiveSubstate::Running),
            0,
        );
        let reactivation = reactivation_machine
            .transition(SessionEvent::DeactivateAllReceived, 10)
            .unwrap();

        assert!(matches!(
            reactivation.next,
            SessionState::Reactivating(ReactivationContext {
                reason: ReactivationReason::DeactivateAll,
                ..
            })
        ));
        assert!(reactivation
            .actions
            .contains(&SessionAction::PauseFrameDelivery));

        let mut reconnect_machine = LifecycleStateMachine::with_state(
            "session-1",
            SessionState::Active(ActiveSubstate::Running),
            0,
        );
        let reconnect = reconnect_machine
            .transition(SessionEvent::NetworkLost, 10)
            .unwrap();

        assert!(matches!(
            reconnect.next,
            SessionState::Reconnecting(ReconnectContext {
                reason: ReconnectReason::NetworkLost,
                attempt: 1,
                ..
            })
        ));
        assert!(reconnect.actions.contains(&SessionAction::FreezeFrameStore));
        assert_eq!(reconnect.emitted_snapshot.reconnect_attempt, 1);
    }

    #[test]
    fn active_substates_have_guarded_transitions() {
        let mut machine = LifecycleStateMachine::with_state(
            "session-1",
            SessionState::Active(ActiveSubstate::Running),
            0,
        );

        assert!(machine
            .transition(SessionEvent::BackpressureCleared, 10)
            .is_err());

        let raised = machine
            .transition(SessionEvent::BackpressureRaised, 20)
            .unwrap();
        assert_eq!(
            raised.next,
            SessionState::Active(ActiveSubstate::FrontendBackpressured)
        );

        let cleared = machine
            .transition(SessionEvent::BackpressureCleared, 30)
            .unwrap();
        assert_eq!(cleared.next, SessionState::Active(ActiveSubstate::Running));

        let detached = machine
            .transition(SessionEvent::FrontendDetached, 40)
            .unwrap();
        assert_eq!(
            detached.next,
            SessionState::Active(ActiveSubstate::FrontendDetached)
        );

        let attached = machine
            .transition(SessionEvent::FrontendAttached, 50)
            .unwrap();
        assert_eq!(attached.next, SessionState::Active(ActiveSubstate::Running));
    }

    #[test]
    fn fatal_failure_snapshot_is_secret_safe() {
        let mut machine = LifecycleStateMachine::with_state(
            "session-1",
            SessionState::Active(ActiveSubstate::Running),
            0,
        );

        let outcome = machine
            .transition(
                SessionEvent::FatalError {
                    class: FailureClass::AuthRejected,
                },
                10,
            )
            .unwrap();
        let encoded = serde_json::to_string(&outcome.emitted_snapshot).unwrap();

        assert_eq!(outcome.emitted_snapshot.state, "terminated");
        assert_eq!(
            outcome.emitted_snapshot.last_failure_class.as_deref(),
            Some("auth_rejected")
        );
        assert!(!encoded.contains("password"));
        assert!(!encoded.contains("username"));
        assert!(!encoded.contains("host"));
        assert!(!encoded.contains("pdu"));
    }

    #[test]
    fn maps_existing_public_status_and_phase_strings() {
        assert_eq!(
            SessionState::from_public_status("connected"),
            Some(SessionState::Active(ActiveSubstate::Running))
        );
        assert_eq!(
            SessionState::from_public_status("reconnecting"),
            Some(SessionState::Reconnecting(ReconnectContext::network_lost(
                0, 0
            )))
        );
        assert_eq!(
            SessionState::from_phase_str("configuring"),
            Some(SessionState::Resolving)
        );
        assert_eq!(
            SessionState::from_phase_str("tls_upgrade"),
            Some(SessionState::NegotiatingSecurity)
        );
        assert_eq!(
            SessionState::from_phase_str("authenticating"),
            Some(SessionState::Authenticating)
        );
        assert_eq!(
            SessionState::from(ConnectionPhase::CapabilityExchange),
            SessionState::Activating
        );
    }

    #[test]
    fn channel_fault_is_isolated_as_active_recovery_state() {
        let mut machine = LifecycleStateMachine::with_state(
            "session-1",
            SessionState::Active(ActiveSubstate::Running),
            0,
        );

        let faulted = machine
            .transition(
                SessionEvent::ChannelFault {
                    channel: "rdpdr".to_string(),
                },
                10,
            )
            .unwrap();

        assert_eq!(
            faulted.next,
            SessionState::Active(ActiveSubstate::ChannelsRecovering)
        );
        assert_eq!(
            faulted.emitted_snapshot.last_failure_class.as_deref(),
            Some("channel_fault")
        );
        assert!(faulted
            .actions
            .contains(&SessionAction::MarkChannelFaulted("rdpdr".to_string())));

        let recovered = machine
            .transition(
                SessionEvent::ChannelRecovered {
                    channel: "rdpdr".to_string(),
                },
                20,
            )
            .unwrap();
        assert_eq!(
            recovered.next,
            SessionState::Active(ActiveSubstate::Running)
        );
    }
}
