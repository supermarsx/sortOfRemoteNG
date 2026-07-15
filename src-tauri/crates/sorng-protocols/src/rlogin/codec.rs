use super::io::RloginByteStream;
use super::types::{RloginConfig, RloginError, WindowSize, MAX_SERVER_DIAGNOSTIC_BYTES};

const WINDOW_MAGIC: [u8; 4] = [0xff, 0xff, b's', b's'];

/// Encode the exact RFC 1282 initial client frame:
/// NUL, local-user, NUL, remote-user, NUL, terminal/speed, NUL.
pub fn encode_handshake(config: &RloginConfig) -> Result<Vec<u8>, RloginError> {
    config.validate()?;

    let descriptor = config.terminal_descriptor();
    let mut frame = Vec::with_capacity(
        4 + config.local_username.len() + config.remote_username.len() + descriptor.len(),
    );
    frame.push(0);
    frame.extend_from_slice(config.local_username.as_bytes());
    frame.push(0);
    frame.extend_from_slice(config.remote_username.as_bytes());
    frame.push(0);
    frame.extend_from_slice(descriptor.as_bytes());
    frame.push(0);
    Ok(frame)
}

/// Encode the RFC 1282 12-byte window-size message.  All numeric fields are
/// unsigned 16-bit network-byte-order values.
pub fn encode_window_update(size: WindowSize) -> [u8; 12] {
    let rows = size.rows.to_be_bytes();
    let columns = size.columns.to_be_bytes();
    let width = size.width_pixels.to_be_bytes();
    let height = size.height_pixels.to_be_bytes();
    [
        WINDOW_MAGIC[0],
        WINDOW_MAGIC[1],
        WINDOW_MAGIC[2],
        WINDOW_MAGIC[3],
        rows[0],
        rows[1],
        columns[0],
        columns[1],
        width[0],
        width[1],
        height[0],
        height[1],
    ]
}

/// Read the server's single-byte handshake response.  A zero byte enters data
/// mode.  The traditional value one introduces a human-readable diagnostic,
/// which is bounded before it is converted to text.
pub async fn read_server_ack<R>(reader: &mut R) -> Result<(), RloginError>
where
    R: RloginByteStream + ?Sized,
{
    let code = read_byte(reader)
        .await?
        .ok_or_else(|| RloginError::io("unexpected EOF before RLogin acknowledgement"))?;
    match code {
        0 => Ok(()),
        1 => Err(read_server_diagnostic(reader).await?),
        other => Err(RloginError::UnexpectedAcknowledgement(other)),
    }
}

async fn read_server_diagnostic<R>(reader: &mut R) -> Result<RloginError, RloginError>
where
    R: RloginByteStream + ?Sized,
{
    let mut bytes = Vec::with_capacity(128);
    loop {
        match read_byte(reader).await? {
            Some(b'\n') => break,
            Some(byte) => {
                if bytes.len() == MAX_SERVER_DIAGNOSTIC_BYTES {
                    return Ok(RloginError::ServerDiagnosticTooLong {
                        limit: MAX_SERVER_DIAGNOSTIC_BYTES,
                    });
                }
                bytes.push(byte);
            }
            None => break,
        }
    }

    while matches!(bytes.last(), Some(b'\r' | b'\n')) {
        bytes.pop();
    }
    let message = sanitize_diagnostic(&bytes);
    Ok(RloginError::ServerDiagnostic(if message.is_empty() {
        "server rejected the connection without a diagnostic".to_string()
    } else {
        message
    }))
}

async fn read_byte<R>(reader: &mut R) -> Result<Option<u8>, RloginError>
where
    R: RloginByteStream + ?Sized,
{
    let mut byte = [0_u8; 1];
    match reader.read_bytes(&mut byte).await? {
        0 => Ok(None),
        _ => Ok(Some(byte[0])),
    }
}

fn sanitize_diagnostic(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .map(|character| {
            if character == '\t' || !character.is_control() {
                character
            } else {
                '\u{fffd}'
            }
        })
        .collect()
}
