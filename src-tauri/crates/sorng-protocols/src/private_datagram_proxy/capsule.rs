//! Incremental RFC 9297 capsules with RFC 9298 context-zero UDP payloads.
//!
//! This is a codec only: authentication, HTTP Upgrade negotiation, native
//! destination admission and transport ownership must precede its use. Unknown
//! capsule types/contexts are discarded incrementally without buffering them.
//! A resource limit closes a stream with an excessively large capsule rather
//! than allocating from its advertised length. No network traffic is emitted.

const MAX_UDP_PAYLOAD: usize = 65_507;
const MAX_CAPSULE_VALUE: u64 = 65_535 + 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CapsuleError {
    #[error("Invalid capsule payload limit")]
    InvalidLimit,
    #[error("Capsule exceeds the resource limit")]
    TooLarge,
    #[error("Malformed or truncated capsule")]
    Malformed,
    #[error("Capsule decoder is closed")]
    Closed,
}

#[derive(Default)]
struct VarInt {
    value: u64,
    needed: u8,
    seen: u8,
}
impl VarInt {
    fn byte(&mut self, byte: u8) -> Option<u64> {
        if self.seen == 0 {
            self.needed = 1 << (byte >> 6);
            self.value = u64::from(byte & 0x3f);
        } else {
            self.value = (self.value << 8) | u64::from(byte);
        }
        self.seen += 1;
        (self.seen == self.needed).then_some(self.value)
    }
}
enum Phase {
    Kind(VarInt),
    Length { kind: u64, integer: VarInt },
    Context { remaining: u64, integer: VarInt },
    Payload { remaining: u64, bytes: Vec<u8> },
    Skip(u64),
    Closed,
}

pub struct DecodedCapsule {
    pub consumed: usize,
    pub datagram: Option<Vec<u8>>,
}

pub struct CapsuleDecoder {
    phase: Phase,
    max_payload: usize,
}
impl CapsuleDecoder {
    pub fn new(max_payload: usize) -> Result<Self, CapsuleError> {
        if !(1..=MAX_UDP_PAYLOAD).contains(&max_payload) {
            return Err(CapsuleError::InvalidLimit);
        }
        Ok(Self {
            phase: Phase::Kind(VarInt::default()),
            max_payload,
        })
    }

    /// Consumes at most one deliverable datagram. Call again with the unconsumed
    /// suffix. All partial state is retained, so fragment boundaries and caller
    /// cancellation between calls cannot reinterpret a partial capsule header.
    /// Non-minimal QUIC integer encodings are valid and deliberately accepted.
    pub fn decode(&mut self, input: &[u8]) -> Result<DecodedCapsule, CapsuleError> {
        if matches!(self.phase, Phase::Closed) {
            return Err(CapsuleError::Closed);
        }
        let mut consumed = 0;
        while consumed < input.len() {
            let phase = std::mem::replace(&mut self.phase, Phase::Closed);
            self.phase = match phase {
                Phase::Kind(mut integer) => {
                    let value = integer.byte(input[consumed]);
                    consumed += 1;
                    match value {
                        Some(kind) => Phase::Length {
                            kind,
                            integer: VarInt::default(),
                        },
                        None => Phase::Kind(integer),
                    }
                }
                Phase::Length { kind, mut integer } => {
                    let value = integer.byte(input[consumed]);
                    consumed += 1;
                    match value {
                        None => Phase::Length { kind, integer },
                        Some(length) => {
                            if length > MAX_CAPSULE_VALUE {
                                return Err(CapsuleError::TooLarge);
                            }
                            if kind == 0 {
                                if length == 0 {
                                    return Err(CapsuleError::Malformed);
                                }
                                Phase::Context {
                                    remaining: length,
                                    integer: VarInt::default(),
                                }
                            } else if length == 0 {
                                Phase::Kind(VarInt::default())
                            } else {
                                Phase::Skip(length)
                            }
                        }
                    }
                }
                Phase::Context {
                    mut remaining,
                    mut integer,
                } => {
                    let value = integer.byte(input[consumed]);
                    consumed += 1;
                    remaining -= 1;
                    match value {
                        None if remaining == 0 => return Err(CapsuleError::Malformed),
                        None => Phase::Context { remaining, integer },
                        Some(0) => {
                            if remaining > self.max_payload as u64 {
                                return Err(CapsuleError::TooLarge);
                            }
                            if remaining == 0 {
                                self.phase = Phase::Kind(VarInt::default());
                                return Ok(DecodedCapsule {
                                    consumed,
                                    datagram: Some(Vec::new()),
                                });
                            }
                            Phase::Payload {
                                remaining,
                                bytes: Vec::with_capacity(remaining as usize),
                            }
                        }
                        Some(_) if remaining == 0 => Phase::Kind(VarInt::default()),
                        Some(_) => Phase::Skip(remaining),
                    }
                }
                Phase::Payload {
                    mut remaining,
                    mut bytes,
                } => {
                    let count = (input.len() - consumed).min(remaining as usize);
                    bytes.extend_from_slice(&input[consumed..consumed + count]);
                    consumed += count;
                    remaining -= count as u64;
                    if remaining == 0 {
                        self.phase = Phase::Kind(VarInt::default());
                        return Ok(DecodedCapsule {
                            consumed,
                            datagram: Some(bytes),
                        });
                    }
                    Phase::Payload { remaining, bytes }
                }
                Phase::Skip(mut remaining) => {
                    let count = (input.len() - consumed).min(remaining as usize);
                    consumed += count;
                    remaining -= count as u64;
                    if remaining == 0 {
                        Phase::Kind(VarInt::default())
                    } else {
                        Phase::Skip(remaining)
                    }
                }
                Phase::Closed => return Err(CapsuleError::Closed),
            };
        }
        Ok(DecodedCapsule {
            consumed,
            datagram: None,
        })
    }

    /// A clean transport EOF is only valid between complete capsules. This
    /// permanently closes the decoder on both valid and truncated shutdown.
    pub fn finish(&mut self) -> Result<(), CapsuleError> {
        let phase = std::mem::replace(&mut self.phase, Phase::Closed);
        match phase {
            Phase::Kind(integer) if integer.seen == 0 => Ok(()),
            Phase::Closed => Err(CapsuleError::Closed),
            _ => Err(CapsuleError::Malformed),
        }
    }
}

pub fn encode_datagram(payload: &[u8], max_payload: usize) -> Result<Vec<u8>, CapsuleError> {
    if !(1..=MAX_UDP_PAYLOAD).contains(&max_payload) {
        return Err(CapsuleError::InvalidLimit);
    }
    if payload.len() > max_payload {
        return Err(CapsuleError::TooLarge);
    }
    let mut output = Vec::with_capacity(payload.len() + 6);
    output.push(0); // DATAGRAM capsule type.
    encode_integer((payload.len() + 1) as u64, &mut output);
    output.push(0); // Registered context zero: an unmodified UDP payload.
    output.extend_from_slice(payload);
    Ok(output)
}
fn encode_integer(value: u64, output: &mut Vec<u8>) {
    let (length, prefix) = if value < 64 {
        (1, 0)
    } else if value < 16_384 {
        (2, 0x40)
    } else {
        (4, 0x80)
    };
    let bytes = value.to_be_bytes();
    let start = bytes.len() - length;
    output.push(bytes[start] | prefix);
    output.extend_from_slice(&bytes[start + 1..]);
}

#[cfg(test)]
#[path = "capsule/tests.rs"]
mod tests;
