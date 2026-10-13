use std::fmt;
use std::io;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::ironrdp::pdu::fast_path::EncryptionFlags;
use crate::ironrdp::pdu::input::fast_path::{FastPathInputEvent, FastPathInputHeader};
use crate::ironrdp_core::{Encode as _, WriteCursor};
use secrecy::zeroize::Zeroizing;
use smallvec::{smallvec, SmallVec};
use tokio::sync::oneshot;

use super::types::RdpInputAction;

/// Inline capacity — 95%+ of input events produce exactly 1 `FastPathInputEvent`.
pub type InputEvents = SmallVec<[FastPathInputEvent; 2]>;

/// Most events one fast-path input PDU can carry. Its `numEvents` field is a
/// single byte ([MS-RDPBCGR] 2.2.8.1.2), so ironrdp's `FastPathInput::new`
/// refuses more.
pub const FASTPATH_INPUT_PDU_MAX_EVENTS: usize = 255;

/// UTF-16 units typed by one credential PDU. Every unit is a press and a
/// release that travel together, which leaves room for 127 of them.
pub const CREDENTIAL_UNITS_PER_PDU: usize = FASTPATH_INPUT_PDU_MAX_EVENTS / 2;
// A PDU must be able to hold a whole surrogate pair.
const _: () = assert!(CREDENTIAL_UNITS_PER_PDU >= 2);

/// Longest credential text accepted, in UTF-16 units.
pub const MAX_CREDENTIAL_INPUT_UNITS: usize = 1024;

/// How long the command waits for the session thread to start typing before
/// it withdraws the request. A live session picks one up within milliseconds.
pub const CREDENTIAL_INPUT_PICKUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Validated credential text as UTF-16 units, wiped when dropped.
pub struct CredentialText(Zeroizing<Vec<u16>>);

impl CredentialText {
    pub fn unit_count(&self) -> usize {
        self.0.len()
    }

    /// The text as consecutive runs of at most `CREDENTIAL_UNITS_PER_PDU`
    /// units, one per PDU. A surrogate pair is never split across two runs, so
    /// stopping between PDUs cannot leave half a character typed.
    fn pdu_batches(&self) -> impl Iterator<Item = &[u16]> {
        let mut rest = self.0.as_slice();
        std::iter::from_fn(move || {
            if rest.is_empty() {
                return None;
            }
            let mut len = rest.len().min(CREDENTIAL_UNITS_PER_PDU);
            // The units come from a `str`, so a high surrogate is always
            // followed by its low half.
            if len < rest.len() && (0xD800..0xDC00).contains(&rest[len - 1]) {
                len -= 1;
            }
            let (batch, tail) = rest.split_at(len);
            rest = tail;
            Some(batch)
        })
    }
}

impl fmt::Debug for CredentialText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CredentialText(<redacted>)")
    }
}

/// Credential input is text only: no scancodes, Enter, or clipboard events.
pub fn credential_text_input(data: &str) -> Result<CredentialText, String> {
    if data.is_empty()
        || data.encode_utf16().count() > MAX_CREDENTIAL_INPUT_UNITS
        || data
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '\u{2028}' | '\u{2029}'))
    {
        return Err("Credential input is empty, oversized or contains control characters".into());
    }
    // UTF-16 never needs more units than UTF-8 needs bytes, so this buffer is
    // never reallocated and no unwiped copy is left behind.
    let mut units = Zeroizing::new(Vec::with_capacity(data.len()));
    units.extend(data.encode_utf16());
    Ok(CredentialText(units))
}

/// Encodes one run of units as a fast-path input PDU: a press and a release
/// for each unit, in order.
///
/// The events are written straight into a buffer that is wiped on drop.
/// `FastPathInput` would need them in a list of its own that cannot be wiped.
fn encode_credential_pdu(units: &[u16]) -> Option<Zeroizing<Vec<u8>>> {
    let events = || {
        units.iter().flat_map(|&code| {
            [true, false]
                .into_iter()
                .flat_map(move |pressed| convert_input(&RdpInputAction::Unicode { code, pressed }))
        })
    };
    let count = events().count();
    if !(1..=FASTPATH_INPUT_PDU_MAX_EVENTS).contains(&count) {
        return None;
    }
    let header = FastPathInputHeader {
        flags: EncryptionFlags::empty(),
        data_length: events().map(|event| event.size()).sum(),
        num_events: u8::try_from(count).ok()?,
    };
    let mut pdu = Zeroizing::new(vec![0; header.size() + header.data_length]);
    let mut cursor = WriteCursor::new(&mut pdu);
    header.encode(&mut cursor).ok()?;
    for event in events() {
        event.encode(&mut cursor).ok()?;
    }
    Some(pdu)
}

/// Why a credential typing request did not type everything. The text is a
/// stable code, a colon, then a sentence; it never contains the credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialInputFailure {
    /// The session never started writing the request: nothing was typed.
    NotSent,
    /// Completion was not confirmed. Counts only fully accepted PDUs; the
    /// interrupted PDU may have arrived. Never resumed or repeated.
    Incomplete {
        written_units: usize,
        total_units: usize,
    },
}

impl fmt::Display for CredentialInputFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotSent => formatter.write_str(
                "rdp-credential-input-not-sent: the session did not accept the input and nothing was typed",
            ),
            Self::Incomplete {
                written_units,
                total_units,
            } => write!(
                formatter,
                "rdp-credential-input-incomplete: the transport accepted {written_units} of {total_units} UTF-16 units; delivery of the interrupted PDU is unknown and typing will not be resumed or repeated"
            ),
        }
    }
}

impl std::error::Error for CredentialInputFailure {}

type CredentialInputOutcome = Result<(), CredentialInputFailure>;

// Who owns a request: nobody yet, the session thread, or the command that
// took it back. Exactly one of the last two wins.
const REQUEST_PENDING: u8 = 0;
const REQUEST_WRITING: u8 = 1;
const REQUEST_WITHDRAWN: u8 = 2;

/// The session thread's half of one credential typing request.
pub struct CredentialInputRequest {
    text: CredentialText,
    owner: Arc<AtomicU8>,
    outcome: oneshot::Sender<CredentialInputOutcome>,
}

/// The command's half: it learns what the session thread wrote.
pub struct CredentialInputReceipt {
    owner: Arc<AtomicU8>,
    outcome: oneshot::Receiver<CredentialInputOutcome>,
}

/// Pairs `text` with the receipt its sender waits on. The whole credential
/// travels as one request so nothing can be typed in between its PDUs.
pub fn credential_input_request(
    text: CredentialText,
) -> (CredentialInputRequest, CredentialInputReceipt) {
    let owner = Arc::new(AtomicU8::new(REQUEST_PENDING));
    let (sender, receiver) = oneshot::channel();
    (
        CredentialInputRequest {
            text,
            owner: Arc::clone(&owner),
            outcome: sender,
        },
        CredentialInputReceipt {
            owner,
            outcome: receiver,
        },
    )
}

/// What the session thread did with one credential typing request.
#[derive(Debug)]
pub enum CredentialInputWrite {
    /// Every unit was written, as this many input events.
    Complete { events: usize },
    /// The command had stopped waiting, so nothing was written.
    Withdrawn,
    /// A PDU could not be encoded. The PDUs before it stay written.
    Unencodable,
    /// The transport refused a PDU. The PDUs before it stay written.
    TransportFailed(io::Error),
}

/// Reports how far a claimed request got, exactly once, even if the session
/// thread unwinds in the middle of it.
struct WriteReport {
    outcome: Option<oneshot::Sender<CredentialInputOutcome>>,
    written_units: usize,
    total_units: usize,
    attempted_write: bool,
}

impl Drop for WriteReport {
    fn drop(&mut self) {
        let outcome = if self.written_units == self.total_units {
            Ok(())
        } else if !self.attempted_write {
            Err(CredentialInputFailure::NotSent)
        } else {
            Err(CredentialInputFailure::Incomplete {
                written_units: self.written_units,
                total_units: self.total_units,
            })
        };
        if let Some(sender) = self.outcome.take() {
            let _ = sender.send(outcome);
        }
    }
}

impl CredentialInputRequest {
    pub fn unit_count(&self) -> usize {
        self.text.unit_count()
    }

    /// Types the credential by handing its PDUs to `write_pdu` one after the
    /// other, then tells the waiting command how it ended. The first failure
    /// stops it: what was written stays written and nothing is tried again.
    pub fn write(self, mut write_pdu: impl FnMut(&[u8]) -> io::Result<()>) -> CredentialInputWrite {
        if self
            .owner
            .compare_exchange(
                REQUEST_PENDING,
                REQUEST_WRITING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return CredentialInputWrite::Withdrawn;
        }
        let mut report = WriteReport {
            outcome: Some(self.outcome),
            written_units: 0,
            total_units: self.text.unit_count(),
            attempted_write: false,
        };
        for batch in self.text.pdu_batches() {
            let Some(pdu) = encode_credential_pdu(batch) else {
                return CredentialInputWrite::Unencodable;
            };
            // A failed transport call can follow a successful plaintext write
            // or partial socket delivery. Only an unattempted request can
            // promise that nothing was typed.
            report.attempted_write = true;
            if let Err(error) = write_pdu(&pdu) {
                return CredentialInputWrite::TransportFailed(error);
            }
            report.written_units += batch.len();
        }
        CredentialInputWrite::Complete {
            events: report.total_units * 2,
        }
    }
}

impl CredentialInputReceipt {
    /// Waits for the session thread's report. If the thread has not started
    /// writing within `pickup`, the request is withdrawn so that it can never
    /// be typed later, after its sender was told it failed.
    pub async fn wait(mut self, pickup: Duration) -> CredentialInputOutcome {
        let reported = match tokio::time::timeout(pickup, &mut self.outcome).await {
            Ok(reported) => reported,
            Err(_) if self.withdraw() => return Err(CredentialInputFailure::NotSent),
            // The session thread is already writing; only it knows how far it gets.
            Err(_) => (&mut self.outcome).await,
        };
        // A claimed request always reports, so a silent sender means the
        // request was dropped unclaimed: reconnect fence, shutdown, closed queue.
        reported.unwrap_or(Err(CredentialInputFailure::NotSent))
    }

    fn withdraw(&self) -> bool {
        self.owner
            .compare_exchange(
                REQUEST_PENDING,
                REQUEST_WITHDRAWN,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

impl Drop for CredentialInputReceipt {
    fn drop(&mut self) {
        // Nobody is waiting any more, so the request must not be typed.
        self.withdraw();
    }
}

#[cfg(test)]
mod credential_input_tests {
    use super::*;
    use crate::ironrdp::pdu::input::fast_path::{FastPathInput, KeyboardFlags};

    /// Obviously synthetic text of exactly `units` UTF-16 units: ASCII,
    /// accented, currency and CJK characters, one unit each.
    fn synthetic(units: usize) -> String {
        "synthetic-Pä55wörd-€字-"
            .chars()
            .cycle()
            .take(units)
            .collect()
    }

    fn request(text: &str) -> (CredentialInputRequest, CredentialInputReceipt) {
        credential_input_request(credential_text_input(text).unwrap())
    }

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    /// What a server types from these PDUs, per PDU: the unit of every
    /// press/release pair. Each PDU is decoded by ironrdp-pdu, which enforces
    /// the wire limit, and must hold nothing but such pairs.
    fn typed_units(pdus: &[Vec<u8>]) -> Vec<Vec<u16>> {
        pdus.iter()
            .map(|pdu| {
                let input: FastPathInput =
                    crate::ironrdp_core::decode(pdu).expect("a valid fast-path input PDU");
                assert!(
                    crate::ironrdp_core::encode_vec(&input).unwrap() == *pdu,
                    "the PDU is exactly one fast-path input PDU"
                );
                let events = input.input_events();
                assert!(events.len() <= FASTPATH_INPUT_PDU_MAX_EVENTS);
                events
                    .chunks(2)
                    .map(|pair| match pair {
                        [FastPathInputEvent::UnicodeKeyboardEvent(press, code), FastPathInputEvent::UnicodeKeyboardEvent(release, released)]
                            if press.is_empty()
                                && *release == KeyboardFlags::RELEASE
                                && code == released =>
                        {
                            *code
                        }
                        _ => panic!("a credential PDU holds only Unicode press/release pairs"),
                    })
                    .collect()
            })
            .collect()
    }

    struct Typed {
        pdus: Vec<Vec<u8>>,
        attempts: usize,
        write: CredentialInputWrite,
        outcome: CredentialInputOutcome,
    }

    /// Types `text` through a transport that accepts `accept` PDUs and refuses
    /// the next one.
    fn type_text(text: &str, accept: usize) -> Typed {
        let (request, mut receipt) = request(text);
        let mut pdus = Vec::new();
        let mut attempts = 0;
        let write = request.write(|pdu| {
            attempts += 1;
            assert!(
                matches!(
                    receipt.outcome.try_recv(),
                    Err(oneshot::error::TryRecvError::Empty)
                ),
                "the command is not answered while PDUs are still going out"
            );
            if pdus.len() == accept {
                return Err(io::ErrorKind::ConnectionReset.into());
            }
            pdus.push(pdu.to_vec());
            Ok(())
        });
        let outcome = receipt
            .outcome
            .try_recv()
            .expect("a claimed request always reports");
        Typed {
            pdus,
            attempts,
            write,
            outcome,
        }
    }

    #[test]
    fn credential_input_is_paired_unicode_without_submit() {
        // `typed_units` accepts only Unicode press/release pairs: no scancode
        // and no Enter can be among them.
        let typed = type_text("a!🔒", usize::MAX);
        assert_eq!(typed_units(&typed.pdus), [[97, 33, 0xd83d, 0xdd12]]);
    }

    #[test]
    fn credential_input_rejects_controls_and_oversize_before_building_batch() {
        for value in [
            "",
            "secret\n",
            "secret\r",
            "secret\t",
            "secret\u{1b}",
            "secret\u{85}",
            "secret\u{2028}",
        ] {
            assert!(credential_text_input(value).is_err());
        }
        assert_eq!(
            credential_text_input(&"a".repeat(1024))
                .unwrap()
                .unit_count(),
            1024
        );
        assert!(credential_text_input(&"a".repeat(1025)).is_err());
        assert!(credential_text_input(&"🔒".repeat(513)).is_err());
    }

    #[test]
    fn every_length_is_typed_whole_in_pdus_within_the_fast_path_limit() {
        for units in [
            1, 2, 126, 127, 128, 129, 253, 254, 255, 256, 381, 500, 1023, 1024,
        ] {
            let text = synthetic(units);
            let typed = type_text(&text, usize::MAX);
            assert!(
                matches!(typed.write, CredentialInputWrite::Complete { events } if events == units * 2),
                "{units} units"
            );
            assert_eq!(typed.outcome, Ok(()), "{units} units");
            let per_pdu = typed_units(&typed.pdus);
            assert_eq!(
                per_pdu.len(),
                units.div_ceil(CREDENTIAL_UNITS_PER_PDU),
                "{units} units"
            );
            assert!(per_pdu
                .iter()
                .all(|pdu| pdu.len() <= CREDENTIAL_UNITS_PER_PDU));
            assert!(
                per_pdu.concat() == utf16(&text),
                "{units} units arrive complete and in order"
            );
        }
    }

    #[test]
    fn a_pdu_never_ends_inside_a_surrogate_pair() {
        for text in [
            format!("{}🔒{}", synthetic(126), synthetic(10)),
            "🔒".repeat(512),
            format!("s{}", "🔒".repeat(200)),
            format!("{}𝔘𝔫𝔦{}", synthetic(253), "🔒".repeat(64)),
        ] {
            let typed = type_text(&text, usize::MAX);
            assert_eq!(typed.outcome, Ok(()));
            let per_pdu = typed_units(&typed.pdus);
            assert!(
                per_pdu.iter().all(|pdu| String::from_utf16(pdu).is_ok()),
                "every PDU holds whole characters"
            );
            assert!(per_pdu.concat() == utf16(&text));
        }
        // The pair that would straddle unit 127 moves to the next PDU whole.
        let straddling = type_text(&format!("{}🔒", synthetic(126)), usize::MAX);
        assert_eq!(
            typed_units(&straddling.pdus)
                .iter()
                .map(Vec::len)
                .collect::<Vec<_>>(),
            [126, 2]
        );
    }

    #[test]
    fn a_refused_pdu_stops_typing_and_reports_how_far_it_got() {
        // Three PDUs: 127 + 127 + 46 units.
        let text = synthetic(300);
        for (accept, expected) in [
            (
                0,
                CredentialInputFailure::Incomplete {
                    written_units: 0,
                    total_units: 300,
                },
            ),
            (
                1,
                CredentialInputFailure::Incomplete {
                    written_units: 127,
                    total_units: 300,
                },
            ),
            (
                2,
                CredentialInputFailure::Incomplete {
                    written_units: 254,
                    total_units: 300,
                },
            ),
        ] {
            let typed = type_text(&text, accept);
            assert!(matches!(
                typed.write,
                CredentialInputWrite::TransportFailed(_)
            ));
            assert_eq!(typed.outcome, Err(expected));
            // The refused PDU is the last one offered: no retry, nothing after it.
            assert_eq!(typed.attempts, accept + 1);
            assert!(typed_units(&typed.pdus).concat() == utf16(&text)[..accept * 127]);
        }
    }

    #[test]
    fn failures_carry_a_stable_code_and_counts_but_no_credential_text() {
        assert_eq!(
            CredentialInputFailure::NotSent.to_string(),
            "rdp-credential-input-not-sent: the session did not accept the input and nothing was typed"
        );
        assert_eq!(
            CredentialInputFailure::Incomplete {
                written_units: 127,
                total_units: 300,
            }
            .to_string(),
            "rdp-credential-input-incomplete: the transport accepted 127 of 300 UTF-16 units; delivery of the interrupted PDU is unknown and typing will not be resumed or repeated"
        );
        let text = credential_text_input(&synthetic(20)).unwrap();
        assert_eq!(format!("{text:?}"), "CredentialText(<redacted>)");
    }

    #[test]
    fn credential_buffers_are_wiped_when_dropped() {
        let text = credential_text_input(&synthetic(20)).unwrap();
        // `Zeroizing` wipes its buffer on drop. These bindings stop compiling
        // if either buffer stops being one.
        let units: &Zeroizing<Vec<u16>> = &text.0;
        let pdu: Zeroizing<Vec<u8>> = encode_credential_pdu(units).unwrap();
        assert_eq!(typed_units(&[pdu.to_vec()]), [utf16(&synthetic(20))]);
    }

    #[test]
    fn a_run_that_does_not_fit_one_pdu_is_refused_not_truncated() {
        assert!(encode_credential_pdu(&utf16(&synthetic(CREDENTIAL_UNITS_PER_PDU))).is_some());
        assert!(encode_credential_pdu(&utf16(&synthetic(CREDENTIAL_UNITS_PER_PDU + 1))).is_none());
        assert!(encode_credential_pdu(&[]).is_none());
    }

    #[tokio::test]
    async fn a_request_withdrawn_at_the_pickup_timeout_is_never_typed() {
        let (request, receipt) = request(&synthetic(300));
        assert_eq!(
            receipt.wait(Duration::from_millis(1)).await,
            Err(CredentialInputFailure::NotSent)
        );
        let mut offered = 0;
        let write = request.write(|_| {
            offered += 1;
            Ok(())
        });
        assert!(matches!(write, CredentialInputWrite::Withdrawn));
        assert_eq!(offered, 0, "the sender was told nothing was typed");
    }

    #[test]
    fn a_request_whose_sender_stopped_waiting_is_never_typed() {
        let (request, receipt) = request(&synthetic(300));
        drop(receipt);
        let mut offered = 0;
        let write = request.write(|_| {
            offered += 1;
            Ok(())
        });
        assert!(matches!(write, CredentialInputWrite::Withdrawn));
        assert_eq!(offered, 0);
    }

    #[tokio::test]
    async fn a_request_dropped_unclaimed_reports_nothing_typed_at_once() {
        let (request, receipt) = request(&synthetic(300));
        drop(request);
        let reported = tokio::time::timeout(
            Duration::from_secs(5),
            receipt.wait(Duration::from_secs(600)),
        )
        .await
        .expect("a dropped request answers without waiting for the pickup timeout");
        assert_eq!(reported, Err(CredentialInputFailure::NotSent));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_command_is_answered_only_after_the_last_pdu_even_past_the_pickup_timeout() {
        let (request, receipt) = request(&synthetic(300));
        let (stalled_tx, stalled_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel::<()>();
        let session = std::thread::spawn(move || {
            let mut pdus = 0;
            request.write(|_| {
                pdus += 1;
                if pdus == 2 {
                    // The transport stalls in the middle of the credential.
                    stalled_tx.send(()).unwrap();
                    resume_rx.recv().unwrap();
                }
                Ok(())
            })
        });
        tokio::task::spawn_blocking(move || stalled_rx.recv().unwrap())
            .await
            .unwrap();

        let waiting = tokio::spawn(receipt.wait(Duration::from_millis(1)));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            !waiting.is_finished(),
            "half-typed is neither success nor 'nothing was typed'"
        );

        resume_tx.send(()).unwrap();
        assert_eq!(waiting.await.unwrap(), Ok(()));
        assert!(matches!(
            session.join().unwrap(),
            CredentialInputWrite::Complete { events: 600 }
        ));
    }

    #[test]
    fn an_unwinding_session_thread_still_reports_how_far_it_got() {
        let (request, mut receipt) = request(&synthetic(300));
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut pdus = 0;
            request.write(|_| {
                pdus += 1;
                if pdus == 2 {
                    panic!("synthetic transport panic");
                }
                Ok(())
            })
        }));
        assert!(unwound.is_err());
        assert_eq!(
            receipt.outcome.try_recv(),
            Ok(Err(CredentialInputFailure::Incomplete {
                written_units: 127,
                total_units: 300,
            }))
        );
    }
}

// ---- Convert frontend input to IronRDP FastPathInputEvent ----

pub fn convert_input(action: &RdpInputAction) -> InputEvents {
    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
    use crate::ironrdp::pdu::input::mouse::PointerFlags;
    use crate::ironrdp::pdu::input::mouse_x::PointerXFlags;
    use crate::ironrdp::pdu::input::{MousePdu, MouseXPdu};

    match action {
        RdpInputAction::MouseMove { x, y } => {
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::MOVE,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::MouseButton {
            x,
            y,
            button,
            pressed,
        } => {
            let (_is_extended, flags) = match button {
                0 => (false, PointerFlags::LEFT_BUTTON),
                1 => (false, PointerFlags::MIDDLE_BUTTON_OR_WHEEL),
                2 => (false, PointerFlags::RIGHT_BUTTON),
                3 => {
                    return smallvec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON1
                        } else {
                            PointerXFlags::BUTTON1
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                4 => {
                    return smallvec![FastPathInputEvent::MouseEventEx(MouseXPdu {
                        flags: if *pressed {
                            PointerXFlags::DOWN | PointerXFlags::BUTTON2
                        } else {
                            PointerXFlags::BUTTON2
                        },
                        x_position: *x,
                        y_position: *y,
                    })]
                }
                _ => (false, PointerFlags::LEFT_BUTTON),
            };
            let mouse_flags = if *pressed {
                PointerFlags::DOWN | flags
            } else {
                flags
            };
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: mouse_flags,
                number_of_wheel_rotation_units: 0,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::Wheel {
            x,
            y,
            delta,
            horizontal,
        } => {
            let flags = if *horizontal {
                PointerFlags::HORIZONTAL_WHEEL
            } else {
                PointerFlags::VERTICAL_WHEEL
            };
            smallvec![FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: *delta,
                x_position: *x,
                y_position: *y,
            })]
        }
        RdpInputAction::KeyboardKey {
            scancode,
            pressed,
            extended,
        } => {
            let mut flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            if *extended {
                flags |= KeyboardFlags::EXTENDED;
            }
            smallvec![FastPathInputEvent::KeyboardEvent(flags, *scancode as u8)]
        }
        RdpInputAction::Unicode { code, pressed } => {
            let flags = if *pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            smallvec![FastPathInputEvent::UnicodeKeyboardEvent(flags, *code)]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ironrdp::pdu::input::fast_path::KeyboardFlags;
    use crate::ironrdp::pdu::input::mouse::PointerFlags;
    use crate::ironrdp::pdu::input::mouse_x::PointerXFlags;

    fn single_event(action: RdpInputAction) -> FastPathInputEvent {
        let mut events = convert_input(&action);
        assert_eq!(events.len(), 1);
        events.remove(0)
    }

    fn assert_mouse_event(
        event: &FastPathInputEvent,
        expected_flags: PointerFlags,
        expected_rotation_units: i16,
        expected_x: u16,
        expected_y: u16,
    ) {
        match event {
            FastPathInputEvent::MouseEvent(mouse) => {
                assert_eq!(mouse.flags, expected_flags);
                assert_eq!(
                    mouse.number_of_wheel_rotation_units,
                    expected_rotation_units
                );
                assert_eq!(mouse.x_position, expected_x);
                assert_eq!(mouse.y_position, expected_y);
            }
            other => panic!("expected mouse event, got {other:?}"),
        }
    }

    fn assert_mouse_x_event(
        event: &FastPathInputEvent,
        expected_flags: PointerXFlags,
        expected_x: u16,
        expected_y: u16,
    ) {
        match event {
            FastPathInputEvent::MouseEventEx(mouse) => {
                assert_eq!(mouse.flags, expected_flags);
                assert_eq!(mouse.x_position, expected_x);
                assert_eq!(mouse.y_position, expected_y);
            }
            other => panic!("expected extended mouse event, got {other:?}"),
        }
    }

    fn assert_keyboard_event(
        event: &FastPathInputEvent,
        expected_flags: KeyboardFlags,
        expected_scancode: u8,
    ) {
        match event {
            FastPathInputEvent::KeyboardEvent(flags, scancode) => {
                assert_eq!(*flags, expected_flags);
                assert_eq!(*scancode, expected_scancode);
            }
            other => panic!("expected keyboard event, got {other:?}"),
        }
    }

    fn assert_unicode_event(
        event: &FastPathInputEvent,
        expected_flags: KeyboardFlags,
        expected_code: u16,
    ) {
        match event {
            FastPathInputEvent::UnicodeKeyboardEvent(flags, code) => {
                assert_eq!(*flags, expected_flags);
                assert_eq!(*code, expected_code);
            }
            other => panic!("expected unicode keyboard event, got {other:?}"),
        }
    }

    fn input_backlog_limit() -> usize {
        let session_runner_source = include_str!("session_runner.rs");
        assert!(session_runner_source.contains("INPUT_BACKLOG_LIMIT: usize = 512"));
        512
    }

    fn coalesce_inputs(
        actions: impl IntoIterator<Item = RdpInputAction>,
    ) -> (Vec<FastPathInputEvent>, u64) {
        let mut merged = Vec::new();
        let mut dropped = 0u64;
        let backlog_limit = input_backlog_limit();

        for action in actions {
            let events = convert_input(&action);
            if merged.len() < backlog_limit {
                merged.extend(events);
            } else {
                dropped += events.len() as u64;
            }
        }

        (merged, dropped)
    }

    #[test]
    fn mouse_move_encodes_fast_path_pointer_move() {
        let event = single_event(RdpInputAction::MouseMove { x: 640, y: 360 });

        assert_mouse_event(&event, PointerFlags::MOVE, 0, 640, 360);
    }

    #[test]
    fn mouse_buttons_encode_primary_secondary_and_extended_flags() {
        let left_press = single_event(RdpInputAction::MouseButton {
            x: 10,
            y: 20,
            button: 0,
            pressed: true,
        });
        let middle_release = single_event(RdpInputAction::MouseButton {
            x: 11,
            y: 21,
            button: 1,
            pressed: false,
        });
        let right_press = single_event(RdpInputAction::MouseButton {
            x: 12,
            y: 22,
            button: 2,
            pressed: true,
        });
        let x1_press = single_event(RdpInputAction::MouseButton {
            x: 13,
            y: 23,
            button: 3,
            pressed: true,
        });
        let x2_release = single_event(RdpInputAction::MouseButton {
            x: 14,
            y: 24,
            button: 4,
            pressed: false,
        });

        assert_mouse_event(
            &left_press,
            PointerFlags::DOWN | PointerFlags::LEFT_BUTTON,
            0,
            10,
            20,
        );
        assert_mouse_event(
            &middle_release,
            PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
            0,
            11,
            21,
        );
        assert_mouse_event(
            &right_press,
            PointerFlags::DOWN | PointerFlags::RIGHT_BUTTON,
            0,
            12,
            22,
        );
        assert_mouse_x_event(
            &x1_press,
            PointerXFlags::DOWN | PointerXFlags::BUTTON1,
            13,
            23,
        );
        assert_mouse_x_event(&x2_release, PointerXFlags::BUTTON2, 14, 24);
    }

    #[test]
    fn wheel_events_encode_vertical_and_horizontal_axes() {
        let vertical = single_event(RdpInputAction::Wheel {
            x: 100,
            y: 200,
            delta: 120,
            horizontal: false,
        });
        let horizontal = single_event(RdpInputAction::Wheel {
            x: 101,
            y: 201,
            delta: -120,
            horizontal: true,
        });

        assert_mouse_event(&vertical, PointerFlags::VERTICAL_WHEEL, 120, 100, 200);
        assert_mouse_event(&horizontal, PointerFlags::HORIZONTAL_WHEEL, -120, 101, 201);
    }

    #[test]
    fn keyboard_events_preserve_scancode_release_and_extended_bits() {
        let press = single_event(RdpInputAction::KeyboardKey {
            scancode: 0x1E,
            pressed: true,
            extended: false,
        });
        let extended_release = single_event(RdpInputAction::KeyboardKey {
            scancode: 0x53,
            pressed: false,
            extended: true,
        });

        assert_keyboard_event(&press, KeyboardFlags::empty(), 0x1E);
        assert_keyboard_event(
            &extended_release,
            KeyboardFlags::RELEASE | KeyboardFlags::EXTENDED,
            0x53,
        );
    }

    #[test]
    fn unicode_events_encode_press_and_release_without_scancode_translation() {
        let press = single_event(RdpInputAction::Unicode {
            code: 0x20AC,
            pressed: true,
        });
        let release = single_event(RdpInputAction::Unicode {
            code: 0x20AC,
            pressed: false,
        });

        assert_unicode_event(&press, KeyboardFlags::empty(), 0x20AC);
        assert_unicode_event(&release, KeyboardFlags::RELEASE, 0x20AC);
    }

    #[test]
    fn coalescing_boundary_keeps_first_512_single_event_inputs() {
        let backlog_limit = input_backlog_limit() as u16;
        let actions = (0..=backlog_limit).map(|index| RdpInputAction::MouseMove {
            x: index,
            y: index + 1000,
        });

        let (merged, dropped) = coalesce_inputs(actions);

        assert_eq!(merged.len(), backlog_limit as usize);
        assert_eq!(dropped, 1);
        assert_mouse_event(
            merged.first().expect("first event"),
            PointerFlags::MOVE,
            0,
            0,
            1000,
        );
        assert_mouse_event(
            merged.last().expect("last retained event"),
            PointerFlags::MOVE,
            0,
            backlog_limit - 1,
            backlog_limit + 999,
        );
    }
}
