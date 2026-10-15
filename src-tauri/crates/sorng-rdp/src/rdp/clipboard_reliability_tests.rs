use super::*;

fn formats() -> Vec<ClipboardFormat> {
    vec![ClipboardFormat::new(ClipboardFormatId::new(CF_UNICODETEXT))]
}
fn publication(
    text: &str,
) -> (
    ClipboardPublication,
    tokio::sync::oneshot::Receiver<Result<(), String>>,
) {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    (ClipboardPublication::new(text.into(), sender), receiver)
}

#[test]
fn initial_empty_advertisement_does_not_require_local_copy_or_ready() {
    let mut state = ClipboardState::new(ClipboardDirection::ServerToClient);
    assert!(state.next_advertisement().is_none());
    state.request_initial_formats();
    assert!(state.next_advertisement().unwrap().is_empty());
    assert!(!state.ready);
}

#[test]
fn publication_waits_for_monitor_ready_write_and_initial_ack() {
    let mut state = ClipboardState::default();
    let (request, mut receiver) = publication("first");
    state.queue_publication(request);
    assert!(state.next_advertisement().is_none());
    state.request_initial_formats();
    assert_eq!(state.next_advertisement().unwrap().len(), 1);
    state.advertisement_written();
    assert!(receiver.try_recv().is_err());
    state.mark_ready();
    assert_eq!(receiver.try_recv().unwrap(), Ok(()));
}

#[test]
fn closed_or_expired_receipt_withdraws_unpublished_text() {
    for expired in [false, true] {
        let mut state = ClipboardState::default();
        state.mark_ready();
        let (mut request, receiver) = publication("private");
        if expired {
            request.deadline = Instant::now() - Duration::from_secs(1);
        } else {
            drop(receiver);
        }
        state.queue_publication(request);
        assert!(state.local_text.is_none());
    }
}

#[test]
fn overlapping_publication_is_rejected_without_overwriting_first() {
    let mut state = ClipboardState::default();
    let (first, _first_receipt) = publication("first");
    let (second, mut second_receipt) = publication("second");
    state.queue_publication(first);
    state.queue_publication(second);
    assert!(second_receipt.try_recv().unwrap().is_err());
    assert_eq!(state.local_text.as_deref(), Some("first"));
}

#[test]
fn stale_response_drains_before_latest_request_and_preserves_new_formats() {
    let mut state = ClipboardState::default();
    state.mark_ready();
    state.store_remote_formats(&formats());
    state.request_remote_text();
    assert!(state.begin_remote_text());
    let old_generation = state.remote_generation;
    state.store_remote_formats(&formats());
    assert!(state.remote_generation > old_generation);
    assert!(!state.begin_remote_text());
    assert!(!state.accept_remote_response());
    assert_eq!(state.remote_formats.len(), 1);
    assert!(state.begin_remote_text());
    assert!(state.accept_remote_response());
    assert!(!state.accept_remote_response());
}

#[test]
fn policy_aba_rejects_inflight_response_and_identical_policy_is_noop() {
    let mut state = ClipboardState::default();
    state.mark_ready();
    state.store_remote_formats(&formats());
    let initial = state.remote_generation;
    state.set_policy(true, ClipboardDirection::Bidirectional);
    assert_eq!(state.remote_generation, initial);
    state.request_remote_text();
    assert!(state.begin_remote_text());
    state.set_policy(false, ClipboardDirection::Bidirectional);
    state.set_policy(true, ClipboardDirection::Bidirectional);
    assert!(!state.accept_remote_response());
}

#[test]
fn fifo_requests_snapshot_payload_and_unknown_format_never_gets_text() {
    let mut state = ClipboardState::default();
    state.stage_text("first".into());
    for format in [CF_UNICODETEXT, 999, CF_UNICODETEXT] {
        state.queue_format_data_request(FormatDataRequest {
            format: ClipboardFormatId::new(format),
        });
    }
    state.stage_text("second".into());
    assert_eq!(state.pending_data_request.len(), 3);
    let first = state.pending_data_request.pop_front().unwrap();
    let unknown = state.pending_data_request.pop_front().unwrap();
    let last = state.pending_data_request.pop_front().unwrap();
    assert_eq!(first.offer.text.as_deref(), Some("first"));
    assert!(Arc::ptr_eq(&first.offer, &last.offer));
    assert!(format_data_response(&unknown, true).is_error());
    assert!(!format_data_response(&first, true).is_error());
    assert!(format_data_response(&first, false).is_error());
}

#[test]
fn direction_revocation_clears_offer_and_invalidates_queued_snapshot() {
    let mut state = ClipboardState::default();
    state.stage_text("first".into());
    state.queue_format_data_request(FormatDataRequest {
        format: ClipboardFormatId::new(CF_UNICODETEXT),
    });
    let pending = state.pending_data_request.pop_front().unwrap();
    state.set_policy(true, ClipboardDirection::ServerToClient);
    assert!(state.local_text.is_none());
    assert_ne!(pending.offer.epoch, state.offer_epoch);
    assert!(state.next_advertisement().is_none());
    state.request_initial_formats();
    assert!(state.next_advertisement().unwrap().is_empty());
}

#[test]
fn real_monitor_ready_emits_initial_pdus_and_ack_unlocks_remote_first_copy() {
    use crate::ironrdp_cliprdr::pdu::{ClipboardPdu, FormatListResponse};
    use crate::ironrdp_svc::SvcProcessor;
    let shared = Arc::new(Mutex::new(ClipboardState::new(
        ClipboardDirection::ServerToClient,
    )));
    let backend = AppCliprdrBackend::new(
        "synthetic".into(),
        Arc::new(sorng_core::events::NoopEventEmitter),
        shared.clone(),
    );
    let mut client = crate::ironrdp_cliprdr::CliprdrClient::new(Box::new(backend));
    let monitor_ready = crate::ironrdp_core::encode_vec(&ClipboardPdu::MonitorReady).unwrap();
    client.process(&monitor_ready).unwrap();
    let initial_formats = shared.lock().unwrap().next_advertisement().unwrap();
    assert!(initial_formats.is_empty());
    let messages: Vec<crate::ironrdp_svc::SvcMessage> =
        client.initiate_copy(&initial_formats).unwrap().into();
    assert!(
        !messages.is_empty(),
        "initial capabilities and empty format list must be sent"
    );
    shared.lock().unwrap().advertisement_written();
    assert!(!shared.lock().unwrap().ready);
    let ack =
        crate::ironrdp_core::encode_vec(&ClipboardPdu::FormatListResponse(FormatListResponse::Ok))
            .unwrap();
    client.process(&ack).unwrap();
    assert!(shared.lock().unwrap().ready);
    let mut state = shared.lock().unwrap();
    state.store_remote_formats(&formats());
    state.request_remote_text();
    assert!(state.begin_remote_text());
    drop(state);
    let messages: Vec<crate::ironrdp_svc::SvcMessage> = client
        .initiate_paste(ClipboardFormatId::new(CF_UNICODETEXT))
        .unwrap()
        .into();
    assert!(!messages.is_empty());
}

#[test]
fn reconnect_checkpoint_withdraws_clipboard_receipt_and_never_replays_action() {
    use crate::rdp::{types::RdpCommand, wake_channel::create_wake_channel};
    let (sender, mut receiver) = create_wake_channel().unwrap();
    let (request, mut receipt) = publication("not replayed");
    sender.send(RdpCommand::ClipboardPublish(request)).unwrap();
    sender.send(RdpCommand::ClipboardPaste).unwrap();
    receiver.preserve_pending_for_checkpoint();
    assert!(receipt.try_recv().unwrap().is_err());
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    ));
}

#[test]
fn reactivation_withdraws_canceled_unpublished_offer_and_queued_data() {
    let mut state = ClipboardState::default();
    let (request, mut receipt) = publication("canceled");
    state.queue_publication(request);
    state.queue_format_data_request(FormatDataRequest {
        format: ClipboardFormatId::new(CF_UNICODETEXT),
    });
    let pending = state.pending_data_request.pop_front().unwrap();
    state.mark_suspended_for_reactivation();
    state.mark_reactivated();
    assert!(receipt.try_recv().unwrap().is_err());
    assert!(state.local_text.is_none());
    assert_ne!(pending.offer.epoch, state.offer_epoch);
    assert!(state.next_advertisement().unwrap().is_empty());
}

#[test]
fn missing_response_requires_reconnect_instead_of_rebinding_late_payload() {
    let mut state = ClipboardState::default();
    state.mark_ready();
    state.store_remote_formats(&formats());
    state.request_remote_text();
    assert!(state.begin_remote_text());
    state.remote_request_started = Some(Instant::now() - Duration::from_secs(6));
    assert!(state.remote_response_expired());
    assert!(!state.remote_response_expired());
    state.set_policy(true, ClipboardDirection::Bidirectional);
    assert!(!state.allows_server_to_client());
    assert!(!state.accept_remote_response());
    state.request_remote_text();
    assert!(!state.begin_remote_text());
}
