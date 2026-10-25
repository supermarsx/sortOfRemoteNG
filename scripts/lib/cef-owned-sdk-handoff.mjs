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
  "existing-windows-package": "x86_64-pc-windows-msvc",
  "owned-windows-incremental-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-operation2": "x86_64-pc-windows-msvc",
};
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
  isWindowsCapsuleOrigin(origin)
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
    ([
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
      review.origin === WINDOWS_OPERATION2_ORIGIN,
    );
    if (
      review.origin === WINDOWS_OPERATION2_ORIGIN &&
      !Buffer.from(bytes.toString("utf8")).equals(bytes)
    )
      fail("Bounded UTF8 original metadata required");
    if (
      (review.origin === "owned-windows-incremental-engine" &&
        ["nativeOutput", "engineOutput"].includes(name)) ||
      (isWindowsCapsuleOrigin(review.origin) &&
        (capsuleTextRoles.has(name) ||
          (review.origin === WINDOWS_OPERATION2_ORIGIN &&
            name === "engineAccounting")))
    ) {
      if (
        bytes.length >
          (review.origin === WINDOWS_OPERATION2_ORIGIN
            ? ownedEvidenceLimit(review.origin, name)
            : isWindowsCapsuleOrigin(review.origin) && name === "engineOutput"
              ? 64 * 1024 ** 2
              : 1024 ** 2) ||
        !Buffer.from(bytes.toString("utf8")).equals(bytes)
      )
        fail("Bounded UTF8 original build output required");
      records[name] = bytes.toString("utf8");
    } else records[name] = JSON.parse(bytes);
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
