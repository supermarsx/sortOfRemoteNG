//! Wake-signaled command channel for the RDP session loop.
//!
//! Wraps a `tokio::sync::mpsc::UnboundedSender/Receiver<RdpCommand>` with a
//! TCP socketpair "wake pipe".  When the sender enqueues a command it also
//! writes 1 byte to the pipe, allowing the session loop to `poll()` on both
//! the RDP TCP socket AND the wake pipe simultaneously — no timeout polling.

use crate::rdp::types::RdpCommand;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

// ─── Wake pipe (cross-platform TCP socketpair) ──────────────────────────

/// Create a connected TCP socketpair on localhost for use as a wake pipe.
/// Both ends are set to non-blocking.
pub fn create_wake_pair() -> io::Result<(TcpStream, TcpStream)> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    let writer = TcpStream::connect(addr)?;
    let (reader, _) = listener.accept()?;
    reader.set_nonblocking(true)?;
    writer.set_nonblocking(true)?;
    Ok((reader, writer))
}

// ─── WakeSender ─────────────────────────────────────────────────────────

/// A command sender that signals a wake pipe whenever a command is enqueued.
/// Thread-safe: can be cloned and shared across tokio tasks.
pub struct WakeSender {
    inner: mpsc::UnboundedSender<RdpCommand>,
    wake_writer: Arc<std::sync::Mutex<TcpStream>>,
    signaled: Arc<AtomicBool>,
}

impl WakeSender {
    pub fn new(
        inner: mpsc::UnboundedSender<RdpCommand>,
        wake_writer: TcpStream,
        signaled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            inner,
            wake_writer: Arc::new(std::sync::Mutex::new(wake_writer)),
            signaled,
        }
    }

    /// Send a command and signal the session loop to wake up.
    pub fn send(
        &self,
        cmd: RdpCommand,
    ) -> Result<(), mpsc::error::SendError<RdpCommand>> {
        self.inner.send(cmd)?;
        // Coalesce: only write if not already signaled since last drain
        if !self.signaled.swap(true, Ordering::AcqRel) {
            if let Ok(mut w) = self.wake_writer.lock() {
                let _ = w.write_all(&[1u8]);
            }
        }
        Ok(())
    }
}

impl Clone for WakeSender {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            wake_writer: Arc::clone(&self.wake_writer),
            signaled: Arc::clone(&self.signaled),
        }
    }
}

// ─── WakeReceiver ───────────────────────────────────────────────────────

/// The receiving end used inside the session loop.  Provides access to
/// both the command channel and the wake pipe's reading end (for polling).
pub struct WakeReceiver {
    pub cmd_rx: mpsc::UnboundedReceiver<RdpCommand>,
    pub wake_reader: TcpStream,
    signaled: Arc<AtomicBool>,
}

impl WakeReceiver {
    pub fn new(
        cmd_rx: mpsc::UnboundedReceiver<RdpCommand>,
        wake_reader: TcpStream,
        signaled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            cmd_rx,
            wake_reader,
            signaled,
        }
    }

    /// Drain all pending bytes from the wake pipe and reset the signal flag.
    /// Call this after the poller wakes.
    pub fn drain_wake(&self) {
        self.signaled.store(false, Ordering::Release);
        let mut buf = [0u8; 64];
        let mut reader = &self.wake_reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(_) => continue,
                Err(_) => break, // WouldBlock or other — done
            }
        }
    }
}

// ─── Factory ────────────────────────────────────────────────────────────

/// Create a wake-signaled command channel pair.
pub fn create_wake_channel() -> io::Result<(WakeSender, WakeReceiver)> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<RdpCommand>();
    let (wake_reader, wake_writer) = create_wake_pair()?;
    let signaled = Arc::new(AtomicBool::new(false));
    let tx = WakeSender::new(cmd_tx, wake_writer, Arc::clone(&signaled));
    let rx = WakeReceiver::new(cmd_rx, wake_reader, signaled);
    Ok((tx, rx))
}
