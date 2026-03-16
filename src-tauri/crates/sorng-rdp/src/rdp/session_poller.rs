//! Event-driven poller for the RDP session loop.
//!
//! Watches two sources simultaneously:
//! - The TCP socket (for incoming RDP server data)
//! - A wake pipe (for incoming commands from the frontend)
//!
//! The session thread sleeps in the kernel until either source is ready,
//! eliminating the timeout-based polling that added latency to input.

use std::io;
use std::net::TcpStream;
use std::time::Duration;

use polling::{Event, Events, Poller};

/// Key constants for the two event sources.
const KEY_TCP: usize = 0;
const KEY_WAKE: usize = 1;

/// Result of a single poll wait.
#[derive(Debug, Default)]
pub struct PollResult {
    pub tcp_ready: bool,
    pub wake_ready: bool,
    pub timed_out: bool,
}

/// Thin wrapper around `polling::Poller` for the two RDP session sources.
pub struct SessionPoller {
    poller: Poller,
    events: Events,
    // Store raw handles for re-arming on platforms with oneshot semantics.
    #[cfg(unix)]
    tcp_fd: std::os::unix::io::RawFd,
    #[cfg(unix)]
    wake_fd: std::os::unix::io::RawFd,
    #[cfg(windows)]
    tcp_sock: std::os::windows::io::RawSocket,
    #[cfg(windows)]
    wake_sock: std::os::windows::io::RawSocket,
}

impl SessionPoller {
    /// Create a new poller watching the given TCP and wake sockets.
    ///
    /// Both sockets MUST be in non-blocking mode.
    ///
    /// # Safety
    /// The caller must ensure both sockets outlive the `SessionPoller`.
    pub fn new(tcp_socket: &TcpStream, wake_socket: &TcpStream) -> io::Result<Self> {
        let poller = Poller::new()?;

        #[cfg(unix)]
        let (tcp_fd, wake_fd) = {
            use std::os::unix::io::AsRawFd;
            let tcp_fd = tcp_socket.as_raw_fd();
            let wake_fd = wake_socket.as_raw_fd();
            unsafe {
                use polling::os::iocp_or_io as raw;
                poller.add(tcp_fd, Event::readable(KEY_TCP))?;
                poller.add(wake_fd, Event::readable(KEY_WAKE))?;
            }
            (tcp_fd, wake_fd)
        };

        #[cfg(windows)]
        let (tcp_sock, wake_sock) = {
            use std::os::windows::io::AsRawSocket;
            let tcp_sock = tcp_socket.as_raw_socket();
            let wake_sock = wake_socket.as_raw_socket();
            unsafe {
                poller.add(tcp_sock, Event::readable(KEY_TCP))?;
                poller.add(wake_sock, Event::readable(KEY_WAKE))?;
            }
            (tcp_sock, wake_sock)
        };

        Ok(Self {
            poller,
            events: Events::new(),
            #[cfg(unix)]
            tcp_fd,
            #[cfg(unix)]
            wake_fd,
            #[cfg(windows)]
            tcp_sock,
            #[cfg(windows)]
            wake_sock,
        })
    }

    /// Block until at least one source is ready, or until `timeout` expires.
    pub fn wait(&mut self, timeout: Option<Duration>) -> io::Result<PollResult> {
        self.events.clear();
        match self.poller.wait(&mut self.events, timeout) {
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {
                return Ok(PollResult {
                    timed_out: true,
                    ..Default::default()
                });
            }
            Err(e) => return Err(e),
        }

        let mut result = PollResult::default();
        if self.events.is_empty() {
            result.timed_out = true;
        }
        for ev in self.events.iter() {
            match ev.key {
                KEY_TCP => result.tcp_ready = true,
                KEY_WAKE => result.wake_ready = true,
                _ => {}
            }
        }

        // Re-arm interests for next wait (oneshot semantics on some backends).
        self.rearm();

        Ok(result)
    }

    /// Re-register both sources as readable for the next wait.
    fn rearm(&self) {
        #[cfg(unix)]
        {
            let _ = self.poller.modify(
                unsafe { std::os::unix::io::BorrowedFd::borrow_raw(self.tcp_fd) },
                Event::readable(KEY_TCP),
            );
            let _ = self.poller.modify(
                unsafe { std::os::unix::io::BorrowedFd::borrow_raw(self.wake_fd) },
                Event::readable(KEY_WAKE),
            );
        }
        #[cfg(windows)]
        {
            let _ = self.poller.modify(
                unsafe {
                    std::os::windows::io::BorrowedSocket::borrow_raw(self.tcp_sock)
                },
                Event::readable(KEY_TCP),
            );
            let _ = self.poller.modify(
                unsafe {
                    std::os::windows::io::BorrowedSocket::borrow_raw(self.wake_sock)
                },
                Event::readable(KEY_WAKE),
            );
        }
    }
}

impl Drop for SessionPoller {
    fn drop(&mut self) {
        // Remove sources from the poller to avoid dangling registrations.
        #[cfg(unix)]
        {
            let _ = self.poller.delete(
                unsafe { std::os::unix::io::BorrowedFd::borrow_raw(self.tcp_fd) },
            );
            let _ = self.poller.delete(
                unsafe { std::os::unix::io::BorrowedFd::borrow_raw(self.wake_fd) },
            );
        }
        #[cfg(windows)]
        {
            let _ = self.poller.delete(
                unsafe {
                    std::os::windows::io::BorrowedSocket::borrow_raw(self.tcp_sock)
                },
            );
            let _ = self.poller.delete(
                unsafe {
                    std::os::windows::io::BorrowedSocket::borrow_raw(self.wake_sock)
                },
            );
        }
    }
}
