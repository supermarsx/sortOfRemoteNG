// sorng-replay – Video replay (RDP / VNC)
//
// Binary-search based frame access, nearest-frame interpolation,
// and keyframe extraction for video-type recordings.

use crate::types::VideoFrame;

/// Binary search for the latest frame whose timestamp ≤ `position_ms`.
pub fn get_frame_at_position(frames: &[VideoFrame], position_ms: u64) -> Option<&VideoFrame> {
    if frames.is_empty() {
        return None;
    }
    let idx = get_frame_index(frames, position_ms);
    frames.get(idx)
}

/// Return the index of the latest frame whose timestamp ≤ `position_ms`.
///
/// If `position_ms` is before the first frame, returns 0.
/// If after the last frame, returns the last valid index.
pub fn get_frame_index(frames: &[VideoFrame], position_ms: u64) -> usize {
    if frames.is_empty() {
        return 0;
    }

    match frames.binary_search_by_key(&position_ms, |f| f.timestamp_ms) {
        Ok(exact) => exact,
        Err(insert_point) => {
            if insert_point == 0 {
                0
            } else {
                insert_point - 1
            }
        }
    }
}

/// Return the index of the frame nearest to `position_ms`.
pub fn interpolate_position(frames: &[VideoFrame], position_ms: u64) -> usize {
    if frames.is_empty() {
        return 0;
    }

    match frames.binary_search_by_key(&position_ms, |f| f.timestamp_ms) {
        Ok(exact) => exact,
        Err(insert_point) => {
            if insert_point == 0 {
                return 0;
            }
            if insert_point >= frames.len() {
                return frames.len() - 1;
            }

            let before = frames[insert_point - 1].timestamp_ms;
            let after = frames[insert_point].timestamp_ms;

            if position_ms - before <= after - position_ms {
                insert_point - 1
            } else {
                insert_point
            }
        }
    }
}

/// Return indices of keyframes spaced at approximately `interval_ms` apart.
pub fn get_keyframes(frames: &[VideoFrame], interval_ms: u64) -> Vec<usize> {
    if frames.is_empty() || interval_ms == 0 {
        return Vec::new();
    }

    let mut keyframes = Vec::new();
    let mut next_ts = frames[0].timestamp_ms;

    for (i, f) in frames.iter().enumerate() {
        if f.timestamp_ms >= next_ts {
            keyframes.push(i);
            next_ts = f.timestamp_ms + interval_ms;
        }
    }

    keyframes
}
