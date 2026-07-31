// sorng-recording - Compression module
//
// Pure functions that compress / decompress byte buffers.
// All work is CPU-bound so they should be spawned on
// `tokio::task::spawn_blocking`.

use crate::flate2::read::{DeflateDecoder, GzDecoder};
use crate::flate2::write::{DeflateEncoder, GzEncoder};
use crate::flate2::Compression;
use std::io::{self, Read, Write};

use crate::error::{RecordingError, RecordingResult};
use crate::types::CompressionAlgorithm;

pub const MAX_COMPRESSED_INPUT_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_RETAINED_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPANSION_RATIO: usize = 100;
const EXPANSION_SLACK_BYTES: usize = 64 * 1024;
const IO_BUFFER_BYTES: usize = 32 * 1024;
const COMPRESSION_ERROR: &str = "compression failed";
const COMPRESSION_LIMIT_ERROR: &str = "compression rejected by safety limits";
const DECOMPRESSION_ERROR: &str = "decompression failed";
const DECOMPRESSION_LIMIT_ERROR: &str = "decompression rejected by safety limits";

#[derive(Clone, Copy)]
struct CompressionLimits {
    max_compressed: usize,
    max_expanded: usize,
    max_retained: usize,
    max_ratio: usize,
    ratio_slack: usize,
}

const DEFAULT_COMPRESSION_LIMITS: CompressionLimits = CompressionLimits {
    max_compressed: MAX_COMPRESSED_INPUT_BYTES,
    max_expanded: MAX_EXPANDED_BYTES,
    max_retained: MAX_RETAINED_BYTES,
    max_ratio: MAX_EXPANSION_RATIO,
    ratio_slack: EXPANSION_SLACK_BYTES,
};

fn compression_error() -> RecordingError {
    RecordingError::CompressionError(COMPRESSION_ERROR.to_string())
}

fn compression_limit_error() -> RecordingError {
    RecordingError::CompressionError(COMPRESSION_LIMIT_ERROR.to_string())
}

fn decompression_error() -> RecordingError {
    RecordingError::CompressionError(DECOMPRESSION_ERROR.to_string())
}

fn decompression_limit_error() -> RecordingError {
    RecordingError::CompressionError(DECOMPRESSION_LIMIT_ERROR.to_string())
}

fn limit_io_error(compressing: bool) -> io::Error {
    io::Error::other(if compressing {
        COMPRESSION_LIMIT_ERROR
    } else {
        DECOMPRESSION_LIMIT_ERROR
    })
}

fn map_compression_io(error: io::Error) -> RecordingError {
    if error.to_string().contains(COMPRESSION_LIMIT_ERROR) {
        compression_limit_error()
    } else {
        compression_error()
    }
}

struct BoundedVecWriter {
    bytes: Vec<u8>,
    limit: usize,
    compressing: bool,
}

impl BoundedVecWriter {
    fn new(limit: usize, compressing: bool) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
            compressing,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }

    fn reserve_for(&mut self, new_len: usize) -> io::Result<()> {
        if new_len <= self.bytes.capacity() {
            return Ok(());
        }

        let target = self
            .bytes
            .capacity()
            .saturating_mul(2)
            .max(IO_BUFFER_BYTES)
            .max(new_len)
            .min(self.limit);
        self.bytes
            .try_reserve_exact(target.saturating_sub(self.bytes.capacity()))
            .map_err(|_| limit_io_error(self.compressing))
    }
}

impl Write for BoundedVecWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let new_len = self
            .bytes
            .len()
            .checked_add(buffer.len())
            .ok_or_else(|| limit_io_error(self.compressing))?;
        if new_len > self.limit {
            return Err(limit_io_error(self.compressing));
        }
        self.reserve_for(new_len)?;
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct CountingLimitWriter<W> {
    inner: W,
    written: usize,
    limit: usize,
}

impl<W> CountingLimitWriter<W> {
    fn new(inner: W, limit: usize) -> Self {
        Self {
            inner,
            written: 0,
            limit,
        }
    }

    fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for CountingLimitWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let requested = self
            .written
            .checked_add(buffer.len())
            .ok_or_else(|| limit_io_error(true))?;
        if requested > self.limit {
            return Err(limit_io_error(true));
        }

        let count = self.inner.write(buffer)?;
        self.written = self
            .written
            .checked_add(count)
            .ok_or_else(|| limit_io_error(true))?;
        Ok(count)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

// ======================================================================
// Compress
// ======================================================================

/// Compress a byte slice with the chosen algorithm.
pub fn compress(data: &[u8], algo: &CompressionAlgorithm) -> RecordingResult<Vec<u8>> {
    compress_with_limits(data, algo, DEFAULT_COMPRESSION_LIMITS)
}

fn compress_with_limits(
    data: &[u8],
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<Vec<u8>> {
    let output_limit = compression_output_limit(data.len(), algo, limits)?;
    let writer = BoundedVecWriter::new(output_limit, true);
    let writer = compress_into(data, algo, writer)?;
    Ok(writer.into_inner())
}

fn compression_output_limit(
    input_len: usize,
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<usize> {
    if input_len > limits.max_expanded {
        return Err(compression_limit_error());
    }
    let retained_output = limits
        .max_retained
        .checked_sub(input_len)
        .ok_or_else(compression_limit_error)?;
    let format_limit = if matches!(algo, CompressionAlgorithm::None) {
        limits.max_expanded
    } else {
        limits.max_compressed
    };
    Ok(format_limit.min(retained_output))
}

fn compress_into<W: Write>(
    data: &[u8],
    algo: &CompressionAlgorithm,
    writer: W,
) -> RecordingResult<W> {
    match algo {
        CompressionAlgorithm::None => {
            let mut writer = writer;
            writer.write_all(data).map_err(map_compression_io)?;
            Ok(writer)
        }
        CompressionAlgorithm::Gzip => {
            let mut encoder = GzEncoder::new(writer, Compression::default());
            encoder.write_all(data).map_err(map_compression_io)?;
            encoder.finish().map_err(map_compression_io)
        }
        CompressionAlgorithm::Zstd => {
            let mut encoder =
                crate::zstd::stream::write::Encoder::new(writer, 3).map_err(map_compression_io)?;
            encoder.write_all(data).map_err(map_compression_io)?;
            encoder.finish().map_err(map_compression_io)
        }
        CompressionAlgorithm::Deflate => {
            let mut encoder = DeflateEncoder::new(writer, Compression::default());
            encoder.write_all(data).map_err(map_compression_io)?;
            encoder.finish().map_err(map_compression_io)
        }
    }
}

// ======================================================================
// Decompress
// ======================================================================

/// Decompress a byte slice that was compressed with the given algorithm.
pub fn decompress(data: &[u8], algo: &CompressionAlgorithm) -> RecordingResult<Vec<u8>> {
    decompress_with_limits(data, algo, DEFAULT_COMPRESSION_LIMITS)
}

fn decompress_with_limits(
    data: &[u8],
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<Vec<u8>> {
    decompress_reader_with_limits(data, data.len(), data.len(), algo, limits)
}

fn decompress_reader_with_limits<R: Read>(
    reader: R,
    compressed_len: usize,
    retained_input_len: usize,
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<Vec<u8>> {
    let is_compressed = !matches!(algo, CompressionAlgorithm::None);
    if (is_compressed && compressed_len > limits.max_compressed)
        || (!is_compressed && compressed_len > limits.max_expanded)
    {
        return Err(decompression_limit_error());
    }

    let output_limit =
        expanded_output_limit(compressed_len, retained_input_len, is_compressed, limits)?;
    match algo {
        CompressionAlgorithm::None => read_expanded_bounded(reader, output_limit),
        CompressionAlgorithm::Gzip => read_expanded_bounded(GzDecoder::new(reader), output_limit),
        CompressionAlgorithm::Zstd => {
            let decoder = crate::zstd::stream::read::Decoder::new(reader)
                .map_err(|_| decompression_error())?;
            read_expanded_bounded(decoder, output_limit)
        }
        CompressionAlgorithm::Deflate => {
            read_expanded_bounded(DeflateDecoder::new(reader), output_limit)
        }
    }
}

fn expanded_output_limit(
    compressed_len: usize,
    retained_input_len: usize,
    is_compressed: bool,
    limits: CompressionLimits,
) -> RecordingResult<usize> {
    let retained_output = limits
        .max_retained
        .checked_sub(retained_input_len)
        .ok_or_else(decompression_limit_error)?;
    let mut output_limit = limits.max_expanded.min(retained_output);
    if is_compressed {
        let ratio_limit = compressed_len
            .checked_mul(limits.max_ratio)
            .and_then(|value| value.checked_add(limits.ratio_slack))
            .unwrap_or(usize::MAX);
        output_limit = output_limit.min(ratio_limit);
    }
    Ok(output_limit)
}

fn read_expanded_bounded<R: Read>(mut reader: R, output_limit: usize) -> RecordingResult<Vec<u8>> {
    let mut output = BoundedVecWriter::new(output_limit, false);
    let mut buffer = [0u8; IO_BUFFER_BYTES];

    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| decompression_error())?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| decompression_limit_error())?;
    }
    Ok(output.into_inner())
}

// ======================================================================
// Convenience: compress a string to base64
// ======================================================================

/// Compress a UTF-8 string and return base64-encoded output.
pub fn compress_to_b64(text: &str, algo: &CompressionAlgorithm) -> RecordingResult<String> {
    compress_to_b64_with_limits(text, algo, DEFAULT_COMPRESSION_LIMITS)
}

fn compress_to_b64_with_limits(
    text: &str,
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<String> {
    if text.len() > limits.max_expanded {
        return Err(compression_limit_error());
    }

    let raw_limit = if matches!(algo, CompressionAlgorithm::None) {
        limits.max_expanded
    } else {
        limits.max_compressed
    };
    let retained_output = limits
        .max_retained
        .checked_sub(text.len())
        .ok_or_else(compression_limit_error)?;
    let encoded_limit = base64_encoded_len(raw_limit)
        .unwrap_or(usize::MAX)
        .min(retained_output);
    let encoded_sink = BoundedVecWriter::new(encoded_limit, true);
    let base64_sink =
        base64::write::EncoderWriter::new(encoded_sink, &base64::engine::general_purpose::STANDARD);
    let raw_sink = CountingLimitWriter::new(base64_sink, raw_limit);
    let raw_sink = compress_into(text.as_bytes(), algo, raw_sink)?;
    let encoded_sink = raw_sink.into_inner().finish().map_err(map_compression_io)?;
    String::from_utf8(encoded_sink.into_inner()).map_err(|_| compression_error())
}

/// Decode base64, decompress, return UTF-8 string.
pub fn decompress_from_b64(b64: &str, algo: &CompressionAlgorithm) -> RecordingResult<String> {
    decompress_from_b64_with_limits(b64, algo, DEFAULT_COMPRESSION_LIMITS)
}

fn decompress_from_b64_with_limits(
    b64: &str,
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<String> {
    let decoded_len = base64_preflight(b64, algo, limits)?;
    let mut decoded_reader = base64::read::DecoderReader::new(
        b64.as_bytes(),
        &base64::engine::general_purpose::STANDARD,
    );
    let decompressed =
        decompress_reader_with_limits(&mut decoded_reader, decoded_len, b64.len(), algo, limits)?;

    // Some codec readers stop at the end of their frame. Drain the base64
    // reader without retaining its bytes so malformed trailing input is still
    // rejected, matching the previous decode-all behavior.
    let mut drain = [0u8; IO_BUFFER_BYTES];
    while decoded_reader
        .read(&mut drain)
        .map_err(|_| decompression_error())?
        != 0
    {}

    String::from_utf8(decompressed).map_err(|_| decompression_error())
}

fn base64_preflight(
    encoded: &str,
    algo: &CompressionAlgorithm,
    limits: CompressionLimits,
) -> RecordingResult<usize> {
    let decoded_limit = if matches!(algo, CompressionAlgorithm::None) {
        limits.max_expanded
    } else {
        limits.max_compressed
    };
    let encoded_limit = base64_encoded_len(decoded_limit).unwrap_or(usize::MAX);

    // This check deliberately precedes DecoderReader construction so an
    // oversized request cannot trigger a decoded-buffer allocation.
    if encoded.len() > encoded_limit || encoded.len() > limits.max_retained {
        return Err(decompression_limit_error());
    }

    let decoded_len =
        base64_decoded_len_upper_bound(encoded).ok_or_else(decompression_limit_error)?;
    if decoded_len > decoded_limit {
        return Err(decompression_limit_error());
    }
    if matches!(algo, CompressionAlgorithm::None)
        && encoded
            .len()
            .checked_add(decoded_len)
            .is_none_or(|retained| retained > limits.max_retained)
    {
        return Err(decompression_limit_error());
    }
    Ok(decoded_len)
}

fn base64_encoded_len(decoded_len: usize) -> Option<usize> {
    decoded_len.checked_add(2)?.checked_div(3)?.checked_mul(4)
}

fn base64_decoded_len_upper_bound(encoded: &str) -> Option<usize> {
    let len = encoded.len();
    let groups = len.checked_div(4)?;
    let remainder = len % 4;
    let remainder_bytes = match remainder {
        0 => 0,
        1 | 2 => 1,
        3 => 2,
        _ => unreachable!(),
    };
    let mut decoded_len = groups.checked_mul(3)?.checked_add(remainder_bytes)?;

    if remainder == 0 && !encoded.is_empty() {
        let bytes = encoded.as_bytes();
        if bytes[len - 1] == b'=' {
            decoded_len = decoded_len.checked_sub(1)?;
            if len >= 2 && bytes[len - 2] == b'=' {
                decoded_len = decoded_len.checked_sub(1)?;
            }
        }
    }
    Some(decoded_len)
}

// ======================================================================
// Estimate compression ratio (useful for UI)
// ======================================================================

pub fn compression_ratio(original: usize, compressed: usize) -> f64 {
    if original == 0 {
        return 1.0;
    }
    compressed as f64 / original as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_limits(
        max_compressed: usize,
        max_expanded: usize,
        max_retained: usize,
    ) -> CompressionLimits {
        CompressionLimits {
            max_compressed,
            max_expanded,
            max_retained,
            max_ratio: 1_000,
            ratio_slack: 0,
        }
    }

    fn assert_decompression_limit(error: RecordingError) {
        assert!(matches!(
            error,
            RecordingError::CompressionError(ref message)
                if message == DECOMPRESSION_LIMIT_ERROR
        ));
    }

    fn assert_ratio_bomb_rejected(algo: CompressionAlgorithm) {
        let payload = vec![b'A'; 8 * 1024];
        let compressed = compress(&payload, &algo).unwrap();
        let limits = CompressionLimits {
            max_compressed: compressed.len(),
            max_expanded: payload.len(),
            max_retained: compressed.len() + payload.len(),
            max_ratio: 2,
            ratio_slack: 8,
        };
        assert_decompression_limit(decompress_with_limits(&compressed, &algo, limits).unwrap_err());
    }

    #[test]
    fn rejects_deterministic_gzip_ratio_bomb() {
        assert_ratio_bomb_rejected(CompressionAlgorithm::Gzip);
    }

    #[test]
    fn rejects_deterministic_deflate_ratio_bomb() {
        assert_ratio_bomb_rejected(CompressionAlgorithm::Deflate);
    }

    #[test]
    fn rejects_deterministic_zstd_ratio_bomb() {
        assert_ratio_bomb_rejected(CompressionAlgorithm::Zstd);
    }

    #[test]
    fn exact_input_output_and_aggregate_boundaries_are_enforced() {
        let payload: Vec<u8> = (0u8..=255).cycle().take(4096).collect();
        let algo = CompressionAlgorithm::Gzip;
        let compressed = compress(&payload, &algo).unwrap();
        let exact = test_limits(
            compressed.len(),
            payload.len(),
            compressed.len() + payload.len(),
        );
        assert_eq!(
            decompress_with_limits(&compressed, &algo, exact).unwrap(),
            payload
        );

        let input_too_small = CompressionLimits {
            max_compressed: compressed.len() - 1,
            ..exact
        };
        assert_decompression_limit(
            decompress_with_limits(&compressed, &algo, input_too_small).unwrap_err(),
        );

        let output_too_small = CompressionLimits {
            max_expanded: payload.len() - 1,
            ..exact
        };
        assert_decompression_limit(
            decompress_with_limits(&compressed, &algo, output_too_small).unwrap_err(),
        );

        let aggregate_too_small = CompressionLimits {
            max_retained: compressed.len() + payload.len() - 1,
            ..exact
        };
        assert_decompression_limit(
            decompress_with_limits(&compressed, &algo, aggregate_too_small).unwrap_err(),
        );
    }

    #[test]
    fn compression_enforces_exact_aggregate_boundary() {
        let payload: Vec<u8> = (0u8..=255).cycle().take(2048).collect();
        let algo = CompressionAlgorithm::Gzip;
        let roomy = test_limits(2048, payload.len(), 4096);
        let compressed = compress_with_limits(&payload, &algo, roomy).unwrap();
        let exact = CompressionLimits {
            max_compressed: compressed.len(),
            max_retained: payload.len() + compressed.len(),
            ..roomy
        };
        assert_eq!(
            compress_with_limits(&payload, &algo, exact).unwrap(),
            compressed
        );

        let aggregate_too_small = CompressionLimits {
            max_retained: exact.max_retained - 1,
            ..exact
        };
        assert!(compress_with_limits(&payload, &algo, aggregate_too_small).is_err());
    }

    #[test]
    fn base64_streaming_honors_exact_aggregate_boundary() {
        let encoded = "YWJj";
        let exact = test_limits(3, 3, encoded.len() + 3);
        assert_eq!(
            decompress_from_b64_with_limits(encoded, &CompressionAlgorithm::None, exact).unwrap(),
            "abc"
        );

        let aggregate_too_small = CompressionLimits {
            max_retained: exact.max_retained - 1,
            ..exact
        };
        assert_decompression_limit(
            decompress_from_b64_with_limits(
                encoded,
                &CompressionAlgorithm::None,
                aggregate_too_small,
            )
            .unwrap_err(),
        );
    }

    #[test]
    fn oversized_base64_is_rejected_before_decoding() {
        let limits = test_limits(3, 3, 64);
        let invalid_but_oversized = "!!!!!!!!";
        assert_decompression_limit(
            decompress_from_b64_with_limits(
                invalid_but_oversized,
                &CompressionAlgorithm::None,
                limits,
            )
            .unwrap_err(),
        );
    }
}
