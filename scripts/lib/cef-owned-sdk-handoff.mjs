// Review local bytes and pinned local evidence. This is not a hosted producer,
// native acceptance, an upload, or authorization to publish a runtime.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  lstat,
  realpath,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle } from "../cef-runtime-ci.mjs";
import {
  validateSourceLock,
  identitySha256,
  preflightCustomRuntime,
  inspectCustomRuntimeExports,
  BRIDGE_PATCH_ID,
  HTTP3_BRIDGE_PATCH_ID,
} from "./browser-custom-runtime.mjs";
import {
  RELEASE_LIMITS,
  releaseRelativePath,
} from "./browser-runtime-release.mjs";
import { inspectNativeBinary } from "../browser-runtime-package.mjs";

const exec = promisify(execFile),
  ROOT = fileURLToPath(new URL("../../", import.meta.url)),
  hex = /^[a-f\d]{64}$/,
  commit = /^[a-f\d]{40}$/;
const origins = {
  "owned-linux-engine": "x86_64-unknown-linux-gnu",
  "owned-linux-incremental-engine": "x86_64-unknown-linux-gnu",
  "owned-linux-isolated-incremental-engine": "x86_64-unknown-linux-gnu",
  "existing-windows-package": "x86_64-pc-windows-msvc",
  "owned-windows-incremental-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-operation2": "x86_64-pc-windows-msvc",
};
export const LINUX_INCREMENTAL_ORIGIN = "owned-linux-incremental-engine";
export const LINUX_ISOLATED_ORIGIN = "owned-linux-isolated-incremental-engine";
export const isLinuxIncrementalOrigin = (origin) =>
  [LINUX_INCREMENTAL_ORIGIN, LINUX_ISOLATED_ORIGIN].includes(origin);
export const LINUX_INCREMENTAL_IDENTITY =
  "9d0bc5722d719eff8a20d39ef06fb6f222b239ea44d78dd42e7c40a2f42def2e";
export const LINUX_ISOLATED_INPUT_RAW =
  "57ef78a4db57c9f18da0f773c990b95e97ff3b457201b6e9a9911589e1695993";
export const LINUX_ISOLATED_IDENTITY =
  "f4c94e74af5ee552cf4370c459973b2298a97c68337e494f24c05dde9a8e3004";
// Derived by actual private Git old12 -> ordered23 from pinned public blobs.
export const LINUX_ISOLATED_TRANSITION = Object.freeze({
  before: [
    {
      path: "base/BUILD.gn",
      kind: "file",
      size: 233765,
      sha256:
        "6923bf617d6f758957984aeacdc0cdaa040e1187a7589d4d658682becfb268f5",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/BUILD.gn",
      kind: "file",
      size: 45276,
      sha256:
        "0d12ddbf0e9ffb4df8eb2ad91ba72546146f4418747dd33f27195f4b99fa78fe",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer.cc",
      kind: "file",
      size: 3380,
      sha256:
        "b279055c0faa1b8c92b0c470560a4a248a0b1e37190c1b4584270c209b0763f6",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer_storage.h",
      kind: "absent",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer_storage_unittest.cc",
      kind: "absent",
    },
    {
      path: "base/test/BUILD.gn",
      kind: "file",
      size: 28854,
      sha256:
        "f9b9b5c2e9805bb1901e6442e0e3453d844cbfd52e543662d65b2d012a541e35",
    },
    {
      path: "base/test/tracing/test_trace_processor.cc",
      kind: "file",
      size: 8340,
      sha256:
        "51d0b11f008f6a4d1aeda6a105ca4cd357232f0134d7b4c54740ecf230e88b28",
    },
    {
      path: "cef/BUILD.gn",
      kind: "file",
      size: 97568,
      sha256:
        "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
    },
    {
      path: "cef/cef_paths2.gypi",
      kind: "file",
      size: 34404,
      sha256:
        "9a5b37b0bc7566a593530105dc5d08fb19c51e5f4d7072678fdbff00366ac934",
    },
    {
      path: "cef/include/cef_sorng_tls_bridge.h",
      kind: "file",
      size: 7737,
      sha256:
        "6ea8336407a9b4b56d25a9092b54346142214c31ea7432fa893f2eee27d33a10",
    },
    {
      path: "cef/libcef/browser/browser_context.cc",
      kind: "file",
      size: 12464,
      sha256:
        "4c7a914072ec8932b33656ec11fbc317b132f823a2282f3f63f6d9c65726b2a2",
    },
    {
      path: "cef/libcef/browser/chrome/chrome_content_browser_client_cef.cc",
      kind: "file",
      size: 30367,
      sha256:
        "a518f565b2718a7e9cb60f8510b5d37451a8eb095f84ca1aede311dad78d508a",
    },
    {
      path: "cef/libcef/browser/download_manager_delegate_impl.cc",
      kind: "file",
      size: 18316,
      sha256:
        "aeed739e819197a966a639102737ae18cda98fabeef7908bfa7e89edf69e8d16",
    },
    {
      path: "cef/libcef/browser/native/native_widget_delegate.cc",
      kind: "file",
      size: 4481,
      sha256:
        "16687c95eb695f56f8fd5e51ad74ab6cd402210b24e4e7b72e19565e81235128",
    },
    {
      path: "cef/libcef/browser/native/window_x11.cc",
      kind: "file",
      size: 18399,
      sha256:
        "0ccac4e8f1f8371e42bec473e2b60016f4f68370c3e072d7e44f42c50da3303a",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_bridge.cc",
      kind: "file",
      size: 22960,
      sha256:
        "558bd3532cbf5bf3c9cb4a1dc277f5d432968c77b265c39d6c487e215a8cd1dc",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_bridge.h",
      kind: "file",
      size: 1007,
      sha256:
        "205f4ba3605431b4cc974a3cc12a33f6044156f1b2d487baf1288b3aef244cba",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_registration_policy.h",
      kind: "file",
      size: 3647,
      sha256:
        "60f7e6a740ffbc4b005fa4513cfebf625f89bd08b51357262fe769dc86fae975",
    },
    {
      path: "cef/libcef/browser/request_context_impl.cc",
      kind: "file",
      size: 38055,
      sha256:
        "476553766d2d14015194c1f460282e16cab58f8d1aeb1872322d2ef7ef293f71",
    },
    {
      path: "cef/libcef/browser/request_context_impl.h",
      kind: "file",
      size: 10843,
      sha256:
        "576190b62a6dc4ca8c90c5b92c0746fafca19a808cc53ac83e1b9a7435733fd3",
    },
    {
      path: "cef/libcef_dll/sorng_tls_bridge_exports.cc",
      kind: "file",
      size: 1594,
      sha256:
        "ee9d05629db2e8dd9a56fa8290947ba1623b4cba4463e1e26d04d2f9848cfb3f",
    },
    {
      path: "chrome/browser/accessibility/soda_installer_impl.cc",
      kind: "file",
      size: 10044,
      sha256:
        "bcd5215fae14b5523853e54c5370bc4df77f8bd30f6e107b3ce9b160f8beb4a3",
    },
    {
      path: "chrome/browser/net/profile_network_context_service.cc",
      kind: "file",
      size: 71435,
      sha256:
        "1bb392f2a375233f858f585979d2e9cf2a8b2bc55ec20137b863c907484b207c",
    },
    {
      path: "chrome/browser/net/profile_network_context_service.h",
      kind: "file",
      size: 11672,
      sha256:
        "28bfdbd82ddf4c2ca23014fb8f32dee7d56ad989259a058f3f6725d2536186b6",
    },
    {
      path: "chrome/browser/net/proxy_config_monitor.cc",
      kind: "file",
      size: 9734,
      sha256:
        "41fe6103a860e58bdf122a25f1bc1eeb5a0bfcb69bf0c00e026ef91e58a71e57",
    },
    {
      path: "chrome/browser/net/proxy_config_monitor.h",
      kind: "file",
      size: 4569,
      sha256:
        "4ba803fe03dab6fb4d4a232465a74d374a5fcfccb9b7948bf3304a6e92bdd314",
    },
    {
      path: "components/soda/soda_features.cc",
      kind: "file",
      size: 669,
      sha256:
        "f18ef105ef736a03a4866a3cad93e56f6937b8178fabbecf1405161744592dd0",
    },
    {
      path: "components/soda/soda_features.h",
      kind: "file",
      size: 787,
      sha256:
        "ff0df2af6ab969f478d1b0c32c1ba015755c60377493db9cb63e1a8f81c10bc3",
    },
    {
      path: "components/soda/soda_installer.cc",
      kind: "file",
      size: 16226,
      sha256:
        "2dbcf34c368f412c12dc4040c343b31a709f319df8f6e75cd80a442281630f60",
    },
    {
      path: "components/soda/soda_util.cc",
      kind: "file",
      size: 3888,
      sha256:
        "01a6c7567030a9a2883824aa2336378e7888424f45692837e3f97d4c5cf9c4fd",
    },
    {
      path: "net/BUILD.gn",
      kind: "file",
      size: 152425,
      sha256:
        "286f326d5e4ad259bf57e400560ef1929c40d900a0a1e55868ca3a38ed050055",
    },
    {
      path: "net/cert/cert_verify_proc.h",
      kind: "file",
      size: 15648,
      sha256:
        "d352474ea5ac57239889fcf10e5a2c28dea3a9edd68e6a783cf667115724c732",
    },
    {
      path: "net/cert/cert_verify_proc_builtin.cc",
      kind: "file",
      size: 90253,
      sha256:
        "2be6bbce0583564d7792ab2a6310019bf4224991348f767b4e7860f010469746",
    },
    {
      path: "net/dns/host_resolver_manager.cc",
      kind: "file",
      size: 75926,
      sha256:
        "6ec52d9f79968fb2b921c91fa1b8a1ad19a9356427d655cf7d8d0cbbe45cc872",
    },
    {
      path: "net/dns/host_resolver_manager_unittest.cc",
      kind: "file",
      size: 704832,
      sha256:
        "7c8f5a79e526645e625001a0f7311792672ec76a497e99243bf45fef39135e84",
    },
    {
      path: "net/http/http_network_session.cc",
      kind: "file",
      size: 19125,
      sha256:
        "ce48d6ddbfd82e43628ece7a1555401ac9bc4d464e3e9add4ebe809dcd27bae6",
    },
    {
      path: "net/http/http_network_session.h",
      kind: "file",
      size: 14625,
      sha256:
        "2d36e9bc98b50e1c6047fa092f29f984a908f5901c8e1b8dda68e79a23738534",
    },
    {
      path: "net/http/http_stream_factory_job.cc",
      kind: "file",
      size: 56381,
      sha256:
        "1c194b1ad5ec8f91eaa9f22c8635fc1f08d80d43c1c6f116ee61d02dd347a024",
    },
    {
      path: "net/http/sorng_owned_quic_job_unittest.cc",
      kind: "absent",
    },
    {
      path: "net/proxy_resolution/configured_proxy_resolution_service.cc",
      kind: "file",
      size: 69219,
      sha256:
        "fccc95716e10e9e2bed09ec79bb6c1594a2a50fb0133ec1390ff13f67787bfd2",
    },
    {
      path: "net/proxy_resolution/configured_proxy_resolution_service.h",
      kind: "file",
      size: 25839,
      sha256:
        "21e6bce169c313ba4acc56661412c94e8e4ea3bc821a74d720e82e2ba8bd1da3",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium.cc",
      kind: "file",
      size: 20883,
      sha256:
        "b8bcf134d67c345c4356c1a5ffdcc5d0a712709296afd0fa5d382000bf29b968",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium.h",
      kind: "file",
      size: 4559,
      sha256:
        "99144e433ad14550a4474fe092ed71f0c4dbbcf90f27932fb6668b445c53d11b",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium_test.cc",
      kind: "file",
      size: 29062,
      sha256:
        "46c712cc2f52039b916d1d6a3aca7cffa178ffa3059b4c2fb6560334a6fd4f1e",
    },
    {
      path: "net/quic/quic_session_attempt.cc",
      kind: "file",
      size: 19043,
      sha256:
        "f261db30c55481a15fab1f369c6d4ffab9a9ce07915d81f016bd178921f87ea3",
    },
    {
      path: "net/quic/quic_session_pool.cc",
      kind: "file",
      size: 116990,
      sha256:
        "899910229b2722385c31333b684bb4b32bfec9025a5a3e812570b74979233eff",
    },
    {
      path: "net/quic/quic_session_pool.h",
      kind: "file",
      size: 47096,
      sha256:
        "a1c4cb7fc2eb5a2425a76fcbe828f596fed82e52fdf9973340cd9fb88db02f1f",
    },
    {
      path: "net/quic/quic_session_pool_owned_proxy_job.cc",
      kind: "absent",
    },
    {
      path: "net/quic/quic_session_pool_owned_proxy_job.h",
      kind: "absent",
    },
    {
      path: "net/quic/quic_session_pool_peer.cc",
      kind: "file",
      size: 7443,
      sha256:
        "0f64cbddccae3528867e25cecca415c1f0503042f3c853c2017e1cbfffc4dce7",
    },
    {
      path: "net/quic/quic_session_pool_peer.h",
      kind: "file",
      size: 5085,
      sha256:
        "2b9902b372a372246dc3bd082236a0d730d995b2b6f63178d3840e075ef7d5a5",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket.cc",
      kind: "absent",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket.h",
      kind: "absent",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket_unittest.cc",
      kind: "absent",
    },
    {
      path: "net/socket/sorng_tls_policy.h",
      kind: "file",
      size: 1175,
      sha256:
        "9f53d24311540e1f660a232af3ceec5269f12bc5baed5c89cf822af5fefa1f99",
    },
    {
      path: "net/socket/ssl_client_socket.cc",
      kind: "file",
      size: 15377,
      sha256:
        "79c09032c1fdbbea15c493c01bf03e5add47ae361f8d919088367abd2c09a9b0",
    },
    {
      path: "net/socket/ssl_client_socket.h",
      kind: "file",
      size: 12900,
      sha256:
        "8bd155d05e2c0e04b72a866fa8b8c83f3bd2bc6b3bc63b96a280ba64340c41ad",
    },
    {
      path: "net/socket/ssl_client_socket_impl.cc",
      kind: "file",
      size: 72855,
      sha256:
        "f8e87bc264d9f21bb7d602eaedb51691e1f01333e887a9b07d329453562ff65b",
    },
    {
      path: "net/socket/ssl_client_socket_impl.h",
      kind: "file",
      size: 12089,
      sha256:
        "23f03445825b769035512f32b5fc06eb4df5fe5c088857c81f8a0a4bfe908a58",
    },
    {
      path: "net/socket/ssl_client_socket_unittest.cc",
      kind: "file",
      size: 288034,
      sha256:
        "0184fe2ce529efafa39c2542c2d1f31bbfd0492dc6303c9e5fe15328a8502cb9",
    },
    {
      path: "net/spdy/spdy_session_pool.cc",
      kind: "file",
      size: 41966,
      sha256:
        "632a5b9c07bac37f40b96d07c479151f41a3eaea0e5ef972b0bf8ac71801db3c",
    },
    {
      path: "services/cert_verifier/cert_verifier_creation.cc",
      kind: "file",
      size: 10525,
      sha256:
        "dfadab98db93140667edbe256f2ea49ab1fd81d26015576c8c0367bab267c128",
    },
    {
      path: "services/cert_verifier/cert_verifier_service.cc",
      kind: "file",
      size: 12218,
      sha256:
        "a3463725d1bcd9752580f1043aa1c286cc83ff31e3e8fe86687c2c3e45b78050",
    },
    {
      path: "services/cert_verifier/cert_verifier_service_factory.cc",
      kind: "file",
      size: 23118,
      sha256:
        "0feb9077bfb616070d67e33f8507b302467ede3c45f15c69e2e51b120630b7ef",
    },
    {
      path: "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom",
      kind: "file",
      size: 6325,
      sha256:
        "32133f7d65365ff1c9339dce5ccd3cc0fae416920f1c362fa2684ec133bd9f77",
    },
    {
      path: "services/network/network_context.cc",
      kind: "file",
      size: 176612,
      sha256:
        "8a20ddbdb8b2434b5fe1de83e17541a5190172bb97a5a694f762d4a5438f8c2b",
    },
    {
      path: "services/network/network_context.h",
      kind: "file",
      size: 52940,
      sha256:
        "57db75f611c60162a5e2c72568d31f8c117b349df3f4e48141474720394e182e",
    },
    {
      path: "services/network/public/mojom/network_context.mojom",
      kind: "file",
      size: 93392,
      sha256:
        "cc7f6c6dfcb085832f95d673aeaadb9c540487533d6a77ac33c92bf3112a5ba5",
    },
    {
      path: "services/network/sorng_datagram_configuration_unittest.cc",
      kind: "absent",
    },
  ],
  after: [
    {
      path: "base/BUILD.gn",
      kind: "file",
      size: 233805,
      sha256:
        "416145c0a7ae2732cb827aebcb860e0c55fc9c880ddc4f5f7d1c8a6d074be3e9",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/BUILD.gn",
      kind: "file",
      size: 45891,
      sha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer.cc",
      kind: "file",
      size: 2689,
      sha256:
        "26f84076f84647c50ea46dc46f9512ddfa947f6c2abff028da897a8156b87ee7",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer_storage.h",
      kind: "file",
      size: 4025,
      sha256:
        "3f9e5297da557241ff2955733411a00f378cae314de3189a94491128481eb8fb",
    },
    {
      path: "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer_storage_unittest.cc",
      kind: "file",
      size: 13299,
      sha256:
        "0ecca1595f370306f086cb10fa4457322f1ff07e51d1eeb4dc846d90273f5ac5",
    },
    {
      path: "base/test/BUILD.gn",
      kind: "file",
      size: 28953,
      sha256:
        "c57dbfc40278fdc9af67558f6209b17b8531066b1672a2f3e3e6c6851b8bbc37",
    },
    {
      path: "base/test/tracing/test_trace_processor.cc",
      kind: "file",
      size: 8358,
      sha256:
        "92db46117ff55b78f5a3289cc9d5368b85a7182b79074719ea38654a97a2e41f",
    },
    {
      path: "cef/BUILD.gn",
      kind: "file",
      size: 97568,
      sha256:
        "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
    },
    {
      path: "cef/cef_paths2.gypi",
      kind: "file",
      size: 34404,
      sha256:
        "9a5b37b0bc7566a593530105dc5d08fb19c51e5f4d7072678fdbff00366ac934",
    },
    {
      path: "cef/include/cef_sorng_tls_bridge.h",
      kind: "file",
      size: 8886,
      sha256:
        "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
    },
    {
      path: "cef/libcef/browser/browser_context.cc",
      kind: "file",
      size: 12464,
      sha256:
        "4c7a914072ec8932b33656ec11fbc317b132f823a2282f3f63f6d9c65726b2a2",
    },
    {
      path: "cef/libcef/browser/chrome/chrome_content_browser_client_cef.cc",
      kind: "file",
      size: 30367,
      sha256:
        "a518f565b2718a7e9cb60f8510b5d37451a8eb095f84ca1aede311dad78d508a",
    },
    {
      path: "cef/libcef/browser/download_manager_delegate_impl.cc",
      kind: "file",
      size: 18316,
      sha256:
        "aeed739e819197a966a639102737ae18cda98fabeef7908bfa7e89edf69e8d16",
    },
    {
      path: "cef/libcef/browser/native/native_widget_delegate.cc",
      kind: "file",
      size: 4481,
      sha256:
        "16687c95eb695f56f8fd5e51ad74ab6cd402210b24e4e7b72e19565e81235128",
    },
    {
      path: "cef/libcef/browser/native/window_x11.cc",
      kind: "file",
      size: 18719,
      sha256:
        "b9fd179fcef5c1e5755be9c9956ab7cc792ff07393ae8760e2601a1e5d9d7a82",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_bridge.cc",
      kind: "file",
      size: 25757,
      sha256:
        "fa0f6453d0623cbe3c0e1537d60e38561f0d6de3592744dae7dcc5616862af04",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_bridge.h",
      kind: "file",
      size: 1007,
      sha256:
        "205f4ba3605431b4cc974a3cc12a33f6044156f1b2d487baf1288b3aef244cba",
    },
    {
      path: "cef/libcef/browser/net_service/sorng_tls_registration_policy.h",
      kind: "file",
      size: 3647,
      sha256:
        "60f7e6a740ffbc4b005fa4513cfebf625f89bd08b51357262fe769dc86fae975",
    },
    {
      path: "cef/libcef/browser/request_context_impl.cc",
      kind: "file",
      size: 38055,
      sha256:
        "476553766d2d14015194c1f460282e16cab58f8d1aeb1872322d2ef7ef293f71",
    },
    {
      path: "cef/libcef/browser/request_context_impl.h",
      kind: "file",
      size: 10843,
      sha256:
        "576190b62a6dc4ca8c90c5b92c0746fafca19a808cc53ac83e1b9a7435733fd3",
    },
    {
      path: "cef/libcef_dll/sorng_tls_bridge_exports.cc",
      kind: "file",
      size: 1594,
      sha256:
        "ee9d05629db2e8dd9a56fa8290947ba1623b4cba4463e1e26d04d2f9848cfb3f",
    },
    {
      path: "chrome/browser/accessibility/soda_installer_impl.cc",
      kind: "file",
      size: 10044,
      sha256:
        "bcd5215fae14b5523853e54c5370bc4df77f8bd30f6e107b3ce9b160f8beb4a3",
    },
    {
      path: "chrome/browser/net/profile_network_context_service.cc",
      kind: "file",
      size: 71435,
      sha256:
        "1bb392f2a375233f858f585979d2e9cf2a8b2bc55ec20137b863c907484b207c",
    },
    {
      path: "chrome/browser/net/profile_network_context_service.h",
      kind: "file",
      size: 11672,
      sha256:
        "28bfdbd82ddf4c2ca23014fb8f32dee7d56ad989259a058f3f6725d2536186b6",
    },
    {
      path: "chrome/browser/net/proxy_config_monitor.cc",
      kind: "file",
      size: 9734,
      sha256:
        "41fe6103a860e58bdf122a25f1bc1eeb5a0bfcb69bf0c00e026ef91e58a71e57",
    },
    {
      path: "chrome/browser/net/proxy_config_monitor.h",
      kind: "file",
      size: 4569,
      sha256:
        "4ba803fe03dab6fb4d4a232465a74d374a5fcfccb9b7948bf3304a6e92bdd314",
    },
    {
      path: "components/soda/soda_features.cc",
      kind: "file",
      size: 669,
      sha256:
        "f18ef105ef736a03a4866a3cad93e56f6937b8178fabbecf1405161744592dd0",
    },
    {
      path: "components/soda/soda_features.h",
      kind: "file",
      size: 787,
      sha256:
        "ff0df2af6ab969f478d1b0c32c1ba015755c60377493db9cb63e1a8f81c10bc3",
    },
    {
      path: "components/soda/soda_installer.cc",
      kind: "file",
      size: 16226,
      sha256:
        "2dbcf34c368f412c12dc4040c343b31a709f319df8f6e75cd80a442281630f60",
    },
    {
      path: "components/soda/soda_util.cc",
      kind: "file",
      size: 3888,
      sha256:
        "01a6c7567030a9a2883824aa2336378e7888424f45692837e3f97d4c5cf9c4fd",
    },
    {
      path: "net/BUILD.gn",
      kind: "file",
      size: 153732,
      sha256:
        "e2a00edadebcb9e2e769be4ae47974ee71172c3d5b387d44bd619ad900c7d8d7",
    },
    {
      path: "net/cert/cert_verify_proc.h",
      kind: "file",
      size: 15648,
      sha256:
        "d352474ea5ac57239889fcf10e5a2c28dea3a9edd68e6a783cf667115724c732",
    },
    {
      path: "net/cert/cert_verify_proc_builtin.cc",
      kind: "file",
      size: 90253,
      sha256:
        "2be6bbce0583564d7792ab2a6310019bf4224991348f767b4e7860f010469746",
    },
    {
      path: "net/dns/host_resolver_manager.cc",
      kind: "file",
      size: 75926,
      sha256:
        "6ec52d9f79968fb2b921c91fa1b8a1ad19a9356427d655cf7d8d0cbbe45cc872",
    },
    {
      path: "net/dns/host_resolver_manager_unittest.cc",
      kind: "file",
      size: 704832,
      sha256:
        "7c8f5a79e526645e625001a0f7311792672ec76a497e99243bf45fef39135e84",
    },
    {
      path: "net/http/http_network_session.cc",
      kind: "file",
      size: 19545,
      sha256:
        "79c5b2da0db0f740c1274e507deae4043642673ff5289de6b2085bb72b28792c",
    },
    {
      path: "net/http/http_network_session.h",
      kind: "file",
      size: 14698,
      sha256:
        "5b690a26bfd3877ee8c28f1dbb06ccfa15da4a1decc88dfecab491ba8447ce66",
    },
    {
      path: "net/http/http_stream_factory_job.cc",
      kind: "file",
      size: 56633,
      sha256:
        "247c50d13792bc784b05f0329de98ed2c7ef89c388953296af363844f09317bd",
    },
    {
      path: "net/http/sorng_owned_quic_job_unittest.cc",
      kind: "file",
      size: 8828,
      sha256:
        "15c670e87d12d0cf1db1069ffd16eb854e382532efd48a730e604f85ba6a38f5",
    },
    {
      path: "net/proxy_resolution/configured_proxy_resolution_service.cc",
      kind: "file",
      size: 69219,
      sha256:
        "fccc95716e10e9e2bed09ec79bb6c1594a2a50fb0133ec1390ff13f67787bfd2",
    },
    {
      path: "net/proxy_resolution/configured_proxy_resolution_service.h",
      kind: "file",
      size: 25839,
      sha256:
        "21e6bce169c313ba4acc56661412c94e8e4ea3bc821a74d720e82e2ba8bd1da3",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium.cc",
      kind: "file",
      size: 21961,
      sha256:
        "a99e8fe76bb34c73d9c5886c1e62d0e2260492fe3dc2052eb4f166fc7014c596",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium.h",
      kind: "file",
      size: 4757,
      sha256:
        "c3e17e6a7a358335bf73c8b86b83ccb05f873caea70a8f2e2d59a0e752b45d6c",
    },
    {
      path: "net/quic/crypto/proof_verifier_chromium_test.cc",
      kind: "file",
      size: 32670,
      sha256:
        "cf5d72dc0fcd014c76c696c1fea767843df02823ac0213549bcf55738f726610",
    },
    {
      path: "net/quic/quic_session_attempt.cc",
      kind: "file",
      size: 19119,
      sha256:
        "5cd3810657a35c4256ab94b0a85d4999489abb831c0c52602dee2b7225099f6a",
    },
    {
      path: "net/quic/quic_session_pool.cc",
      kind: "file",
      size: 121713,
      sha256:
        "fa4d21229aaef5ba0358214262ce3c80f37ffd5724729314118ad05c996a2da1",
    },
    {
      path: "net/quic/quic_session_pool.h",
      kind: "file",
      size: 47749,
      sha256:
        "f3a4dc12704571ad055fb85c003b364b9c26c79b067ebb07268b81fc9c501b34",
    },
    {
      path: "net/quic/quic_session_pool_owned_proxy_job.cc",
      kind: "file",
      size: 2342,
      sha256:
        "570de99f7e9aa8c72dc0f65307c56932be82457183e69c02a84c9c3d2285dd86",
    },
    {
      path: "net/quic/quic_session_pool_owned_proxy_job.h",
      kind: "file",
      size: 1447,
      sha256:
        "acc73d22d8b9c7ddda3d73f32fb573bc8dafdd088f8a8c8b5416be5d9d2b25ff",
    },
    {
      path: "net/quic/quic_session_pool_peer.cc",
      kind: "file",
      size: 7578,
      sha256:
        "d851a191bd4d16426f59eb4e35e6bf45e7d5bfaa97dae1aa9980a1b1489374b1",
    },
    {
      path: "net/quic/quic_session_pool_peer.h",
      kind: "file",
      size: 5158,
      sha256:
        "dd2a4d1a145ce314ea1fc3f6f4ce310ad4895db67eef8a237049d9fcaacbe519",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket.cc",
      kind: "file",
      size: 17833,
      sha256:
        "4ae6390d6388cd58c6b2a0b83d59236df7cc228ddf773dfc1c71f442a7724b94",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket.h",
      kind: "file",
      size: 5227,
      sha256:
        "242c2a9f4f81fbb31798bd4b52c8e0930a067ec1d7480bd066dc5cbe019b30ec",
    },
    {
      path: "net/socket/sorng_capsule_datagram_client_socket_unittest.cc",
      kind: "file",
      size: 14505,
      sha256:
        "9130ca95daf92c26f1f31f7ce1f53f71da75802549b53e396f4515214d962269",
    },
    {
      path: "net/socket/sorng_tls_policy.h",
      kind: "file",
      size: 1175,
      sha256:
        "9f53d24311540e1f660a232af3ceec5269f12bc5baed5c89cf822af5fefa1f99",
    },
    {
      path: "net/socket/ssl_client_socket.cc",
      kind: "file",
      size: 15377,
      sha256:
        "79c09032c1fdbbea15c493c01bf03e5add47ae361f8d919088367abd2c09a9b0",
    },
    {
      path: "net/socket/ssl_client_socket.h",
      kind: "file",
      size: 12900,
      sha256:
        "8bd155d05e2c0e04b72a866fa8b8c83f3bd2bc6b3bc63b96a280ba64340c41ad",
    },
    {
      path: "net/socket/ssl_client_socket_impl.cc",
      kind: "file",
      size: 72855,
      sha256:
        "f8e87bc264d9f21bb7d602eaedb51691e1f01333e887a9b07d329453562ff65b",
    },
    {
      path: "net/socket/ssl_client_socket_impl.h",
      kind: "file",
      size: 12089,
      sha256:
        "23f03445825b769035512f32b5fc06eb4df5fe5c088857c81f8a0a4bfe908a58",
    },
    {
      path: "net/socket/ssl_client_socket_unittest.cc",
      kind: "file",
      size: 288034,
      sha256:
        "0184fe2ce529efafa39c2542c2d1f31bbfd0492dc6303c9e5fe15328a8502cb9",
    },
    {
      path: "net/spdy/spdy_session_pool.cc",
      kind: "file",
      size: 41966,
      sha256:
        "632a5b9c07bac37f40b96d07c479151f41a3eaea0e5ef972b0bf8ac71801db3c",
    },
    {
      path: "services/cert_verifier/cert_verifier_creation.cc",
      kind: "file",
      size: 10525,
      sha256:
        "dfadab98db93140667edbe256f2ea49ab1fd81d26015576c8c0367bab267c128",
    },
    {
      path: "services/cert_verifier/cert_verifier_service.cc",
      kind: "file",
      size: 12218,
      sha256:
        "a3463725d1bcd9752580f1043aa1c286cc83ff31e3e8fe86687c2c3e45b78050",
    },
    {
      path: "services/cert_verifier/cert_verifier_service_factory.cc",
      kind: "file",
      size: 23118,
      sha256:
        "0feb9077bfb616070d67e33f8507b302467ede3c45f15c69e2e51b120630b7ef",
    },
    {
      path: "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom",
      kind: "file",
      size: 6325,
      sha256:
        "32133f7d65365ff1c9339dce5ccd3cc0fae416920f1c362fa2684ec133bd9f77",
    },
    {
      path: "services/network/network_context.cc",
      kind: "file",
      size: 179056,
      sha256:
        "4399b126f358e0c13e8f47cb75d9634f76fed94821c54067a103d55b9aa7ffe1",
    },
    {
      path: "services/network/network_context.h",
      kind: "file",
      size: 53225,
      sha256:
        "c5a066db60e71a4dc1f4ea5f208cd3111409607546f441364a6431730277aaf1",
    },
    {
      path: "services/network/public/mojom/network_context.mojom",
      kind: "file",
      size: 93573,
      sha256:
        "cae7e451c042e56d8b6832a1bf53e9dc98bb5b81f08c051b05c21f142c7f0ba8",
    },
    {
      path: "services/network/sorng_datagram_configuration_unittest.cc",
      kind: "file",
      size: 13864,
      sha256:
        "daf5a2f7d8d12e2316dd9456e38cb8491ac9b84b31c6d4c0cf5911b4c34b26db",
    },
  ],
});
for (const rows of Object.values(LINUX_ISOLATED_TRANSITION)) {
  rows.forEach(Object.freeze);
  Object.freeze(rows);
}
export const LINUX_PREDECESSOR_IDENTITY =
  "49f23608a686da56a32a2c825b51fa2577bcbba6353d5f9587a0c68dec9df68e";
export const LINUX_INCREMENTAL_TOOLCHAIN_SHA =
  "345e0c5fb0034b3194ab3fd2b60e499eabf6d3e320ad4ae7a5d4534e6a8835dd";
export const LINUX_INCREMENTAL_EVIDENCE = Object.freeze([
  "predecessor",
  "readiness",
  "apply",
  "started",
  "container",
  "compile",
  "compileOutput",
  "finished",
  "postchecks",
  "package",
  "distribution",
  "preparation",
]);
export const LINUX_ISOLATED_COPY_TREES = Object.freeze([
  "base",
  "net",
  "network",
  "out",
]);
export const LINUX_ISOLATED_INIT_ROOTS = Object.freeze([
  "base",
  "net",
  "network",
  "cef",
  "out",
  "operation",
]);
export const LINUX_ISOLATED_EVIDENCE = Object.freeze([
  ...LINUX_INCREMENTAL_EVIDENCE,
  "workspace",
  "copyManifest",
  "generation",
  "gn",
  "gnOutput",
]);
export const LINUX_ISOLATED_LIMITS = Object.freeze({
  copyFiles: 500000,
  copyDirectories: 100000,
  copyBytes: 256 * 1024 ** 3,
  fileBytes: 8 * 1024 ** 3,
  pathBytes: 1024,
  copyManifestBytes: 128 * 1024 ** 2,
  generationBytes: 48 * 1024 ** 2,
  gnOutputBytes: 16 * 1024 ** 2,
  totalEvidenceBytes: 272 * 1024 ** 2,
  workMs: 7800000,
  cleanupMs: 30000,
  copyMs: 1800000,
  generationMs: 600000,
  gnMs: 900000,
  compileMs: 3600000,
  packageMs: 900000,
  diskMinimumBytes: 100 * 1024 ** 3,
  allowanceBytes: 8 * 1024 ** 3,
});
export const LINUX_INCREMENTAL_PROVENANCE = Object.freeze([
  "origin",
  "operation",
  "controllerCommit",
  "sourceLockIdentity",
  "predecessorSourceLockIdentity",
  "predecessorHandoffSha256",
  "baselineEngineSha256",
  "engineSha256",
  "image",
  "originalInputsSourceLockRawSha256",
  "toolchainLockSha256",
  "actualToolFilesVerified",
  "separatelyObservedTools",
  "incrementalBuild",
  "pristineSourceBuild",
  "originalBuildReplayed",
  "reviewedEvidenceDigests",
  "nestedOriginalRecordDigests",
]);
export const LINUX_ISOLATED_PROVENANCE = Object.freeze([
  ...LINUX_INCREMENTAL_PROVENANCE,
  "originalCacheReadonly",
  "workspaceCopied",
  "workspaceVolume",
  "workspaceManifestSha256",
  "generationRecordSha256",
  "gnRecordSha256",
  "compiledObjectSha256",
  "isolatedBuild",
]);
export const WINDOWS_CAPSULE_ORIGIN = "owned-windows-capsule-lifetime-engine";
export const WINDOWS_CAPSULE_IDENTITY =
  "bdc724576452178e82a6d9732aaaf1a770e277ddf5ce5cad5a4d65ac242a9629";
export const WINDOWS_CAPSULE_EVIDENCE = Object.freeze([
  "build",
  "native",
  "nativeJobs",
  "nativeFocusedOutput",
  "nativeBrpOutput",
  "nativeSandboxOutput",
  "nativeFocusedList",
  "nativeBrpList",
  "nativeSandboxList",
  "engine",
  "engineJob",
  "engineOutput",
  "engineBeforeimage",
  "engineSymbols",
  "sourcePostchecks",
  "package",
  "distribution",
  "preparation",
]);
export const WINDOWS_OPERATION2_ORIGIN =
  "owned-windows-capsule-lifetime-operation2";
export const WINDOWS_OPERATION2_EVIDENCE = Object.freeze([
  ...WINDOWS_CAPSULE_EVIDENCE,
  "previousEngineAttempt",
  "engineAccounting",
]);
export const isWindowsCapsuleOrigin = (origin) =>
  [WINDOWS_CAPSULE_ORIGIN, WINDOWS_OPERATION2_ORIGIN].includes(origin);
export const ownedCapsuleEvidence = (origin) =>
  origin === WINDOWS_OPERATION2_ORIGIN
    ? WINDOWS_OPERATION2_EVIDENCE
    : WINDOWS_CAPSULE_EVIDENCE;
export const WINDOWS_OPERATION2_CLANG = Object.freeze({
  bytes: 103794176,
  sha256: "84ce79856a871a28a062fc9e4586c527a897903caf58bbf37fe9391ec2dd78c7",
  provenance: "separately-observed-not-native42-tool8",
  verified: true,
});
export const WINDOWS_CAPSULE_PROVENANCE = Object.freeze([
  "origin",
  "engineSha256",
  "baselineEngineSha256",
  "originalControllerCommit",
  "actualToolFilesVerified",
  "nativeClassTestsPassed",
  "incrementalBuild",
  "originalBuildRecordsPinned",
  "originalBuildReplayed",
  "pristineSourceBuild",
  "nativeProfileCounts",
  "actualSourceFilesVerified",
  "securityMacroCount",
  "instanceTracerEnabled",
  "derivedFacts",
  "reviewedEvidenceDigests",
  "nestedOriginalRecordDigests",
]);
export const WINDOWS_OPERATION2_PROVENANCE = Object.freeze([
  ...WINDOWS_CAPSULE_PROVENANCE,
  "previousFailedAttemptDigest",
  "engineAccountingDigest",
  "separatelyObservedClang",
  "engineOperationPolicy",
]);
export const WINDOWS_CAPSULE_SOURCE_PINS = Object.freeze([
  {
    path: "net/socket/sorng_capsule_datagram_client_socket.cc",
    bytes: 17833,
    sha256: "4ae6390d6388cd58c6b2a0b83d59236df7cc228ddf773dfc1c71f442a7724b94",
  },
  {
    path: "net/socket/sorng_capsule_datagram_client_socket.h",
    bytes: 5227,
    sha256: "242c2a9f4f81fbb31798bd4b52c8e0930a067ec1d7480bd066dc5cbe019b30ec",
  },
  {
    path: "net/socket/sorng_capsule_datagram_client_socket_unittest.cc",
    bytes: 14505,
    sha256: "9130ca95daf92c26f1f31f7ce1f53f71da75802549b53e396f4515214d962269",
  },
  {
    path: "services/network/network_context.cc",
    bytes: 179211,
    sha256: "c0e69a996e417c0af4d9f49547cb9ddbc60610ca27e05410f389c243ba44d568",
  },
  {
    path: "services/network/network_context.h",
    bytes: 53225,
    sha256: "c5a066db60e71a4dc1f4ea5f208cd3111409607546f441364a6431730277aaf1",
  },
  {
    path: "services/network/sorng_datagram_configuration_unittest.cc",
    bytes: 13864,
    sha256: "daf5a2f7d8d12e2316dd9456e38cb8491ac9b84b31c6d4c0cf5911b4c34b26db",
  },
  {
    path: "base/BUILD.gn",
    bytes: 233805,
    sha256: "416145c0a7ae2732cb827aebcb860e0c55fc9c880ddc4f5f7d1c8a6d074be3e9",
  },
  {
    path: "base/test/BUILD.gn",
    bytes: 27780,
    sha256: "ef64d54196d1b101e0eca9dfd7dbda029c033663ff7b118892a0bfe306298ba0",
  },
  {
    path: "base/test/tracing/test_trace_processor.cc",
    bytes: 8358,
    sha256: "92db46117ff55b78f5a3289cc9d5368b85a7182b79074719ea38654a97a2e41f",
  },
]);
export const WINDOWS_CAPSULE_MACROS = Object.freeze({
  ENABLE_USER_SPACE_ZERO_SEGMENT: 1,
  USER_SPACE_ZERO_SEGMENT_SIZE_MB: 4097,
  BACKUP_REF_PTR_EXTRA_OOB_CHECKS: 1,
  BACKUP_REF_PTR_POISON_OOB_PTR: 0,
  CAN_UNWIND_WITH_FRAME_POINTERS: 0,
  CHECKED_SPAN: 1,
  CHECKED_SPAN_HAS_METADATA_SUPPORT: 0,
  DCHECKS_ARE_ON: 1,
  DCHECK_IS_CONFIGURABLE: 0,
  ENABLE_AUTO_PARTITIONING: 0,
  ENABLE_BACKUP_REF_PTR_FEATURE_FLAG: 1,
  ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER: 0,
  ENABLE_BACKUP_REF_PTR_SLOW_CHECKS: 0,
  ENABLE_BACKUP_REF_PTR_SUPPORT: 1,
  ENABLE_BRP_FOR_UNPROTECTED_IN_RELEASE_RAW_PTR: 1,
  ENABLE_DANGLING_RAW_PTR_CHECKS: 1,
  ENABLE_DANGLING_RAW_PTR_FEATURE_FLAG: 1,
  ENABLE_GWP_ASAN_SUPPORT: 1,
  ENABLE_PARTITION_LOCK_REENTRANCY_CHECK: 0,
  ENABLE_PARTITION_LOCK_PRIORITY_INHERITANCE: 0,
  ENABLE_PKEYS: 0,
  ENABLE_POINTER_ARITHMETIC_TRAIT_CHECK: 1,
  ENABLE_POINTER_COMPRESSION: 0,
  ENABLE_POINTER_SUBTRACTION_CHECK: 0,
  ENABLE_SYSTEM_FREE_FALLBACK: 0,
  MOVE_METADATA_OUT_OF_GIGACAGE_FOR_64_BITS_POINTERS: 1,
  ENABLE_MOVE_METADATA_OUT_OF_GIGACAGE_TRIAL: 1,
  ENABLE_THREAD_ISOLATION: 0,
  EXPENSIVE_DCHECKS_ARE_ON: 1,
  FORCE_DISABLE_BACKUP_REF_PTR_FEATURE: 0,
  FORCE_ENABLE_RAW_PTR_EXCLUSION: 0,
  FORWARD_THROUGH_MALLOC: 0,
  HAS_64_BIT_POINTERS: 1,
  HAS_MEMORY_TAGGING: 0,
  IS_ANDROID: 0,
  IS_CHROMEOS: 0,
  IS_COMPONENT_BUILD: 0,
  IS_DEBUG: 0,
  IS_HWASAN: 0,
  MEMORY_TOOL_REPLACES_ALLOCATOR: 0,
  OFFICIAL: 0,
  RAW_PTR_ZERO_ON_CONSTRUCT: 1,
  RAW_PTR_ZERO_ON_DESTRUCT: 0,
  RAW_PTR_ZERO_ON_MOVE: 1,
  REALLOC_GROWTH_FACTOR_MITIGATION: 0,
  RECORD_ALLOC_INFO: 0,
  SHIM_SUPPORTS_ALLOC_TOKEN: 0,
  SHIM_SUPPORTS_SIZED_DEALLOC: 1,
  SMALLER_PARTITION_COOKIE: 0,
  STACK_SCAN_SUPPORTED: 1,
  USE_ALLOCATOR_SHIM: 1,
  USE_ASAN_BACKUP_REF_PTR: 0,
  USE_ASAN_BACKUP_REF_PTR_V2: 0,
  USE_FULL_MTE: 0,
  USE_LARGE_EMPTY_SLOT_SPAN_RING: 1,
  USE_PARTITION_ALLOC: 1,
  USE_PARTITION_ALLOC_AS_MALLOC: 1,
  USE_PARTITION_COOKIE: 1,
  USE_RAW_PTR_ASAN_UNOWNED_IMPL: 0,
  USE_RAW_PTR_BACKUP_REF_IMPL: 1,
  USE_RAW_PTR_HOOKABLE_IMPL: 0,
});
export const WINDOWS_CAPSULE_TOOL_PINS = Object.freeze([
  {
    path: "Users/Mariana/AppData/Local/Programs/Python/Python312/python.exe",
    sha256: "4d6f5f81a4bca11191c4c7c6b43632694d0a4ce74e068619d8fdc161d469859a",
    size: 104952,
  },
  {
    path: "Users/Mariana/AppData/Local/Programs/Python/Python312/python312.dll",
    sha256: "9a0e3435aaa680d868150f87ab3e388ad2eebc22f87e036155c7b4eda8cd2120",
    size: 6945272,
  },
  {
    path: "Program Files (x86)/Microsoft Visual Studio/2026/BuildTools/VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64/cl.exe",
    sha256: "b0a1818ebae6da7f18230a84e76ce839212584ac4c2ab55b97a0d5268085da57",
    size: 893288,
  },
  {
    path: "Program Files (x86)/Microsoft Visual Studio/2026/BuildTools/VC/Tools/MSVC/14.51.36231/lib/x64/libcmt.lib",
    sha256: "d4cc4c224455825dec1669f9ad6a9872a4f5b37ed1daae1fd0b9044d7650d908",
    size: 6610744,
  },
  {
    path: "Program Files (x86)/Microsoft Visual Studio/2026/BuildTools/VC/Tools/MSVC/14.51.36231/include/vcruntime.h",
    sha256: "8a6e89fe85c66162d62c772d02367ae2e6530f1faaaa8d099427698a689bac7f",
    size: 11444,
  },
  {
    path: "Program Files (x86)/Windows Kits/10/Include/10.0.28000.0/um/Windows.h",
    sha256: "b337d661d03a4abefb7b86a2742ce1ad5d19b57cd8b858bd13e7bbcc1dbeeaaa",
    size: 7511,
  },
  {
    path: "Program Files (x86)/Windows Kits/10/Lib/10.0.28000.0/um/x64/kernel32.lib",
    sha256: "8ba8dab9adec752047d4f136852e8136d01836bff39bbb56a20ac5f2d56415d8",
    size: 311908,
  },
  {
    path: "Program Files (x86)/Windows Kits/10/Debuggers/x64/dbghelp.dll",
    sha256: "575e0d4f2859e8b368dd3dc21e4b16e4ad4f885dceeb44abe6466cfb4e4141f5",
    size: 735728,
  },
]);
export const WINDOWS_CAPSULE_PROFILES = Object.freeze({
  "owned-quic-lifetime-full": [
    "SorngDatagramConfigurationTest.OnlyExactNativeContextCanEnableQuic",
    "SorngDatagramConfigurationTest.ReplacementMustProveItsOwnCurrentProxy",
    "SorngOwnedQuicJobTest.ExactCurrentOwnedProxyReachesCapsuleTcp",
    "SorngOwnedQuicJobTest.OwnedSessionAdvertisesItsActualReceiveLimit",
    "SorngOwnedQuicJobTest.OrdinarySessionsKeepTheirExistingWireAdvertisement",
    "SorngOwnedQuicJobTest.SameEndpointWithoutContextAuthorityIsRejected",
    "SorngOwnedQuicJobTest.RevokedContextIsRejectedBeforeTransport",
    "SorngOwnedQuicJobTest.WrongEndpointAndEveryUnownedSchemeStayRejected",
    "SorngCapsuleSocketTest.RejectsCredentialsAndWrongEndpointWithoutDial",
    "SorngCapsuleSocketTest.UpgradePreservesCoalescedCapsuleAndExactDatagram",
    "SorngCapsuleSocketTest.FragmentedUpgradeDiscardsUnknownCapsulesAndContexts",
    "SorngCapsuleSocketTest.MalformedDatagramCapsuleFailsClosed",
    "SorngCapsuleSocketTest.OversizeDatagramNeverWritesBeyondNativeRouteCap",
    "SorngCapsuleSocketTest.NumericIpv6PathNeverResolvesOrigin",
    "SorngCapsuleSocketTest.RefusesNonUpgradeAndRevocationCancelsPendingConnect",
    "SorngCapsuleSocketTest.NativeUpgradeDeadlineIsBounded",
    "ProofVerifierChromiumTest.VerifyProof",
    "ProofVerifierChromiumTest.FailsIfCertFails",
    "ProofVerifierChromiumTest.PassesCertVerifierRequestParams",
    "ProofVerifierChromiumTest.FailsIfSignatureFails",
    "ProofVerifierChromiumTest.IsFatalErrorNotSetForNonFatalError",
    "ProofVerifierChromiumTest.IsFatalErrorSetForFatalError",
    "ProofVerifierChromiumTest.PKPEnforced",
    "ProofVerifierChromiumTest.PKPBypassFlagSet",
    "ProofVerifierChromiumTest.PKPAndCTBothTested",
    "ProofVerifierChromiumTest.OwnedAdmissionWaitsAndPreservesNativeFailures",
    "ProofVerifierChromiumTest.OwnedAdmissionRevocationRejectsPostedSuccess",
    "ProofVerifierChromiumTest.UnknownRootRejected",
    "ProofVerifierChromiumTest.UnknownRootAcceptedWithOverride",
    "ProofVerifierChromiumTest.UnknownRootAcceptedWithWildcardOverride",
    "ProofVerifierChromiumTest.SCTAuditingReportCollected",
    "ProofVerifierChromiumTest.DestroyWithPendingRequest",
    "SorngCapsuleSocketTest.CloseReleasesFactoryAndStreamBeforeOwnerDies",
    "SorngCapsuleSocketTest.RevokeCompletesPendingConnectExactlyOnceAndDropsStream",
    "SorngCapsuleSocketTest.ReentrantRevokeCompletionCanDeleteCapsuleAndFactory",
    "SorngDatagramConfigurationTest.ContextShutdownRetiresPendingOwnedCapsuleBeforeFactoryAndLateRevoke",
  ],
  "brp-dpd": [
    "BackupRefPtrTest.Basic",
    "BackupRefPtrTest.QuarantinedBytes",
    "BackupRefPtrTest.RawPtrNotDangling",
  ],
  sandbox: [
    "RestrictedTokenTest.ResultToken",
    "RestrictedTokenTest.DefaultDaclLockdown",
    "RestrictedTokenTest.DeleteAllPrivileges",
  ],
});
const capsuleTextRoles = new Set([
  "engineOutput",
  "nativeFocusedOutput",
  "nativeBrpOutput",
  "nativeSandboxOutput",
  "nativeFocusedList",
  "nativeBrpList",
  "nativeSandboxList",
]);
export function ownedEvidenceLimit(origin, role) {
  if (origin === LINUX_ISOLATED_ORIGIN)
    return role === "copyManifest"
      ? LINUX_ISOLATED_LIMITS.copyManifestBytes
      : role === "generation"
        ? LINUX_ISOLATED_LIMITS.generationBytes
        : role === "gnOutput"
          ? LINUX_ISOLATED_LIMITS.gnOutputBytes
          : role === "compileOutput"
            ? 64 * 1024 ** 2
            : 1024 ** 2;
  if (origin === LINUX_INCREMENTAL_ORIGIN)
    return role === "compileOutput" ? 64 * 1024 ** 2 : 1024 ** 2;
  if (origin === WINDOWS_OPERATION2_ORIGIN)
    return role === "engineOutput"
      ? 64 * 1024 ** 2
      : role === "engineAccounting"
        ? 2 * 1024 ** 2
        : 1024 ** 2;
  return isWindowsCapsuleOrigin(origin) && role === "engineOutput"
    ? 64 * 1024 ** 2
    : origin === WINDOWS_OPERATION2_ORIGIN && role === "engineAccounting"
      ? 2 * 1024 ** 2
      : RELEASE_LIMITS.metadata;
}
export const WINDOWS_INCREMENTAL_EVIDENCE = Object.freeze([
  "build",
  "beforeimage",
  "apply",
  "prerequisites",
  "nativeOutput",
  "continuation",
  "engineJob",
  "engine",
  "engineOutput",
  "symbols",
  "package",
  "distribution",
  "preparation",
]);
export const WINDOWS_INCREMENTAL_PROVENANCE = Object.freeze([
  "origin",
  "engineSha256",
  "baselineEngineSha256",
  "originalControllerCommit",
  "actualToolFilesVerified",
  "nativeClassTestsPassed",
  "incrementalBuild",
  "originalBuildRecordsPinned",
  "originalBuildReplayed",
  "pristineSourceBuild",
]);
const evidenceNames = (origin) =>
  origin === LINUX_ISOLATED_ORIGIN
    ? LINUX_ISOLATED_EVIDENCE
    : origin === LINUX_INCREMENTAL_ORIGIN
      ? LINUX_INCREMENTAL_EVIDENCE
      : isWindowsCapsuleOrigin(origin)
        ? ownedCapsuleEvidence(origin)
        : origin === "owned-windows-incremental-engine"
          ? WINDOWS_INCREMENTAL_EVIDENCE
          : origin === "owned-linux-engine"
            ? [
                "prepared",
                "started",
                "container",
                "finished",
                "producer",
                "freshCheck",
              ]
            : ["build"];
const fail = (message) => {
  throw Error(message);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function shape(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("Closed reviewed handoff fields required");
}
function pin(value, maximum = RELEASE_LIMITS.metadata) {
  shape(value, ["path", "sha256", "size"]);
  releaseRelativePath(value.path);
  if (
    !hex.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > maximum
  )
    fail("Bounded raw metadata pin required");
}

export function ownedSdkHandoffPlan(review) {
  shape(review, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "sourceLockIdentity",
    "descriptorSha256",
    "python",
    "evidence",
  ]);
  if (
    review.schemaVersion !== 1 ||
    review.kind !== "sorng-cef-owned-sdk-review" ||
    !Object.hasOwn(origins, review.origin) ||
    review.target !== origins[review.origin] ||
    !hex.test(review.sourceLockIdentity) ||
    !hex.test(review.descriptorSha256)
  )
    fail("Closed local SDK identity required");
  shape(review.python, ["path", "sha256", "size"]);
  if (
    !path.isAbsolute(review.python.path) ||
    !hex.test(review.python.sha256) ||
    !Number.isSafeInteger(review.python.size) ||
    review.python.size < 1 ||
    review.python.size > 64 * 1024 ** 2
  )
    fail("Explicit reviewed Python executable pin required");
  shape(review.evidence, evidenceNames(review.origin));
  if (
    isLinuxIncrementalOrigin(review.origin) &&
    (review.sourceLockIdentity !==
      (review.origin === LINUX_ISOLATED_ORIGIN
        ? LINUX_ISOLATED_IDENTITY
        : LINUX_INCREMENTAL_IDENTITY) ||
      Object.values(review.evidence).reduce((n, p) => n + p.size, 0) >
        (review.origin === LINUX_ISOLATED_ORIGIN
          ? LINUX_ISOLATED_LIMITS.totalEvidenceBytes
          : 80 * 1024 ** 2))
  )
    fail("Closed Linux incremental identity and evidence bound required");
  for (const [role, value] of Object.entries(review.evidence))
    pin(value, ownedEvidenceLimit(review.origin, role));
  if (
    isWindowsCapsuleOrigin(review.origin) &&
    (review.sourceLockIdentity !== WINDOWS_CAPSULE_IDENTITY ||
      Object.values(review.evidence).reduce((sum, row) => sum + row.size, 0) >
        96 * 1024 ** 2)
  )
    fail("Closed capsule source and total evidence bound required");
  if (
    review.origin === "owned-windows-incremental-engine" &&
    Object.values(review.evidence).reduce(
      (total, value) => total + value.size,
      0,
    ) >
      2 * 1024 ** 2
  )
    fail("Incremental Windows evidence total bound");
  return {
    ...structuredClone(review),
    verificationScope: "reviewed-local-bytes-and-evidence-bindings",
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
  };
}

export function ownedHandoffReviewBinding(review) {
  ownedSdkHandoffPlan(review);
  return {
    canonicalReviewSha256: identitySha256(review),
    evidencePins: structuredClone(review.evidence),
    verificationPython: {
      sha256: review.python.sha256,
      size: review.python.size,
    },
  };
}

// These cross-file checks do not make JSON an authority. The operator must first
// review genuine records and pin their exact bytes in the closed review input.
export function verifyOwnedHandoffEvidence(review, records, sourceLock) {
  ownedSdkHandoffPlan(review);
  shape(records, evidenceNames(review.origin));
  if (isLinuxIncrementalOrigin(review.origin))
    return verifyLinuxIncrementalEvidence(
      review,
      records,
      sourceLock,
      review.origin === LINUX_ISOLATED_ORIGIN,
    );
  if (isWindowsCapsuleOrigin(review.origin))
    return verifyWindowsCapsuleEvidence(review, records, sourceLock);
  if (review.origin === "owned-windows-incremental-engine")
    return verifyWindowsIncrementalEvidence(review, records, sourceLock);
  if (review.origin === "existing-windows-package") {
    const e = records.build;
    if (
      e.built !== true ||
      e.sourceLockSha256 !== review.sourceLockIdentity ||
      !hex.test(e.libcefSha256) ||
      e.gnArgsUnchanged !== true ||
      e.acceptance !== "pending"
    )
      fail("Original Windows build evidence mismatch");
    return {
      origin: review.origin,
      engineSha256: e.libcefSha256,
      originalBuildRecordPinned: true,
      newEngineBuildClaimed: false,
    };
  }
  const {
    prepared: p,
    started: s,
    container: c,
    finished: f,
    producer: b,
    freshCheck: check,
  } = records;
  const operation = p.plan?.operation,
    source = p.plan?.sourceCommit,
    image = p.plan?.image;
  if (
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(operation ?? "") ||
    !commit.test(source ?? "") ||
    !/^sha256:[a-f\d]{64}$/.test(image ?? "") ||
    !hex.test(p.sourceArchiveSha256 ?? "") ||
    !hex.test(p.planSha256 ?? "") ||
    s.operation !== operation ||
    s.sourceCommit !== source ||
    s.image !== image ||
    s.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    s.planSha256 !== p.planSha256 ||
    s.replayAllowed !== false
  )
    fail("Prepared source and one-shot engine record mismatch");
  const x = check.result,
    fp = x?.plan,
    lock = validateSourceLock(x?.sourceLock);
  if (
    !hex.test(p.sourceInventorySha256 ?? "") ||
    p.extraction?.rootOwned !== true ||
    p.extraction?.sourceCommit !== source ||
    p.extraction?.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    p.extraction?.sourceInventorySha256 !== p.sourceInventorySha256 ||
    p.sealed?.sealed !== true ||
    p.sealed?.planSha256 !== p.planSha256 ||
    p.tools?.filesVerified !== 10 ||
    p.tools?.toolsRoot !== "/work/tools" ||
    p.tools?.engineBuildAttempted !== false ||
    p.tools?.pythonStdlibDependency !==
      "same immutable image /usr/lib/python3.12"
  )
    fail(
      "Prepared extraction, sealed inventory and actual tool check required",
    );
  if (
    check.engineBuildAttempted !== false ||
    check.publicationAllowed !== false ||
    fp?.operation !== operation ||
    fp.sourceCommit !== source ||
    fp.imageId !== image ||
    fp.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    fp.sourceInventorySha256 !== p.sourceInventorySha256 ||
    !hex.test(fp.sourceLockSha256 ?? "") ||
    fp.target !== review.target ||
    fp.runnerMode !== "dedicated" ||
    fp.repository !== "supermarsx/sortOfRemoteNG" ||
    fp.provenance !== "owned-local-container" ||
    fp.productionReady !== false ||
    fp.nativeAcceptance !== "not-tested" ||
    fp.publicationAllowed !== false ||
    identitySha256(lock) !== review.sourceLockIdentity ||
    x.confinement !== "actual-kernel-validated" ||
    x.imageIdentityAuthority !==
      "parent Docker inspect; not introspectable in child" ||
    x.productionReady !== false
  )
    fail("Fresh native source, image, toolchain and kernel check mismatch");
  if (
    identitySha256(fp.paths) !==
      identitySha256({
        checkout: "/opt/producer/checkout",
        archive: "/opt/producer/source.tar",
        inventory: "/opt/producer/source-inventory.json",
        tools: "/work/tools",
        temporary: "/work/build",
        scratch: "/work/tmp",
      }) ||
    x.home?.uid !== 10001 ||
    x.home?.gid !== 10001 ||
    x.home?.mode !== 0o700 ||
    x.home?.privateCacheWriteVerified !== true ||
    x.home?.cacheProbeRemoved !== true ||
    x.home?.mountAndAliasVerified !== true
  )
    fail("Fresh private HOME and fixed mount paths required");
  if (
    !commit.test(s.controllerCommit ?? "") ||
    c.controllerCommit !== s.controllerCommit ||
    f.controllerCommit !== s.controllerCommit ||
    c.sourceCommit !== source ||
    f.sourceCommit !== source ||
    c.image !== image ||
    c.name !== `/sorng-cef-owned-engine-${operation}` ||
    !hex.test(c.id ?? "") ||
    c.networkMode !== "bridge" ||
    c.user !== "10001:10001" ||
    c.readonlyRoot !== true ||
    c.memory !== 24 * 1024 ** 3 ||
    c.memorySwap !== c.memory ||
    c.nanoCpus !== 8e9 ||
    c.pids !== 512
  )
    fail("Owned engine identity or confinement record mismatch");
  if (
    f.reason !== "completed" ||
    f.result?.exitCode !== 0 ||
    f.result?.logFailure ||
    f.result?.streamExceeded ||
    f.result?.controllerFailure ||
    f.provenance !== "owned-local-container" ||
    f.productionReady !== false ||
    f.nativeAcceptance !== "not-tested" ||
    f.publicationAllowed !== false
  )
    fail("Completed owned engine without log failure required");
  if (
    b.state !== "completed" ||
    b.operation !== operation ||
    b.sourceCommit !== source ||
    b.imageIdReviewedExpectation !== image ||
    b.parentImageVerificationRequired !== true ||
    b.provenance !== "owned-local-container" ||
    b.productionReady !== false ||
    b.nativeAcceptance !== "not-tested" ||
    b.publicationAllowed !== false ||
    b.result?.target !== review.target ||
    b.result?.descriptorSha256 !== review.descriptorSha256 ||
    b.result?.nativeAcceptance !== "not-tested" ||
    b.result?.productionReady !== false
  )
    fail("Actual completed child bundle receipt required");
  return {
    origin: review.origin,
    operation,
    sourceCommit: source,
    controllerCommit: s.controllerCommit,
    image,
    sourceArchiveSha256: p.sourceArchiveSha256,
    sourceInventorySha256: p.sourceInventorySha256,
    originalInputsSourceLockRawSha256: fp.sourceLockSha256,
    toolchainLockSha256: lock.builds.find((row) => row.target === review.target)
      ?.toolchainLock.sha256,
    actualToolFilesVerified: p.tools.filesVerified,
    completedEngineRecordsPinned: true,
  };
}

// The controller emits these exact private records. A matching schema is not
// independent execution attestation: the operator must review the genuine bytes.
export const LINUX_INCREMENTAL_FACT_KEYS = Object.freeze({
  predecessor: ["sourceLock", "review", "handoff", "manifest", "records"],
  readiness: [
    "image",
    "volume",
    "cacheRoot",
    "sourceBefore",
    "toolFiles",
    "extraTools",
    "args",
    "graph",
    "securityMacros",
    "securityHeader",
    "kernel",
    "upstream",
    "reconstruction",
    "exclusiveCache",
    "cacheOutputs",
  ],
  apply: ["patch", "before", "after", "onlyReviewedPatchApplied"],
  started: [
    "startWallMs",
    "startMonotonicMs",
    "compileDeadlineWallMs",
    "compileBudgetMs",
    "cleanupBudgetMs",
    "packagingBudgetMs",
    "controllerPins",
    "replayAllowed",
  ],
  container: ["id", "name", "image", "volume", "kernel"],
  compile: [
    "argv",
    "cwd",
    "beginWallMs",
    "endWallMs",
    "beginMonotonicMs",
    "endMonotonicMs",
    "elapsedMs",
    "exit",
    "outputSha256",
    "outputBytes",
    "localSteps",
    "finished",
  ],
  finished: [
    "containerId",
    "reason",
    "exit",
    "quiescent",
    "processesLeft",
    "readersStopped",
    "logFailure",
    "cleanupElapsedMs",
  ],
  postchecks: [
    "sourceAfter",
    "toolFiles",
    "extraTools",
    "args",
    "securityMacros",
    "securityHeader",
    "upstream",
    "compileSha256",
    "engine",
    "sandbox",
  ],
  package: [
    "descriptorSha256",
    "originalInputsSourceLockRawSha256",
    "sourceLockIdentity",
    "engine",
    "sandbox",
    "sdkFiles",
    "assets",
    "beginWallMs",
    "endWallMs",
    "elapsedMs",
  ],
  distribution: [
    "argv",
    "cwd",
    "exit",
    "elapsedMs",
    "inventorySha256",
    "filesVerified",
    "quiescent",
    "outputsFresh",
  ],
  preparation: [
    "method",
    "exit",
    "elapsedMs",
    "inventorySha256",
    "filesVerified",
    "quiescent",
    "outputsFresh",
    "archiveRoundtrip",
    "elfMachine",
    "bridgeExports",
  ],
});
export const LINUX_ISOLATED_FACT_KEYS = Object.freeze({
  ...LINUX_INCREMENTAL_FACT_KEYS,
  apply: ["patches", "before", "after", "onlyReviewedPatchesApplied"],
  container: [...LINUX_INCREMENTAL_FACT_KEYS.container, "inspect"],
  workspace: [
    "originalVolume",
    "workspaceVolume",
    "originalReadonly",
    "independentCopies",
    "createdFresh",
    "init",
    "mounts",
    "copyManifestSha256",
    "copyFiles",
    "copyBytes",
    "copyDirectories",
    "cefProjection",
    "startWallMs",
    "startMonotonicMs",
    "workDeadlineWallMs",
    "workBudgetMs",
    "cleanupBudgetMs",
    "copyBudgetMs",
    "generationBudgetMs",
    "gnBudgetMs",
    "capacityBeforeBytes",
    "capacityAfterBytes",
    "diskMinimumBytes",
    "beginWallMs",
    "endWallMs",
    "elapsedMs",
  ],
  copyManifest: [
    "limits",
    "trees",
    "entries",
    "directories",
    "bytes",
    "files",
    "inventorySha256",
    "complete",
    "unknownLinks",
    "independentFiles",
  ],
  generation: ["packet", "metadata", "logs", "elapsedMs"],
  gn: [
    "argv",
    "cwd",
    "beginWallMs",
    "endWallMs",
    "elapsedMs",
    "exit",
    "outputSha256",
    "outputBytes",
    "argsBefore",
    "argsAfter",
    "securityHeaderBefore",
    "securityHeaderAfter",
    "securityMacrosBefore",
    "securityMacrosAfter",
    "graphBefore",
    "graphAfter",
    "objectEdge",
    "linkEdge",
    "sourceAfterSha256",
    "generationSha256",
  ],
  postchecks: [
    ...LINUX_INCREMENTAL_FACT_KEYS.postchecks,
    "objectAfter",
    "linkAfter",
    "workspaceSha256",
    "generationSha256",
    "gnSha256",
  ],
});
export const LINUX_INCREMENTAL_TOOL_PINS = Object.freeze([
  {
    path: "usr/bin/python3.12",
    size: 8020928,
    sha256: "e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f",
  },
  {
    path: "usr/bin/x86_64-linux-gnu-ld.bfd",
    size: 1359128,
    sha256: "e9ceb054c12207970f2726dfc07e9a66b411602748628baf27399f02a9bbb31b",
  },
  {
    path: "usr/bin/pkgconf",
    size: 45168,
    sha256: "7e8152db1b0c7e49d47b4b82a70dc9997b557951c5d4d938b0e7f208ce9eb10b",
  },
  {
    path: "usr/include/stdio.h",
    size: 34649,
    sha256: "b4f6709d12c8493e2a42f740845abe2994deb27fc78fb85fcaa6e27228a87d62",
  },
  {
    path: "usr/bin/git",
    size: 4066232,
    sha256: "eb54b535467e0975c1284d4c4d08eea779aeb248a5d34b02e2ee171382e22201",
  },
  {
    path: "usr/bin/gperf",
    size: 100680,
    sha256: "32bb03d8f3d79434c0ac001ad8c530c405c6aef763d4aeb4033c7e21131bc6ca",
  },
  {
    path: "usr/local/bin/node",
    size: 125989464,
    sha256: "bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12",
  },
  {
    path: "usr/local/bin/siso",
    size: 63728201,
    sha256: "c74fe8203cfef3222592aea4292809d13ec645d39e9763b416c542d304837c4f",
  },
]);
export const LINUX_INCREMENTAL_SOURCE_PATHS = Object.freeze([
  "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer.cc",
  "cef/BUILD.gn",
  "cef/cef_paths2.gypi",
  "cef/include/cef_sorng_tls_bridge.h",
  "cef/libcef/browser/browser_context.cc",
  "cef/libcef/browser/chrome/chrome_content_browser_client_cef.cc",
  "cef/libcef/browser/download_manager_delegate_impl.cc",
  "cef/libcef/browser/native/native_widget_delegate.cc",
  "cef/libcef/browser/native/window_x11.cc",
  "cef/libcef/browser/net_service/sorng_tls_bridge.cc",
  "cef/libcef/browser/net_service/sorng_tls_bridge.h",
  "cef/libcef/browser/net_service/sorng_tls_registration_policy.h",
  "cef/libcef/browser/request_context_impl.cc",
  "cef/libcef/browser/request_context_impl.h",
  "cef/libcef_dll/sorng_tls_bridge_exports.cc",
  "chrome/browser/accessibility/soda_installer_impl.cc",
  "chrome/browser/net/profile_network_context_service.cc",
  "chrome/browser/net/profile_network_context_service.h",
  "chrome/browser/net/proxy_config_monitor.cc",
  "chrome/browser/net/proxy_config_monitor.h",
  "components/soda/soda_features.cc",
  "components/soda/soda_features.h",
  "components/soda/soda_installer.cc",
  "components/soda/soda_util.cc",
  "net/BUILD.gn",
  "net/cert/cert_verify_proc.h",
  "net/cert/cert_verify_proc_builtin.cc",
  "net/dns/host_resolver_manager.cc",
  "net/dns/host_resolver_manager_unittest.cc",
  "net/proxy_resolution/configured_proxy_resolution_service.cc",
  "net/proxy_resolution/configured_proxy_resolution_service.h",
  "net/socket/sorng_tls_policy.h",
  "net/socket/ssl_client_socket.cc",
  "net/socket/ssl_client_socket.h",
  "net/socket/ssl_client_socket_impl.cc",
  "net/socket/ssl_client_socket_impl.h",
  "net/socket/ssl_client_socket_unittest.cc",
  "net/spdy/spdy_session_pool.cc",
  "services/cert_verifier/cert_verifier_creation.cc",
  "services/cert_verifier/cert_verifier_service.cc",
  "services/cert_verifier/cert_verifier_service_factory.cc",
  "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom",
  "services/network/network_context.cc",
  "services/network/network_context.h",
  "services/network/public/mojom/network_context.mojom",
]);
const linuxImage =
    "sha256:5c3e8c42ac5a58ca0ec31df6dfc45d57af3c663ed53b8e4d7171e18f31480930",
  linuxVolume =
    "sorng-cef-preflight-20261023-6f4466b3-0e90-4275-b19a-57470e8f8af5-work",
  linuxCache = "/work/build/cef-ci-qTkJO9/source/src",
  linuxPatch =
    "09359b5fe26fc71ca90fdf2add850cc2cd9129d34b76da2b1dd1a95e1ab5fc39",
  linuxBefore =
    "0ccac4e8f1f8371e42bec473e2b60016f4f68370c3e072d7e44f42c50da3303a",
  linuxAfter =
    "d624ed223238b3b999e85a994be5a3c1340dd87ce64e3d60094e7c87e4dbd19d",
  linuxInputRaw =
    "3f92807b495eaac55ad415fecbc423fc8763cc0024cb41be89efc5feabcbef23",
  linuxArgs =
    "80533e918b63db1e7696d910c8292d7cfbbd042506f53fed03f2100327061286",
  linuxSourcePath = "cef/libcef/browser/native/window_x11.cc";

export function validateLinuxIncrementalProvenance(p, review) {
  return validateLinuxProvenance(p, review, false);
}
export function validateLinuxIsolatedProvenance(p, review) {
  return validateLinuxProvenance(p, review, true);
}
function validateLinuxProvenance(p, review, isolated) {
  const roles = isolated ? LINUX_ISOLATED_EVIDENCE : LINUX_INCREMENTAL_EVIDENCE;
  shape(p, isolated ? LINUX_ISOLATED_PROVENANCE : LINUX_INCREMENTAL_PROVENANCE);
  const require = (ok) => {
    if (!ok) fail("Portable Linux incremental provenance mismatch");
  };
  require(
    p.origin ===
      (isolated ? LINUX_ISOLATED_ORIGIN : LINUX_INCREMENTAL_ORIGIN) &&
      review.origin === p.origin &&
      review.sourceLockIdentity ===
        (isolated ? LINUX_ISOLATED_IDENTITY : LINUX_INCREMENTAL_IDENTITY) &&
      review.target === "x86_64-unknown-linux-gnu" &&
      p.sourceLockIdentity === review.sourceLockIdentity &&
      p.predecessorSourceLockIdentity === LINUX_PREDECESSOR_IDENTITY &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.operation) &&
      commit.test(p.controllerCommit) &&
      p.engineSha256 === review.engineSha256 &&
      hex.test(p.baselineEngineSha256) &&
      p.engineSha256 !== p.baselineEngineSha256 &&
      p.image === linuxImage &&
      p.originalInputsSourceLockRawSha256 ===
        (isolated ? LINUX_ISOLATED_INPUT_RAW : linuxInputRaw) &&
      p.originalInputsSourceLockRawSha256 ===
        review.originalInputsSourceLockRawSha256 &&
      p.toolchainLockSha256 === LINUX_INCREMENTAL_TOOLCHAIN_SHA &&
      p.actualToolFilesVerified === 8 &&
      p.incrementalBuild === true &&
      p.pristineSourceBuild === false &&
      p.originalBuildReplayed === false,
  );
  shape(p.reviewedEvidenceDigests, roles);
  for (const role of roles)
    require(
      p.reviewedEvidenceDigests[role] ===
        review.reviewBinding.evidencePins[role].sha256,
    );
  shape(p.separatelyObservedTools, [
    "clang",
    "ldLld",
    "gn",
    "siso",
    "autoninja",
    "clangStamp",
    "sisoSpecification",
  ]);
  for (const pin of Object.values(p.separatelyObservedTools)) {
    shape(pin, ["sha256", "size"]);
    require(
      hex.test(pin.sha256) &&
        Number.isSafeInteger(pin.size) &&
        pin.size > 0 &&
        pin.size <= 1024 ** 3,
    );
  }
  const n = p.nestedOriginalRecordDigests;
  shape(n, [
    "predecessorSourceLock",
    "predecessorReview",
    "predecessorHandoff",
    "predecessorManifest",
    "predecessorRecords",
  ]);
  for (const role of [
    "predecessorSourceLock",
    "predecessorReview",
    "predecessorHandoff",
    "predecessorManifest",
  ])
    require(hex.test(n[role]));
  require(p.predecessorHandoffSha256 === n.predecessorHandoff);
  shape(n.predecessorRecords, [
    "prepared",
    "started",
    "container",
    "finished",
    "producer",
    "freshCheck",
  ]);
  for (const sha of Object.values(n.predecessorRecords)) require(hex.test(sha));
  if (isolated) {
    require(
      p.originalCacheReadonly === true &&
        p.workspaceCopied === true &&
        p.isolatedBuild === true &&
        p.workspaceVolume === `sorng-cef-linux-isolated-${p.operation}-work`,
    );
    for (const [key, role] of [
      ["workspaceManifestSha256", "copyManifest"],
      ["generationRecordSha256", "generation"],
      ["gnRecordSha256", "gn"],
    ])
      require(p[key] === p.reviewedEvidenceDigests[role]);
    require(hex.test(p.compiledObjectSha256));
  }
  return p;
}

function verifyLinuxIncrementalEvidence(
  review,
  records,
  inputLock,
  isolated = false,
) {
  const expectedIdentity = isolated
    ? LINUX_ISOLATED_IDENTITY
    : LINUX_INCREMENTAL_IDENTITY;
  const require = (ok) => {
      if (!ok) fail("Original Linux incremental evidence mismatch");
    },
    same = (a, b) => identitySha256(a) === identitySha256(b),
    positive = (x) => Number.isSafeInteger(x) && x > 0,
    digest = (x) => typeof x === "string" && hex.test(x),
    uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
    facts = {};
  let operation, controllerCommit;
  for (const role of (isolated
    ? LINUX_ISOLATED_EVIDENCE
    : LINUX_INCREMENTAL_EVIDENCE
  ).filter((x) => x !== "compileOutput" && x !== "gnOutput")) {
    const row = records[role];
    shape(row, [
      "schemaVersion",
      "kind",
      "operation",
      "controllerCommit",
      "sourceLockIdentity",
      "target",
      "facts",
    ]);
    require(
      row.schemaVersion === 1 &&
        row.kind ===
          `sorng-owned-linux-${isolated ? "isolated" : "incremental"}-${role}` &&
        uuid.test(row.operation) &&
        commit.test(row.controllerCommit) &&
        row.sourceLockIdentity === expectedIdentity &&
        row.target === review.target,
    );
    operation ??= row.operation;
    controllerCommit ??= row.controllerCommit;
    require(
      row.operation === operation && row.controllerCommit === controllerCommit,
    );
    shape(
      row.facts,
      (isolated ? LINUX_ISOLATED_FACT_KEYS : LINUX_INCREMENTAL_FACT_KEYS)[role],
    );
    facts[role] = row.facts;
  }
  const raw = (row) => {
    shape(row, ["rawUtf8", "sha256", "size"]);
    const b = Buffer.from(row.rawUtf8 ?? "", "utf8");
    require(
      typeof row.rawUtf8 === "string" &&
        positive(row.size) &&
        row.size <= 1024 ** 2 &&
        b.length === row.size &&
        b.toString("utf8") === row.rawUtf8 &&
        hash(b) === row.sha256,
    );
    try {
      return JSON.parse(row.rawUtf8);
    } catch {
      fail("Original Linux incremental JSON invalid");
    }
  };
  const previous = facts.predecessor,
    oldLock = validateSourceLock(raw(previous.sourceLock)),
    oldReview = raw(previous.review),
    oldHandoff = raw(previous.handoff),
    oldManifest = raw(previous.manifest),
    oldRecords = {};
  const oldNames = [
    "prepared",
    "started",
    "container",
    "finished",
    "producer",
    "freshCheck",
  ];
  shape(previous.records, oldNames);
  for (const name of oldNames) {
    oldRecords[name] = raw(previous.records[name]);
    const pin = oldReview.evidence?.[name];
    require(
      pin?.sha256 === previous.records[name].sha256 &&
        pin.size === previous.records[name].size,
    );
  }
  require(
    oldReview.origin === "owned-linux-engine" &&
      oldReview.target === review.target &&
      oldReview.sourceLockIdentity === LINUX_PREDECESSOR_IDENTITY &&
      identitySha256(oldLock) === LINUX_PREDECESSOR_IDENTITY &&
      oldHandoff.origin === undefined &&
      oldHandoff.kind === "sorng-cef-owned-sdk-handoff" &&
      oldHandoff.sourceLockIdentity === LINUX_PREDECESSOR_IDENTITY &&
      oldHandoff.hostedBuild === false &&
      oldHandoff.nativeAcceptance === "not-tested" &&
      oldHandoff.productionReady === false &&
      oldHandoff.publicationAllowed === false &&
      oldHandoff.uploadAllowed === false &&
      oldHandoff.descriptorSha256 === oldReview.descriptorSha256 &&
      digest(oldHandoff.engineSha256) &&
      same(oldHandoff.reviewBinding, ownedHandoffReviewBinding(oldReview)) &&
      oldRecords.freshCheck.result.plan.sourceLockSha256 ===
        previous.sourceLock.sha256 &&
      operation !== oldRecords.started.operation,
  );
  require(
    oldHandoff.schemaVersion === 1 &&
      oldHandoff.target === review.target &&
      oldHandoff.originalInputsSourceLockRawSha256 ===
        previous.sourceLock.sha256 &&
      Array.isArray(oldHandoff.assets) &&
      oldHandoff.assets.length === 5 &&
      new Set(oldHandoff.assets.map((x) => x.name)).size === 5,
  );
  for (const asset of oldHandoff.assets) {
    shape(asset, ["name", "size", "sha256"]);
    require(positive(asset.size) && digest(asset.sha256));
    releaseRelativePath(asset.name);
  }
  require(
    oldHandoff.assets.some(
      (x) =>
        x.name === "runtime.json" && x.sha256 === oldReview.descriptorSha256,
    ) &&
      oldHandoff.assets.some(
        (x) =>
          x.name === "manifest.json" &&
          x.sha256 === previous.manifest.sha256 &&
          x.size === previous.manifest.size,
      ) &&
      oldManifest.kind === "sorng-cef-custom-runtime" &&
      oldManifest.schemaVersion === 1 &&
      oldManifest.sourceLockSha256 === LINUX_PREDECESSOR_IDENTITY &&
      oldManifest.artifacts?.length === 1 &&
      oldManifest.artifacts[0].target === review.target &&
      Array.isArray(oldManifest.artifacts[0].sdkFiles) &&
      oldManifest.artifacts[0].sdkFiles.length === oldHandoff.filesVerified &&
      oldHandoff.filesVerified <= RELEASE_LIMITS.members,
  );
  verifyOwnedHandoffEvidence(oldReview, oldRecords, oldLock);
  const lock = validateSourceLock(inputLock),
    build = lock.builds.find((x) => x.target === review.target),
    oldBuild = oldLock.builds.find((x) => x.target === review.target);
  require(
    identitySha256(lock) === expectedIdentity &&
      build &&
      oldBuild &&
      lock.patches.length === oldLock.patches.length + (isolated ? 11 : 1) &&
      lock.patches.at(-1).sha256 === linuxPatch,
  );
  const projected = structuredClone(lock);
  if (isolated) {
    projected.patches = projected.patches.slice(0, 12);
    projected.bridge = structuredClone(oldLock.bridge);
    require(
      lock.bridge.patchId === HTTP3_BRIDGE_PATCH_ID &&
        lock.bridge.capabilities.length === 9 &&
        lock.bridge.header.sha256 ===
          "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
    );
  } else projected.patches.pop();
  require(same(projected, oldLock));
  const r = facts.readiness,
    a = facts.apply,
    start = facts.started,
    c = facts.container,
    compiled = facts.compile,
    end = facts.finished,
    post = facts.postchecks,
    pack = facts.package;
  const file = (row) => {
    shape(row, ["path", "sha256", "size"]);
    pin(row, 1024 ** 3);
    return row;
  };
  const files = (rows, max = 512) => {
    require(
      Array.isArray(rows) &&
        rows.length > 0 &&
        rows.length <= max &&
        new Set(rows.map((x) => x.path)).size === rows.length,
    );
    rows.forEach(file);
  };
  shape(r.cacheOutputs, ["engine", "sandbox"]);
  for (const [role, name] of [
    ["engine", "libcef.so"],
    ["sandbox", "chrome-sandbox"],
  ]) {
    const old = oldManifest.artifacts[0].sdkFiles.filter(
      (x) => x.path === name,
    );
    require(
      old.length === 1 &&
        old[0].type === "file" &&
        old[0].sha256 === r.cacheOutputs[role].sha256 &&
        old[0].size === r.cacheOutputs[role].size &&
        r.cacheOutputs[role].path === name,
    );
    file(r.cacheOutputs[role]);
  }
  require(r.cacheOutputs.engine.sha256 === oldHandoff.engineSha256);
  files(r.sourceBefore);
  require(
    same(
      r.sourceBefore.map((x) => x.path),
      isolated
        ? LINUX_ISOLATED_TRANSITION.before
            .filter((x) => x.kind === "file")
            .map((x) => x.path)
        : LINUX_INCREMENTAL_SOURCE_PATHS,
    ),
  );
  files(post.sourceAfter);
  files(r.toolFiles, 8);
  require(
    r.toolFiles.length === 8 &&
      same(r.toolFiles, LINUX_INCREMENTAL_TOOL_PINS) &&
      same(r.toolFiles, post.toolFiles),
  );
  shape(r.extraTools, [
    "clang",
    "ldLld",
    "gn",
    "siso",
    "autoninja",
    "clangStamp",
    "sisoSpecification",
  ]);
  Object.values(r.extraTools).forEach(file);
  require(same(r.extraTools, post.extraTools));
  file(r.args);
  file(r.graph);
  require(
    r.args.path === "out/Release_GN_x64/args.gn" &&
      r.graph.path === "out/Release_GN_x64/build.ninja",
  );
  require(r.args.sha256 === linuxArgs && same(r.args, post.args));
  const macros = (rows) => {
    require(
      Array.isArray(rows) &&
        rows.length > 0 &&
        rows.length <= 512 &&
        new Set(rows.map((x) => x.name)).size === rows.length,
    );
    for (const row of rows) {
      shape(row, ["name", "value"]);
      require(
        /^[A-Z][A-Z0-9_]{0,127}$/.test(row.name) && [0, 1].includes(row.value),
      );
    }
    require(
      rows.some(
        (x) =>
          x.name === "ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER" && x.value === 0,
      ),
    );
  };
  macros(r.securityMacros);
  file(r.securityHeader);
  require(
    same(r.securityHeader, post.securityHeader) &&
      same(r.securityMacros, post.securityMacros),
  );
  require(same(r.upstream, lock.upstream) && same(r.upstream, post.upstream));
  shape(r.reconstruction, ["method", "oldPatchPins", "verifiedSourcePins"]);
  require(
    r.reconstruction.method === "git-pristine-plus-reviewed-old12" &&
      same(r.reconstruction.oldPatchPins, oldLock.patches) &&
      same(r.reconstruction.verifiedSourcePins, r.sourceBefore),
  );
  require(
    r.sourceBefore.some(
      (x) => x.path === linuxSourcePath && x.sha256 === linuxBefore,
    ),
  );
  if (isolated) {
    require(
      same(a.patches, lock.patches.slice(12)) &&
        same(a.before, LINUX_ISOLATED_TRANSITION.before) &&
        same(a.after, LINUX_ISOLATED_TRANSITION.after) &&
        a.onlyReviewedPatchesApplied === true,
    );
    const present = (rows) =>
      rows.filter((x) => x.kind === "file").map(({ kind, ...row }) => row);
    require(
      same(r.sourceBefore, present(a.before)) &&
        same(post.sourceAfter, present(a.after)),
    );
  } else {
    const expectedAfter = r.sourceBefore.map((row) =>
      row.path === linuxSourcePath ? { ...row, ...a.after } : row,
    );
    file(a.patch);
    file(a.before);
    file(a.after);
    require(
      a.patch.sha256 === linuxPatch &&
        a.patch.size === 1073 &&
        a.patch.path === lock.patches.at(-1).path &&
        a.before.path === linuxSourcePath &&
        a.before.sha256 === linuxBefore &&
        a.after.path === linuxSourcePath &&
        a.after.sha256 ===
          (isolated
            ? "b9fd179fcef5c1e5755be9c9956ab7cc792ff07393ae8760e2601a1e5d9d7a82"
            : linuxAfter) &&
        a.onlyReviewedPatchApplied === true &&
        same(
          a.before,
          r.sourceBefore.find((x) => x.path === linuxSourcePath),
        ) &&
        same(expectedAfter, post.sourceAfter),
    );
  }
  const kernel = (k) => {
    shape(k, [
      "uid",
      "gid",
      "readonlyRoot",
      "networkMode",
      "memory",
      "memorySwap",
      "nanoCpus",
      "pids",
      "capDrop",
      "noNewPrivileges",
      "mountsVerified",
      "homeVerified",
      "home",
      "diskFreeBytes",
      "diskMinimumBytes",
    ]);
    require(
      Number.isSafeInteger(k.diskFreeBytes) &&
        k.diskMinimumBytes === 100 * 1024 ** 3 &&
        k.diskFreeBytes >= k.diskMinimumBytes,
    );
    shape(k.home, [
      "uid",
      "gid",
      "mode",
      "mountAndAliasVerified",
      "privateCacheWriteVerified",
    ]);
    require(
      k.home.uid === 10001 &&
        k.home.gid === 10001 &&
        k.home.mode === 0o700 &&
        k.home.mountAndAliasVerified === true &&
        k.home.privateCacheWriteVerified === true,
    );
    require(
      k.uid === 10001 &&
        k.gid === 10001 &&
        k.readonlyRoot === true &&
        k.networkMode === "none" &&
        k.memory === 24 * 1024 ** 3 &&
        k.memorySwap === k.memory &&
        k.nanoCpus === 8e9 &&
        k.pids === 512 &&
        same(k.capDrop, ["ALL"]) &&
        k.noNewPrivileges === true &&
        k.mountsVerified === true &&
        k.homeVerified === true,
    );
  };
  kernel(r.kernel);
  kernel(c.kernel);
  require(
    r.exclusiveCache === true &&
      r.image === linuxImage &&
      r.volume === linuxVolume &&
      r.cacheRoot === linuxCache &&
      c.image === linuxImage &&
      c.volume === linuxVolume &&
      digest(c.id) &&
      c.name ===
        `/sorng-cef-linux-${isolated ? "isolated" : "incremental"}-${operation}` &&
      same(r.kernel, c.kernel),
  );
  shape(start.controllerPins, ["controller", "guest"]);
  Object.values(start.controllerPins).forEach(file);
  require(
    positive(start.startWallMs) &&
      positive(start.startMonotonicMs) &&
      start.replayAllowed === false &&
      start.compileBudgetMs === 3600000 &&
      start.cleanupBudgetMs === 30000 &&
      start.packagingBudgetMs === 900000 &&
      start.compileDeadlineWallMs === start.startWallMs + start.compileBudgetMs,
  );
  const expectedArgv = [
    "/work/tools/usr/bin/python3.12",
    `${linuxCache}/../depot_tools/autoninja.py`,
    "-j",
    "8",
    "-C",
    "out/Release_GN_x64",
    "cef",
    "chrome_sandbox",
  ];
  // Fixed normalized depot path; caller cannot select an arbitrary script.
  expectedArgv[1] = "/work/build/cef-ci-qTkJO9/source/depot_tools/autoninja.py";
  require(
    same(compiled.argv, expectedArgv) &&
      compiled.cwd === linuxCache &&
      positive(compiled.beginWallMs) &&
      positive(compiled.endWallMs) &&
      compiled.beginWallMs >= start.startWallMs &&
      compiled.endWallMs <= start.compileDeadlineWallMs &&
      compiled.endWallMs >= compiled.beginWallMs &&
      positive(compiled.beginMonotonicMs) &&
      positive(compiled.endMonotonicMs) &&
      compiled.beginMonotonicMs >= start.startMonotonicMs &&
      compiled.endMonotonicMs - start.startMonotonicMs <=
        start.compileBudgetMs &&
      compiled.endMonotonicMs - compiled.beginMonotonicMs ===
        compiled.elapsedMs &&
      positive(compiled.elapsedMs) &&
      compiled.elapsedMs <= start.compileBudgetMs &&
      compiled.exit === 0 &&
      compiled.finished === true &&
      positive(compiled.localSteps),
  );
  const local = /^noexec:0 local:(\d+) remote:0 cache:0 skip:\d+\r?$/m.exec(
    records.compileOutput,
  );
  require(
    /^build finished\r?$/m.test(records.compileOutput) &&
      local &&
      Number(local[1]) === compiled.localSteps,
  );
  require(
    typeof records.compileOutput === "string" &&
      Buffer.byteLength(records.compileOutput) === compiled.outputBytes &&
      compiled.outputBytes === review.evidence.compileOutput.size &&
      hash(Buffer.from(records.compileOutput)) === compiled.outputSha256 &&
      compiled.outputSha256 === review.evidence.compileOutput.sha256 &&
      !/^(?:FAILED:|ninja: build stopped|FATAL)/m.test(records.compileOutput),
  );
  require(
    end.containerId === c.id &&
      end.reason === "completed" &&
      end.exit === 0 &&
      end.quiescent === true &&
      end.processesLeft === 0 &&
      end.readersStopped === true &&
      end.logFailure === false &&
      Number.isSafeInteger(end.cleanupElapsedMs) &&
      end.cleanupElapsedMs >= 0 &&
      end.cleanupElapsedMs <= start.cleanupBudgetMs &&
      post.compileSha256 === review.evidence.compile.sha256,
  );
  file(post.engine);
  file(post.sandbox);
  file(pack.engine);
  file(pack.sandbox);
  require(
    post.engine.path === "libcef.so" &&
      post.sandbox.path === "chrome-sandbox" &&
      same(pack.engine, post.engine) &&
      same(pack.sandbox, post.sandbox) &&
      post.engine.sha256 !== oldHandoff.engineSha256,
  );
  require(
    pack.descriptorSha256 === review.descriptorSha256 &&
      pack.originalInputsSourceLockRawSha256 ===
        (isolated ? LINUX_ISOLATED_INPUT_RAW : linuxInputRaw) &&
      pack.sourceLockIdentity === expectedIdentity &&
      positive(pack.beginWallMs) &&
      positive(pack.endWallMs) &&
      pack.beginWallMs >= compiled.endWallMs &&
      pack.endWallMs - compiled.endWallMs <= start.packagingBudgetMs &&
      pack.endWallMs - pack.beginWallMs === pack.elapsedMs &&
      positive(pack.elapsedMs) &&
      positive(pack.sdkFiles) &&
      pack.sdkFiles <= RELEASE_LIMITS.members,
  );
  require(
    Array.isArray(pack.assets) &&
      pack.assets.length === 5 &&
      new Set(pack.assets.map((x) => x.name)).size === 5,
  );
  const assetNames = [
    "runtime.json",
    "source-lock.json",
    "manifest.json",
    "receipt.json",
    `sorng-cef-custom-${expectedIdentity}-${review.target}.tar.bz2`,
  ];
  for (const row of pack.assets) {
    shape(row, ["name", "size", "sha256"]);
    require(
      assetNames.includes(row.name) &&
        positive(row.size) &&
        row.size <= RELEASE_LIMITS.archive &&
        digest(row.sha256),
    );
  }
  require(
    pack.assets.find((x) => x.name === "runtime.json").sha256 ===
      review.descriptorSha256,
  );
  for (const role of ["distribution", "preparation"]) {
    const row = facts[role];
    require(
      row.exit === 0 &&
        positive(row.elapsedMs) &&
        digest(row.inventorySha256) &&
        row.filesVerified === pack.sdkFiles &&
        row.quiescent === true &&
        row.outputsFresh === true,
    );
  }
  require(
    facts.distribution.elapsedMs + facts.preparation.elapsedMs <=
      pack.elapsedMs,
  );
  const dist = facts.distribution;
  require(
    dist.cwd === `${linuxCache}/cef` &&
      Array.isArray(dist.argv) &&
      dist.argv.length === 10 &&
      same(dist.argv.slice(0, 3), [
        "/work/tools/usr/bin/python3.12",
        "tools/make_distrib.py",
        "--output-dir",
      ]) &&
      dist.argv[3] === `/work/linux-incremental-${operation}/distribution` &&
      same(dist.argv.slice(4), [
        "--ninja-build",
        "--x64-build",
        "--minimal",
        "--allow-partial",
        "--no-archive",
        "--no-docs",
      ]),
  );
  const prep = facts.preparation;
  require(
    prep.method === "prepareCustomRuntime+verifyPreparedCustomRuntime" &&
      prep.archiveRoundtrip === true &&
      prep.elfMachine === "ELF64-x86-64" &&
      prep.bridgeExports === (isolated ? 5 : 4) &&
      prep.inventorySha256 ===
        pack.assets.find((x) => x.name === "manifest.json").sha256,
  );
  const isolatedFacts = isolated
    ? verifyLinuxIsolatedFacts({
        review,
        records,
        facts,
        operation,
        controllerCommit,
        oldHandoff,
      })
    : {};
  return {
    origin: review.origin,
    operation,
    controllerCommit,
    sourceLockIdentity: expectedIdentity,
    predecessorSourceLockIdentity: LINUX_PREDECESSOR_IDENTITY,
    predecessorHandoffSha256: previous.handoff.sha256,
    baselineEngineSha256: oldHandoff.engineSha256,
    engineSha256: post.engine.sha256,
    image: linuxImage,
    originalInputsSourceLockRawSha256: isolated
      ? LINUX_ISOLATED_INPUT_RAW
      : linuxInputRaw,
    toolchainLockSha256: build.toolchainLock.sha256,
    actualToolFilesVerified: 8,
    separatelyObservedTools: Object.fromEntries(
      Object.entries(r.extraTools).map(([key, p]) => [
        key,
        { sha256: p.sha256, size: p.size },
      ]),
    ),
    incrementalBuild: true,
    pristineSourceBuild: false,
    originalBuildReplayed: false,
    reviewedEvidenceDigests: Object.fromEntries(
      Object.entries(review.evidence).map(([key, p]) => [key, p.sha256]),
    ),
    nestedOriginalRecordDigests: {
      predecessorSourceLock: previous.sourceLock.sha256,
      predecessorReview: previous.review.sha256,
      predecessorHandoff: previous.handoff.sha256,
      predecessorManifest: previous.manifest.sha256,
      predecessorRecords: Object.fromEntries(
        oldNames.map((key) => [key, previous.records[key].sha256]),
      ),
    },
    ...isolatedFacts,
  };
}

export function linuxIsolatedInitCode(operation) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operation))
    fail("Closed isolated operation required");
  const volume = `sorng-cef-linux-isolated-${operation}-work`;
  return `import os,json,stat\noperation=${JSON.stringify(operation)}\nvolume=${JSON.stringify(volume)}\nassert os.getuid()==0 and os.path.realpath('/owned')=='/owned'\nfd=os.open('/owned',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\ntry:\n assert os.listdir(fd)==[]\n rows=[]\n for name in ('base','net','network','cef','out','operation'):\n  os.mkdir(name,0o700,dir_fd=fd)\n  os.chown(name,10001,10001,dir_fd=fd,follow_symlinks=False)\n  info=os.stat(name,dir_fd=fd,follow_symlinks=False)\n  assert stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==10001 and stat.S_IMODE(info.st_mode)==448\n  rows.append(dict(name=name,dev=str(info.st_dev),ino=str(info.st_ino),uid=info.st_uid,gid=info.st_gid,mode=stat.S_IMODE(info.st_mode)))\n print(json.dumps(dict(operation=operation,volume=volume,directories=rows),sort_keys=True))\nfinally:os.close(fd)\n`;
}

function verifyIsolatedGenerationPayload(packet, metadata, raw, readiness) {
  const require = (x) => {
      if (!x) fail("Isolated generation raw comparison mismatch");
    },
    same = (a, b) => identitySha256(a) === identitySha256(b),
    values = {};
  for (const [name, envelope] of Object.entries(metadata))
    values[name] = raw(envelope, 512 * 1024);
  const projection = values["projection.json"],
    cached = values["cached-generated.json"],
    member = (x) => {
      releaseRelativePath(x);
      require(!x.split("/").includes(".git"));
    };
  const rows = (list, max) => {
    require(
      Array.isArray(list) &&
        list.length > 0 &&
        list.length <= max &&
        new Set(list.map((x) => x.path)).size === list.length,
    );
    for (const r of list) {
      member(r.path);
      require(
        Number.isSafeInteger(r.size) &&
          r.size >= 0 &&
          r.size <= 32 * 1024 ** 2 &&
          hex.test(r.sha256) &&
          Number.isSafeInteger(r.mode) &&
          r.mode >= 0 &&
          r.mode <= 511 &&
          (r.mode & 0o22) === 0,
      );
    }
  };
  rows(projection, 4096);
  rows(cached, 4096);
  require(
    projection.length === 1897 &&
      cached.length === 990 &&
      packet.projection?.files === 1897 &&
      packet.projection.inventorySha256 === identitySha256(projection) &&
      packet.projection.bytes === projection.reduce((n, r) => n + r.size, 0),
  );
  require(
    packet.admission?.canonicalCef?.files === 1897 &&
      packet.admission.canonicalCef.inventorySha256 ===
        "57a70a22d2953d44c57ca84eb8e17fdf8d9a1f2ba57a31a004686eb4d710947f" &&
      packet.admission.canonicalCef.allCanonicalBytesMatched === true,
  );
  for (const source of readiness.sourceBefore.filter((x) =>
    x.path.startsWith("cef/"),
  )) {
    const row = projection.find((x) => x.path === source.path.slice(4));
    require(row && row.size === source.size && row.sha256 === source.sha256);
  }
  const windowPath = "libcef/browser/native/window_x11.cc",
    windowBefore = projection.find((x) => x.path === windowPath);
  require(windowBefore?.sha256 === linuxBefore && windowBefore.size === 18399);
  const base = new Map(
    projection.map((r) => [
      r.path,
      { path: r.path, size: r.size, sha256: r.sha256, mode: r.mode },
    ]),
  );
  for (const r of cached)
    if (r.path.startsWith("cef/")) {
      const path = r.path.slice(4),
        value = { path, size: r.size, sha256: r.sha256, mode: r.mode };
      if (base.has(path)) require(same(base.get(path), value));
      base.set(path, value);
    } else
      require(
        [
          "out/gen/cef/include/cef_version.h",
          "out/gen/cef/include/cef_api_versions.h",
          "out/gen/cef/libcef_dll/cef_api_versions.inc",
        ].includes(r.path),
      );
  require(base.size === 2853);
  const decode = (p, max) => {
    shape(p, ["base64", "size", "sha256"]);
    require(
      typeof p.base64 === "string" &&
        p.base64.length <= 4 * Math.ceil(max / 3) &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          p.base64,
        ),
    );
    const b = Buffer.from(p.base64, "base64");
    require(
      b.length === p.size &&
        b.length > 0 &&
        b.length <= max &&
        hash(b) === p.sha256 &&
        b.toString("base64") === p.base64,
    );
    return b;
  };
  const local = (text) => {
    require(
      typeof text === "string" &&
        /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$/.test(
          text,
        ),
    );
    const d = new Date(text.slice(0, -3) + "Z");
    require(
      Number.isFinite(d.getTime()) &&
        d.toISOString().slice(0, -1) === text.slice(0, -3),
    );
    return d.getTime() + Number(text.slice(-3)) / 1000;
  };
  const replaceOnce = (buffer, before, after) => {
    const at = buffer.indexOf(before);
    require(at >= 0 && buffer.indexOf(before, at + 1) < 0);
    return Buffer.concat([
      buffer.subarray(0, at),
      after,
      buffer.subarray(at + before.length),
    ]);
  };
  let newProof;
  for (const [index, name] of [
    "old12-output.json",
    "new23-output.json",
  ].entries()) {
    const value = values[name],
      result = index ? packet.newGenerated : packet.oldGenerated;
    shape(value, ["files", "apiUntrackedBodies", "hookLocalWindow"]);
    rows(value.files, 4096);
    require(
      value.files.length === base.size &&
        result?.files === base.size &&
        result.comparisonPassed === true &&
        typeof result.rawByteEqual === "boolean" &&
        result.inventorySha256 === identitySha256(value.files) &&
        result.bytes === value.files.reduce((n, r) => n + r.size, 0),
    );
    shape(value.apiUntrackedBodies, ["cached", "private"]);
    const a = decode(value.apiUntrackedBodies.cached, 1024),
      b = decode(value.apiUntrackedBodies.private, 1024);
    require(
      a.length === 642 &&
        hash(a) ===
          "7ae7df88408c1920de87cb076a5abb9d6abaca311b06ecdf49c55c7262b86897",
    );
    const aj = JSON.parse(a),
      bj = JSON.parse(b);
    const proof = result.dateCommentEquivalence;
    shape(proof, [
      "policy",
      "literalSubstitutionExact",
      "otherJsonFieldsEqual",
      "cached",
      "private",
      "hookLocalWindow",
      "comments",
    ]);
    require(
      proof.policy === "cef-untracked-api-comment-dates-v1" &&
        proof.literalSubstitutionExact === true &&
        proof.otherJsonFieldsEqual === true &&
        same(proof.cached, { size: a.length, sha256: hash(a) }) &&
        same(proof.private, { size: b.length, sha256: hash(b) }) &&
        same(proof.hookLocalWindow, value.hookLocalWindow),
    );
    shape(proof.hookLocalWindow, ["beginLocal", "endLocal"]);
    const begin = local(proof.hookLocalWindow.beginLocal),
      end = local(proof.hookLocalWindow.endLocal);
    require(end >= begin && end - begin <= 300000);
    const dates = new Set([
      proof.hookLocalWindow.beginLocal.slice(0, 10),
      proof.hookLocalWindow.endLocal.slice(0, 10),
    ]);
    require(Array.isArray(proof.comments) && proof.comments.length === 2);
    let changed = Buffer.from(a);
    for (const [i, version] of ["999998", "999999"].entries()) {
      const c = proof.comments[i],
        label = ["Next version", "Experimental version"][i];
      shape(c, ["pointer", "cached", "private"]);
      require(
        c.pointer === `/hashes/${version}/comment` &&
          c.cached === `${label} last updated October 24, 2026.` &&
          aj.hashes[version].comment === c.cached &&
          bj.hashes[version].comment === c.private,
      );
      const match = new RegExp(
        "^" + label + " last updated ([A-Z][a-z]+) ([0-9]{2}), ([0-9]{4})\\.$",
      ).exec(c.private);
      require(match);
      const month = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ].indexOf(match[1]);
      require(month >= 0);
      const iso = `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]}`;
      local(iso + "T00:00:00.000000");
      require(dates.has(iso));
      changed = replaceOnce(
        changed,
        Buffer.from(JSON.stringify(c.cached)),
        Buffer.from(JSON.stringify(c.private)),
      );
      bj.hashes[version].comment = c.cached;
    }
    require(
      changed.equals(b) && same(aj, bj) && result.rawByteEqual === a.equals(b),
    );
    const expected = new Map(base);
    if (index)
      for (const row of LINUX_ISOLATED_TRANSITION.after.filter((x) =>
        x.path.startsWith("cef/"),
      )) {
        const memberPath = row.path.slice(4),
          oldRow = expected.get(memberPath);
        require(row.kind === "file" && oldRow);
        expected.set(memberPath, {
          path: memberPath,
          size: row.size,
          sha256: row.sha256,
          mode: oldRow.mode,
        });
      }
    for (const r of value.files) {
      const e = expected.get(r.path);
      require(e);
      if (r.path === "cef_api_untracked.json")
        require(
          r.size === b.length && r.sha256 === hash(b) && r.mode === e.mode,
        );
      else require(same(r, e));
    }
    newProof = proof;
  }
  const action = values["actions.json"];
  shape(action, ["files", "apiVersionHeaderBodies"]);
  require(action.files?.length === 3 && packet.actions?.length === 3);
  shape(action.apiVersionHeaderBodies, ["cached", "private"]);
  const before = decode(action.apiVersionHeaderBodies.cached, 32768),
    after = decode(action.apiVersionHeaderBodies.private, 32768);
  require(
    before.length === 12676 &&
      hash(before) ===
        "eff5e6316c47038e5fbe0ae85a5aab5acb3e574ab92be4f35b76b83a981fae93",
  );
  let converted = Buffer.from(before);
  for (const [i, version] of ["999998", "999999"].entries()) {
    const c = newProof.comments[i],
      tail = `\n#define CEF_API_VERSION_${version} ${version}`;
    converted = replaceOnce(
      converted,
      Buffer.from("// " + c.cached + tail),
      Buffer.from("// " + c.private + tail),
    );
  }
  require(converted.equals(after));
  for (const [i, name] of [
    "cef_version.h",
    "cef_api_versions.h",
    "cef_api_versions.inc",
  ].entries()) {
    const row = action.files[i],
      record = packet.actions[i];
    require(
      row.path === name &&
        record.path === name &&
        row.size === record.size &&
        row.sha256 === record.sha256 &&
        row.mode === record.mode &&
        record.mode === 420 &&
        record.equal === row.equal,
    );
    const old = cached.find(
      (x) =>
        x.path ===
        (i === 2 ? "out/gen/cef/libcef_dll/" : "out/gen/cef/include/") + name,
    );
    require(old);
    if (i === 1)
      require(
        record.comparisonPassed === true &&
          record.rawByteEqual === before.equals(after) &&
          record.equal === before.equals(after) &&
          record.sha256 === hash(after) &&
          record.size === after.length &&
          record.dateCommentEquivalence?.literalSubstitutionExact === true &&
          record.dateCommentEquivalence.jsonDateProofSha256 ===
            identitySha256(newProof) &&
          record.dateCommentEquivalence.new23ApiBodySha256 ===
            newProof.private.sha256,
      );
    else
      require(
        record.equal === true &&
          record.sha256 === old.sha256 &&
          record.size === old.size &&
          record.mode === old.mode,
      );
  }
  require(
    packet.postInputDigest === identitySha256(values["post-inputs.json"]),
  );
  require(
    same(values["post-inputs.json"].toolFiles, readiness.toolFiles) &&
      same(values["post-inputs.json"].runtimeFiles, packet.runtimeFiles) &&
      same(values["post-inputs.json"].admission, packet.admission),
  );
}

function verifyLinuxIsolatedFacts({
  review,
  records,
  facts,
  operation,
  controllerCommit,
  oldHandoff,
}) {
  const require = (ok) => {
      if (!ok) fail("Closed isolated Linux workspace evidence mismatch");
    },
    same = (a, b) => identitySha256(a) === identitySha256(b),
    integer = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
  const raw = (value, max, json = true) => {
    shape(value, ["rawUtf8", "sha256", "size"]);
    const b = Buffer.from(value.rawUtf8 ?? "", "utf8");
    require(
      typeof value.rawUtf8 === "string" &&
        b.length === value.size &&
        b.toString("utf8") === value.rawUtf8 &&
        integer(b.length, max) &&
        hash(b) === value.sha256,
    );
    if (!json) return value.rawUtf8;
    try {
      return JSON.parse(value.rawUtf8);
    } catch {
      fail("Closed isolated Linux raw JSON required");
    }
  };
  const file = (p) => {
    pin(p, 8 * 1024 ** 3);
    return p;
  };
  const w = facts.workspace,
    copy = facts.copyManifest,
    g = facts.generation,
    gn = facts.gn,
    post = facts.postchecks,
    compiled = facts.compile,
    pack = facts.package,
    volume = `sorng-cef-linux-isolated-${operation}-work`;
  require(
    w.originalVolume === linuxVolume &&
      w.workspaceVolume === volume &&
      w.originalReadonly === true &&
      w.independentCopies === true &&
      w.createdFresh === true,
  );
  require(
    facts.apply.before.find((x) => x.path === linuxSourcePath)?.size ===
      18399 &&
      facts.apply.after.find((x) => x.path === linuxSourcePath)?.size ===
        18719 &&
      facts.readiness.args.size === 646,
  );
  require(
    w.copyManifestSha256 === review.evidence.copyManifest.sha256 &&
      same(copy.limits, {
        files: 500000,
        directories: 100000,
        bytes: 256 * 1024 ** 3,
        fileBytes: 8 * 1024 ** 3,
        pathBytes: 1024,
      }) &&
      copy.complete === true &&
      copy.unknownLinks === 0 &&
      copy.independentFiles === true,
  );
  require(
    integer(copy.files, 500000) &&
      copy.files > 0 &&
      integer(copy.directories.length, 100000) &&
      Array.isArray(copy.entries) &&
      copy.entries.length === copy.files &&
      integer(copy.bytes, 256 * 1024 ** 3),
  );
  const paths = new Set(),
    ordered = [...copy.entries].sort((a, b) =>
      Buffer.compare(
        Buffer.from(a.tree + "/" + a.path),
        Buffer.from(b.tree + "/" + b.path),
      ),
    );
  require(same(copy.entries, ordered));
  let bytes = 0;
  const member = (p) => {
    require(
      typeof p === "string" &&
        Buffer.byteLength(p) <= 1024 &&
        !p.startsWith("/") &&
        !p.includes("\\") &&
        !/[\x00-\x1f\x7f]/.test(p) &&
        p.split("/").every((x) => x && x !== "." && x !== ".." && x !== ".git"),
    );
  };
  const id = (x) => typeof x === "string" && /^[0-9]{1,24}$/.test(x);
  const sourceIds = new Set(),
    targetIds = new Set();
  for (const row of copy.entries) {
    shape(row, [
      "tree",
      "path",
      "size",
      "sha256",
      "mode",
      "mtimeNs",
      "sourceDev",
      "sourceIno",
      "targetDev",
      "targetIno",
      "sourceNlink",
      "targetNlink",
    ]);
    member(row.path);
    require(
      LINUX_ISOLATED_COPY_TREES.includes(row.tree) &&
        !paths.has(row.tree + "/" + row.path),
    );
    paths.add(row.tree + "/" + row.path);
    require(
      integer(row.size, 8 * 1024 ** 3) &&
        hex.test(row.sha256) &&
        integer(row.mode, 511) &&
        (row.mode & 0o22) === 0 &&
        /^-?[0-9]{1,24}$/.test(row.mtimeNs) &&
        [row.sourceDev, row.sourceIno, row.targetDev, row.targetIno].every(
          id,
        ) &&
        row.sourceNlink === 1 &&
        row.targetNlink === 1 &&
        (row.sourceDev !== row.targetDev || row.sourceIno !== row.targetIno),
    );
    const sourceId = row.sourceDev + ":" + row.sourceIno,
      targetId = row.targetDev + ":" + row.targetIno;
    require(!sourceIds.has(sourceId) && !targetIds.has(targetId));
    sourceIds.add(sourceId);
    targetIds.add(targetId);
    bytes += row.size;
  }
  require(
    bytes === copy.bytes &&
      w.copyBytes === copy.bytes &&
      w.copyFiles === copy.files &&
      w.copyDirectories === copy.directories.length &&
      copy.inventorySha256 === identitySha256(copy.entries),
  );
  require([...targetIds].every((x) => !sourceIds.has(x)));
  const dirPaths = new Set();
  for (const row of copy.directories) {
    shape(row, ["tree", "path", "mode", "uid", "gid"]);
    member(row.path);
    require(
      LINUX_ISOLATED_COPY_TREES.includes(row.tree) &&
        !paths.has(row.tree + "/" + row.path) &&
        !dirPaths.has(row.tree + "/" + row.path) &&
        row.uid === 10001 &&
        row.gid === 10001 &&
        integer(row.mode, 511) &&
        (row.mode & 0o22) === 0,
    );
    dirPaths.add(row.tree + "/" + row.path);
  }
  for (const path of [...paths, ...dirPaths]) {
    const parts = path.split("/");
    parts.pop();
    while (parts.length) {
      require(
        !paths.has(parts.join("/")) &&
          (parts.length === 1 || dirPaths.has(parts.join("/"))),
      );
      parts.pop();
    }
  }
  for (const [name, role] of [
    ["libcef.so", "engine"],
    ["chrome_sandbox", "sandbox"],
  ]) {
    const row = copy.entries.find((x) => x.tree === "out" && x.path === name);
    require(
      row &&
        row.sha256 === facts.readiness.cacheOutputs[role].sha256 &&
        row.size === facts.readiness.cacheOutputs[role].size,
    );
  }
  require(
    copy.entries.some(
      (x) =>
        x.tree === "out" &&
        x.path === "libcef.so" &&
        x.sha256 === oldHandoff.engineSha256,
    ),
  );
  shape(copy.trees, LINUX_ISOLATED_COPY_TREES);
  const roots = {
    base: "base",
    net: "net",
    network: "services/network",
    out: "out/Release_GN_x64",
  };
  require(
    same(
      copy.directories,
      [...copy.directories].sort((a, b) =>
        Buffer.compare(
          Buffer.from(a.tree + "/" + a.path),
          Buffer.from(b.tree + "/" + b.path),
        ),
      ),
    ),
  );
  for (const tree of LINUX_ISOLATED_COPY_TREES) {
    const summary = copy.trees[tree],
      files = copy.entries.filter((x) => x.tree === tree),
      directories = copy.directories.filter((x) => x.tree === tree);
    shape(summary, [
      "sourceRoot",
      "targetRoot",
      "files",
      "bytes",
      "directories",
      "inventorySha256",
    ]);
    require(
      summary.sourceRoot ===
        linuxCache.replace("/work/", "/opt/original-cache/") +
          "/" +
          roots[tree] &&
        summary.targetRoot === linuxCache + "/" + roots[tree] &&
        files.length > 0 &&
        summary.files === files.length &&
        summary.bytes === files.reduce((n, r) => n + r.size, 0) &&
        summary.directories === directories.length &&
        summary.inventorySha256 === identitySha256({ files, directories }),
    );
  }
  const copiedRoot = (path) =>
    path.startsWith("base/")
      ? ["base", path.slice(5)]
      : path.startsWith("net/")
        ? ["net", path.slice(4)]
        : path.startsWith("services/network/")
          ? ["network", path.slice(17)]
          : null;
  let changed = 0,
    absent = 0;
  for (const [i, before] of LINUX_ISOLATED_TRANSITION.before.entries()) {
    const after = LINUX_ISOLATED_TRANSITION.after[i],
      selected = copiedRoot(before.path);
    if (!same(before, after)) {
      changed++;
      require(selected !== null || before.path.startsWith("cef/"));
    }
    if (selected) {
      const [tree, path] = selected,
        row = copy.entries.find((x) => x.tree === tree && x.path === path);
      if (before.kind === "file")
        require(
          row && row.size === before.size && row.sha256 === before.sha256,
        );
      else {
        absent++;
        require(!row);
        const parent = path.split("/").slice(0, -1).join("/");
        require(
          parent
            ? dirPaths.has(tree + "/" + parent)
            : LINUX_ISOLATED_COPY_TREES.includes(tree),
        );
      }
    }
  }
  require(changed === 32 && absent === 9);
  require(
    w.workBudgetMs === 7800000 &&
      w.cleanupBudgetMs === 30000 &&
      w.copyBudgetMs === 1800000 &&
      w.generationBudgetMs === 600000 &&
      w.gnBudgetMs === 900000 &&
      w.workDeadlineWallMs === w.startWallMs + 7800000 &&
      Number.isSafeInteger(w.startMonotonicMs) &&
      w.startMonotonicMs > 0 &&
      w.beginWallMs >= w.startWallMs &&
      w.endWallMs >= w.beginWallMs &&
      w.endWallMs - w.beginWallMs === w.elapsedMs &&
      w.endWallMs <= w.startWallMs + 1800000,
  );
  require(
    w.diskMinimumBytes === 100 * 1024 ** 3 &&
      Number.isSafeInteger(w.capacityBeforeBytes) &&
      w.capacityBeforeBytes >= copy.bytes + 108 * 1024 ** 3 &&
      Number.isSafeInteger(w.capacityAfterBytes) &&
      w.capacityAfterBytes >= 100 * 1024 ** 3,
  );
  const expectedMounts = [
    {
      type: "volume",
      source: linuxVolume,
      target: "/work",
      readonly: true,
      subpath: "",
    },
    {
      type: "volume",
      source: linuxVolume,
      target: "/opt/original-cache",
      readonly: true,
      subpath: "",
    },
    ...[
      ["base", `${linuxCache}/base`],
      ["net", `${linuxCache}/net`],
      ["network", `${linuxCache}/services/network`],
      ["cef", `${linuxCache}/cef`],
      ["out", `${linuxCache}/out/Release_GN_x64`],
      ["operation", `/work/linux-incremental-${operation}`],
    ].map(([subpath, target]) => ({
      type: "volume",
      source: volume,
      target,
      readonly: false,
      subpath,
    })),
  ];
  require(same(w.mounts, expectedMounts));
  shape(w.init, ["id", "name", "inspect", "result", "exit", "quiescent"]);
  require(
    hex.test(w.init.id) &&
      w.init.name === `/sorng-cef-linux-isolated-init-${operation}` &&
      w.init.exit === 0 &&
      w.init.quiescent === true,
  );
  const init = raw(w.init.inspect, 1024 ** 2),
    inspection = raw(facts.container.inspect, 1024 ** 2);
  const noInitArrayAuthority = (value) =>
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0);
  require(
    init.Id === w.init.id &&
      init.Name === w.init.name &&
      init.Image === linuxImage &&
      init.Config.User === "0:0" &&
      init.Config.Labels["com.sortofremoteng.isolated.operation"] ===
        operation &&
      init.HostConfig.NetworkMode === "none" &&
      init.HostConfig.ReadonlyRootfs === true &&
      same(init.HostConfig.CapDrop, ["ALL"]) &&
      same(init.HostConfig.CapAdd, ["CHOWN"]) &&
      same(init.HostConfig.SecurityOpt, ["no-new-privileges:true"]) &&
      same(init.Config.Entrypoint, ["/usr/bin/python3"]) &&
      same(init.Config.Cmd, [
        "-I",
        "-B",
        "-c",
        linuxIsolatedInitCode(operation),
      ]) &&
      init.State.Running === false &&
      init.State.ExitCode === 0 &&
      init.HostConfig.PidsLimit === 16 &&
      init.HostConfig.NanoCpus === 1e9 &&
      init.HostConfig.Memory === 64 * 1024 ** 2 &&
      init.HostConfig.MemorySwap === 64 * 1024 ** 2 &&
      [
        init.HostConfig.Devices,
        init.HostConfig.DeviceRequests,
        init.HostConfig.VolumesFrom,
        init.HostConfig.Binds,
      ].every(noInitArrayAuthority) &&
      (init.HostConfig.PidMode === undefined ||
        init.HostConfig.PidMode === null ||
        init.HostConfig.PidMode === "") &&
      init.HostConfig.Privileged === false &&
      !init.HostConfig.Tmpfs &&
      init.Mounts.length === 1 &&
      init.Mounts[0].Type === "volume" &&
      init.Mounts[0].Name === volume &&
      init.Mounts[0].Destination === "/owned" &&
      init.Mounts[0].RW === true,
  );
  shape(w.init.result, ["operation", "volume", "directories"]);
  require(
    w.init.result.operation === operation &&
      w.init.result.volume === volume &&
      same(
        w.init.result.directories.map((x) => x.name),
        LINUX_ISOLATED_INIT_ROOTS,
      ),
  );
  for (const d of w.init.result.directories) {
    shape(d, ["name", "dev", "ino", "uid", "gid", "mode"]);
    require(
      id(d.dev) &&
        id(d.ino) &&
        d.uid === 10001 &&
        d.gid === 10001 &&
        d.mode === 448,
    );
  }
  for (const row of copy.entries)
    require(
      row.targetDev ===
        w.init.result.directories.find((x) => x.name === row.tree).dev,
    );
  require(
    inspection.Id === facts.container.id &&
      inspection.Name === facts.container.name &&
      inspection.Image === linuxImage &&
      inspection.Config.User === "10001:10001" &&
      inspection.Config.Labels["com.sortofremoteng.isolated.operation"] ===
        operation &&
      inspection.HostConfig.NetworkMode === "none" &&
      inspection.HostConfig.ReadonlyRootfs === true &&
      inspection.HostConfig.Memory === 24 * 1024 ** 3 &&
      inspection.HostConfig.MemorySwap === 24 * 1024 ** 3 &&
      inspection.HostConfig.NanoCpus === 8e9 &&
      inspection.HostConfig.PidsLimit === 512 &&
      same(inspection.HostConfig.CapDrop, ["ALL"]) &&
      (!inspection.HostConfig.CapAdd ||
        inspection.HostConfig.CapAdd.length === 0) &&
      same(inspection.HostConfig.SecurityOpt, ["no-new-privileges:true"]) &&
      same(inspection.Config.Entrypoint, ["/usr/bin/python3"]) &&
      same(inspection.Config.Cmd, [
        "-I",
        "-B",
        "/opt/incremental/guest.py",
        "--execute-isolated-incremental",
      ]) &&
      inspection.HostConfig.Privileged === false &&
      !inspection.HostConfig.Tmpfs &&
      !inspection.HostConfig.Binds?.length &&
      !inspection.HostConfig.Devices?.length &&
      !inspection.HostConfig.DeviceRequests?.length &&
      !inspection.HostConfig.VolumesFrom?.length &&
      !inspection.HostConfig.PidMode &&
      inspection.Mounts.length === 11 &&
      inspection.HostConfig.Mounts.length === 11,
  );
  for (const m of expectedMounts) {
    const live = inspection.Mounts.filter((x) => x.Destination === m.target),
      declared = inspection.HostConfig.Mounts.filter(
        (x) => x.Target === m.target,
      );
    require(
      live.length === 1 &&
        declared.length === 1 &&
        live[0].Type === "volume" &&
        live[0].Name === m.source &&
        live[0].RW === !m.readonly &&
        declared[0].VolumeOptions?.NoCopy === true &&
        (declared[0].VolumeOptions?.Subpath ?? "") === m.subpath,
    );
  }
  require(
    same(
      inspection.Mounts.filter((x) => x.Type === "bind")
        .map((x) => x.Destination)
        .sort(),
      ["/opt/context", "/opt/incremental", "/opt/producer/checkout"],
    ) &&
      inspection.Mounts.filter((x) => x.Type === "bind").every(
        (x) =>
          x.RW === false &&
          inspection.HostConfig.Mounts.filter(
            (d) =>
              d.Type === "bind" &&
              d.Target === x.Destination &&
              d.ReadOnly === true,
          ).length === 1,
      ),
  );
  require(integer(g.elapsedMs, 600000) && g.elapsedMs > 0);
  const packet = raw(g.packet, 512 * 1024);
  require(
    packet.kind === "sorng-linux-isolated-generation-reproduction" &&
      packet.operation === operation &&
      packet.controllerCommit === controllerCommit &&
      packet.sourceLockIdentity === LINUX_ISOLATED_IDENTITY &&
      packet.status === "reproduced" &&
      packet.phase === "complete" &&
      packet.failure === null &&
      packet.postchecks === true &&
      packet.cacheReadOnly === true &&
      packet.sourceAccepted === false &&
      packet.readinessPassed === false &&
      packet.buildExecuted === false &&
      packet.privatePatchApplied === true &&
      packet.workspaceVolume === volume,
  );
  require(
    packet.baseline?.expectedFiles === 499 &&
      packet.baseline.expectedContentBytes === 18867290 &&
      packet.baseline.expectedInventorySha256 ===
        "45911abc56f8c7f9680f80be8302d8a864d334a371f818d86e9930214c9d042f" &&
      packet.baseline.patchBaselineVerified === true &&
      packet.baseline.orderEquivalent === true &&
      packet.baseline.comparisons?.length === 7 &&
      packet.baseline.comparisons.every((x) => x.setsEqual === true),
  );
  const stages = [
      "formatter-selection",
      "resource-selection",
      "old12-hook",
      "new23-hook",
      "version-header",
      "api-headers",
    ],
    metadata = [
      "cached-generated.json",
      "projection.json",
      "git-queries.json",
      "old12-output.json",
      "new23-output.json",
      "actions.json",
      "post-inputs.json",
    ];
  shape(g.metadata, metadata);
  shape(
    g.logs,
    stages.map((x) => x + ".log"),
  );
  require(
    packet.stages?.length === 6 &&
      packet.evidence?.length === 7 &&
      packet.retentionFailure === null &&
      packet.unconfirmedLog === null,
  );
  let logBytes = 0;
  for (const [index, name] of stages.entries()) {
    const stage = packet.stages[index];
    require(
      stage.stage === name &&
        stage.exit === 0 &&
        integer(stage.elapsedMs, 600000),
    );
    const log = g.logs[name + ".log"];
    raw(log, 8 * 1024 ** 2, false);
    require(
      log.sha256 === stage.output.sha256 && log.size === stage.output.size,
    );
    logBytes += log.size;
  }
  require(logBytes <= 32 * 1024 ** 2);
  for (const name of metadata) {
    const value = g.metadata[name];
    raw(value, 512 * 1024);
    const p = packet.evidence.find((x) => x.name === name);
    require(p && p.sha256 === value.sha256 && p.size === value.size);
  }
  for (const generated of [packet.oldGenerated, packet.newGenerated])
    require(
      Number.isSafeInteger(generated?.files) &&
        generated.files > 0 &&
        generated.files <= 4096 &&
        generated.comparisonPassed === true &&
        typeof generated.rawByteEqual === "boolean" &&
        generated.dateCommentEquivalence?.literalSubstitutionExact === true &&
        generated.dateCommentEquivalence.otherJsonFieldsEqual === true &&
        generated.dateCommentEquivalence.cached.sha256 ===
          "7ae7df88408c1920de87cb076a5abb9d6abaca311b06ecdf49c55c7262b86897",
    );
  require(
    packet.actions?.length === 3 &&
      packet.actions[0].path === "cef_version.h" &&
      packet.actions[0].equal === true &&
      packet.actions[1].path === "cef_api_versions.h" &&
      packet.actions[1].comparisonPassed === true &&
      packet.actions[1].dateCommentEquivalence?.literalSubstitutionExact ===
        true &&
      packet.actions[1].dateCommentEquivalence.jsonDateProofSha256 ===
        identitySha256(packet.newGenerated.dateCommentEquivalence) &&
      packet.actions[2].path === "cef_api_versions.inc" &&
      packet.actions[2].equal === true,
  );
  verifyIsolatedGenerationPayload(packet, g.metadata, raw, facts.readiness);
  // CEF is reconstructed into its own tree, not mislabeled as a byte copy.
  const cef = w.cefProjection;
  shape(cef, [
    "method",
    "root",
    "sourceVolume",
    "byteIdenticalCopy",
    "old12InventorySha256",
    "new23InventorySha256",
    "files",
    "bytes",
    "directories",
    "gitMetadata",
  ]);
  const oldCef = raw(g.metadata["old12-output.json"], 512 * 1024).files,
    newCef = raw(g.metadata["new23-output.json"], 512 * 1024).files;
  require(
    cef.method === "canonical-inputs-plus-reviewed-old12" &&
      cef.root === linuxCache + "/cef" &&
      cef.sourceVolume === linuxVolume &&
      cef.byteIdenticalCopy === false &&
      cef.old12InventorySha256 === identitySha256(oldCef) &&
      cef.new23InventorySha256 === identitySha256(newCef) &&
      cef.files === Math.max(oldCef.length, newCef.length) &&
      cef.bytes ===
        Math.max(
          ...[oldCef, newCef].map((rows) =>
            rows.reduce((n, r) => n + r.size, 0),
          ),
        ),
  );
  const meta = cef.gitMetadata;
  shape(meta, [
    "method",
    "root",
    "originalRoot",
    "identity",
    "originalIdentity",
    "entries",
    "bytes",
    "inventorySha256",
  ]);
  require(
    meta.method === "private-refs-index-readonly-object-alternates" &&
      meta.root === cef.root + "/.git" &&
      meta.originalRoot ===
        linuxCache.replace("/work/", "/opt/original-cache/") + "/cef/.git",
  );
  for (const identity of [meta.identity, meta.originalIdentity]) {
    shape(identity, ["dev", "ino", "uid", "gid", "mode"]);
    require(
      id(identity.dev) &&
        id(identity.ino) &&
        identity.uid === 10001 &&
        identity.gid === 10001 &&
        integer(identity.mode, 511) &&
        (identity.mode & 0o22) === 0,
    );
  }
  require(
    meta.identity.mode === 448 &&
      meta.identity.dev ===
        w.init.result.directories.find((x) => x.name === "cef").dev &&
      (meta.identity.dev !== meta.originalIdentity.dev ||
        meta.identity.ino !== meta.originalIdentity.ino),
  );
  require(
    Array.isArray(meta.entries) &&
      meta.entries.length >= 4 &&
      meta.entries.length <= 256 &&
      same(
        meta.entries,
        [...meta.entries].sort((a, b) =>
          Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
        ),
      ),
  );
  const gitPaths = new Set(),
    gitFileIds = new Set();
  let metadataBytes = 0;
  for (const row of meta.entries) {
    shape(row, [
      "path",
      "size",
      "sha256",
      "mode",
      "dev",
      "ino",
      "nlink",
      "uid",
      "gid",
    ]);
    member(row.path);
    require(
      !gitPaths.has(row.path) &&
        ([
          "HEAD",
          "config",
          "index",
          "packed-refs",
          "shallow",
          "objects/info/alternates",
        ].includes(row.path) ||
          /^refs\/(?:heads|remotes)\/[A-Za-z0-9._/-]+$/.test(row.path)) &&
        !row.path.endsWith(".lock") &&
        integer(row.size, 1024 * 1024) &&
        hex.test(row.sha256) &&
        integer(row.mode, 511) &&
        (row.mode & 0o22) === 0 &&
        id(row.dev) &&
        id(row.ino) &&
        row.nlink === 1 &&
        row.uid === 10001 &&
        row.gid === 10001,
    );
    require(
      row.dev === meta.identity.dev && !gitFileIds.has(row.dev + ":" + row.ino),
    );
    gitFileIds.add(row.dev + ":" + row.ino);
    gitPaths.add(row.path);
    metadataBytes += row.size;
  }
  require(
    ["HEAD", "config", "index", "objects/info/alternates"].every((name) =>
      gitPaths.has(name),
    ) &&
      metadataBytes === meta.bytes &&
      metadataBytes <= 16 * 1024 ** 2 &&
      meta.inventorySha256 === identitySha256(meta.entries),
  );
  const expectedConfig =
    "[core]\nrepositoryformatversion=0\nfilemode=true\nbare=false\nautocrlf=false\nhooksPath=/dev/null\nfsmonitor=false\n";
  for (const [name, body] of [
    ["config", expectedConfig],
    ["objects/info/alternates", meta.originalRoot + "/objects\n"],
  ]) {
    const row = meta.entries.find((x) => x.path === name);
    require(
      row.size === Buffer.byteLength(body) &&
        row.sha256 === hash(Buffer.from(body)),
    );
  }
  const cefDirectories = new Set([
    ".git",
    ".git/objects",
    ".git/objects/info",
    ".git/refs",
    ".git/refs/heads",
    ".git/refs/remotes",
  ]);
  for (const name of [
    ...oldCef.map((x) => x.path),
    ...newCef.map((x) => x.path),
    ...meta.entries.map((x) => ".git/" + x.path),
  ]) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      cefDirectories.add(parts.join("/"));
      parts.pop();
    }
  }
  require(same(cef.directories, [...cefDirectories].sort()));
  const aggregateFiles = copy.files + cef.files + meta.entries.length,
    aggregateBytes = copy.bytes + cef.bytes + meta.bytes,
    aggregateDirectories = copy.directories.length + cef.directories.length;
  require(
    aggregateFiles <= 500000 &&
      aggregateBytes <= 256 * 1024 ** 3 &&
      aggregateDirectories <= 100000 &&
      w.capacityBeforeBytes >= aggregateBytes + 108 * 1024 ** 3,
  );
  const gitQueries = raw(g.metadata["git-queries.json"], 512 * 1024),
    expectedQueries = [
      ["rev-parse", "HEAD"],
      ["rev-list", "--count", "HEAD"],
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["log", "-n", "1", "--pretty=%d", "HEAD"],
      ["cherry", "origin/master", "HEAD"],
      ["ls-files", "--stage", "-z"],
      [
        "grep",
        "--no-color",
        "-n",
        "-E",
        "(CEF_NEXT|CEF_NEXT)|=next",
        "--",
        ":!include/cef_api_hash.h",
        "*.h",
        "*.cc",
      ],
    ];
  require(
    Array.isArray(gitQueries) && gitQueries.length === expectedQueries.length,
  );
  for (const [i, row] of gitQueries.entries()) {
    shape(row, [
      "argv",
      "exit",
      "stdoutBytes",
      "stdoutSha256",
      "stderrBytes",
      "stderrSha256",
      "equal",
    ]);
    require(
      same(row.argv, expectedQueries[i]) &&
        row.equal === true &&
        [0, 1].includes(row.exit) &&
        integer(row.stdoutBytes, 1024 * 1024) &&
        integer(row.stderrBytes, 1024 * 1024) &&
        hex.test(row.stdoutSha256) &&
        hex.test(row.stderrSha256),
    );
    if (i === 0)
      require(
        row.exit === 0 &&
          row.stdoutBytes === 41 &&
          row.stdoutSha256 ===
            hash(Buffer.from("682c378d70d5780061e96644dca16ddd8fd157a9\n")),
      );
  }

  require(
    same(gn.argv, [
      `${linuxCache}/buildtools/linux64/gn`,
      "gen",
      `${linuxCache}/out/Release_GN_x64`,
    ]) &&
      gn.cwd === linuxCache &&
      gn.exit === 0 &&
      gn.beginWallMs >= w.endWallMs &&
      gn.endWallMs >= gn.beginWallMs &&
      gn.elapsedMs === gn.endWallMs - gn.beginWallMs &&
      gn.elapsedMs <= 900000 &&
      gn.endWallMs <= w.workDeadlineWallMs &&
      gn.generationSha256 === review.evidence.generation.sha256 &&
      gn.sourceAfterSha256 === identitySha256(facts.postchecks.sourceAfter),
  );
  require(
    typeof records.gnOutput === "string" &&
      Buffer.byteLength(records.gnOutput) === gn.outputBytes &&
      gn.outputBytes <= 16 * 1024 ** 2 &&
      hash(Buffer.from(records.gnOutput)) === gn.outputSha256 &&
      review.evidence.gnOutput.sha256 === gn.outputSha256,
  );
  for (const [before, after] of [
    [gn.argsBefore, gn.argsAfter],
    [gn.securityHeaderBefore, gn.securityHeaderAfter],
  ])
    require(same(before, after));
  require(
    same(gn.argsBefore, facts.readiness.args) &&
      same(gn.securityHeaderBefore, facts.readiness.securityHeader) &&
      same(gn.securityMacrosBefore, gn.securityMacrosAfter) &&
      same(gn.securityMacrosBefore, facts.readiness.securityMacros) &&
      same(gn.graphBefore, facts.readiness.graph),
  );
  file(gn.graphAfter);
  for (const [edge, name] of [
    [gn.objectEdge, "object"],
    [gn.linkEdge, "link"],
  ]) {
    shape(edge, [
      "ninjaFile",
      "edgeSha256",
      "rule",
      "source",
      "output",
      "before",
    ]);
    file(edge.ninjaFile);
    file(edge.before);
    require(
      hex.test(edge.edgeSha256) &&
        typeof edge.rule === "string" &&
        /^[a-zA-Z0-9_]{1,128}$/.test(edge.rule),
    );
    member(edge.output);
    require(
      edge.ninjaFile.path.endsWith(".ninja") &&
        edge.before.path === edge.output,
    );
    const original = copy.entries.find(
      (x) => x.tree === "out" && x.path === edge.output,
    );
    require(
      original &&
        original.size === edge.before.size &&
        original.sha256 === edge.before.sha256,
    );
    if (name === "object")
      require(
        edge.source === "cef/libcef/browser/native/window_x11.cc" &&
          edge.output.endsWith(".o"),
      );
    else
      require(
        edge.output === "libcef.so" &&
          edge.source === "cef" &&
          same(edge.before, facts.readiness.cacheOutputs.engine),
      );
  }
  file(post.objectAfter);
  file(post.linkAfter);
  require(
    post.objectAfter.path === gn.objectEdge.output &&
      post.objectAfter.sha256 !== gn.objectEdge.before.sha256 &&
      same(post.linkAfter, post.engine) &&
      post.workspaceSha256 === review.evidence.workspace.sha256 &&
      post.generationSha256 === review.evidence.generation.sha256 &&
      post.gnSha256 === review.evidence.gn.sha256 &&
      compiled.beginWallMs >= gn.endWallMs &&
      pack.endWallMs <= w.workDeadlineWallMs,
  );
  return {
    originalCacheReadonly: true,
    workspaceCopied: true,
    workspaceVolume: volume,
    workspaceManifestSha256: review.evidence.copyManifest.sha256,
    generationRecordSha256: review.evidence.generation.sha256,
    gnRecordSha256: review.evidence.gn.sha256,
    compiledObjectSha256: post.objectAfter.sha256,
    isolatedBuild: true,
  };
}

function verifyWindowsIncrementalEvidence(review, r, inputLock) {
  const lock = validateSourceLock(inputLock),
    id = review.sourceLockIdentity,
    b = r.build,
    before = r.beforeimage,
    applied = r.apply,
    prior = r.prerequisites,
    continued = r.continuation,
    job = r.engineJob,
    engine = r.engine,
    symbols = r.symbols,
    packaged = r.package;
  const require = (ok) => {
    if (!ok) fail("Original incremental Windows evidence mismatch");
  };
  const same = (a, b) =>
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    identitySha256(a) === identitySha256(b);
  const digest = (value) => typeof value === "string" && hex.test(value);
  const cleanJob = (value) =>
    value?.kind === "owned-job-proof" &&
    Number.isSafeInteger(value.rootPid) &&
    value.rootPid > 0 &&
    /^[1-9][0-9]{0,19}$/.test(value.rootCreationFiletime ?? "") &&
    Number.isSafeInteger(value.elapsedMs) &&
    value.elapsedMs > 0 &&
    value.elapsedMs <= 6 * 60 * 60_000 &&
    value.started === true &&
    value.assignedBeforeResume === true &&
    value.resumed === true &&
    value.handleListOnly === true &&
    value.outcome === "success" &&
    value.rootExit === 0 &&
    value.finalRootExit === 0 &&
    value.rootReaped === true &&
    value.cleanupVerified === true &&
    value.activeAtEnd === 0 &&
    value.logReadersStopped === true;
  require(
    identitySha256(lock) === id &&
      lock.bridge.patchId === HTTP3_BRIDGE_PATCH_ID &&
      lock.bridge.abiVersion === 2 &&
      lock.bridge.capabilities.length === 9 &&
      lock.patches.length === 17,
  );
  const patch = lock.patches.at(-1),
    build = lock.builds.find((row) => row.target === review.target);
  require(
    build &&
      /\/0017-chromium-instance-tracer-allocation-reentrancy\.patch$/.test(
        patch.path,
      ),
  );
  require(
    b?.kind === "genuine-local-windows-x64-tracer17-build-evidence" &&
      b.sourceLockSha256 === id &&
      b.patchId === HTTP3_BRIDGE_PATCH_ID &&
      b.abiVersion === 2 &&
      b.nativeTests?.passed === 12 &&
      b.nativeTests.failed === 0 &&
      b.engineBuild?.exit === 0 &&
      b.engineBuild.ownedJobCleanup === true &&
      b.source4Tool8ArgsFlagsPostchecks === true &&
      b.nativeBrowserAcceptance === false &&
      b.productionReady === false &&
      b.runtimeSelected === false &&
      b.published === false,
  );
  require(
    before?.kind === "sorng-tracer17-beforeimage" &&
      before.sourceLockIdentity === id &&
      before.actualToolCount === 8 &&
      digest(before.backupSha256?.["libcef.dll"]) &&
      before.backupSha256?.["args.gn"] === build.gnArgs.sha256,
  );
  for (const [name, entry] of Object.entries(lock.upstream))
    require(
      before.gitHeads?.[name === "depot_tools" ? "depotTools" : name] ===
        entry.commit,
    );
  const pins = [
    ...lock.patches.slice(0, -1),
    lock.bridge.header,
    build.gnArgs,
    build.toolchainLock,
  ];
  require(
    Array.isArray(before.preservedInputs) &&
      before.preservedInputs.length === pins.length &&
      new Set(before.preservedInputs.map((row) => row.path)).size ===
        pins.length,
  );
  for (const pin of pins)
    require(
      before.preservedInputs.some(
        (row) => row.path === pin.path && row.sha256 === pin.sha256,
      ),
    );
  require(
    applied?.fourResultHashesExact === true &&
      applied.operations?.length === 2 &&
      applied.operations.every((row) => row.exit === 0) &&
      applied.files?.length === 4 &&
      applied.files.every((row) => digest(row.sha256)),
  );
  require(
    prior?.sourceLockIdentity === id &&
      commit.test(prior.sourceHead ?? "") &&
      prior.outcome === "post-stage-validation-denied" &&
      prior.postchecks?.fullEngineStageStarted === false &&
      prior.postchecks.actual8ToolPins === true &&
      prior.postchecks.actual4SourcePins === true &&
      prior.postchecks.argsUnchanged === true &&
      prior.stages?.length === 4 &&
      prior.stages.every(
        (row, index) =>
          row.index === index &&
          row.outcome === "success" &&
          row.rootExit === 0 &&
          row.activeAtEnd === 0 &&
          row.cleanupVerified === true &&
          row.logReadersStopped === true,
      ),
  );
  const textPin = (name, text) => {
    require(
      typeof text === "string" &&
        Buffer.byteLength(text) <= 1024 ** 2 &&
        Buffer.byteLength(text) === review.evidence[name].size &&
        hash(Buffer.from(text)) === review.evidence[name].sha256,
    );
  };
  textPin("nativeOutput", r.nativeOutput);
  textPin("engineOutput", r.engineOutput);
  const native = [
    ...r.nativeOutput.matchAll(
      /^\[(\d+)\/12\] (InstanceTracerStorage(?:Integration)?Test\.[A-Za-z0-9_]+) \(\d+ ms\)\r?$/gm,
    ),
  ];
  const expectedNative = new Set([
    ...[
      "RealRawPtrAssignmentMovesTrackingBetweenAllocations",
      "RealMayDangleIsFilteredWithoutDroppingNormalOwner",
      "RealRawPtrCopyAndCleanupKeepExactRecords",
    ].map((name) => `InstanceTracerStorageIntegrationTest.${name}`),
    ...[
      "TraceAllocationAndRemovalNeverHoldStorageMutex",
      "SnapshotAllocationNeverHoldsStorageMutex",
      "DuplicatePreservesOriginalAndDestroysUnusedNodeOutsideMutex",
      "SnapshotIsCompleteSortedAndFiltersSlotAndMayDangle",
      "NodeAllocatorCanReenterRemovalBeforeInsertion",
      "SnapshotRetriesAfterCapacityAllocationAddsOwners",
      "InfoConstructionCanReenterRemoval",
      "GeometricCapacityProgressesDuringReserveTimeGrowth",
      "FourConcurrentWritersAndSnapshotsFinishEmpty",
    ].map((name) => `InstanceTracerStorageTest.${name}`),
  ]);
  require(
    native.length === 12 &&
      new Set(native.map((row) => row[2])).size === 12 &&
      native.every((row) => expectedNative.has(row[2])) &&
      native.every((row, index) => Number(row[1]) === index + 1) &&
      /^SUCCESS: all tests passed\.\r?$/m.test(r.nativeOutput) &&
      !/\b(?:FAILED|FATAL|RETRY|RETRIED)\b/.test(r.nativeOutput),
  );
  require(
    prior.files?.some(
      (row) =>
        row.path.endsWith("/3/stdout.log") &&
        row.sha256 === review.evidence.nativeOutput.sha256 &&
        row.bytes === review.evidence.nativeOutput.size,
    ),
  );
  const proof = continued?.originalProof;
  require(
    continued?.kind === "owned-engine-continuation" &&
      continued.success === true &&
      continued.outcome === "success" &&
      proof?.beforeimage?.sourceLockIdentity === id &&
      proof.beforeimage.sourceFileCount === 4 &&
      proof.beforeimage.inputPinCount === 20 &&
      proof.beforeimage.toolCount === 8 &&
      proof.native?.expectedTests === 12 &&
      proof.native.passedTests === 12 &&
      proof.native.uniqueTestNames === 12 &&
      cleanJob(job) &&
      same(continued.job, job),
  );
  require(
    engine?.kind === "actual-local-windows-x64-tracer17-engine-build" &&
      engine.sourceLockIdentity === id &&
      engine.patch17 === patch.sha256 &&
      engine.outcome === "success" &&
      engine.engineExit === 0 &&
      engine.originalGuardFormatFailurePreserved === true &&
      engine.postbuild?.sourcePins === 4 &&
      engine.postbuild.installedToolPins === 8 &&
      engine.postbuild.argsUnchanged === true &&
      same(engine.postbuild, continued.postbuild) &&
      engine.cleanup?.rootPid === job.rootPid &&
      engine.cleanup.rootCreationFiletime === job.rootCreationFiletime &&
      engine.cleanup.rootReaped === true &&
      engine.cleanup.activeAtEnd === 0 &&
      engine.cleanup.cleanupVerified === true &&
      engine.cleanup.logReadersStopped === true,
  );
  for (const [role, suffix] of [
    ["continuation", "/continuation.json"],
    ["engineJob", "/receipt.json"],
    ["engineOutput", "/stdout.log"],
  ])
    require(
      engine.rawBuildProofs?.some(
        (row) =>
          row.path.endsWith(suffix) &&
          row.sha256 === review.evidence[role].sha256 &&
          row.bytes === review.evidence[role].size,
      ),
    );
  const completed = /^noexec:0 local:(\d+) remote:0 cache:0 skip:\d+\r?$/m.exec(
    r.engineOutput,
  );
  require(
    /^build finished\r?$/m.test(r.engineOutput) &&
      completed &&
      Number(completed[1]) === engine.steps &&
      !/^(?:FAILED:|ninja: build stopped|FATAL)/m.test(r.engineOutput),
  );
  require(
    symbols?.kind === "new-local-engine-symbol-and-output-proof" &&
      symbols.machine === "0x8664" &&
      symbols.matches === true &&
      symbols.networkSymbolLookup === false &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        symbols.dllRsds?.guid ?? "",
      ) &&
      Number.isSafeInteger(symbols.dllRsds?.age) &&
      symbols.dllRsds.age > 0 &&
      same(symbols.dllRsds, symbols.pdbInformationStream) &&
      same(engine.newOutputs, symbols),
  );
  const file = (name) =>
    symbols.files?.filter((row) =>
      row.path.replaceAll("\\", "/").endsWith("/" + name),
    );
  for (const name of [
    "libcef.dll",
    "libcef.dll.pdb",
    "libcef.dll.lib",
    "bootstrap.exe",
    "bootstrapc.exe",
  ])
    require(
      file(name)?.length === 1 &&
        digest(file(name)[0].sha256) &&
        Number.isSafeInteger(file(name)[0].bytes) &&
        file(name)[0].bytes > 0,
    );
  require(file("libcef.dll")[0].sha256 !== before.backupSha256["libcef.dll"]);
  require(
    packaged?.kind === "immutable-local-tracer17-sdk-package" &&
      packaged.sourceLockIdentity === id &&
      packaged.bridgePatchId === HTTP3_BRIDGE_PATCH_ID &&
      packaged.headerSha256 === lock.bridge.header.sha256 &&
      packaged.sdkFiles === packaged.preparedSdkFiles &&
      Number.isSafeInteger(packaged.sdkFiles) &&
      packaged.sdkFiles > 0 &&
      packaged.snapshotRsdsPdbMatched === true &&
      packaged.source4Tool8ArgsFlagsPostchecks === true &&
      packaged.originalPreparationFailurePreserved === true &&
      packaged.authorizedRecoveryFreshOnly === true &&
      packaged.productionReady === false &&
      packaged.selected === false &&
      packaged.published === false,
  );
  require(
    cleanJob(r.distribution?.receipt) &&
      cleanJob(r.preparation?.receipt) &&
      r.preparation.originalFailurePreserved === true &&
      packaged.steps?.some(
        (row) => row.phase === "prepare" && row.exit === 1,
      ) &&
      packaged.steps?.some(
        (row) =>
          row.phase === "prepare-recovery" &&
          row.exit === 0 &&
          row.cleanup === true &&
          row.activeAtEnd === 0,
      ),
  );
  require(
    Array.isArray(r.distribution.argv) &&
      r.distribution.argv[1] === "tools/make_distrib.py" &&
      [
        "--ninja-build",
        "--x64-build",
        "--minimal",
        "--allow-partial",
        "--no-archive",
        "--no-docs",
      ].every((flag) => r.distribution.argv.includes(flag)),
  );
  for (const [role, basename] of [
    ["build", "build-evidence.json"],
    ["distribution", "distribution-job-proof.json"],
    ["preparation", "prepare-recovery-job-proof.json"],
  ])
    require(
      packaged.metadataAndArchiveHashes?.some(
        (row) =>
          row.path === basename &&
          row.sha256 === review.evidence[role].sha256 &&
          row.bytes === review.evidence[role].size,
      ),
    );
  return {
    origin: review.origin,
    engineSha256: file("libcef.dll")[0].sha256,
    baselineEngineSha256: before.backupSha256["libcef.dll"],
    originalControllerCommit: prior.sourceHead,
    actualToolFilesVerified: 8,
    nativeClassTestsPassed: 12,
    incrementalBuild: true,
    originalBuildRecordsPinned: true,
    originalBuildReplayed: false,
    pristineSourceBuild: false,
  };
}

function verifyWindowsOperation2Engine(
  review,
  r,
  engine,
  nativeManifestSha,
  clean,
) {
  const require = (ok) => {
    if (!ok) fail("Original operation2 Windows evidence mismatch");
  };
  const same = (a, b) => identitySha256(a) === identitySha256(b);
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      fail("Original operation2 JSON invalid");
    }
  };
  const original = (record) => {
    shape(record, ["rawUtf8", "sha256"]);
    require(
      typeof record.rawUtf8 === "string" &&
        Buffer.byteLength(record.rawUtf8) <= 1024 ** 2 &&
        hash(Buffer.from(record.rawUtf8)) === record.sha256,
    );
    return parse(record.rawUtf8);
  };
  const job = r.engineJob;
  require(
    r.engine?.kind === "source22-explicit-engine-operation2-controller" &&
      r.engine.success === true &&
      r.engine.engineStarted === true &&
      r.engine.sourceLockIdentity === WINDOWS_CAPSULE_IDENTITY,
  );
  require(
    engine?.kind === "owned-windows-source22-explicit-engine-operation2" &&
      engine.success === true &&
      engine.sourceLockIdentity === WINDOWS_CAPSULE_IDENTITY &&
      same(engine.job, job),
  );
  require(
    engine.finalDeadlineAdmission?.verified === true &&
      r.engine.controllerFinalDeadlineAdmission?.verified === true,
  );
  require(
    same(engine.actualClang, WINDOWS_OPERATION2_CLANG) &&
      same(r.engine.actualClang, WINDOWS_OPERATION2_CLANG),
  );
  require(
    same(engine.postVerification, {
      actualClangSeparatelyObserved: { verified: true },
      source9ToolsFlagsGraph: { verified: true },
      gitHeads: { verified: true },
      source22Inputs: { verified: true },
    }),
  );
  require(
    same(engine.nativePrerequisites, {
      count: 42,
      executedInThisOperation: false,
      sameSourceToolsFlagsReverified: true,
      manifestSha256: nativeManifestSha,
    }),
  );
  require(
    engine.originalAttemptDeadlineUtc === "2026-10-25T00:35:33Z" &&
      Number.isFinite(engine.operationMonotonicEnd) &&
      engine.operationMonotonicEnd > 0,
  );
  require(
    Array.isArray(engine.argv) &&
      engine.argv.length === 9 &&
      /(?:^|[\\/])python(?:\.exe)?$/.test(engine.argv[0]) &&
      /[\\/]autoninja\.py$/.test(engine.argv[1]) &&
      same(engine.argv.slice(2), [
        "-j12",
        "-C",
        "out/Release_GN_x64",
        "cef",
        "cef_sandbox",
        "bootstrap",
        "bootstrapc",
      ]),
  );
  require(
    Number.isFinite(engine.capSeconds) &&
      engine.capSeconds > 0 &&
      engine.capSeconds <= 14400,
  );
  require(
    job.compilerOutcome === "success" &&
      job.accountingOutcome === "verified" &&
      job.elapsedMs <= engine.capSeconds * 1000 + 30000,
  );
  require(
    same(job.policyReadback, {
      cpuFlags: 5,
      cpuRate: 3000,
      limitFlags: 0x2208,
      activeProcessLimit: 128,
      jobMemoryBytes: "34359738368",
      explicitInheritedHandles: 3,
      affinityPolicyChanged: false,
    }),
  );
  const ev = r.build.operationEvidence;
  shape(ev, [
    "controllerSha256",
    "driverSha256",
    "controllerLaunch",
    "phaseRecords",
  ]);
  require(
    ev.controllerSha256 ===
      "b022ce4b19a8f103df347290fe119d33fecb9655e3f2ab0b690ad0259c3a1e5c" &&
      ev.driverSha256 ===
        "0130b26e2fdea96396fe1bb5527f504859fef2c56d1f70b91a0cc6f665c559fa",
  );
  const launch = original(ev.controllerLaunch),
    start = Date.parse(launch.launchUtc),
    end = Date.parse(engine.operationDeadlineUtc);
  require(
    launch.kind === "explicit-operation2-controller-launch" &&
      launch.deadlineUtc === engine.operationDeadlineUtc &&
      launch.controllerSha256 === ev.controllerSha256 &&
      launch.driverSha256 === ev.driverSha256 &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end - start > 60000 &&
      end - start <= 14400000,
  );
  require(/^[1-9][0-9]{0,19}$/.test(job.rootCreationFiletime ?? ""));
  require(BigInt(job.rootCreationFiletime) <= 18446744073709551615n);
  const rootMs = Number(
    (BigInt(job.rootCreationFiletime) - 116444736000000000n) / 10000n,
  );
  require(
    Number.isSafeInteger(rootMs) &&
      rootMs >= start &&
      rootMs + job.elapsedMs <= end,
  );
  shape(ev.phaseRecords, ["phaseA", "phaseB"]);
  for (const phase of ["phaseA", "phaseB"]) {
    shape(ev.phaseRecords[phase], ["capacity", "audit"]);
    const obs = r.engine[phase],
      cap = original(ev.phaseRecords[phase].capacity),
      audit = original(ev.phaseRecords[phase].audit);
    require(
      obs?.phase === phase &&
        obs.capacitySha256 === ev.phaseRecords[phase].capacity.sha256 &&
        obs.auditSha256 === ev.phaseRecords[phase].audit.sha256 &&
        obs.writerCollectorSha256 ===
          "641fd1717e79f06c6e0dda72332ce8514f209f3540031b1c84b1b3cd7b5e4022",
    );
    require(
      cap.kind === "actual-host-capacity" &&
        cap.logicalProcessors === 80 &&
        Number.isSafeInteger(cap.availableBytes) &&
        cap.availableBytes >= 64 * 1024 ** 3 &&
        Number.isSafeInteger(cap.committedBytes) &&
        Number.isSafeInteger(cap.commitLimitBytes) &&
        cap.committedBytes >= 0 &&
        cap.commitLimitBytes - cap.committedBytes >= 64 * 1024 ** 3,
    );
    require(
      audit.kind === "sorng-scoped-engine-writer-audit" &&
        audit.blockingCount === 0 &&
        Array.isArray(audit.rows) &&
        audit.rows.length <= 256 &&
        audit.rows.every((row) => row?.blocks === false) &&
        audit.sourceRoot === "F:/cef-builds/sorng-20261007/src" &&
        audit.depotRoot === "F:/cef-builds/sorng-20261007/depot_tools",
    );
    for (const when of [cap.observedAtUtc, audit.observedAtUtc]) {
      const ms = Date.parse(when);
      require(
        Number.isFinite(ms) &&
          ms >= start &&
          ms <= rootMs &&
          (phase !== "phaseB" || rootMs - ms <= 60000),
      );
    }
    require(clean(obs.capacityQueryJob));
  }
  const previous = r.previousEngineAttempt;
  shape(previous, [
    "kind",
    "derivedFacts",
    "originalReport",
    "originalManifest",
    "originalReceipt",
  ]);
  require(
    previous.kind === "derived-operation2-original-failed-attempt" &&
      previous.derivedFacts === true,
  );
  const prior = original(previous.originalReport),
    manifest = original(previous.originalManifest),
    receipt = original(previous.originalReceipt),
    old = prior.engine,
    priorJob = old?.job,
    summary = engine.previousAttempt;
  require(
    prior.kind === "source22-engine-fresh-continuation" &&
      prior.sourceLockIdentity === WINDOWS_CAPSULE_IDENTITY &&
      prior.success === false &&
      old.success === false &&
      old.originalDeadlineUtc === "2026-10-25T00:35:33Z" &&
      old.finalDeadlineAdmission?.verified === false,
  );
  require(
    priorJob?.success === false &&
      priorJob.outcome === "deadline" &&
      priorJob.finalRootExit === 124 &&
      priorJob.rootReaped === true &&
      priorJob.cleanupVerified === true &&
      priorJob.activeAtEnd === 0 &&
      priorJob.logReadersStopped === true,
  );
  require(
    same(old.postVerification, {
      source9ToolsFlagsGraph: { verified: true },
      gitHeads: { verified: true },
      source22Inputs: { verified: true },
    }),
  );
  require(
    manifest.kind ===
      "actual-source22-first-engine-partial-deadline-raw-proof" &&
      manifest.files?.length === 39 &&
      manifest.observationFiles?.length === 4,
  );
  require(
    manifest.files.filter(
      (x) =>
        x.path === "engine-continuation.json" &&
        x.sha256 === previous.originalReport.sha256 &&
        x.bytes === Buffer.byteLength(previous.originalReport.rawUtf8),
    ).length === 1,
  );
  require(
    receipt.kind === "actual-source22-engine-partial-original-deadline" &&
      receipt.sourceLockIdentity === WINDOWS_CAPSULE_IDENTITY &&
      receipt.rawManifestSha256 === previous.originalManifest.sha256 &&
      receipt.fullEngineBuilt === false &&
      same(receipt.actualJob, priorJob),
  );
  require(
    same(summary, {
      manifestSha256: previous.originalManifest.sha256,
      receiptSha256: previous.originalReceipt.sha256,
      originalDeadlineUtc: "2026-10-25T00:35:33Z",
      originalOutcome: "deadline",
      originalFinalRootExit: 124,
      originalSuccess: false,
      rootReaped: true,
      activeAtEnd: 0,
    }),
  );
  require(
    typeof r.engineAccounting === "string" &&
      Buffer.byteLength(r.engineAccounting) <= 2 * 1024 ** 2 &&
      hash(Buffer.from(r.engineAccounting)) === job.accountingSha256 &&
      job.accountingSha256 === review.evidence.engineAccounting.sha256,
  );
  const accounting = parse(r.engineAccounting);
  shape(accounting, [
    "kind",
    "available",
    "intervalMs",
    "queryClasses",
    "rowLimit",
    "byteLimit",
    "samples",
    "errors",
    "processorGroupFacts",
    "cpuDenominatorKnown",
    "utilizationPercent",
  ]);
  require(
    accounting.kind === "owned-job-accounting-v1" &&
      accounting.available === true &&
      accounting.intervalMs === 10000 &&
      same(accounting.queryClasses, [8, 9]) &&
      accounting.rowLimit === 2048 &&
      accounting.byteLimit === 2097152 &&
      same(accounting.errors, []) &&
      accounting.processorGroupFacts === "not-collected" &&
      accounting.cpuDenominatorKnown === false &&
      accounting.utilizationPercent === null,
  );
  require(
    Array.isArray(accounting.samples) &&
      accounting.samples.length >= 2 &&
      accounting.samples.length <= 2048,
  );
  const decimalKeys = [
    "user100ns",
    "kernel100ns",
    "readOperations",
    "writeOperations",
    "otherOperations",
    "readBytes",
    "writeBytes",
    "otherBytes",
    "peakProcessMemoryBytes",
    "peakJobMemoryBytes",
  ];
  let last, periodic;
  for (const [i, row] of accounting.samples.entries()) {
    shape(row, [
      "role",
      "elapsedMs",
      "totalProcesses",
      "activeProcesses",
      "terminatedProcesses",
      ...decimalKeys,
    ]);
    require(
      row.role ===
        (i === 0
          ? "initial"
          : i === accounting.samples.length - 1
            ? "final"
            : "sample") &&
        Number.isSafeInteger(row.elapsedMs) &&
        row.elapsedMs >= 0 &&
        row.elapsedMs <= job.elapsedMs + 1000,
    );
    for (const key of decimalKeys)
      require(
        typeof row[key] === "string" &&
          /^(0|[1-9][0-9]{0,19})$/.test(row[key]) &&
          BigInt(row[key]) <= 18446744073709551615n,
      );
    require(
      BigInt(row.user100ns) <= 9223372036854775807n &&
        BigInt(row.kernel100ns) <= 9223372036854775807n,
    );
    for (const key of [
      "totalProcesses",
      "activeProcesses",
      "terminatedProcesses",
    ])
      require(
        Number.isSafeInteger(row[key]) &&
          row[key] >= 0 &&
          row[key] <= 0xffffffff,
      );
    require(
      row.activeProcesses <= 128 &&
        row.terminatedProcesses <= row.totalProcesses &&
        BigInt(row.peakJobMemoryBytes) <= 34359738368n &&
        BigInt(row.peakProcessMemoryBytes) <= 34359738368n,
    );
    if (last) {
      require(
        row.elapsedMs >= last.elapsedMs &&
          row.totalProcesses >= last.totalProcesses &&
          row.terminatedProcesses >= last.terminatedProcesses,
      );
      for (const key of decimalKeys)
        require(BigInt(row[key]) >= BigInt(last[key]));
    }
    if (row.role === "sample") {
      require(
        periodic === undefined
          ? row.elapsedMs - accounting.samples[0].elapsedMs >= 10000
          : row.elapsedMs - periodic >= 10000,
      );
      periodic = row.elapsedMs;
    }
    last = row;
  }
  require(last.activeProcesses === 0 && engine.symbols?.age <= 0xffffffff);
  return {
    previousFailedAttemptDigest: review.evidence.previousEngineAttempt.sha256,
    engineAccountingDigest: job.accountingSha256,
    separatelyObservedClang: {
      sha256: WINDOWS_OPERATION2_CLANG.sha256,
      bytes: WINDOWS_OPERATION2_CLANG.bytes,
      qualification: WINDOWS_OPERATION2_CLANG.provenance,
    },
    engineOperationPolicy: {
      jobs: 12,
      cpuRate: 3000,
      memoryBytes: "34359738368",
      activeLimit: 128,
      deadlineUtc: engine.operationDeadlineUtc,
      originalFailedDeadlineUtc: "2026-10-25T00:35:33Z",
    },
  };
}

function verifyWindowsCapsuleEvidence(review, r, inputLock) {
  const operation2 = review.origin === WINDOWS_OPERATION2_ORIGIN;
  const lock = validateSourceLock(inputLock),
    id = review.sourceLockIdentity;
  const require = (ok) => {
    if (!ok) fail("Original capsule Windows evidence mismatch");
  };
  const same = (a, b) => identitySha256(a) === identitySha256(b);
  const digest = (v) => typeof v === "string" && hex.test(v);
  const original = (wrapped) => {
    shape(wrapped, ["rawUtf8", "sha256"]);
    require(
      typeof wrapped.rawUtf8 === "string" &&
        Buffer.byteLength(wrapped.rawUtf8) <= RELEASE_LIMITS.metadata &&
        hash(Buffer.from(wrapped.rawUtf8)) === wrapped.sha256,
    );
    return JSON.parse(wrapped.rawUtf8);
  };
  const clean = (job) =>
    job?.kind === "owned-job-proof" &&
    job.success === true &&
    job.started === true &&
    job.assignedBeforeResume === true &&
    job.resumed === true &&
    job.handleListOnly === true &&
    job.outcome === "success" &&
    job.rootExit === 0 &&
    job.finalRootExit === 0 &&
    job.rootReaped === true &&
    job.cleanupVerified === true &&
    job.activeAtEnd === 0 &&
    job.logReadersStopped === true &&
    job.cleanupBudgetMs === 30000 &&
    Number.isSafeInteger(job.rootPid) &&
    job.rootPid > 0 &&
    /^[1-9][0-9]{0,19}$/.test(job.rootCreationFiletime ?? "") &&
    Number.isSafeInteger(job.elapsedMs) &&
    job.elapsedMs > 0 &&
    job.elapsedMs <= 6 * 60 * 60_000;
  // Every record is checked against its original bytes before any derived facts.
  for (const [role, record] of Object.entries(r)) {
    if (capsuleTextRoles.has(role)) {
      require(
        typeof record === "string" &&
          Buffer.byteLength(record) === review.evidence[role].size &&
          hash(Buffer.from(record)) === review.evidence[role].sha256 &&
          Buffer.byteLength(record) <=
            (role === "engineOutput" ? 64 * 1024 ** 2 : 1024 ** 2),
      );
    }
  }
  require(
    identitySha256(lock) === id &&
      id === WINDOWS_CAPSULE_IDENTITY &&
      lock.bridge.abiVersion === 2 &&
      lock.bridge.patchId === HTTP3_BRIDGE_PATCH_ID &&
      lock.bridge.capabilities.length === 9 &&
      lock.patches.length === 22 &&
      lock.patches.at(-1).sha256 ===
        "1177f9414d305a0f0d1edddc9b788813c220a6b44e741a6cfd39b737c4e6fc6e",
  );
  const b = r.build;
  shape(b, [
    "kind",
    "derivedFacts",
    "sourceLockIdentity",
    "controllerCommit",
    "recordDigests",
    "policy",
    ...(operation2 ? ["operationEvidence"] : []),
  ]);
  require(
    b.kind === "derived-local-windows-capsule-build-bindings" &&
      b.derivedFacts === true &&
      b.sourceLockIdentity === id &&
      commit.test(b.controllerCommit ?? ""),
  );
  shape(
    b.recordDigests,
    ownedCapsuleEvidence(review.origin).filter((name) => name !== "build"),
  );
  for (const [role, sha] of Object.entries(b.recordDigests))
    require(sha === review.evidence[role].sha256);
  require(
    same(b.policy, {
      cpuRate: operation2 ? 3000 : 2000,
      memoryBytes: 32 * 1024 ** 3,
      processLimit: 128,
      inheritedHandles: 3,
      cleanupMs: 30000,
      jobs: operation2 ? 12 : 8,
      originalDeadlineUtc: "2026-10-25T00:35:33Z",
      originalMonotonicEnd: 1414850.593,
    }),
  );
  const native = r.native?.native,
    engine = operation2 ? r.engine?.operation : r.engine?.engine;
  require(
    r.native?.kind === "source22-fresh-native-continuation" &&
      r.native.success === true &&
      native?.success === true &&
      native.sourceLockIdentity === id &&
      native.nativeRecords === 42 &&
      native.patch22Applied === true &&
      native.finalDeadlineAdmission?.verified === true &&
      same(native.postVerification, {
        source9ToolsFlagsRuntimeGraph: { verified: true },
        gitHeads: { verified: true },
        source22Inputs: { verified: true },
      }),
  );
  const stages = [
    "apply-check",
    "apply-test-dependency",
    "security-build",
    "owned-quic-lifetime-full-list",
    "owned-quic-lifetime-full-run",
    "brp-dpd-list",
    "brp-dpd-run",
    "sandbox-list",
    "sandbox-run",
  ];
  require(
    native.stages?.length === 9 &&
      native.stages.every(
        (row, index) => row.name === stages[index] && clean(row.job),
      ),
  );
  // Raw manifest retains the original runtime-beforeimage pins, never their multi-GB contents.
  shape(r.nativeJobs, [
    "kind",
    "derivedFacts",
    "originalManifest",
    "stageReceipts",
    "observations",
  ]);
  require(
    r.nativeJobs.kind === "derived-capsule-original-native-records" &&
      r.nativeJobs.derivedFacts === true,
  );
  const manifest = original(r.nativeJobs.originalManifest),
    manifestSha = r.nativeJobs.originalManifest.sha256;
  require(
    manifest.files?.length === 57 &&
      manifest.observationFiles?.length === 4 &&
      new Set(manifest.files.map((row) => row.path)).size === 57 &&
      new Set(manifest.observationFiles.map((row) => row.path)).size === 4,
  );
  shape(r.nativeJobs.stageReceipts, stages);
  for (const row of native.stages) {
    const wrapped = r.nativeJobs.stageReceipts[row.name];
    require(
      same(original(wrapped), row.job) &&
        manifest.files.some(
          (pin) =>
            pin.path === row.name + "/receipt.json" &&
            pin.sha256 === wrapped.sha256 &&
            pin.bytes === Buffer.byteLength(wrapped.rawUtf8),
        ),
    );
  }
  require(
    Array.isArray(r.nativeJobs.observations) &&
      r.nativeJobs.observations.length === 4,
  );
  for (let i = 0; i < 4; i++) {
    const wrapped = r.nativeJobs.observations[i];
    original(wrapped);
    require(
      manifest.observationFiles[i].sha256 === wrapped.sha256 &&
        manifest.observationFiles[i].bytes ===
          Buffer.byteLength(wrapped.rawUtf8),
    );
  }
  const manifestPin = (role, suffix) =>
    require(
      manifest.files.some(
        (row) =>
          row.path === suffix &&
          row.sha256 === review.evidence[role].sha256 &&
          row.bytes === review.evidence[role].size,
      ),
    );
  manifestPin("native", "continuation.json");
  for (const [profile, outputRole, listRole] of [
    ["owned-quic-lifetime-full", "nativeFocusedOutput", "nativeFocusedList"],
    ["brp-dpd", "nativeBrpOutput", "nativeBrpList"],
    ["sandbox", "nativeSandboxOutput", "nativeSandboxList"],
  ]) {
    const expected = WINDOWS_CAPSULE_PROFILES[profile],
      text = r[outputRole],
      listing = r[listRole];
    manifestPin(outputRole, profile + "-run/stdout.log");
    manifestPin(listRole, profile + "-list/stdout.log");
    const rows = [
      ...text.matchAll(
        /^\[(\d+)\/(\d+)\] ([A-Za-z0-9_]+\.[A-Za-z0-9_]+) \(\d+ ms\)\r?$/gm,
      ),
    ];
    require(
      rows.length === expected.length &&
        new Set(rows.map((row) => row[3])).size === expected.length &&
        rows.every(
          (row, index) =>
            Number(row[1]) === index + 1 &&
            Number(row[2]) === expected.length &&
            expected.includes(row[3]),
        ) &&
        /^SUCCESS: all tests passed\.\r?$/m.test(text) &&
        !/\b(?:FAILED|FATAL|RETRY|RETRIED)\b/.test(text),
    );
    let suite = "";
    const names = [];
    for (const line of listing.split(/\r?\n/)) {
      if (/^[A-Za-z0-9_]+\.$/.test(line)) suite = line.slice(0, -1);
      else if (/^  [A-Za-z0-9_]+$/.test(line))
        names.push(suite + "." + line.trim());
      // Other genuine target tests may be listed; only the exact positive
      // filter below is executed. Parameterized comments are not authority.
    }
    require(
      expected.every(
        (name) => names.filter((listed) => listed === name).length === 1,
      ),
    );
  }
  shape(r.sourcePostchecks, [
    "kind",
    "derivedFacts",
    "nativeReceipt",
    "generatedFlags",
  ]);
  require(
    r.sourcePostchecks.kind === "derived-capsule-original-postcheck-records" &&
      r.sourcePostchecks.derivedFacts === true,
  );
  const post = original(r.sourcePostchecks.nativeReceipt),
    flags = original(r.sourcePostchecks.generatedFlags);
  require(
    post.kind === "actual-source22-genuine-native42-pass" &&
      post.sourceLockIdentity === id &&
      post.rawManifestSha256 === manifestSha &&
      post.nativePassingRecords === 42 &&
      post.allNativeJobsQuiescent === true &&
      post.finalDeadlineAdmission?.verified === true &&
      same(post.actualSource9, WINDOWS_CAPSULE_SOURCE_PINS) &&
      same(post.postVerification, native.postVerification) &&
      flags.macroCount === 61 &&
      same(flags.macros, WINDOWS_CAPSULE_MACROS) &&
      same(flags.actualTool8, WINDOWS_CAPSULE_TOOL_PINS),
  );
  require(clean(r.engineJob));
  let operationProvenance = {};
  if (operation2)
    operationProvenance = verifyWindowsOperation2Engine(
      review,
      r,
      engine,
      manifestSha,
      clean,
    );
  else {
    require(
      r.engine?.kind === "source22-engine-fresh-continuation" &&
        r.engine.success === true &&
        r.engine.engineStarted === true &&
        r.engine.sourceLockIdentity === id &&
        engine?.kind === "source22-one-owned-engine-build" &&
        engine.success === true &&
        engine.sourceLockIdentity === id &&
        engine.native42ManifestSha256 === manifestSha &&
        clean(r.engineJob) &&
        same(engine.job, r.engineJob) &&
        engine.finalDeadlineAdmission?.verified === true &&
        same(engine.postVerification, {
          source9ToolsFlagsGraph: { verified: true },
          gitHeads: { verified: true },
          source22Inputs: { verified: true },
        }),
    );
    for (const report of [native, engine])
      require(
        report.originalDeadlineUtc === b.policy.originalDeadlineUtc &&
          report.originalMonotonicEnd === b.policy.originalMonotonicEnd,
      );
    require(
      Array.isArray(engine.argv) &&
        engine.argv.length === 9 &&
        /(?:^|[\\/])python(?:\.exe)?$/.test(engine.argv[0]) &&
        /[\\/]autoninja\.py$/.test(engine.argv[1]) &&
        same(engine.argv.slice(2), [
          "-j8",
          "-C",
          "out/Release_GN_x64",
          "cef",
          "cef_sandbox",
          "bootstrap",
          "bootstrapc",
        ]) &&
        Number.isFinite(engine.capSeconds) &&
        engine.capSeconds > 0 &&
        engine.capSeconds <= 14400,
    );
  }
  require(
    /^build finished\r?$/m.test(r.engineOutput) &&
      /^noexec:0 local:\d+ remote:0 cache:0 skip:\d+\r?$/m.test(
        r.engineOutput,
      ) &&
      !/^(?:FAILED:|ninja: build stopped|FATAL)/m.test(r.engineOutput),
  );
  shape(r.engineSymbols, [
    "kind",
    "derivedFacts",
    "originalEngineRecordSha256",
    "symbols",
  ]);
  require(
    r.engineSymbols.kind === "derived-capsule-engine-symbol-identity" &&
      r.engineSymbols.derivedFacts === true &&
      r.engineSymbols.originalEngineRecordSha256 ===
        review.evidence.engine.sha256,
  );
  const symbols = r.engineSymbols.symbols;
  shape(symbols, ["machine", "guid", "age", "scope"]);
  require(
    same(symbols, engine.symbols) &&
      symbols.machine === "AMD64" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        symbols.guid ?? "",
      ) &&
      Number.isSafeInteger(symbols.age) &&
      symbols.age > 0,
  );
  const outputNames = [
    "libcef.dll",
    "libcef.dll.pdb",
    "bootstrap.exe",
    "bootstrapc.exe",
    "bootstrap.lib",
    "libcef.dll.lib",
    "obj/cef/cef_sandbox.lib",
  ];
  require(
    engine.outputs?.length === 7 &&
      new Set(engine.outputs.map((row) => row.path)).size === 7 &&
      engine.outputs.every(
        (row) =>
          outputNames.includes(row.path) &&
          digest(row.sha256) &&
          Number.isSafeInteger(row.bytes) &&
          row.bytes > 0,
      ),
  );
  require(
    Array.isArray(r.engineBeforeimage) && r.engineBeforeimage.length === 16,
  );
  const runtimeBefore = r.engineBeforeimage.filter(
    (row) => row.role === "runtime",
  );
  require(
    runtimeBefore.length === 7 &&
      new Set(runtimeBefore.map((row) => row.path)).size === 7 &&
      runtimeBefore.every(
        (row) =>
          outputNames.includes(row.path) &&
          digest(row.sha256) &&
          Number.isSafeInteger(row.bytes) &&
          row.bytes > 0,
      ),
  );
  const old = r.engineBeforeimage.filter(
    (row) => row.role === "runtime" && row.path === "libcef.dll",
  );
  const dll = engine.outputs.find((row) => row.path === "libcef.dll");
  require(
    old.length === 1 &&
      digest(old[0].sha256) &&
      dll.sha256 !== old[0].sha256 &&
      same(
        r.engineBeforeimage
          .filter((row) => row.role === "source")
          .map(({ role: _role, ...row }) => row),
        WINDOWS_CAPSULE_SOURCE_PINS,
      ),
  );
  const packaged = r.package;
  require(
    packaged?.kind ===
      (operation2
        ? "immutable-local-capsule22-operation2-sdk-package"
        : "immutable-local-capsule22-sdk-package") &&
      packaged.derivedFacts === true &&
      packaged.sourceLockIdentity === id &&
      packaged.engineSha256 === dll.sha256 &&
      packaged.bridgePatchId === HTTP3_BRIDGE_PATCH_ID &&
      packaged.headerSha256 === lock.bridge.header.sha256 &&
      Number.isSafeInteger(packaged.sdkFiles) &&
      packaged.sdkFiles > 0 &&
      packaged.sdkFiles === packaged.preparedSdkFiles &&
      packaged.snapshotRsdsPdbMatched === true &&
      packaged.source9Tool8ArgsFlagsPostchecks === true &&
      packaged.productionReady === false &&
      packaged.selected === false &&
      packaged.published === false &&
      clean(r.distribution?.receipt) &&
      clean(r.preparation?.receipt),
  );
  require(
    Array.isArray(r.distribution.argv) &&
      r.distribution.argv[1] === "tools/make_distrib.py" &&
      [
        "--ninja-build",
        "--x64-build",
        "--minimal",
        "--allow-partial",
        "--no-archive",
        "--no-docs",
      ].every((flag) => r.distribution.argv.includes(flag)),
  );
  for (const role of ["distribution", "preparation"])
    require(
      packaged.originalRecordDigests?.[role] === review.evidence[role].sha256,
    );
  return {
    origin: review.origin,
    engineSha256: dll.sha256,
    baselineEngineSha256: old[0].sha256,
    originalControllerCommit: b.controllerCommit,
    actualToolFilesVerified: 8,
    nativeClassTestsPassed: 42,
    incrementalBuild: true,
    originalBuildRecordsPinned: true,
    originalBuildReplayed: false,
    pristineSourceBuild: false,
    nativeProfileCounts: [36, 3, 3],
    actualSourceFilesVerified: 9,
    securityMacroCount: 61,
    instanceTracerEnabled: false,
    derivedFacts: true,
    reviewedEvidenceDigests: structuredClone(b.recordDigests),
    ...operationProvenance,
    nestedOriginalRecordDigests: {
      ...(operation2
        ? {
            previousEngineAttempt: {
              report: r.previousEngineAttempt.originalReport.sha256,
              manifest: r.previousEngineAttempt.originalManifest.sha256,
              receipt: r.previousEngineAttempt.originalReceipt.sha256,
            },
            engineAccounting: review.evidence.engineAccounting.sha256,
          }
        : {}),
      nativeManifest: manifestSha,
      nativeStageReceipts: Object.fromEntries(
        stages.map((name) => [name, r.nativeJobs.stageReceipts[name].sha256]),
      ),
      nativeObservations: r.nativeJobs.observations.map((row) => row.sha256),
      nativeReceipt: r.sourcePostchecks.nativeReceipt.sha256,
      generatedFlags: r.sourcePostchecks.generatedFlags.sha256,
      engineRecord: review.evidence.engine.sha256,
    },
  };
}

async function regular(file, limit) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > limit ||
    (await realpath(file)) !== file
  )
    fail("Bounded canonical regular file required");
  return info;
}
async function pinned(
  root,
  value,
  maximum = RELEASE_LIMITS.metadata,
  bounded = false,
) {
  pin(value, maximum);
  const file = path.join(root, value.path);
  const info = await regular(file, maximum);
  if (maximum > RELEASE_LIMITS.metadata || bounded) {
    const hasher = createHash("sha256");
    const chunks = [];
    if (info.size !== value.size) fail("Original output size mismatch");
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      size += chunk.length;
      if (size > value.size || size > maximum)
        fail("Original output stream bound");
      hasher.update(chunk);
      chunks.push(chunk);
    }
    if (size !== value.size || hasher.digest("hex") !== value.sha256)
      fail("Original output stream pin mismatch");
    // Return exactly the bytes that were bounded and hashed, never reopen a
    // pathname which could now name a larger or different file.
    return Buffer.concat(chunks, size);
  }
  const bytes = await readFile(file);
  if (
    info.size !== value.size ||
    bytes.length !== value.size ||
    hash(bytes) !== value.sha256
  )
    fail("Reviewed evidence raw pin mismatch");
  return bytes;
}
async function sourceInputs(inputs, identity, target, origin) {
  await regular(path.join(inputs, "source-lock.json"), RELEASE_LIMITS.metadata);
  const bytes = await readFile(path.join(inputs, "source-lock.json"));
  const lock = validateSourceLock(JSON.parse(bytes));
  if (
    identitySha256(lock) !== identity ||
    lock.bridge.abiVersion !== 2 ||
    (origin === LINUX_ISOLATED_ORIGIN
      ? target !== "x86_64-unknown-linux-gnu" ||
        identity !== LINUX_ISOLATED_IDENTITY ||
        lock.bridge.patchId !== HTTP3_BRIDGE_PATCH_ID ||
        lock.bridge.capabilities.length !== 9
      : [
            "owned-windows-incremental-engine",
            WINDOWS_CAPSULE_ORIGIN,
            WINDOWS_OPERATION2_ORIGIN,
          ].includes(origin)
        ? target !== "x86_64-pc-windows-msvc" ||
          lock.bridge.patchId !== HTTP3_BRIDGE_PATCH_ID ||
          lock.bridge.capabilities.length !== 9
        : lock.bridge.patchId !== BRIDGE_PATCH_ID ||
          lock.bridge.capabilities.length !== 8)
  )
    fail("Original origin-specific input identity required without relabeling");
  const build = lock.builds.find((row) => row.target === target);
  if (!build) fail("Reviewed native target absent");
  for (const value of [
    ...lock.patches,
    lock.bridge.header,
    build.gnArgs,
    build.toolchainLock,
  ]) {
    releaseRelativePath(value.path);
    const file = path.join(inputs, value.path);
    await regular(file, RELEASE_LIMITS.metadata);
    if (hash(await readFile(file)) !== value.sha256)
      fail("Original source input raw pin mismatch");
  }
  return {
    lock,
    rawSha256: hash(bytes),
  };
}

export async function checkOwnedSdkHandoff({
  review,
  bundle,
  inputs,
  evidence,
  output,
  execute = false,
}) {
  if (execute !== true)
    fail("Explicit review-only local verification required");
  const plan = ownedSdkHandoffPlan(review),
    bundleRoot = await realpath(bundle),
    inputsRoot = await realpath(inputs),
    evidenceRoot = await realpath(evidence);
  const records = {};
  for (const [name, value] of Object.entries(review.evidence)) {
    const bytes = await pinned(
      evidenceRoot,
      value,
      ownedEvidenceLimit(review.origin, name),
      review.origin === WINDOWS_OPERATION2_ORIGIN ||
        isLinuxIncrementalOrigin(review.origin),
    );
    if (
      [
        WINDOWS_OPERATION2_ORIGIN,
        LINUX_INCREMENTAL_ORIGIN,
        LINUX_ISOLATED_ORIGIN,
      ].includes(review.origin) &&
      !Buffer.from(bytes.toString("utf8")).equals(bytes)
    )
      fail("Bounded UTF8 original metadata required");
    if (
      (isLinuxIncrementalOrigin(review.origin) && name === "compileOutput") ||
      (review.origin === LINUX_ISOLATED_ORIGIN && name === "gnOutput") ||
      (review.origin === "owned-windows-incremental-engine" &&
        ["nativeOutput", "engineOutput"].includes(name)) ||
      (isWindowsCapsuleOrigin(review.origin) &&
        (capsuleTextRoles.has(name) ||
          (review.origin === WINDOWS_OPERATION2_ORIGIN &&
            name === "engineAccounting")))
    ) {
      if (
        bytes.length >
          ([
            WINDOWS_OPERATION2_ORIGIN,
            LINUX_INCREMENTAL_ORIGIN,
            LINUX_ISOLATED_ORIGIN,
          ].includes(review.origin)
            ? ownedEvidenceLimit(review.origin, name)
            : isWindowsCapsuleOrigin(review.origin) && name === "engineOutput"
              ? 64 * 1024 ** 2
              : 1024 ** 2) ||
        !Buffer.from(bytes.toString("utf8")).equals(bytes)
      )
        fail("Bounded UTF8 original build output required");
      records[name] = bytes.toString("utf8");
    } else {
      try {
        records[name] = JSON.parse(bytes);
      } catch (error) {
        if (isLinuxIncrementalOrigin(review.origin))
          fail("Original Linux incremental JSON invalid");
        throw error;
      }
    }
  }
  const verifiedInputs = await sourceInputs(
    inputsRoot,
    review.sourceLockIdentity,
    review.target,
    review.origin,
  );
  const provenance = verifyOwnedHandoffEvidence(
    review,
    records,
    verifiedInputs.lock,
  );
  if (
    review.origin === "owned-linux-engine" &&
    records.freshCheck.result.plan.sourceLockSha256 !== verifiedInputs.rawSha256
  )
    fail("Fresh check does not bind original raw input lock");
  if (
    isLinuxIncrementalOrigin(review.origin) &&
    records.package.facts.originalInputsSourceLockRawSha256 !==
      verifiedInputs.rawSha256
  )
    fail("Incremental Linux raw input lock differs");
  const descriptorFile = path.join(bundleRoot, "runtime.json");
  await regular(descriptorFile, RELEASE_LIMITS.descriptor);
  if (hash(await readFile(descriptorFile)) !== review.descriptorSha256)
    fail("Reviewed raw descriptor mismatch");
  const checked = await verifyBundle(bundleRoot, "supermarsx/sortOfRemoteNG");
  if (
    checked.identity.sourceLockSha256 !== review.sourceLockIdentity ||
    checked.descriptor.target !== review.target
  )
    fail("Transport source or target differs from original reviewed build");
  const expected = new Set(
    checked.assets.map((row) => path.basename(row.file)),
  );
  for (const name of await readdir(bundleRoot)) {
    if (!expected.has(name)) fail("Unexpected bundle entry");
    await regular(
      path.join(bundleRoot, name),
      name === checked.descriptor.archive.path
        ? RELEASE_LIMITS.archive
        : RELEASE_LIMITS.metadata,
    );
  }
  if (expected.size !== 5) fail("Exact five-asset transport bundle required");
  if (
    [
      "owned-windows-incremental-engine",
      WINDOWS_CAPSULE_ORIGIN,
      WINDOWS_OPERATION2_ORIGIN,
    ].includes(review.origin)
  ) {
    const packaged = records.package;
    if (
      packaged.archive?.path !== checked.descriptor.archive.path ||
      packaged.archive.sha256 !== checked.descriptor.archive.sha256 ||
      packaged.archive.size !== checked.descriptor.archive.size
    )
      fail("Original Windows package archive differs");
    for (const row of checked.assets.filter(
      (row) => row.name !== "runtime.json",
    ))
      if (
        !packaged.metadataAndArchiveHashes.some(
          (pin) =>
            pin.path === row.name &&
            pin.sha256 === row.sha256 &&
            pin.bytes === row.size,
        )
      )
        fail("Original Windows package asset differs");
  }
  if (isLinuxIncrementalOrigin(review.origin)) {
    const packaged = records.package.facts;
    if (
      packaged.descriptorSha256 !== review.descriptorSha256 ||
      packaged.assets.length !== checked.assets.length ||
      checked.assets.some(
        (row) =>
          !packaged.assets.some(
            (p) =>
              p.name === row.name &&
              p.sha256 === row.sha256 &&
              p.size === row.size,
          ),
      )
    )
      fail("Incremental Linux five package assets differ");
  }
  const python = await realpath(review.python.path),
    pythonInfo = await regular(python, 64 * 1024 ** 2);
  if (
    python !== review.python.path ||
    pythonInfo.size !== review.python.size ||
    hash(await readFile(python)) !== review.python.sha256
  )
    fail("Reviewed Python executable mismatch");
  const base = await realpath(path.join(ROOT, ".artifacts")),
    destination = path.resolve(output ?? "");
  if (
    path.dirname(destination) !== base ||
    !/^owned-sdk-handoff-[a-f\d-]{36}$/.test(path.basename(destination))
  )
    fail("New immediate owned artifact child required");
  await mkdir(destination, { mode: 0o700 });
  if ((await realpath(destination)) !== destination)
    fail("Owned output alias forbidden");
  const sourceBytes = await readFile(
      path.join(bundleRoot, checked.descriptor.sourceLock.path),
    ),
    manifestBytes = await readFile(
      path.join(bundleRoot, checked.descriptor.manifest.path),
    );
  if (
    hash(sourceBytes) !== checked.descriptor.sourceLock.sha256 ||
    hash(manifestBytes) !== checked.descriptor.manifest.sha256
  )
    fail("Pinned metadata changed during local verification");
  const archive = path.join(bundleRoot, checked.descriptor.archive.path),
    manifestFile = path.join(destination, "manifest.json"),
    roundtrip = path.join(destination, "roundtrip");
  await writeFile(manifestFile, manifestBytes, { flag: "wx" });
  const env = {
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  await exec(
    python,
    [
      "-I",
      "-B",
      path.join(ROOT, "scripts/lib/extract-custom-runtime.py"),
      archive,
      roundtrip,
      manifestFile,
      review.target,
      checked.descriptor.sdk.archiveRoot,
      String(RELEASE_LIMITS.expanded),
      String(RELEASE_LIMITS.members),
    ],
    { env, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 ** 2 },
  );
  const sdk = path.join(roundtrip, checked.descriptor.sdk.archiveRoot),
    sourceLock = validateSourceLock(JSON.parse(sourceBytes)),
    manifest = JSON.parse(manifestBytes);
  const preflight = await preflightCustomRuntime({
    sourceLock,
    manifest,
    target: review.target,
    artifactRoot: bundleRoot,
    sdkRoot: sdk,
  });
  const library = path.join(
    sdk,
    review.target.includes("windows") ? "libcef.dll" : "libcef.so",
  );
  await inspectNativeBinary(library, review.target);
  await inspectCustomRuntimeExports(
    library,
    review.target,
    sourceLock.bridge.patchId,
  );
  const engineSha256 = hash(await readFile(library));
  if (isLinuxIncrementalOrigin(review.origin)) {
    const packaged = records.package.facts;
    if (packaged.sdkFiles !== preflight.filesVerified)
      fail("Incremental Linux SDK inventory differs");
    for (const [name, pin] of [
      ["libcef.so", packaged.engine],
      ["chrome-sandbox", packaged.sandbox],
    ]) {
      const bytes = await readFile(path.join(sdk, name));
      if (bytes.length !== pin.size || hash(bytes) !== pin.sha256)
        fail("Incremental Linux packaged output differs");
    }
  }
  if (provenance.engineSha256 && provenance.engineSha256 !== engineSha256)
    fail("Transport engine differs from original Windows build evidence");
  if (
    [
      "owned-windows-incremental-engine",
      WINDOWS_CAPSULE_ORIGIN,
      WINDOWS_OPERATION2_ORIGIN,
    ].includes(review.origin)
  ) {
    if (records.package.sdkFiles !== preflight.filesVerified)
      fail("Original Windows SDK inventory differs");
    for (const [original, packaged] of [
      ["bootstrap.exe", "bootstrap.exe"],
      ["bootstrapc.exe", "bootstrapc.exe"],
      ["libcef.dll.lib", "libcef.lib"],
    ]) {
      const pin = (
        isWindowsCapsuleOrigin(review.origin)
          ? (review.origin === WINDOWS_OPERATION2_ORIGIN
              ? records.engine.operation
              : records.engine.engine
            ).outputs
          : records.symbols.files
      ).find(
        (row) =>
          (isWindowsCapsuleOrigin(review.origin) && row.path === original) ||
          row.path.replaceAll("\\", "/").endsWith("/" + original),
      );
      const bytes = await readFile(path.join(sdk, packaged));
      if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256)
        fail("Original Windows output differs from SDK");
    }
  }
  const result = {
    kind: "sorng-cef-owned-sdk-handoff",
    schemaVersion: 1,
    target: review.target,
    sourceLockIdentity: checked.identity.sourceLockSha256,
    bundleSourceLockRawSha256: checked.descriptor.sourceLock.sha256,
    originalInputsSourceLockRawSha256: verifiedInputs.rawSha256,
    descriptorSha256: review.descriptorSha256,
    assets: checked.assets.map(({ name, sha256, size }) => ({
      name,
      sha256,
      size,
    })),
    provenance,
    reviewBinding: ownedHandoffReviewBinding(review),
    engineSha256,
    filesVerified: preflight.filesVerified,
    archiveSdkRelationship: "extracted-and-inventory-verified",
    verificationScope: plan.verificationScope,
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
  };
  await writeFile(
    path.join(destination, "handoff.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
}

export async function readOwnedSdkReview(file) {
  const resolved = await realpath(file);
  await regular(resolved, 1024 * 1024);
  const review = JSON.parse(await readFile(resolved, "utf8"));
  ownedSdkHandoffPlan(review);
  return review;
}
