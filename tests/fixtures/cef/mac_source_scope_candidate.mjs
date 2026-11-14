// Immutable source-review input only; never production admission.
const freeze = value => { if(value && typeof value === "object") { for(const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export const CANDIDATE = freeze({
  "kind": "held-unqualified-mac-source-scope-candidate",
  "originalFreezeSha256": "fcaa57ca06d5f28e1c6ed62ab01d292249c1fdab1a94949e39cc7d21e90ebb33",
  "producer": "119f2ff904c4ba95fe7b9fcd88ce49a465645c555f85f16d725d48ee2f8ddd10",
  "producerRows": 132,
  "sourceFiles": [
    {
      "path": ".github/workflows/cef-engineering-checkpoint.yml",
      "mode": "100644",
      "bytes": 14907,
      "sha256": "b1a6f2dc111b98ef5f32f6b93b10c9903590e70724b5c6cdf834b82f91dc046c",
      "blob": "789e02bf35ed2ba804a3bfbe2dd7004a01b19e59"
    },
    {
      "path": "scripts/lib/browser-custom-runtime.mjs",
      "mode": "100644",
      "bytes": 69587,
      "sha256": "2d9e61905cb38b34be4fc5af0eec0ad7119b3a3095e183004f17b418d145cf4e",
      "blob": "8c5e8ac65953f0b92524655dd927f3091ec1f6a5"
    },
    {
      "path": "scripts/lib/cef-checkpoint-archive.py",
      "mode": "100644",
      "bytes": 240123,
      "sha256": "355b00a74ffdacf8d92bd4c39dc52e69ad8f944689ea287d474008c5478c7662",
      "blob": "92c95b17e0caa80b6038cac74345d6dd81e02bb8"
    },
    {
      "path": "scripts/lib/cef-engineering-checkpoint.mjs",
      "mode": "100644",
      "bytes": 257531,
      "sha256": "32bd6e5b8fa5be0197f71dec9e23d87d225e8d0ad361818ab865e0d2f581bdee",
      "blob": "0fc69ae7455d69582716d4a9dd7efbe663f96e9b"
    },
    {
      "path": "scripts/lib/cef-mac-gcs-normalize.py",
      "mode": "100644",
      "bytes": 11223,
      "sha256": "b09e8fcc30410817ebc25bf0f33f3ec5d62449f6726881495d81df990b840ed5",
      "blob": "e6a2834029ad5b819a47586d313bae9e6f0ff12d"
    },
    {
      "path": "scripts/lib/cef-mac-process-census.py",
      "mode": "100644",
      "bytes": 24586,
      "sha256": "1ece896e7e336ce27b1691b707a164bf4f9d0ea989e0ff8ac35813520b6b9b8e",
      "blob": "0ac9e4b9e981389b49d4ea1d5c4788dc61de1170"
    },
    {
      "path": "scripts/lib/cef-mac-source-metadata.mjs",
      "mode": "100644",
      "bytes": 52286,
      "sha256": "cc7ba6ab544b5e800bbe95a83d4af90e9bfe9654544ee0373377d048580a7ed4",
      "blob": "cb1d57c827f03781b5ad92ae3357b2800a7369c5"
    }
  ],
  "nativeInputFiles": [
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/cef-ci-runner-x86_64-apple-darwin.json",
      "mode": "100644",
      "bytes": 727,
      "sha256": "f82ad8fd76b63d16938ede7b14d1d09515a7dbb26be4180a6f74ce0827bb5b55",
      "blob": "b4facf9e79979ce858ca0f9c54d2bd65c78e49f1"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/gn/x86_64-apple-darwin.gn",
      "mode": "100644",
      "bytes": 341,
      "sha256": "817383bba38b84601551d7dc7d5f7ea0e3f67ed6b7ca13eb3ddbbca001e5cc61",
      "blob": "9278f409dd02742e6171c77c188f1787424ae65e"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/include/cef_sorng_tls_bridge.h",
      "mode": "100644",
      "bytes": 8886,
      "sha256": "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
      "blob": "e193c8a7675453f9193e11cee06041ff29ee339b"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0001-chromium-socket-admission.patch",
      "mode": "100644",
      "bytes": 37160,
      "sha256": "b347abc666cc693c7ada52b2ba31ad69e1d2f67541ca0a4684ea868fdff4a876",
      "blob": "6d8879183dc307029d68344cc317bd3b48340262"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0002-cef-native-bridge.patch",
      "mode": "100644",
      "bytes": 31384,
      "sha256": "0f2592f560ccd7045376485ba37753f171ad4cf18ca3a3bd9cabb9a1ac340653",
      "blob": "854af95024076b0bc75812cb14e020d6b29fac14"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0003-cef-native-widget-lifetime.patch",
      "mode": "100644",
      "bytes": 791,
      "sha256": "ea26cd554faa7991303ae85118313538b15d16d77b7436a9b4186fbc233cf540",
      "blob": "986bf552a95975ad8fc94e09dea924787c2a6f76"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0004-chromium-soda-provisioning.patch",
      "mode": "100644",
      "bytes": 4538,
      "sha256": "426d95532f3ff8f0c4f5e3d46cc0b3ff77f300bdcb2d853e02b1404b2c013482",
      "blob": "2878004dc8c9a6cc25973e52495e10529c8ed01a"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0005-chromium-proxy-route-probe.patch",
      "mode": "100644",
      "bytes": 3539,
      "sha256": "094770e23077c0791536a579e7bdec43b47fd0de4839ebf1514fb99fc135f810",
      "blob": "6222c580821a468ac36e208877564d39ba48bd45"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0006-cef-explicit-download-destination.patch",
      "mode": "100644",
      "bytes": 1010,
      "sha256": "f1bac1adce80ff7afdf0abefd01546244a1e403bbad6b48d5fd68c214b87c813",
      "blob": "16b0aad55b318e99bb1ce25d4ac42a32da2333ec"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0007-chromium-instance-tracer-reentrancy.patch",
      "mode": "100644",
      "bytes": 997,
      "sha256": "3d3940a4f45b81739aab3735fbea41ee8f485ad89382bbec6340a7b694f04c78",
      "blob": "f83f42c7dda0ece61b82cb7a1d73945eac855d27"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0008-chromium-same-authority-http2.patch",
      "mode": "100644",
      "bytes": 4125,
      "sha256": "4d2625adae0ba7e3268bd4e21fa789a42f1dab57a15432fae1d4577ac6533103",
      "blob": "93243b764403a1d11b5dd99920531c0a4fce420c"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0009-cef-http2-bridge-capability.patch",
      "mode": "100644",
      "bytes": 1972,
      "sha256": "321ad6e827dfb596033b622a76a41b9f616f7fecd496ddb3864b5fa07ef0dec8",
      "blob": "ae3a956a93dde3bb6504c4bcdb88fc7416575c52"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0010-chromium-proxy-application-ack.patch",
      "mode": "100644",
      "bytes": 14590,
      "sha256": "ab48a00f1c71e2d2893d0169c7f0828252d813df2227062b0e7ca9275dc93a55",
      "blob": "1d20a650e04e0dff15ea11b01b5235c28fa010ad"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0011-cef-proxy-application-ack.patch",
      "mode": "100644",
      "bytes": 10759,
      "sha256": "7148edbb12fe1459a073b9eacd09dea35261f68911d6c9f5e03a3f379e7aaec0",
      "blob": "5c3fe42dd750c8c4cc257da9f6b63fd1afbc0cda"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0012-cef-registration-retirement.patch",
      "mode": "100644",
      "bytes": 20195,
      "sha256": "dd863571d99103cf53a90806f1aa4d3b3ba9b141ff082a2e7ae74796cb7ab699",
      "blob": "722b153d51e323e497fe923d4992d65c0711e9eb"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0013-chromium-owned-quic-datagrams.patch",
      "mode": "100644",
      "bytes": 75101,
      "sha256": "d375f771044af74c879b813f18ff78eb795557de81012c9bc6cb1ae79c8681d7",
      "blob": "0e1bcd040664874d871a723b208f9b3ce8d83d42"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0014-cef-owned-quic-datagrams.patch",
      "mode": "100644",
      "bytes": 9374,
      "sha256": "684a8d9ee4e9893f3e1d73e7a5cb830be89965a4bf39d0c8eb70554bcb01fc1c",
      "blob": "5201950b1d2c673c405ea53a7d10a748e45c3115"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0015-chromium-owned-quic-job-selection.patch",
      "mode": "100644",
      "bytes": 8020,
      "sha256": "8addfe231b195d1d2e3c0f153acd2ceeb9f5d820f661684ed08a51d826b11da7",
      "blob": "dc01496e9c61a4255b0e575669454fe9cdc9935e"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0016-chromium-owned-quic-payload-advertisement.patch",
      "mode": "100644",
      "bytes": 8213,
      "sha256": "38332555b0adfedbbffd0f5c911e21748467726b1fdcbf3c36a6ebdb95ed2eb7",
      "blob": "9d10f5e6f75a5378cbcdf12528f812dd282c9062"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
      "mode": "100644",
      "bytes": 22799,
      "sha256": "b205aaa31e25efa35e54bf56b929caf21208c4e6fbb95f23ac3f46d9123c4858",
      "blob": "8e84f40fa415eafc11409fe966d08a5926287051"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0018-chromium-owned-capsule-context-lifetime.patch",
      "mode": "100644",
      "bytes": 21463,
      "sha256": "64b0c79cf40284dba8b93ee47fd3268d827a71b09860895c2770666296b4b383",
      "blob": "854a35aacd3b193e12391c992b27d5b68a769d66"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
      "mode": "100644",
      "bytes": 605,
      "sha256": "d1b39acf848e568ef5067962e53f4075eaca1e49582ee726a7dcf65d94af796c",
      "blob": "2ca58f8189f22c71733a018636a82e07a85c7198"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
      "mode": "100644",
      "bytes": 354,
      "sha256": "bf93af98eaad7094ce577e2365f107ba0b8f4a95647b77cb6d9fec3a04de4708",
      "blob": "d6adad5dbc637b08625fcdf9ecd99830ea7837cd"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
      "mode": "100644",
      "bytes": 379,
      "sha256": "4e3f863eb29766541197d1e095e0a42d0728f3487e63e5bfad43cdb674210fd6",
      "blob": "a5fb46e2ae342aacf61619c85c54e2ceae31f4fa"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0022-chromium-test-trace-processor-static-package-name.patch",
      "mode": "100644",
      "bytes": 845,
      "sha256": "1177f9414d305a0f0d1edddc9b788813c220a6b44e741a6cfd39b737c4e6fc6e",
      "blob": "affa81d8579c8171f304220ccd0b8af4819a94fe"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0023-webrtc-macos-legacy-capture-deprecation-compat.patch",
      "mode": "100644",
      "bytes": 1461,
      "sha256": "aefd044086fdf0ba24965eb716981a7428fa8fc8b6fd68a441934d11b9d63e91",
      "blob": "63ee13eb29fc54121b8813269254a5fed74d98f5"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/patches/0024-chromium-macos-permissions-deployment-compat.patch",
      "mode": "100644",
      "bytes": 734,
      "sha256": "d7578f12bdcc4de2d3f19d2a82f499991029c1dd2959857a33d373b6519b0327",
      "blob": "281ce12b1166fefae04cf6df4ff7228e43ef5f29"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/review-receipt.json",
      "mode": "100644",
      "bytes": 6446,
      "sha256": "c5c81302b18745e747f25588ee1e7a56a256c960e5a4febdef218f4e0ea28825",
      "blob": "b2d30721a69cd6ea97e83f4d491d77ad8e214991"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/source-lock.json",
      "mode": "100644",
      "bytes": 6367,
      "sha256": "f33f8af2d15766f3901d741d41d139b405a46864308a424e50edc973c96a46f7",
      "blob": "b03d790c3a218693db3296f966b7b099af87ef87"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macintel-sdk26-2-permissions-compat/tools/x86_64-apple-darwin.json",
      "mode": "100644",
      "bytes": 2335,
      "sha256": "32e553eec642b16d9be1662e71a7120a754ba02bb658e741d879fbe1cf1cd7e5",
      "blob": "ec098fe2dd5b07008f90439a63035b97751c6329"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/cef-ci-runner-aarch64-apple-darwin.json",
      "mode": "100644",
      "bytes": 722,
      "sha256": "d7667c93c6e5449e3765169a170bb72cca6916c86b5a83f687462ad057736af4",
      "blob": "e144135315b71d81ce311b8b132211eb257bab7a"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/gn/aarch64-apple-darwin.gn",
      "mode": "100644",
      "bytes": 343,
      "sha256": "bf830e0c15789d4a873fc451661fd484865c54cdffb6b64cf8c2c2ad9fa4d94e",
      "blob": "c56ef5119474a682bac49d17bd2e699ef045a4e7"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/include/cef_sorng_tls_bridge.h",
      "mode": "100644",
      "bytes": 8886,
      "sha256": "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
      "blob": "e193c8a7675453f9193e11cee06041ff29ee339b"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0001-chromium-socket-admission.patch",
      "mode": "100644",
      "bytes": 37160,
      "sha256": "b347abc666cc693c7ada52b2ba31ad69e1d2f67541ca0a4684ea868fdff4a876",
      "blob": "6d8879183dc307029d68344cc317bd3b48340262"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0002-cef-native-bridge.patch",
      "mode": "100644",
      "bytes": 31384,
      "sha256": "0f2592f560ccd7045376485ba37753f171ad4cf18ca3a3bd9cabb9a1ac340653",
      "blob": "854af95024076b0bc75812cb14e020d6b29fac14"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0003-cef-native-widget-lifetime.patch",
      "mode": "100644",
      "bytes": 791,
      "sha256": "ea26cd554faa7991303ae85118313538b15d16d77b7436a9b4186fbc233cf540",
      "blob": "986bf552a95975ad8fc94e09dea924787c2a6f76"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0004-chromium-soda-provisioning.patch",
      "mode": "100644",
      "bytes": 4538,
      "sha256": "426d95532f3ff8f0c4f5e3d46cc0b3ff77f300bdcb2d853e02b1404b2c013482",
      "blob": "2878004dc8c9a6cc25973e52495e10529c8ed01a"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0005-chromium-proxy-route-probe.patch",
      "mode": "100644",
      "bytes": 3539,
      "sha256": "094770e23077c0791536a579e7bdec43b47fd0de4839ebf1514fb99fc135f810",
      "blob": "6222c580821a468ac36e208877564d39ba48bd45"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0006-cef-explicit-download-destination.patch",
      "mode": "100644",
      "bytes": 1010,
      "sha256": "f1bac1adce80ff7afdf0abefd01546244a1e403bbad6b48d5fd68c214b87c813",
      "blob": "16b0aad55b318e99bb1ce25d4ac42a32da2333ec"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0007-chromium-instance-tracer-reentrancy.patch",
      "mode": "100644",
      "bytes": 997,
      "sha256": "3d3940a4f45b81739aab3735fbea41ee8f485ad89382bbec6340a7b694f04c78",
      "blob": "f83f42c7dda0ece61b82cb7a1d73945eac855d27"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0008-chromium-same-authority-http2.patch",
      "mode": "100644",
      "bytes": 4125,
      "sha256": "4d2625adae0ba7e3268bd4e21fa789a42f1dab57a15432fae1d4577ac6533103",
      "blob": "93243b764403a1d11b5dd99920531c0a4fce420c"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0009-cef-http2-bridge-capability.patch",
      "mode": "100644",
      "bytes": 1972,
      "sha256": "321ad6e827dfb596033b622a76a41b9f616f7fecd496ddb3864b5fa07ef0dec8",
      "blob": "ae3a956a93dde3bb6504c4bcdb88fc7416575c52"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0010-chromium-proxy-application-ack.patch",
      "mode": "100644",
      "bytes": 14590,
      "sha256": "ab48a00f1c71e2d2893d0169c7f0828252d813df2227062b0e7ca9275dc93a55",
      "blob": "1d20a650e04e0dff15ea11b01b5235c28fa010ad"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0011-cef-proxy-application-ack.patch",
      "mode": "100644",
      "bytes": 10759,
      "sha256": "7148edbb12fe1459a073b9eacd09dea35261f68911d6c9f5e03a3f379e7aaec0",
      "blob": "5c3fe42dd750c8c4cc257da9f6b63fd1afbc0cda"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0012-cef-registration-retirement.patch",
      "mode": "100644",
      "bytes": 20195,
      "sha256": "dd863571d99103cf53a90806f1aa4d3b3ba9b141ff082a2e7ae74796cb7ab699",
      "blob": "722b153d51e323e497fe923d4992d65c0711e9eb"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0013-chromium-owned-quic-datagrams.patch",
      "mode": "100644",
      "bytes": 75101,
      "sha256": "d375f771044af74c879b813f18ff78eb795557de81012c9bc6cb1ae79c8681d7",
      "blob": "0e1bcd040664874d871a723b208f9b3ce8d83d42"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0014-cef-owned-quic-datagrams.patch",
      "mode": "100644",
      "bytes": 9374,
      "sha256": "684a8d9ee4e9893f3e1d73e7a5cb830be89965a4bf39d0c8eb70554bcb01fc1c",
      "blob": "5201950b1d2c673c405ea53a7d10a748e45c3115"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0015-chromium-owned-quic-job-selection.patch",
      "mode": "100644",
      "bytes": 8020,
      "sha256": "8addfe231b195d1d2e3c0f153acd2ceeb9f5d820f661684ed08a51d826b11da7",
      "blob": "dc01496e9c61a4255b0e575669454fe9cdc9935e"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0016-chromium-owned-quic-payload-advertisement.patch",
      "mode": "100644",
      "bytes": 8213,
      "sha256": "38332555b0adfedbbffd0f5c911e21748467726b1fdcbf3c36a6ebdb95ed2eb7",
      "blob": "9d10f5e6f75a5378cbcdf12528f812dd282c9062"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
      "mode": "100644",
      "bytes": 22799,
      "sha256": "b205aaa31e25efa35e54bf56b929caf21208c4e6fbb95f23ac3f46d9123c4858",
      "blob": "8e84f40fa415eafc11409fe966d08a5926287051"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0018-chromium-owned-capsule-context-lifetime.patch",
      "mode": "100644",
      "bytes": 21463,
      "sha256": "64b0c79cf40284dba8b93ee47fd3268d827a71b09860895c2770666296b4b383",
      "blob": "854a35aacd3b193e12391c992b27d5b68a769d66"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
      "mode": "100644",
      "bytes": 605,
      "sha256": "d1b39acf848e568ef5067962e53f4075eaca1e49582ee726a7dcf65d94af796c",
      "blob": "2ca58f8189f22c71733a018636a82e07a85c7198"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
      "mode": "100644",
      "bytes": 354,
      "sha256": "bf93af98eaad7094ce577e2365f107ba0b8f4a95647b77cb6d9fec3a04de4708",
      "blob": "d6adad5dbc637b08625fcdf9ecd99830ea7837cd"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
      "mode": "100644",
      "bytes": 379,
      "sha256": "4e3f863eb29766541197d1e095e0a42d0728f3487e63e5bfad43cdb674210fd6",
      "blob": "a5fb46e2ae342aacf61619c85c54e2ceae31f4fa"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0022-chromium-test-trace-processor-static-package-name.patch",
      "mode": "100644",
      "bytes": 845,
      "sha256": "1177f9414d305a0f0d1edddc9b788813c220a6b44e741a6cfd39b737c4e6fc6e",
      "blob": "affa81d8579c8171f304220ccd0b8af4819a94fe"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0023-webrtc-macos-legacy-capture-deprecation-compat.patch",
      "mode": "100644",
      "bytes": 1461,
      "sha256": "aefd044086fdf0ba24965eb716981a7428fa8fc8b6fd68a441934d11b9d63e91",
      "blob": "63ee13eb29fc54121b8813269254a5fed74d98f5"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/patches/0024-chromium-macos-permissions-deployment-compat.patch",
      "mode": "100644",
      "bytes": 734,
      "sha256": "d7578f12bdcc4de2d3f19d2a82f499991029c1dd2959857a33d373b6519b0327",
      "blob": "281ce12b1166fefae04cf6df4ff7228e43ef5f29"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/review-receipt.json",
      "mode": "100644",
      "bytes": 6448,
      "sha256": "088c6da818e750e4b13dd6e5812ce35ec81bbd9e4d1101f5caee618017864da0",
      "blob": "19845a08e2f11d3a8cbd96a50f7b125a2a45d108"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/source-lock.json",
      "mode": "100644",
      "bytes": 6370,
      "sha256": "9ceabf1338df7d31caffdc4e53ae60cac8f2b5c53d09927a03aff6ac045fa1fb",
      "blob": "1762d6355ca94357cb0c1148e8e2cc1591beef66"
    },
    {
      "path": "native/cef-build-inputs/20261114-r5-owned-http3-macarm-sdk26-2-permissions-compat/tools/aarch64-apple-darwin.json",
      "mode": "100644",
      "bytes": 2337,
      "sha256": "962d466d216143c227207a410b5240cde0da234559e22b5a533ccf1d274d94ab",
      "blob": "e92f670e24c3a2f745fea1640da9c826fa1dd83b"
    }
  ],
  "sources": {
    "x86_64-apple-darwin": "c3ea924815d18c5e702a2231883b896f3439604b620a8b2c96983b0794a4ba0f",
    "aarch64-apple-darwin": "3dfd71cfafb56a4168917ec681252fdce1ce57cb224d277d159255a210062212"
  },
  "selectedRows": [
    {
      "mode": "100644",
      "type": "blob",
      "sha": "789e02bf35ed2ba804a3bfbe2dd7004a01b19e59",
      "path": ".github/workflows/cef-engineering-checkpoint.yml"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "60ade1ae01e833a5c291c47883bf26fb031f7727",
      "path": ".node-version"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "77ba6488a6f092856b705c477e7cf4084ff5390f",
      "path": "native/cef-hosted-recipe.json"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "22e31d24ab9b4731b1e5ca5b22878d3084d6f248",
      "path": "scripts/automation-repository.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "1522b41ad8788f2f9188ef488e49eac26c429659",
      "path": "scripts/browser-app-build.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a5c0a5a32171b833094a6a133c8fbd4b3bc8478e",
      "path": "scripts/browser-client-network-probe.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "23c88fcf52529959b0a4f0ca32cf2a1e0cf53f9d",
      "path": "scripts/browser-live.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "aa7b6a2e159312a3f500bd558647769e1d717b45",
      "path": "scripts/browser-readiness.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "5e0a21bd339d1101e0f323bccc1dc475b696fdc0",
      "path": "scripts/browser-runtime-native-ci.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "988ac8db981ffc8f9e05c1fc3cd9b193e4af0c8b",
      "path": "scripts/browser-runtime-package.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "30e1507084269bab38f6115107b45a225ef4b313",
      "path": "scripts/capture-login-page.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "cc161259f4ff6293493e21fff4eacf2608613cf9",
      "path": "scripts/catalog-icon-contact-sheet.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "f2785f6e944c6952d371106b80f7d6887152ecc0",
      "path": "scripts/cef-browser-acceptance.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "5720498c509aa86d2b4d22b0e96eac6fb17d3ed9",
      "path": "scripts/cef-custom-artifact-inventory.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "915139c7d545668bffe1003261a2379e09e067e3",
      "path": "scripts/cef-engineering-checkpoint.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "59ba20636a8c82e10016b660fbe5e2be748210cf",
      "path": "scripts/cef-hosted-bootstrap.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "2fb3903eb9bf9f582ccf1fd63cf7fbb5c558890b",
      "path": "scripts/cef-hosted-capacity.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9fb323d215e1d246f537685b360d3a665f87f748",
      "path": "scripts/cef-hosted-provision.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9d5d5222b00a86d7e60c82da7a1d8eafd29e4376",
      "path": "scripts/cef-linux-package-fixture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "fae71b6b76c4a1ba4631809d1e5b10a3a40c5c81",
      "path": "scripts/cef-owned-sdk-handoff.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "aa52f99b48d931a5735c4c03976b3f2cf1e4a4f7",
      "path": "scripts/cef-owned-sdk-import.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8549327fb78fc51fe9c0ef32217ac6c232b5b9f6",
      "path": "scripts/cef-owned-sdk-publish.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "616e5cf87ec9a0325d905738749f185bc36515db",
      "path": "scripts/cef-patched-runtime.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "70e03a09eabacb4f39a87883fff3910f947b0de9",
      "path": "scripts/cef-runtime-acceptance-ci.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "b723ed5e56a2f5d8c4122bf7193294cc09653525",
      "path": "scripts/cef-runtime-ci.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0046ae7e7674b0beefc2f25a48904d0d9098c251",
      "path": "scripts/cef-runtime-fetch.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "20b12544401b69495103a6864f5ce1cecfdf5133",
      "path": "scripts/ci/analyze-native-dependency-graph.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "579893859c71eba218b8d057c79050f32e608ca2",
      "path": "scripts/ci/audit_filter.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "07c99ba1ce84ea3d980b877c5ba27705e0b09823",
      "path": "scripts/ci/check-backend-coverage.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "1814e3307a87de501dff1c66b25996b87dd477be",
      "path": "scripts/ci/check-cargo-update-candidate.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "c9d2022462126973263c328c1cd1fa2c9f3554a5",
      "path": "scripts/ci/check-docs-links.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "1226702dbaf18afeed1a8f3936c4880de017bcd2",
      "path": "scripts/ci/check-frontend-cold-bundle.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8f002d7e4478a09a09c7fe523d490d715e144266",
      "path": "scripts/ci/check-gif-worker-export.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a7f2b69d8b804f8eb6672bcbdfa095b73b607695",
      "path": "scripts/ci/check-js-lock-parity.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "e6a8a9ad733c94b8e29f0b0c13d4a5e60e7ad966",
      "path": "scripts/ci/check-npm-audit.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "c54b69df1bd39591c6ddfdd135aa49864bb90da2",
      "path": "scripts/ci/check-release-runtime-catalog.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d830e025f60687fa5b1d3a6b6736eebfcac2c540",
      "path": "scripts/ci/check-release-version-floor.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "6c478768f06ac8ed663ce800a01c3cfaf2d4a042",
      "path": "scripts/ci/diagnose-macos-cef-tests.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "71f74176d81fb9e1f077bc29d55f305e58b47420",
      "path": "scripts/ci/e2e-http-fixtures.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3638c1a6f3dcc889b58d015e9fad16f60e758f78",
      "path": "scripts/ci/e2e-npm-fixture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "e2fbf0b02f37f4d3f05969b16390e59a3667c6e8",
      "path": "scripts/ci/e2e-portainer-fixture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "c6898f29664586368c9c6cc9277b8d7f4b437dab",
      "path": "scripts/ci/lib/docs-search-validation.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "48b32403c8527f8d422991c420e06defc1d6e696",
      "path": "scripts/ci/resolve-release-version.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d6c02b3490303d27961d1a940883705f99a1d592",
      "path": "scripts/ci/run-release-native-build.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a42ba21a31d4d82efd6f1f9a2bfa065a09654f63",
      "path": "scripts/ci/semver.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "658b9b5e4bbaa28ea318c7e2229d91cfdf9e0dae",
      "path": "scripts/ci/summarize-native-build-timings.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9ff38882ad2c68ba94f0fb398aeb3e1ea733810c",
      "path": "scripts/ci/update-npm-compatible.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "abcc7f30998e186f362c779998301941e5af10f7",
      "path": "scripts/ci/validate-release-artifacts.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "264b762f10a6a54748e2a05bcc9974dc4cbb91e4",
      "path": "scripts/ci/validate-updater-feed.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9667feb690df30492faea80da379d5a6a80f182b",
      "path": "scripts/ci/verify-published-release-assets.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d702ef59b0b71e18437f186e98c3e24b5191a676",
      "path": "scripts/ci/verify-release-snapshot.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "c0e465f7e1f4e2047d36b9bce9a53ce730ea7623",
      "path": "scripts/ci/wait-for-release-readiness.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "bea75fda8491a0df11a1fa76aa062a5eea7b8dbe",
      "path": "scripts/crypto/generate-database-eax-vectors.ps1"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "6db3eb880621234ff1d78fa41285b726f0e75ba4",
      "path": "scripts/database-ui-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "755df5ea02747e526b3ecc92e8f574c29dfeb04e",
      "path": "scripts/dev-port.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "ced531d4c9db02fbbf47c0280080da28356ee80b",
      "path": "scripts/dev-server.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "b23555fe7903dfcb973e5d9cf31140f323012d8d",
      "path": "scripts/docs-app-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "38b182cc3bafbaf5804e47c56ca7e1b1734e258c",
      "path": "scripts/docs-visual-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "553db2a542fb5e57fb20a4a0d0e7003524cabbf0",
      "path": "scripts/e2e-build.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "348838a05d8fe3d4fd733c2a450a3fbb4de9fea0",
      "path": "scripts/e2e-isolation-selftest.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "dc474484165bba46ec7f275c6209fc0f18610a69",
      "path": "scripts/folder-icon-contact-sheet.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "cd1780bd4f2e5885d490ddd3c9e79acc05d85012",
      "path": "scripts/format-changed.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3ef1b0f7d2185004f943d1b7892f1017bdecb253",
      "path": "scripts/generate-command-inventory.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "68d09236558e77dc1798bd644abe46dfa9bc928b",
      "path": "scripts/generate-native-login-catalog.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "00d1e401e7a7fc5d27268b7236e08690f1e6c31d",
      "path": "scripts/i18n-residual.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9b421f1da96f4c8223f3f7b088204ad494fbf578",
      "path": "scripts/icon-ui-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3fb21b9fcd4d5e36deb6c206c3c2cf0d2be8c82a",
      "path": "scripts/lib/browser-build-route.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "12e5fe39389938587468849ac095b6c6493f8da0",
      "path": "scripts/lib/browser-client-imports.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8c5e8ac65953f0b92524655dd927f3091ec1f6a5",
      "path": "scripts/lib/browser-custom-runtime.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "806f4feb6a61e84c0a4426d7f1df51396bbe9f4b",
      "path": "scripts/lib/browser-dev-sdk-cache.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "57279a8dabf84605a9783f388210eed4554827e9",
      "path": "scripts/lib/browser-installer-bundles.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "fe6fba4493b9265823a71a0a6445ad41cdccd708",
      "path": "scripts/lib/browser-local-runtime.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0db85b14d4266af86c04eb27dab97359a416c879",
      "path": "scripts/lib/browser-runtime-bootstrap.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "4f5591f6400a1b84cdd2b4c07108ed9ccb59e4a9",
      "path": "scripts/lib/browser-runtime-release.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "eb3a022a7a3c0ad0084f595a654929a4101983bc",
      "path": "scripts/lib/browser-sandbox-access.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "92c95b17e0caa80b6038cac74345d6dd81e02bb8",
      "path": "scripts/lib/cef-checkpoint-archive.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0fc69ae7455d69582716d4a9dd7efbe663f96e9b",
      "path": "scripts/lib/cef-engineering-checkpoint.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "4d216379902e002fe80cf99e07858b622def5bf8",
      "path": "scripts/lib/cef-linux-producer-migration.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8041a411ff3ae9ce3c8b55ddb1cfe0eb3a4b4471",
      "path": "scripts/lib/cef-linux-sidecar-retirement.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "e6a2834029ad5b819a47586d313bae9e6f0ff12d",
      "path": "scripts/lib/cef-mac-gcs-normalize.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0ac9e4b9e981389b49d4ea1d5c4788dc61de1170",
      "path": "scripts/lib/cef-mac-process-census.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8e3e081cfe40fee9ff865b5699b47bfc9a6184ef",
      "path": "scripts/lib/cef-mac-sdk-inventory.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "cb1d57c827f03781b5ad92ae3357b2800a7369c5",
      "path": "scripts/lib/cef-mac-source-metadata.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "4ded0956ee5732222a22c96df40bc40dbee62a30",
      "path": "scripts/lib/cef-native-crash-summary.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3fb062fc081d9a974f841f22a28068059a2a8550",
      "path": "scripts/lib/cef-owned-sdk-handoff.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "369c93b265d65416934865d8a5f0b9c1f62e22d7",
      "path": "scripts/lib/cef-owned-sdk-import.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a53f9d122bf11263745de9f741a13dbbe51aba3c",
      "path": "scripts/lib/cef-owned-sdk-publish.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9580b3fb662eb0b26e9bb2bf897d7c037c4c743c",
      "path": "scripts/lib/cef-storage-acceptance.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "25527fc6303adf9638de3cee72ee989da42e1066",
      "path": "scripts/lib/cef-windows-arm-sdk-origin.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a262d43203010c6feb1e28950040ecf1564b9248",
      "path": "scripts/lib/command-inventory.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d37431b0b46f82c1183f9cc52245cb2223de89c2",
      "path": "scripts/lib/core-command-groups.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "fdc4c6673227cca6d9036d9842fac9891ce193e6",
      "path": "scripts/lib/dev-build-budget.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9e6c3fa95f776b5e542bba35134d493ba98de3d7",
      "path": "scripts/lib/e2e-profile-isolation.d.mts"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "1ddca465468f9b6eb7550d5c6fa10ec1e8ea3844",
      "path": "scripts/lib/e2e-profile-isolation.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "95f02a1b2467bf726b083a309177c58aa8897c0f",
      "path": "scripts/lib/extract-custom-runtime.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "7c42e96ed0c50eb4b5dcbfc58d3cbf097f1ddee7",
      "path": "scripts/lib/linux-package-sandbox.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "8c70b2dda58d7841b1fb5444f88fa25be0d08d0a",
      "path": "scripts/lib/native-child-env.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "7a61eaf64f89ce5f6d824551fc541b9c8716a73b",
      "path": "scripts/lib/windows-native-crash-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0be899cc5030ef456be2e52f0d29a91c1aeb21c8",
      "path": "scripts/lib/windows-openssl-env.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9c7500a5f973afc85aa1240be166426628587226",
      "path": "scripts/native-build-env.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "adb8fdfcdaddac32a58a17ca637b67d213d2cf7a",
      "path": "scripts/native-target.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "37b729490bbc2d337217b17e529145756abda94b",
      "path": "scripts/native/browser-app-plist.py"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d1b82bdb1d8c88da48257e12dc22231983fac3be",
      "path": "scripts/native/browser-cargo-runner.rs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "624444b6dbbd5b7b678429741f3040cd97c2e78c",
      "path": "scripts/native/repair-browser-sandbox-access.ps1"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "1af8438246326956c285ca721093cf4fcc8b73e8",
      "path": "scripts/provider-icons-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "6ad9a56649aff470f4431a501421da2b914ce79d",
      "path": "scripts/readme-screenshot-validation.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "fd113092504ee5c3440fe2fa39cbcd71ca15d810",
      "path": "scripts/readme-screenshot.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "2e129e26927037109abad8996f5e71ca0da7dbe5",
      "path": "scripts/softether-e2e-down.ps1"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "090f7e0ee6e2a4335dd1a5b77bb0e828b09ccee7",
      "path": "scripts/softether-e2e-down.sh"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "16114fc39008314fa34280bf8b6c67855cef559d",
      "path": "scripts/sort-core-command-groups.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "b7b5717eded1d9f05bc9e02f9b9a01ffa7b0e24c",
      "path": "scripts/spreadsheet-ui-check.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "e28b78e4d2bda5e5d8e24a8bc7a336bfdee1bf81",
      "path": "scripts/stage-file-viewer-host.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "c529782fbb8b5915053f4ec0ff0b9954bfc216e1",
      "path": "scripts/stage-openh264-runtime.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "ad986a3a438a6ab21d59957f7701cd029f8d8f58",
      "path": "scripts/stage-windows-native-runtime.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "a2529556eae07dc2ae6192296fcbe56cceccfd92",
      "path": "scripts/styled-english-locales.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "b169695faff2b8e34340b20362e886a4b3c08b6e",
      "path": "scripts/sync-brand-icons.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0e0fbf1f73aa63bf8093cff34ba60ab5e9d92bd6",
      "path": "scripts/sync-js-deps.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "af51e4437a6bb1d1e4e481a4a2be0ee11d3ae832",
      "path": "scripts/sync-version.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "f81ddd2150198a8362ab5510e124dba7390dce7a",
      "path": "scripts/tauri-dev.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d4d7819293430603f3c46f2b3e7c14af54777cfe",
      "path": "scripts/tauri.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3cabbaa847327de9ac8caa4c7cecb7cf0e9832aa",
      "path": "scripts/test-legacy-web-compat-browser.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "0169c0728bb49f4961a34732ae72e1051a386145",
      "path": "scripts/test-synology-login-browser.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "127af7cf77c86525bc6ad561145ca78e18348dad",
      "path": "scripts/test-vault-ssh-inline.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "580c5832a695bfc7f068d203d8b1ddb8eeff57cc",
      "path": "scripts/test-web-network-browser.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "d1b6b5138e89f2215476f57cf432b018bdd942a0",
      "path": "scripts/test-website-dark-mode-browser.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "9c26ad336cc66c956eb4ea2e3815dffdbab264e4",
      "path": "scripts/test-yealink-login-browser.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "e30f7ec547a03efbdcd448dc78a9c395721b1519",
      "path": "scripts/trace-provider-icons.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "062a26cdb05d692f347d28772c1613398df408b2",
      "path": "scripts/trust-ui-capture.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "19541ed4fff8d24537d059748ea0655173e67b7e",
      "path": "scripts/vendor-web-darkreader.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "303feb0be3a88e30c575be88157640621322e6e5",
      "path": "scripts/versioning.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "5d203492eb36a8b3354182b3e66fd7e0402d7e12",
      "path": "scripts/viewport-scroll-check.mjs"
    },
    {
      "mode": "100644",
      "type": "blob",
      "sha": "3f51e0714aae592fdcecf2b72af6fe8be9ac7211",
      "path": "scripts/web-automation-capture.mjs"
    }
  ]
});
