use super::types::RloginError;
use std::future::Future;
use std::pin::Pin;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub type RloginIoFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, RloginError>> + Send + 'a>>;

/// Minimal byte-stream contract used by the protocol engine.  Unlike a Tokio
/// trait alias, this can also be implemented by the shared transport crate's
/// split reader/writer pair while retaining its timeout and cancellation
/// behavior.
pub trait RloginByteStream: Send {
    fn read_bytes<'a>(&'a mut self, buffer: &'a mut [u8]) -> RloginIoFuture<'a, usize>;
    fn write_all_bytes<'a>(&'a mut self, bytes: &'a [u8]) -> RloginIoFuture<'a, ()>;
    fn flush_bytes(&mut self) -> RloginIoFuture<'_, ()>;
    fn shutdown_bytes(&mut self) -> RloginIoFuture<'_, ()>;
}

impl<T> RloginByteStream for T
where
    T: AsyncRead + AsyncWrite + Unpin + Send,
{
    fn read_bytes<'a>(&'a mut self, buffer: &'a mut [u8]) -> RloginIoFuture<'a, usize> {
        Box::pin(async move { self.read(buffer).await.map_err(RloginError::io) })
    }

    fn write_all_bytes<'a>(&'a mut self, bytes: &'a [u8]) -> RloginIoFuture<'a, ()> {
        Box::pin(async move { self.write_all(bytes).await.map_err(RloginError::io) })
    }

    fn flush_bytes(&mut self) -> RloginIoFuture<'_, ()> {
        Box::pin(async move { self.flush().await.map_err(RloginError::io) })
    }

    fn shutdown_bytes(&mut self) -> RloginIoFuture<'_, ()> {
        Box::pin(async move { self.shutdown().await.map_err(RloginError::io) })
    }
}

pub struct BoxedRloginStream {
    inner: Box<dyn RloginByteStream>,
}

impl BoxedRloginStream {
    pub fn new<S>(stream: S) -> Self
    where
        S: RloginByteStream + 'static,
    {
        Self {
            inner: Box::new(stream),
        }
    }
}

impl RloginByteStream for BoxedRloginStream {
    fn read_bytes<'a>(&'a mut self, buffer: &'a mut [u8]) -> RloginIoFuture<'a, usize> {
        self.inner.read_bytes(buffer)
    }

    fn write_all_bytes<'a>(&'a mut self, bytes: &'a [u8]) -> RloginIoFuture<'a, ()> {
        self.inner.write_all_bytes(bytes)
    }

    fn flush_bytes(&mut self) -> RloginIoFuture<'_, ()> {
        self.inner.flush_bytes()
    }

    fn shutdown_bytes(&mut self) -> RloginIoFuture<'_, ()> {
        self.inner.shutdown_bytes()
    }
}
