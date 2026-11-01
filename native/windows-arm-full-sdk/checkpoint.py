"""Bootstrap data identity only; engine checkpoint/restore is deliberately absent."""
import hashlib
import json
import math


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def identity(value):
    return hashlib.sha256(canonical(value)).hexdigest()


IMAGE_QUALIFIED_PATHS = ('.github/workflows/windows-x64-arm-toolchain.yml',
 'native/windows-arm-full-sdk/profile.json',
 'native/windows-arm-full-sdk/acquire.py',
 'native/windows-arm-full-sdk/extract.py',
 'native/windows-arm-full-sdk/environment.py',
 'native/windows-arm-full-sdk/producer.py',
 'native/windows-arm-full-sdk/checkpoint.py',
 'native/windows-arm-full-sdk/job.py',
 'native/windows-arm-full-sdk/test_producer.py',
 'native/windows-arm-full-sdk/source-driver.mjs',
 'tests/tooling/windowsArmFullSdk.node-test.mjs',
 '.github/workflows/windows-arm-source-preflight.yml',
 'native/windows-arm-full-sdk/image-qualified-current-profile.json',
 'native/windows-arm-full-sdk/image-qualified-20261021-profile.json',
 'native/windows-arm-full-sdk/image-qualified-current-driver.mjs',
 'native/windows-arm-full-sdk/image-qualified-20261021-driver.mjs',
 'native/windows-arm-full-sdk/source_metrics.py',
 'native/windows-arm-full-sdk/metrics_fixture.py',
 'native/windows-arm-full-sdk/test_image_dispatch.py',
 'native/windows-arm-full-sdk/test_source_metrics.py',
 'tests/tooling/windowsArmImageQualifiedSourceGn.node-test.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/native/cef-hosted-recipe.json',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/browser-runtime-package.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/cef-custom-artifact-inventory.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-bootstrap.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-provision.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/cef-patched-runtime.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-runtime-release.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-sdk-inventory.mjs',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-checkpoint-archive.py',
 'native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-source-metadata.mjs',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/include/cef_sorng_tls_bridge.h',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0001-chromium-socket-admission.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0002-cef-native-bridge.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0003-cef-native-widget-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0004-chromium-soda-provisioning.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0005-chromium-proxy-route-probe.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0006-cef-explicit-download-destination.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0008-chromium-same-authority-http2.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0009-cef-http2-bridge-capability.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0010-chromium-proxy-application-ack.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0011-cef-proxy-application-ack.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0012-cef-registration-retirement.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0013-chromium-owned-quic-datagrams.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0014-cef-owned-quic-datagrams.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0015-chromium-owned-quic-job-selection.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0024-cef-external-webview-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/review-receipt.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/source-lock.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/tools/aarch64-pc-windows-msvc.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/upstream-sha256.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/gn/aarch64-pc-windows-msvc.gn',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/include/cef_sorng_tls_bridge.h',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0001-chromium-socket-admission.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0002-cef-native-bridge.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0003-cef-native-widget-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0004-chromium-soda-provisioning.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0005-chromium-proxy-route-probe.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0006-cef-explicit-download-destination.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0008-chromium-same-authority-http2.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0009-cef-http2-bridge-capability.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0010-chromium-proxy-application-ack.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0011-cef-proxy-application-ack.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0012-cef-registration-retirement.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0013-chromium-owned-quic-datagrams.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0014-cef-owned-quic-datagrams.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0015-chromium-owned-quic-job-selection.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0024-cef-external-webview-lifetime.patch',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/review-receipt.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/source-lock.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/tools/aarch64-pc-windows-msvc.json',
 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/upstream-sha256.json')


def closed_sources(rows, paths):
    if not isinstance(rows, list) or len(paths) not in (11,16,62,94) or (len(paths)==94 and tuple(paths)!=IMAGE_QUALIFIED_PATHS) or len(rows) != len(paths) or [r.get("path") for r in rows] != paths:
        raise ValueError("BOOT_SOURCE_SET")
    for row in rows:
        if (set(row) != {"path", "bytes", "sha256", "canonicalBytes", "canonicalSha256", "encoding"} or
                type(row["bytes"]) is not int or not 0 < row["bytes"] <= 2 * 1024**2 or
                type(row["canonicalBytes"]) is not int or not 0 < row["canonicalBytes"] <= 2 * 1024**2 or
                any(type(row[k]) is not str or len(row[k]) != 64 or
                    set(row[k]) - set("0123456789abcdef") for k in ("sha256", "canonicalSha256")) or
                row["encoding"] not in ("exact", "git-crlf")):
            raise ValueError("BOOT_SOURCE_ROW")
        crlf=(paths[0],paths[-1]) if len(paths)==11 else (paths[0],paths[10],paths[11],paths[15]if len(paths)==16 else paths[20]if len(paths)==94 else paths[18])
        if row["encoding"] == "git-crlf" and row["path"] not in crlf:
            raise ValueError("BOOT_SOURCE_ENCODING")
    return identity(rows)


def remaining_deadlines(context, wall, mono):
    for key in ("wallWorkEnd", "monotonicWorkEnd"):
        if type(context.get(key)) not in (int, float) or not math.isfinite(context[key]):
            raise ValueError("BOOT_CLOCK")
    value = min(context["wallWorkEnd"] - wall, context["monotonicWorkEnd"] - mono)
    if value <= 0:
        raise ValueError("BOOT_DEADLINE")
    return value


def source_bytes(row, raw):
    if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
        raise ValueError("BOOT_SOURCE_BYTES")
    canonical_raw = raw
    if row["encoding"] == "git-crlf":
        text = raw.decode("utf-8", errors="strict")
        canonical_text = text.replace("\r\n", "\n")
        if "\r" in canonical_text or canonical_text.replace("\n", "\r\n") != text:
            raise ValueError("BOOT_SOURCE_ENCODING")
        canonical_raw = canonical_text.encode("utf-8")
    if (len(canonical_raw) != row["canonicalBytes"] or
            hashlib.sha256(canonical_raw).hexdigest() != row["canonicalSha256"]):
        raise ValueError("BOOT_SOURCE_CANONICAL")
    return canonical_raw


def bootstrap_seal(context, archives):
    # This kind cannot be used as a compiled object checkpoint or SDK/native seal.
    return {"kind": "sorng-windows-arm-cross-bootstrap-data", "sourceDigest": context["sourceDigest"],
            "sourceHead": context["head"], "archives": archives, "buildAdmission": False,
            "engineCheckpointImplemented": False, "sdkBuilt": False,
            "nativeAcceptance": False, "outputExecuted": False}


def compiled_checkpoint(*_args, **_kwargs):
    raise ValueError('FULL_ENGINE_CHECKPOINT_UNAVAILABLE')


def compiled_restore(*_args, **_kwargs):
    raise ValueError('FULL_ENGINE_RESTORE_UNAVAILABLE')
