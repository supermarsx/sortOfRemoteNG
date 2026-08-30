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
use crate::openh264::formats::YUVSource;
#[cfg(feature = "software-decode-dynamic")]
use crate::openh264::OpenH264API;

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
    fn decode(&mut self, nal_data: &[u8]) -> Result<Vec<DecodedFrame>, H264Error> {
        match self.decoder.decode(nal_data) {
            Ok(Some(yuv)) => {
                let (w, h) = yuv.dimensions();
                let width = w as u32;
                let height = h as u32;
                let out_size = w * h * 4;

                let mut rgba = self.pool.acquire(out_size);
                rgba.resize(out_size, 0);
                yuv.write_rgba8(&mut rgba);

                Ok(vec![DecodedFrame {
                    width,
                    height,
                    rgba,
                }])
            }
            Ok(None) => Ok(Vec::new()),
            Err(e) => Err(H264Error::DecodeFailed(format!("openh264: {e}"))),
        }
    }

    fn name(&self) -> &'static str {
        "openh264"
    }
}

#[cfg(all(test, feature = "software-decode"))]
mod source_tests {
    use super::*;
    use crate::openh264::encoder::Encoder;
    use crate::openh264::formats::{RgbaSliceU8, YUVBuffer};

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
            .decode(&encoded)
            .expect("the synthetic frame must decode");
        assert_eq!(frames.len(), 1);
        let frame = &frames[0];
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
