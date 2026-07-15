//! Transport abstraction for encoded PSRP fragments.
//!
//! Higher-level runspace and pipeline components depend only on
//! [`PsrpTransport`]. Applications provide the concrete network framing,
//! authentication, trust, cancellation, and close semantics.

use async_trait::async_trait;

use crate::error::{PsrpError, Result};

/// Abstract transport used by the runspace pool and pipeline.
///
/// `send_fragment` writes pre-encoded fragment bytes. `recv_chunk` returns
/// bytes received from the remote PowerShell endpoint. Concrete transports
/// must preserve the ordering and acknowledgement rules of their wire format.
#[async_trait]
pub trait PsrpTransport: Send {
    async fn send_fragment(&self, bytes: &[u8]) -> Result<()>;
    async fn recv_chunk(&mut self) -> Result<Vec<u8>>;
    async fn signal_stop(&self) -> Result<()>;
    async fn close_shell(&mut self) -> Result<()>;

    /// Start a pipeline, sending its first encoded fragment.
    ///
    /// The default implementation is suitable for transports that do not
    /// require a separate command-creation control message.
    async fn execute_pipeline(
        &mut self,
        fragment_bytes: &[u8],
        _pipeline_id: uuid::Uuid,
    ) -> Result<()> {
        self.send_fragment(fragment_bytes).await
    }

    /// Disconnect while leaving remote resources alive.
    ///
    /// The default fails explicitly because most transports, including the
    /// application's SSH transport, do not support reconnectable runspaces.
    async fn disconnect_shell(&mut self) -> Result<String> {
        Err(PsrpError::protocol(
            "this transport does not implement disconnect_shell",
        ))
    }
}

#[cfg(test)]
pub(crate) mod mock {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// In-memory transport used by the protocol-core test suite.
    #[derive(Clone, Default)]
    pub struct MockTransport {
        pub inbox: Arc<Mutex<VecDeque<Vec<u8>>>>,
        pub outbox: Arc<Mutex<Vec<Vec<u8>>>>,
        pub stopped: Arc<Mutex<bool>>,
        pub closed: Arc<Mutex<bool>>,
        pub fail_send: Arc<Mutex<bool>>,
        pub fail_recv: Arc<Mutex<Option<PsrpError>>>,
    }

    impl MockTransport {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn push_incoming(&self, bytes: Vec<u8>) {
            self.inbox.lock().unwrap().push_back(bytes);
        }

        pub fn sent(&self) -> Vec<Vec<u8>> {
            self.outbox.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl PsrpTransport for MockTransport {
        async fn send_fragment(&self, bytes: &[u8]) -> Result<()> {
            if *self.fail_send.lock().unwrap() {
                return Err(PsrpError::protocol("mock send failure"));
            }
            self.outbox.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }

        async fn recv_chunk(&mut self) -> Result<Vec<u8>> {
            if let Some(error) = self.fail_recv.lock().unwrap().take() {
                return Err(error);
            }
            let mut inbox = self.inbox.lock().unwrap();
            if let Some(bytes) = inbox.pop_front() {
                Ok(bytes)
            } else {
                Err(PsrpError::protocol("mock inbox empty"))
            }
        }

        async fn signal_stop(&self) -> Result<()> {
            *self.stopped.lock().unwrap() = true;
            Ok(())
        }

        async fn close_shell(&mut self) -> Result<()> {
            *self.closed.lock().unwrap() = true;
            Ok(())
        }

        async fn disconnect_shell(&mut self) -> Result<String> {
            *self.closed.lock().unwrap() = true;
            Ok("MOCK-SHELL-ID".into())
        }
    }

    #[tokio::test]
    async fn mock_roundtrip() {
        let mut transport = MockTransport::new();
        transport.send_fragment(b"hello").await.unwrap();
        assert_eq!(transport.sent(), vec![b"hello".to_vec()]);

        transport.push_incoming(b"world".to_vec());
        let received = transport.recv_chunk().await.unwrap();
        assert_eq!(received, b"world");

        transport.signal_stop().await.unwrap();
        transport.close_shell().await.unwrap();
        assert!(*transport.stopped.lock().unwrap());
        assert!(*transport.closed.lock().unwrap());
    }

    #[tokio::test]
    async fn mock_recv_failure() {
        let mut transport = MockTransport::new();
        *transport.fail_recv.lock().unwrap() = Some(PsrpError::protocol("boom"));
        assert!(transport.recv_chunk().await.is_err());
    }

    #[tokio::test]
    async fn mock_send_failure() {
        let transport = MockTransport::new();
        *transport.fail_send.lock().unwrap() = true;
        assert!(transport.send_fragment(b"x").await.is_err());
    }
}
