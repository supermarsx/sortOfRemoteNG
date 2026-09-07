//! Software H.264 decoder using Cisco OpenH264.
//!
//! Development builds may compile OpenH264 from source. Release builds use a
//! required, hard-imported OpenH264 2.6.0 shared library and retain the
//! `openh264` crate's safe high-level decoder API.

#[cfg(all(feature = "software-decode", feature = "software-decode-dynamic"))]
compile_error!("`software-decode` and `software-decode-dynamic` are mutually exclusive");

#[cfg(all(
    feature = "software-decode-dynamic",
    not(any(target_os = "windows", target_os = "linux", target_os = "macos"))
))]
compile_error!("`software-decode-dynamic` supports only Windows, Linux, and macOS");

use super::{DecodedFrame, FrameBufferPool, H264Decoder, H264Error};
use crate::openh264::decoder::Decoder;
#[cfg(feature = "software-decode-dynamic")]
use crate::openh264::decoder::DecoderConfig;
#[cfg(feature = "software-decode-dynamic")]
use crate::openh264::OpenH264API;
use sorng_rdp_vendor::openh264_sys2::{videoFormatI420, SBufferInfo};

#[cfg(all(feature = "software-decode-dynamic", target_os = "windows"))]
const DYNAMIC_OPENH264_LIBRARY_NAME: &str = "openh264-8.dll";
#[cfg(all(feature = "software-decode-dynamic", target_os = "linux"))]
const DYNAMIC_OPENH264_LIBRARY_NAME: &str = "libopenh264.so.8";
#[cfg(all(feature = "software-decode-dynamic", target_os = "macos"))]
const DYNAMIC_OPENH264_LIBRARY_NAME: &str = "@rpath/libopenh264.8.dylib";

#[cfg(feature = "software-decode-dynamic")]
const REQUIRED_OPENH264_VERSION: (u32, u32, u32) = (2, 6, 0);

#[cfg(feature = "software-decode-dynamic")]
#[repr(C)]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct LinkedOpenH264Version {
    major: u32,
    minor: u32,
    revision: u32,
    reserved: u32,
}

#[cfg(feature = "software-decode-dynamic")]
unsafe extern "C" {
    fn WelsGetCodecVersionEx(version: *mut LinkedOpenH264Version);
}

#[cfg(feature = "software-decode-dynamic")]
fn validate_linked_version(version: LinkedOpenH264Version) -> Result<(), H264Error> {
    let actual = (version.major, version.minor, version.revision);
    if actual != REQUIRED_OPENH264_VERSION {
        return Err(H264Error::InitFailed(format!(
            "required hard-linked OpenH264 2.6.0, loaded {}.{}.{}",
            version.major, version.minor, version.revision
        )));
    }
    Ok(())
}

#[cfg(feature = "software-decode-dynamic")]
fn linked_openh264_version() -> Result<LinkedOpenH264Version, H264Error> {
    let mut version = LinkedOpenH264Version::default();
    // SAFETY: the hard import guarantees that the required OpenH264 module is
    // loaded before Rust starts. The ABI writes four C unsigned integers.
    unsafe { WelsGetCodecVersionEx(&mut version) };
    validate_linked_version(version)?;
    Ok(version)
}

#[cfg(feature = "software-decode-dynamic")]
fn dynamic_decoder() -> Result<Decoder, H264Error> {
    let version = linked_openh264_version()?;
    // SAFETY: the direct version call above proves that the OS-loaded module
    // exposes the OpenH264 2.6 ABI for this process. Reopening the same hard-
    // imported runtime name only obtains function pointers owned by that
    // already-required module.
    let api = unsafe { OpenH264API::from_blob_path_unchecked(DYNAMIC_OPENH264_LIBRARY_NAME) }
        .map_err(|error| {
            H264Error::InitFailed(format!(
                "could not access hard-imported {DYNAMIC_OPENH264_LIBRARY_NAME}: {error}"
            ))
        })?;
    let decoder = Decoder::with_api_config(api, DecoderConfig::new())
        .map_err(|error| H264Error::InitFailed(format!("openh264: {error}")))?;
    log::info!(
        "OpenH264: using required hard-imported {}.{}.{} module {}",
        version.major,
        version.minor,
        version.revision,
        DYNAMIC_OPENH264_LIBRARY_NAME
    );
    Ok(decoder)
}

pub struct OpenH264SoftDecoder {
    decoder: Decoder,
    pool: FrameBufferPool,
}

impl OpenH264SoftDecoder {
    pub fn new() -> Result<Self, H264Error> {
        #[cfg(feature = "software-decode")]
        let decoder =
            Decoder::new().map_err(|error| H264Error::InitFailed(format!("openh264: {error}")))?;

        #[cfg(feature = "software-decode-dynamic")]
        let decoder = dynamic_decoder()?;

        Ok(Self {
            decoder,
            pool: FrameBufferPool::new(4),
        })
    }
}

impl H264Decoder for OpenH264SoftDecoder {
    fn decode(&mut self, nal_data: &[u8], picture_id: u64) -> Result<Vec<DecodedFrame>, H264Error> {
        let length = i32::try_from(nal_data.len())
            .map_err(|_| H264Error::DecodeFailed("NAL length overflow".into()))?;
        let mut planes = [std::ptr::null_mut(); 3];
        let mut info = SBufferInfo {
            uiInBsTimeStamp: picture_id,
            ..Default::default()
        };
        // The high-level 0.9.8 wrapper discards input identities and reads the
        // input rather than output timestamp. Use the same no-delay entry point
        // without changing decoder configuration, and consume its planes before
        // the next decoder call invalidates them.
        let status = unsafe {
            self.decoder.raw_api().decode_frame_no_delay(
                nal_data.as_ptr(),
                length,
                planes.as_mut_ptr(),
                &mut info,
            )
        };
        if status != 0 {
            return Err(H264Error::DecodeFailed(format!("openh264: {status}")));
        }
        if info.iBufferStatus == 0 {
            return Ok(Vec::new());
        }
        // SAFETY: a successful output uses the system-memory member of SBufferInfo.
        let layout = unsafe { info.UsrData.sSystemBuffer };
        if planes.iter().any(|p| p.is_null())
            || layout.iFormat != videoFormatI420
            || layout.iWidth <= 0
            || layout.iHeight <= 0
            || layout.iStride[0] < layout.iWidth
            || layout.iStride[1] < layout.iWidth / 2 + layout.iWidth % 2
        {
            return Err(H264Error::ConversionFailed(
                "invalid OpenH264 I420 layout".into(),
            ));
        }
        let (w, h) = (layout.iWidth as usize, layout.iHeight as usize);
        let (ys, uvs) = (layout.iStride[0] as usize, layout.iStride[1] as usize);
        let out_size = w
            .checked_mul(h)
            .and_then(|n| n.checked_mul(4))
            .filter(|&n| n <= super::MAX_DECODED_FRAME_BYTES)
            .ok_or_else(|| {
                H264Error::ConversionFailed("decoded picture exceeds byte budget".into())
            })?;
        let y_len = ys
            .checked_mul(h)
            .ok_or_else(|| H264Error::ConversionFailed("Y stride overflow".into()))?;
        let uv_len = uvs
            .checked_mul(h.div_ceil(2))
            .ok_or_else(|| H264Error::ConversionFailed("UV stride overflow".into()))?;
        let mut rgba = self.pool.acquire(out_size);
        // SAFETY: OpenH264 owns these successful I420 output planes; their row
        // strides and decoded height define their allocated readable lengths.
        unsafe {
            write_limited_i420_rgba(
                std::slice::from_raw_parts(planes[0], y_len),
                std::slice::from_raw_parts(planes[1], uv_len),
                std::slice::from_raw_parts(planes[2], uv_len),
                ys,
                uvs,
                uvs,
                w,
                h,
                &mut rgba,
            )?;
        }
        Ok(vec![DecodedFrame {
            picture_id: info.uiOutYuvTimeStamp,
            width: w as u32,
            height: h as u32,
            rgba,
        }])
    }

    fn name(&self) -> &'static str {
        "openh264"
    }
}

/// Preserve OpenH264's limited-range BT.601 conversion using the existing
/// YUV dependency's runtime-dispatched SIMD kernels, including padded strides.
#[allow(clippy::too_many_arguments)]
fn write_limited_i420_rgba(
    y: &[u8],
    u: &[u8],
    v: &[u8],
    ys: usize,
    us: usize,
    vs: usize,
    width: usize,
    height: usize,
    rgba: &mut Vec<u8>,
) -> Result<(), H264Error> {
    rgba.resize(width * height * 4, 0);
    use sorng_rdp_vendor::yuv::{yuv420_to_rgba, YuvPlanarImage, YuvRange, YuvStandardMatrix};
    yuv420_to_rgba(
        &YuvPlanarImage {
            y_plane: y,
            u_plane: u,
            v_plane: v,
            y_stride: ys as u32,
            u_stride: us as u32,
            v_stride: vs as u32,
            width: width as u32,
            height: height as u32,
        },
        rgba,
        (width * 4) as u32,
        YuvRange::Limited,
        YuvStandardMatrix::Bt601,
    )
    .map_err(|error| H264Error::ConversionFailed(error.to_string()))
}

#[cfg(all(test, feature = "software-decode"))]
mod source_tests {
    use super::*;
    use crate::openh264::encoder::Encoder;
    use crate::openh264::formats::{RgbaSliceU8, YUVBuffer};

    #[test]
    fn simd_limited_range_conversion_preserves_padded_rows_and_color_range() {
        let (width, height, stride) = (18, 16, 32);
        let mut y = vec![0; stride * height];
        let mut u = vec![0; stride / 2 * height / 2];
        let mut v = u.clone();
        for row in 0..height {
            for col in 0..width {
                y[row * stride + col] = if col < 8 {
                    16
                } else if col < 16 {
                    235
                } else {
                    128
                };
            }
        }
        for row in 0..height / 2 {
            for col in 0..width / 2 {
                u[row * stride / 2 + col] = 128;
                v[row * stride / 2 + col] = 128;
            }
        }
        let mut output = Vec::new();
        write_limited_i420_rgba(
            &y,
            &u,
            &v,
            stride,
            stride / 2,
            stride / 2,
            width,
            height,
            &mut output,
        )
        .unwrap();
        for row in output.chunks_exact(width * 4) {
            for (col, pixel) in row.chunks_exact(4).enumerate() {
                let expected = if col < 8 {
                    0
                } else if col < 16 {
                    255
                } else {
                    130
                };
                assert!(pixel[..3]
                    .iter()
                    .all(|&value| value.abs_diff(expected) <= 1));
                assert_eq!(pixel[3], 255);
            }
        }
    }

    #[test]
    fn encoded_frame_round_trips_through_the_rgba_pipeline() {
        const WIDTH: usize = 32;
        const HEIGHT: usize = 32;
        const EXPECTED_RGB: [u8; 3] = [64, 128, 192];

        let mut source = Vec::with_capacity(WIDTH * HEIGHT * 4);
        for _ in 0..(WIDTH * HEIGHT) {
            source.extend_from_slice(&[EXPECTED_RGB[0], EXPECTED_RGB[1], EXPECTED_RGB[2], 255]);
        }
        let yuv = YUVBuffer::from_rgba8_source(RgbaSliceU8::new(&source, (WIDTH, HEIGHT)));
        let encoded = Encoder::new()
            .expect("the bundled development encoder must initialize")
            .encode(&yuv)
            .expect("the synthetic frame must encode")
            .to_vec();

        let frames = OpenH264SoftDecoder::new()
            .expect("the bundled development decoder must initialize")
            .decode(&encoded, 12345)
            .expect("the synthetic frame must decode");
        assert_eq!(frames.len(), 1);
        let frame = &frames[0];
        assert_eq!(frame.picture_id, 12345);
        assert_eq!((frame.width, frame.height), (WIDTH as u32, HEIGHT as u32));
        assert_eq!(frame.rgba.len(), WIDTH * HEIGHT * 4);

        for pixel in frame.rgba.chunks_exact(4) {
            assert_eq!(pixel[3], 255);
            for (actual, expected) in pixel[..3].iter().zip(EXPECTED_RGB) {
                assert!(
                    actual.abs_diff(expected) <= 8,
                    "decoded channel {actual} drifted from {expected}"
                );
            }
        }
    }
}

#[cfg(all(test, feature = "software-decode-dynamic"))]
mod tests {
    use super::*;

    #[test]
    fn required_dynamic_library_initializes_the_decoder() {
        let version =
            linked_openh264_version().expect("hard-linked OpenH264 must report a version");
        assert_eq!(
            (version.major, version.minor, version.revision),
            REQUIRED_OPENH264_VERSION
        );
        let _decoder = OpenH264SoftDecoder::new()
            .expect("the required hard-linked OpenH264 module must initialize");
    }

    #[test]
    fn exact_openh264_2_6_0_is_required() {
        assert!(validate_linked_version(LinkedOpenH264Version {
            major: 2,
            minor: 6,
            revision: 0,
            reserved: 2502,
        })
        .is_ok());
        assert!(validate_linked_version(LinkedOpenH264Version {
            major: 2,
            minor: 5,
            revision: 1,
            reserved: 0,
        })
        .is_err());
    }

    #[test]
    fn runtime_name_uses_openh264_abi_8() {
        #[cfg(target_os = "windows")]
        assert_eq!(DYNAMIC_OPENH264_LIBRARY_NAME, "openh264-8.dll");
        #[cfg(target_os = "linux")]
        assert_eq!(DYNAMIC_OPENH264_LIBRARY_NAME, "libopenh264.so.8");
        #[cfg(target_os = "macos")]
        assert_eq!(DYNAMIC_OPENH264_LIBRARY_NAME, "@rpath/libopenh264.8.dylib");
    }
}
