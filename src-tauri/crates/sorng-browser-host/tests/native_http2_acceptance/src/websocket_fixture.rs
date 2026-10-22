//! Bounded synthetic RFC6455 echo. No general-purpose proxy or public client.
use base64::Engine;
use sha1::Digest;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub async fn echo<T: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut T,
    header: &str,
) -> std::io::Result<()> {
    let key = header
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("sec-websocket-key"))
        .map(|(_, value)| value.trim())
        .ok_or_else(|| std::io::Error::other("missing fixture WebSocket key"))?;
    if key.len() != 24
        || !base64::engine::general_purpose::STANDARD
            .decode(key)
            .is_ok_and(|v| v.len() == 16)
    {
        return Err(std::io::Error::other("invalid fixture WebSocket key"));
    }
    let accept = base64::engine::general_purpose::STANDARD.encode(sha1::Sha1::digest(
        format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes(),
    ));
    stream.write_all(format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes()).await?;
    stream.flush().await?;
    let mut head = [0; 2];
    stream.read_exact(&mut head).await?;
    let length = usize::from(head[1] & 0x7f);
    if head[0] != 0x81 || head[1] & 0x80 == 0 || length > 64 {
        return Err(std::io::Error::other(
            "bounded masked fixture text required",
        ));
    }
    let mut mask = [0; 4];
    stream.read_exact(&mut mask).await?;
    let mut body = vec![0; length];
    stream.read_exact(&mut body).await?;
    for (i, byte) in body.iter_mut().enumerate() {
        *byte ^= mask[i % 4];
    }
    if body != b"fixture" {
        return Err(std::io::Error::other("unexpected fixture WebSocket text"));
    }
    stream.write_all(b"\x81\x07fixture").await?;
    stream.flush().await?;
    Ok(())
}
