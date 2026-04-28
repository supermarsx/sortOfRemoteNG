use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use sorng_core::events::{AppEventEmitter, DynEventEmitter};
use sorng_rdp::rdp::rdpdr::pdu::{
    build_client_announce_reply, build_client_capabilities, build_client_name, build_io_completion,
    decode_utf16le, read_u16, read_u32, PAKID_CORE_CLIENTID_CONFIRM, PAKID_CORE_CLIENT_CAPABILITY,
    PAKID_CORE_CLIENT_NAME, PAKID_CORE_DEVICELIST_ANNOUNCE, PAKID_CORE_DEVICE_IOCOMPLETION,
    PAKID_CORE_DEVICE_IOREQUEST, PAKID_CORE_SERVER_ANNOUNCE, PAKID_CORE_SERVER_CAPABILITY,
    PAKID_CORE_CLIENTID_CONFIRM as PAKID_CORE_CLIENTID_CONFIRM_REQ, RDPDR_CTYP_CORE,
    STATUS_NOT_SUPPORTED,
};
use sorng_rdp::rdp::rdpdr::{DeviceFlags, RdpdrClient};
use sorng_rdp::rdp::settings::{DriveRedirectionConfig, PrinterOutputMode};

const STREAM_SEED: u64 = 0xC0FFEE_D15EA5E;
const STREAM_ITERATIONS: usize = 192;
const MAX_PAYLOAD_SIZE: usize = 192;

#[derive(Clone, Default)]
struct SilentEmitter;

impl AppEventEmitter for SilentEmitter {
    fn emit_event(&self, _event: &str, _payload: serde_json::Value) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Clone)]
struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u32(&mut self) -> u32 {
        // Numerical Recipes LCG parameters for deterministic pseudo-random bytes.
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        (self.state >> 16) as u32
    }

    fn next_u8(&mut self) -> u8 {
        (self.next_u32() & 0xFF) as u8
    }

    fn next_bounded(&mut self, max_inclusive: usize) -> usize {
        (self.next_u32() as usize) % (max_inclusive + 1)
    }
}

fn core_packet(packet_id: u16, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&RDPDR_CTYP_CORE.to_le_bytes());
    out.extend_from_slice(&packet_id.to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn new_client() -> RdpdrClient {
    let emitter: DynEventEmitter = Arc::new(SilentEmitter);
    let drives: Vec<DriveRedirectionConfig> = Vec::new();
    let flags = DeviceFlags {
        printers: false,
        ports: false,
        smart_cards: false,
    };
    RdpdrClient::new(
        "rdpdr-fuzzish".to_string(),
        emitter,
        drives,
        flags,
        PrinterOutputMode::SpoolFile,
    )
}

fn process_without_panic(client: &mut RdpdrClient, payload: &[u8]) -> Vec<Vec<u8>> {
    catch_unwind(AssertUnwindSafe(|| client.process_rdpdr_payload(payload)))
        .expect("rdpdr parser/state-machine should not panic on malformed bounded input")
}

fn fixed_malformed_corpus() -> Vec<Vec<u8>> {
    vec![
        vec![],
        vec![0x00],
        vec![0x00, 0x00],
        vec![0x00, 0x00, 0x00],
        vec![0xAA, 0xBB, 0xCC, 0xDD],
        core_packet(PAKID_CORE_SERVER_ANNOUNCE, &[]),
        core_packet(PAKID_CORE_SERVER_ANNOUNCE, &[1, 0, 12, 0, 7]),
        core_packet(PAKID_CORE_SERVER_CAPABILITY, &[0xFF]),
        core_packet(PAKID_CORE_CLIENTID_CONFIRM_REQ, &[0x01, 0x00, 0x0C]),
        core_packet(PAKID_CORE_DEVICE_IOREQUEST, &[0xFF; 19]),
        core_packet(PAKID_CORE_DEVICE_IOREQUEST, &[0xFF; 20]),
        core_packet(0xFFFF, &[0x7F; 64]),
        core_packet(PAKID_CORE_SERVER_CAPABILITY, &[0x00; 128]),
        vec![0x72, 0x44, 0x52, 0x49, 0x00, 0x11, 0x22],
        {
            let mut huge = vec![0xEE; MAX_PAYLOAD_SIZE];
            if huge.len() >= 4 {
                huge[0..2].copy_from_slice(&RDPDR_CTYP_CORE.to_le_bytes());
                huge[2..4].copy_from_slice(&PAKID_CORE_DEVICE_IOREQUEST.to_le_bytes());
            }
            huge
        },
    ]
}

fn deterministic_payload_stream(seed: u64, iterations: usize, max_payload_size: usize) -> Vec<Vec<u8>> {
    let mut rng = Lcg::new(seed);
    let mut out = Vec::with_capacity(iterations);

    for idx in 0..iterations {
        let len = rng.next_bounded(max_payload_size);
        let mut payload = vec![0u8; len];
        for byte in &mut payload {
            *byte = rng.next_u8();
        }

        if payload.len() >= 4 && idx % 3 == 0 {
            payload[0..2].copy_from_slice(&RDPDR_CTYP_CORE.to_le_bytes());
        }

        if payload.len() >= 4 && idx % 5 == 0 {
            let packet_id = match idx % 6 {
                0 => PAKID_CORE_SERVER_ANNOUNCE,
                1 => PAKID_CORE_SERVER_CAPABILITY,
                2 => PAKID_CORE_CLIENTID_CONFIRM_REQ,
                3 => PAKID_CORE_DEVICE_IOREQUEST,
                4 => 0xFFFF,
                _ => PAKID_CORE_DEVICE_IOCOMPLETION,
            };
            payload[2..4].copy_from_slice(&packet_id.to_le_bytes());
        }

        out.push(payload);
    }

    out
}

fn assert_core_header(packet: &[u8], expected_packet_id: u16) {
    assert!(packet.len() >= 4, "packet must contain RDPDR header");
    assert_eq!(read_u16(packet, 0), RDPDR_CTYP_CORE, "unexpected component");
    assert_eq!(read_u16(packet, 2), expected_packet_id, "unexpected packet id");
}

#[test]
fn rdpdr_parser_handles_bounded_malformed_corpus_without_panics() {
    let mut client = new_client();
    let mut all_inputs = fixed_malformed_corpus();
    all_inputs.extend(deterministic_payload_stream(
        STREAM_SEED,
        STREAM_ITERATIONS,
        MAX_PAYLOAD_SIZE,
    ));

    assert_eq!(all_inputs.len(), fixed_malformed_corpus().len() + STREAM_ITERATIONS);

    for payload in &all_inputs {
        let responses = process_without_panic(&mut client, payload);
        assert!(responses.len() <= 2, "unexpected response fanout for malformed input");
        for response in responses {
            assert!(response.len() <= 16 * 1024, "response length should stay bounded");
            assert!(response.len() >= 4, "all responses should include an RDPDR header");
            assert_eq!(read_u16(&response, 0), RDPDR_CTYP_CORE);
        }
    }
}

#[test]
fn deterministic_payload_generator_is_reproducible_and_bounded() {
    let a = deterministic_payload_stream(STREAM_SEED, STREAM_ITERATIONS, MAX_PAYLOAD_SIZE);
    let b = deterministic_payload_stream(STREAM_SEED, STREAM_ITERATIONS, MAX_PAYLOAD_SIZE);
    let c = deterministic_payload_stream(STREAM_SEED.wrapping_add(1), STREAM_ITERATIONS, MAX_PAYLOAD_SIZE);

    assert_eq!(a, b, "fixed seed must produce the same stream");
    assert_ne!(a, c, "different seed should alter the stream");
    assert_eq!(a.len(), STREAM_ITERATIONS);
    assert!(a.iter().all(|payload| payload.len() <= MAX_PAYLOAD_SIZE));
    assert!(a.iter().any(|payload| payload.len() >= 4 && read_u16(payload, 0) == RDPDR_CTYP_CORE));
}

#[test]
fn pdu_builders_preserve_header_and_length_invariants() {
    let mut rng = Lcg::new(0x5A17_D3C0);

    for _ in 0..24 {
        let client_id = rng.next_u32();
        let announce_reply = build_client_announce_reply(1, 12, client_id);
        assert_eq!(announce_reply.len(), 12);
        assert_core_header(&announce_reply, PAKID_CORE_CLIENTID_CONFIRM);
        assert_eq!(read_u32(&announce_reply, 8), client_id);

        let mut output = vec![0u8; rng.next_bounded(64)];
        for byte in &mut output {
            *byte = rng.next_u8();
        }
        let completion = build_io_completion(7, 99, STATUS_NOT_SUPPORTED, &output);
        assert_eq!(completion.len(), 16 + output.len());
        assert_core_header(&completion, PAKID_CORE_DEVICE_IOCOMPLETION);
        assert_eq!(read_u32(&completion, 4), 7);
        assert_eq!(read_u32(&completion, 8), 99);
        assert_eq!(read_u32(&completion, 12), STATUS_NOT_SUPPORTED);
        assert_eq!(&completion[16..], output.as_slice());

        let host = format!("HOST-{:04X}", (rng.next_u32() & 0xFFFF) as u16);
        let name_pdu = build_client_name(&host);
        assert_core_header(&name_pdu, PAKID_CORE_CLIENT_NAME);
        assert_eq!(read_u32(&name_pdu, 4), 1);
        let name_len = read_u32(&name_pdu, 12) as usize;
        assert_eq!(name_pdu.len(), 16 + name_len);
        assert_eq!(decode_utf16le(&name_pdu[16..]), host);
    }

    for printers in [false, true] {
        for ports in [false, true] {
            for smart_cards in [false, true] {
                for has_drives in [false, true] {
                    let caps = build_client_capabilities(printers, ports, smart_cards, has_drives);
                    assert_core_header(&caps, PAKID_CORE_CLIENT_CAPABILITY);
                    assert!(caps.len() >= 8, "capability response must include capability count");

                    let expected = 1
                        + usize::from(printers)
                        + usize::from(ports)
                        + usize::from(smart_cards)
                        + usize::from(has_drives);
                    let declared = read_u16(&caps, 4) as usize;
                    assert_eq!(declared, expected, "capability count invariant failed");
                }
            }
        }
    }
}

#[test]
fn rdpdr_state_machine_progress_and_unknown_device_irp_are_panic_free() {
    let mut client = new_client();

    let server_announce = core_packet(PAKID_CORE_SERVER_ANNOUNCE, &[1, 0, 12, 0, 0x34, 0x12, 0, 0]);
    let responses = process_without_panic(&mut client, &server_announce);
    assert_eq!(responses.len(), 2);
    assert_core_header(&responses[0], PAKID_CORE_CLIENTID_CONFIRM);
    assert_core_header(&responses[1], PAKID_CORE_CLIENT_NAME);

    let capabilities = core_packet(PAKID_CORE_SERVER_CAPABILITY, &[0, 0]);
    let responses = process_without_panic(&mut client, &capabilities);
    assert_eq!(responses.len(), 1);
    assert_core_header(&responses[0], PAKID_CORE_CLIENT_CAPABILITY);

    let client_confirm = core_packet(PAKID_CORE_CLIENTID_CONFIRM_REQ, &[1, 0, 12, 0, 0x34, 0x12, 0, 0]);
    let responses = process_without_panic(&mut client, &client_confirm);
    assert_eq!(responses.len(), 1);
    assert_core_header(&responses[0], PAKID_CORE_DEVICELIST_ANNOUNCE);

    let mut irp_body = vec![0u8; 20];
    irp_body[0..4].copy_from_slice(&42u32.to_le_bytes());
    irp_body[8..12].copy_from_slice(&7u32.to_le_bytes());
    let unknown_device_irp = core_packet(PAKID_CORE_DEVICE_IOREQUEST, &irp_body);
    let responses = process_without_panic(&mut client, &unknown_device_irp);
    assert_eq!(responses.len(), 1);
    assert_core_header(&responses[0], PAKID_CORE_DEVICE_IOCOMPLETION);
    assert!(responses[0].len() >= 16);
    assert_eq!(read_u32(&responses[0], 4), 42);
    assert_eq!(read_u32(&responses[0], 8), 7);
    assert_eq!(read_u32(&responses[0], 12), STATUS_NOT_SUPPORTED);
}