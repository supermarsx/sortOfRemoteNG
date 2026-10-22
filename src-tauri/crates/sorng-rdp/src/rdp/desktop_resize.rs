//! A resize receipt confirms a Display Control write, never server negotiation.
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

pub const AVAILABILITY_LIMIT: Duration = Duration::from_secs(5);
pub const UNAVAILABLE: &str =
    "Remote desktop resize is unavailable; the negotiated resolution is unchanged";

pub struct DesktopResizeRequest {
    pub width: u16,
    pub height: u16,
    expires: Instant,
    reply: Option<oneshot::Sender<Result<(), String>>>,
}

impl DesktopResizeRequest {
    pub fn new(width: u16, height: u16, reply: oneshot::Sender<Result<(), String>>) -> Self {
        Self {
            width,
            height,
            expires: Instant::now() + AVAILABILITY_LIMIT,
            reply: Some(reply),
        }
    }

    pub(crate) fn legacy(width: u16, height: u16) -> Self {
        Self {
            width,
            height,
            expires: Instant::now() + AVAILABILITY_LIMIT,
            reply: None,
        }
    }

    fn finish(mut self, result: Result<(), String>) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(result);
        }
    }
}

impl Drop for DesktopResizeRequest {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err(UNAVAILABLE.to_owned()));
        }
    }
}

pub(crate) enum ResizeWriteError {
    Encode,
    Transport(String),
}

#[derive(Default)]
pub(crate) struct PendingDesktopResize(Option<DesktopResizeRequest>);

impl PendingDesktopResize {
    pub(crate) fn replace(&mut self, request: DesktopResizeRequest) {
        if let Some(previous) = self.0.replace(request) {
            previous.finish(Err(
                "Remote desktop resize was superseded by a newer size".to_owned()
            ));
        }
    }

    pub(crate) fn pending(&self) -> bool {
        self.0.is_some()
    }

    /// `None` means the Display Control DVC is not ready yet. Keep the exact
    /// latest request for a later protocol tick, rather than losing it.
    pub(crate) fn advance(
        &mut self,
        now: Instant,
        write: impl FnOnce(u16, u16) -> Option<Result<(), ResizeWriteError>>,
    ) -> Result<(), String> {
        let Some(request) = self.0.as_ref() else {
            return Ok(());
        };
        if now >= request.expires
            || request
                .reply
                .as_ref()
                .is_some_and(oneshot::Sender::is_closed)
        {
            self.0
                .take()
                .expect("pending request")
                .finish(Err(UNAVAILABLE.to_owned()));
            return Ok(());
        }
        match write(request.width, request.height) {
            None => Ok(()),
            Some(result) => {
                let request = self.0.take().expect("pending request");
                match result {
                    Ok(()) => {
                        request.finish(Ok(()));
                        Ok(())
                    }
                    Err(ResizeWriteError::Encode) => {
                        request.finish(Err(UNAVAILABLE.to_owned()));
                        Ok(())
                    }
                    Err(ResizeWriteError::Transport(error)) => {
                        request.finish(Err(
                            "Remote desktop resize transport write failed".to_owned()
                        ));
                        Err(error)
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_ready_keeps_latest_until_actual_write_and_receipt() {
        let (reply, mut receipt) = oneshot::channel();
        let mut pending = PendingDesktopResize::default();
        pending.replace(DesktopResizeRequest::new(1400, 800, reply));
        pending.advance(Instant::now(), |_, _| None).unwrap();
        assert!(pending.pending());
        assert!(matches!(
            receipt.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        pending
            .advance(Instant::now(), |w, h| {
                assert_eq!((w, h), (1400, 800));
                Some(Ok(()))
            })
            .unwrap();
        assert_eq!(receipt.try_recv(), Ok(Ok(())));
        assert!(!pending.pending());
    }

    #[test]
    fn superseding_size_resolves_old_receipt_and_only_writes_latest() {
        let (old, mut old_receipt) = oneshot::channel();
        let (latest, mut latest_receipt) = oneshot::channel();
        let mut pending = PendingDesktopResize::default();
        pending.replace(DesktopResizeRequest::new(1000, 700, old));
        pending.replace(DesktopResizeRequest::new(1600, 900, latest));
        assert!(old_receipt
            .try_recv()
            .unwrap()
            .unwrap_err()
            .contains("superseded"));
        pending
            .advance(Instant::now(), |w, h| {
                assert_eq!((w, h), (1600, 900));
                Some(Ok(()))
            })
            .unwrap();
        assert_eq!(latest_receipt.try_recv(), Ok(Ok(())));
    }

    #[test]
    fn expired_or_withdrawn_requests_never_write() {
        let (reply, mut receipt) = oneshot::channel();
        let mut pending = PendingDesktopResize::default();
        let now = Instant::now();
        pending.replace(DesktopResizeRequest::new(1400, 800, reply));
        pending
            .advance(
                now + AVAILABILITY_LIMIT + Duration::from_millis(1),
                |_, _| panic!("expired request wrote"),
            )
            .unwrap();
        assert!(receipt.try_recv().unwrap().is_err());
        assert!(!pending.pending());
        let (reply, receipt) = oneshot::channel();
        let mut pending = PendingDesktopResize::default();
        pending.replace(DesktopResizeRequest::new(1400, 800, reply));
        drop(receipt);
        pending
            .advance(Instant::now(), |_, _| panic!("withdrawn request wrote"))
            .unwrap();
        assert!(!pending.pending());
    }

    #[test]
    fn ending_transport_fails_unsent_receipt_instead_of_replaying_it() {
        let (reply, mut receipt) = oneshot::channel();
        let mut pending = PendingDesktopResize::default();
        pending.replace(DesktopResizeRequest::new(1400, 800, reply));
        drop(pending);
        assert!(receipt.try_recv().unwrap().is_err());
    }

    #[test]
    fn encode_and_transport_failure_cannot_acknowledge_resize() {
        for transport in [false, true] {
            let (reply, mut receipt) = oneshot::channel();
            let mut pending = PendingDesktopResize::default();
            pending.replace(DesktopResizeRequest::new(1400, 800, reply));
            let result = pending.advance(Instant::now(), |_, _| {
                Some(Err(if transport {
                    ResizeWriteError::Transport("fixture transport error".into())
                } else {
                    ResizeWriteError::Encode
                }))
            });
            assert_eq!(result.is_err(), transport);
            assert!(receipt.try_recv().unwrap().is_err());
        }
    }
}
