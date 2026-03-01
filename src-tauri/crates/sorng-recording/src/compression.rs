// sorng-recording – Compression module
//
// Pure functions that compress / decompress byte buffers.
// All work is CPU-bound so they should be spawned on
// `tokio::task::spawn_blocking`.

use flate2::read::{DeflateDecoder, DeflateEncoder, GzDecoder, GzEncoder};
use flate2::Compression;
use std::io::Read;

use crate::error::{RecordingError, RecordingResult};
use crate::types::CompressionAlgorithm;

// ═══════════════════════════════════════════════════════════════════════
//  Compress
// ═══════════════════════════════════════════════════════════════════════

/// Compress a byte slice with the chosen algorithm.
pub fn compress(data: &[u8], algo: &CompressionAlgorithm) -> RecordingResult<Vec<u8>> {
    match algo {
        CompressionAlgorithm::None => Ok(data.to_vec()),
        CompressionAlgorithm::Gzip => compress_gzip(data),
        CompressionAlgorithm::Zstd => compress_zstd(data),
        CompressionAlgorithm::Deflate => compress_deflate(data),
    }
}

/// Decompress a byte slice that was compressed with the given algorithm.
pub fn decompress(data: &[u8], algo: &CompressionAlgorithm) -> RecordingResult<Vec<u8>> {
    match algo {
        CompressionAlgorithm::None => Ok(data.to_vec()),
        CompressionAlgorithm::Gzip => decompress_gzip(data),
        CompressionAlgorithm::Zstd => decompress_zstd(data),
        CompressionAlgorithm::Deflate => decompress_deflate(data),
    }
}

// ── Gzip ──────────────────────────────────────────────────────────────

fn compress_gzip(data: &[u8]) -> RecordingResult<Vec<u8>> {
    let mut encoder = GzEncoder::new(data, Compression::default());
    let mut buf = Vec::new();
    encoder
        .read_to_end(&mut buf)
        .map_err(|e| RecordingError::CompressionError(format!("gzip compress: {}", e)))?;
    Ok(buf)
}

fn decompress_gzip(data: &[u8]) -> RecordingResult<Vec<u8>> {
    let mut decoder = GzDecoder::new(data);
    let mut buf = Vec::new();
    decoder
        .read_to_end(&mut buf)
        .map_err(|e| RecordingError::CompressionError(format!("gzip decompress: {}", e)))?;
    Ok(buf)
}

// ── Zstd ──────────────────────────────────────────────────────────────

fn compress_zstd(data: &[u8]) -> RecordingResult<Vec<u8>> {
    zstd::encode_all(data, 3)
        .map_err(|e| RecordingError::CompressionError(format!("zstd compress: {}", e)))
}

fn decompress_zstd(data: &[u8]) -> RecordingResult<Vec<u8>> {
    zstd::decode_all(data)
        .map_err(|e| RecordingError::CompressionError(format!("zstd decompress: {}", e)))
}

// ── Deflate ───────────────────────────────────────────────────────────

fn compress_deflate(data: &[u8]) -> RecordingResult<Vec<u8>> {
    let mut encoder = DeflateEncoder::new(data, Compression::default());
    let mut buf = Vec::new();
    encoder
        .read_to_end(&mut buf)
        .map_err(|e| RecordingError::CompressionError(format!("deflate compress: {}", e)))?;
    Ok(buf)
}

fn decompress_deflate(data: &[u8]) -> RecordingResult<Vec<u8>> {
    let mut decoder = DeflateDecoder::new(data);
    let mut buf = Vec::new();
    decoder
        .read_to_end(&mut buf)
        .map_err(|e| RecordingError::CompressionError(format!("deflate decompress: {}", e)))?;
    Ok(buf)
}

// ═══════════════════════════════════════════════════════════════════════
//  Convenience: compress a string to base64
// ═══════════════════════════════════════════════════════════════════════

/// Compress a UTF-8 string and return base64-encoded output.
pub fn compress_to_b64(text: &str, algo: &CompressionAlgorithm) -> RecordingResult<String> {
    let raw = compress(text.as_bytes(), algo)?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &raw,
    ))
}

/// Decode base64, decompress, return UTF-8 string.
pub fn decompress_from_b64(b64: &str, algo: &CompressionAlgorithm) -> RecordingResult<String> {
    let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
        .map_err(|e| RecordingError::CompressionError(format!("base64 decode: {}", e)))?;
    let decompressed = decompress(&raw, algo)?;
    String::from_utf8(decompressed)
        .map_err(|e| RecordingError::CompressionError(format!("utf8 decode: {}", e)))
}

// ═══════════════════════════════════════════════════════════════════════
//  Estimate compression ratio (useful for UI)
// ═══════════════════════════════════════════════════════════════════════

pub fn compression_ratio(original: usize, compressed: usize) -> f64 {
    if original == 0 {
        return 1.0;
    }
    compressed as f64 / original as f64
}
