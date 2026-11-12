// Conditional source expectations only. Matching caller data is never native proof.
// The genuine parent must separately own actual GN desc/evaluated args, held headers,
// source closure and original clocks before it may consider any qualification.
import { types } from "node:util";

export const EXPECTED_DEFAULTS_INTEGRATION_ADMITTED = false;

function freezePolicy(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezePolicy(child);
    Object.freeze(value);
  }
  return value;
}
export const ARM64_EXPECTED_DEFAULTS_POLICY = freezePolicy({
  kind: "source-derived-conditional-arm64-defaults-v1",
  sourceReviewPin: {
    bytes: 93920,
    sha256: "6e03a25cde0af18ef0c78201f0e240c78b8b75b764c800f521ea3a40f66939e5",
  },
  chromium: "a654841425914cbb703a2931e07b70a83aedbafd",
  cef: "682c378d70d5780061e96644dca16ddd8fd157a9",
  target: "aarch64-pc-windows-msvc",
  reviewedSources: {
    "20261103.298.1":
      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    "20261021.278.1":
      "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
  },
  values: {
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
  },
  cefHeaderValues: {
    CEF_V8_ENABLE_SANDBOX: 1,
  },
  conditionalAssumptions: {
    current_cpu: "arm64",
    current_os: "win",
    is_win: true,
    is_linux: false,
    is_android: false,
    is_apple: false,
    is_ios: false,
    is_mac: false,
    is_chromeos: false,
    is_fuchsia: false,
    is_clang: true,
    is_debug: false,
    is_component_build: false,
    is_official_build: false,
    build_with_chromium: true,
    is_asan: false,
    is_hwasan: false,
    is_lsan: false,
    is_tsan: false,
    is_msan: false,
    is_ubsan: false,
    is_castos: false,
    is_cast_android: false,
    is_cronet_for_aosp_build: false,
    toolchain_allows_use_partition_alloc_as_malloc: true,
    toolchain_for_rust_host_build_tools: false,
    is_cronet_build: false,
    dcheck_is_configurable: false,
    dcheck_always_on: true,
    enable_expensive_dchecks: true,
    optimize_for_size: false,
    use_sized_deallocation: true,
    can_unwind_with_frame_pointers: false,
    is_clang_or_gcc: true,
    has_64_bit_pointers: true,
    use_large_empty_slot_span_ring: true,
    has_memory_tagging: false,
    partition_alloc_is_official_build: false,
    partition_alloc_is_debug: false,
    partition_alloc_dcheck_always_on: true,
    _disable_partition_alloc_everywhere: false,
    use_allocator_shim_default: true,
    use_partition_alloc_default: true,
    use_allocator_shim: true,
    use_partition_alloc: true,
    use_partition_alloc_as_malloc_default: true,
    use_partition_alloc_as_malloc: true,
    enable_backup_ref_ptr_support_default: true,
    enable_backup_ref_ptr_support: true,
    use_raw_ptr_backup_ref_impl: true,
    enable_dangling_raw_ptr_checks_default: true,
    enable_dangling_raw_ptr_checks: true,
    enable_dangling_raw_ptr_feature_flag: true,
    enable_backup_ref_ptr_feature_flag: true,
    backup_ref_ptr_extra_oob_checks: true,
    backup_ref_ptr_poison_oob_ptr: false,
    enable_backup_ref_ptr_instance_tracer: false,
    enable_backup_ref_ptr_slow_checks: false,
    enable_brp_for_unprotected_in_release_raw_ptr: true,
    enable_gwp_asan_support: true,
    enable_pointer_compression_support: false,
    enable_pointer_compression: false,
    partition_alloc_dchecks_are_on: true,
    _can_unwind_with_frame_pointers: false,
    _dcheck_is_configurable: false,
    _enable_expensive_dchecks: true,
    move_metadata_outside_gigacage: true,
    enable_move_metadata_outside_gigacage_trial: true,
    enable_pkeys: false,
    enable_partition_lock_priority_inheritance: false,
    force_disable_backup_ref_ptr_feature: false,
    memory_tool_replaces_allocator: false,
    shim_supports_sized_dealloc: true,
    partition_alloc_enable_system_free_fallback: false,
    stack_scan_supported: true,
    use_asan_backup_ref_ptr: false,
    use_asan_backup_ref_ptr_v2: false,
    use_raw_ptr_hookable_impl: false,
    use_partition_cookie: true,
    enable_user_space_zero_segment: true,
    use_checked_span: true,
    checked_span_has_metadata_support: false,
    user_space_zero_segment_size_mb: 4097,
    enable_auto_partitioning: false,
    enable_partition_lock_reentrancy_check: false,
    enable_pointer_arithmetic_trait_check: true,
    enable_pointer_subtraction_check: false,
    force_enable_raw_ptr_exclusion: false,
    forward_through_malloc: false,
    raw_ptr_zero_on_construct: true,
    raw_ptr_zero_on_destruct: false,
    raw_ptr_zero_on_move: true,
    partition_alloc_realloc_growth_factor_mitigation: false,
    record_alloc_info: false,
    shim_supports_alloc_token: false,
    smaller_partition_cookie: false,
    use_raw_ptr_asan_unowned_impl: false,
    use_full_mte: false,
  },
  requiredInactiveOverrides: [
    "No use_partition_alloc=false override",
    "toolchain_allows_use_partition_alloc_as_malloc not false",
    "toolchain_for_rust_host_build_tools false",
    "No additional declare_args/default_args/CEF-owned patched input changes the reviewed defaults",
    "No custom_toolchain override; default/current toolchain is win_clang_arm64",
    "No tarball or environment GN_DEFINES additions outside fixed reviewed projection and known VS/SDK paths",
  ],
  tracerProjection: {
    blockBytes: 5642,
    blockSha256:
      "ae72c616403992a1ec04f7071db1f1e2b1d148d8cb31af75f2d662e9bd396f19",
    nativeGeneratorValue: true,
    projectedDeclaredValue: false,
    nativeExecutionObserved: false,
  },
  rows: [
    {
      name: "ENABLE_USER_SPACE_ZERO_SEGMENT",
      value: 1,
      gnVariable: "enable_user_space_zero_segment",
      mappingLine: 157,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:603-605",
      equation:
        "has_64_bit_pointers and use_partition_alloc_as_malloc and (is_mac or is_win or is_chromeos or is_linux)",
    },
    {
      name: "USER_SPACE_ZERO_SEGMENT_SIZE_MB",
      value: 4097,
      gnVariable: "user_space_zero_segment_size_mb",
      mappingLine: 158,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:610",
      equation: "4097",
    },
    {
      name: "BACKUP_REF_PTR_EXTRA_OOB_CHECKS",
      value: 1,
      gnVariable: "backup_ref_ptr_extra_oob_checks",
      mappingLine: 159,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:359-360",
      equation: "enable_backup_ref_ptr_support and use_raw_ptr_backup_ref_impl",
    },
    {
      name: "BACKUP_REF_PTR_POISON_OOB_PTR",
      value: 0,
      gnVariable: "backup_ref_ptr_poison_oob_ptr",
      mappingLine: 160,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:376-377",
      equation:
        "False and backup_ref_ptr_extra_oob_checks and has_64_bit_pointers",
    },
    {
      name: "CAN_UNWIND_WITH_FRAME_POINTERS",
      value: 0,
      gnVariable: "_can_unwind_with_frame_pointers",
      mappingLine: 161,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:18-19; variable defined by compiler.gni",
      equation: "can_unwind_with_frame_pointers",
    },
    {
      name: "CHECKED_SPAN",
      value: 1,
      gnVariable: "use_checked_span",
      mappingLine: 162,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:624-625",
      equation:
        "not (is_asan or is_ubsan or is_tsan) and use_partition_alloc and has_64_bit_pointers",
    },
    {
      name: "CHECKED_SPAN_HAS_METADATA_SUPPORT",
      value: 0,
      gnVariable: "checked_span_has_metadata_support",
      mappingLine: 163,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:633-634",
      equation: "use_checked_span and enable_backup_ref_ptr_support and False",
    },
    {
      name: "DCHECKS_ARE_ON",
      value: 1,
      gnVariable: "partition_alloc_dchecks_are_on",
      mappingLine: 164,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:36-37",
      equation: "partition_alloc_is_debug or partition_alloc_dcheck_always_on",
    },
    {
      name: "DCHECK_IS_CONFIGURABLE",
      value: 0,
      gnVariable: "_dcheck_is_configurable",
      mappingLine: 165,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:20-21; variable defined by dcheck.gni",
      equation: "dcheck_is_configurable",
    },
    {
      name: "ENABLE_AUTO_PARTITIONING",
      value: 0,
      gnVariable: "enable_auto_partitioning",
      mappingLine: 166,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:188",
      equation: "False",
    },
    {
      name: "ENABLE_BACKUP_REF_PTR_FEATURE_FLAG",
      value: 1,
      gnVariable: "enable_backup_ref_ptr_feature_flag",
      mappingLine: 167,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:343-344",
      equation: "enable_backup_ref_ptr_support and use_raw_ptr_backup_ref_impl",
    },
    {
      name: "ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER",
      value: 0,
      gnVariable: "enable_backup_ref_ptr_instance_tracer",
      mappingLine: 168,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source:
        "pa-options.gni:357 plus c9f reviewed post-native generator projection; raw native CEF generator would true",
      equation: "False",
    },
    {
      name: "ENABLE_BACKUP_REF_PTR_SLOW_CHECKS",
      value: 0,
      gnVariable: "enable_backup_ref_ptr_slow_checks",
      mappingLine: 169,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-overrides.gni:113; pa-options.gni:332-333",
      equation: "False and enable_backup_ref_ptr_support",
    },
    {
      name: "ENABLE_BACKUP_REF_PTR_SUPPORT",
      value: 1,
      gnVariable: "enable_backup_ref_ptr_support",
      mappingLine: 170,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:268-269",
      equation: "use_partition_alloc and enable_backup_ref_ptr_support_default",
    },
    {
      name: "ENABLE_BRP_FOR_UNPROTECTED_IN_RELEASE_RAW_PTR",
      value: 1,
      gnVariable: "enable_brp_for_unprotected_in_release_raw_ptr",
      mappingLine: 171,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:290-291",
      equation: "partition_alloc_is_debug or partition_alloc_dcheck_always_on",
    },
    {
      name: "ENABLE_DANGLING_RAW_PTR_CHECKS",
      value: 1,
      gnVariable: "enable_dangling_raw_ptr_checks",
      mappingLine: 172,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:353-355",
      equation:
        "enable_dangling_raw_ptr_checks_default and enable_backup_ref_ptr_support and use_raw_ptr_backup_ref_impl",
    },
    {
      name: "ENABLE_DANGLING_RAW_PTR_FEATURE_FLAG",
      value: 1,
      gnVariable: "enable_dangling_raw_ptr_feature_flag",
      mappingLine: 173,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:372",
      equation: "enable_dangling_raw_ptr_checks",
    },
    {
      name: "ENABLE_GWP_ASAN_SUPPORT",
      value: 1,
      gnVariable: "enable_gwp_asan_support",
      mappingLine: 174,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:28",
      equation: "enable_backup_ref_ptr_support",
    },
    {
      name: "ENABLE_PARTITION_LOCK_REENTRANCY_CHECK",
      value: 0,
      gnVariable: "enable_partition_lock_reentrancy_check",
      mappingLine: 175,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:242",
      equation: "False",
    },
    {
      name: "ENABLE_PARTITION_LOCK_PRIORITY_INHERITANCE",
      value: 0,
      gnVariable: "enable_partition_lock_priority_inheritance",
      mappingLine: 176,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:587-588",
      equation: 'is_android and current_cpu in ("x64","arm64")',
    },
    {
      name: "ENABLE_PKEYS",
      value: 0,
      gnVariable: "enable_pkeys",
      mappingLine: 177,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:542-545",
      equation:
        '(is_linux or is_chromeos) and current_cpu=="x64" and not is_cronet_build',
    },
    {
      name: "ENABLE_POINTER_ARITHMETIC_TRAIT_CHECK",
      value: 1,
      gnVariable: "enable_pointer_arithmetic_trait_check",
      mappingLine: 178,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:233",
      equation: "True",
    },
    {
      name: "ENABLE_POINTER_COMPRESSION",
      value: 0,
      gnVariable: "enable_pointer_compression",
      mappingLine: 179,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:31-32",
      equation: "enable_pointer_compression_support and has_64_bit_pointers",
    },
    {
      name: "ENABLE_POINTER_SUBTRACTION_CHECK",
      value: 0,
      gnVariable: "enable_pointer_subtraction_check",
      mappingLine: 180,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:228",
      equation: "False",
    },
    {
      name: "ENABLE_SYSTEM_FREE_FALLBACK",
      value: 0,
      gnVariable: "partition_alloc_enable_system_free_fallback",
      mappingLine: 181,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:126-127; pa-overrides.gni:149",
      equation: "is_cast_android",
    },
    {
      name: "MOVE_METADATA_OUT_OF_GIGACAGE_FOR_64_BITS_POINTERS",
      value: 1,
      gnVariable: "move_metadata_outside_gigacage",
      mappingLine: 182,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:383",
      equation: "has_64_bit_pointers and not is_ios",
    },
    {
      name: "ENABLE_MOVE_METADATA_OUT_OF_GIGACAGE_TRIAL",
      value: 1,
      gnVariable: "enable_move_metadata_outside_gigacage_trial",
      mappingLine: 183,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:387",
      equation: "move_metadata_outside_gigacage",
    },
    {
      name: "ENABLE_THREAD_ISOLATION",
      value: 0,
      gnVariable: "enable_pkeys",
      mappingLine: 184,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:542-545",
      equation:
        '(is_linux or is_chromeos) and current_cpu=="x64" and not is_cronet_build',
    },
    {
      name: "EXPENSIVE_DCHECKS_ARE_ON",
      value: 1,
      gnVariable: "_enable_expensive_dchecks",
      mappingLine: 185,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:22-23; variable defined by dcheck.gni",
      equation: "enable_expensive_dchecks",
    },
    {
      name: "FORCE_DISABLE_BACKUP_REF_PTR_FEATURE",
      value: 0,
      gnVariable: "force_disable_backup_ref_ptr_feature",
      mappingLine: 186,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:349",
      equation: "enable_backup_ref_ptr_support and False",
    },
    {
      name: "FORCE_ENABLE_RAW_PTR_EXCLUSION",
      value: 0,
      gnVariable: "force_enable_raw_ptr_exclusion",
      mappingLine: 187,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:273",
      equation: "False",
    },
    {
      name: "FORWARD_THROUGH_MALLOC",
      value: 0,
      gnVariable: "forward_through_malloc",
      mappingLine: 188,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:238",
      equation: "False",
    },
    {
      name: "HAS_64_BIT_POINTERS",
      value: 1,
      gnVariable: "has_64_bit_pointers",
      mappingLine: 189,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:94-97",
      equation:
        'current_cpu in ("x64","arm64","arm64e","loong64","riscv64","ppc64","s390x")',
    },
    {
      name: "HAS_MEMORY_TAGGING",
      value: 0,
      gnVariable: "has_memory_tagging",
      mappingLine: 190,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:113-114",
      equation:
        'current_cpu=="arm64" and is_clang and not is_asan and not is_hwasan and (is_linux or is_android)',
    },
    {
      name: "IS_ANDROID",
      value: 0,
      gnVariable: "is_android",
      mappingLine: 191,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source:
        "BUILDCONFIG current target platform or fixed argument assumption",
      equation: null,
    },
    {
      name: "IS_CHROMEOS",
      value: 0,
      gnVariable: "is_chromeos",
      mappingLine: 192,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source:
        "BUILDCONFIG current target platform or fixed argument assumption",
      equation: null,
    },
    {
      name: "IS_COMPONENT_BUILD",
      value: 0,
      gnVariable: "is_component_build",
      mappingLine: 193,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source:
        "BUILDCONFIG current target platform or fixed argument assumption",
      equation: null,
    },
    {
      name: "IS_DEBUG",
      value: 0,
      gnVariable: "partition_alloc_is_debug",
      mappingLine: 194,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:40-45,121",
      equation: "is_debug",
    },
    {
      name: "IS_HWASAN",
      value: 0,
      gnVariable: "is_hwasan",
      mappingLine: 195,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source:
        "BUILDCONFIG current target platform or fixed argument assumption",
      equation: null,
    },
    {
      name: "MEMORY_TOOL_REPLACES_ALLOCATOR",
      value: 0,
      gnVariable: "memory_tool_replaces_allocator",
      mappingLine: 196,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:151-152",
      equation: "is_asan or is_hwasan or is_lsan or is_tsan or is_msan",
    },
    {
      name: "OFFICIAL",
      value: 0,
      gnVariable: "partition_alloc_is_official_build",
      mappingLine: 197,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:62-67,118",
      equation: "is_official_build",
    },
    {
      name: "RAW_PTR_ZERO_ON_CONSTRUCT",
      value: 1,
      gnVariable: "raw_ptr_zero_on_construct",
      mappingLine: 198,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-overrides.gni:137; pa-options.gni:576",
      equation: "True",
    },
    {
      name: "RAW_PTR_ZERO_ON_DESTRUCT",
      value: 0,
      gnVariable: "raw_ptr_zero_on_destruct",
      mappingLine: 199,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-overrides.gni:139; pa-options.gni:578",
      equation: "False",
    },
    {
      name: "RAW_PTR_ZERO_ON_MOVE",
      value: 1,
      gnVariable: "raw_ptr_zero_on_move",
      mappingLine: 200,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-overrides.gni:138; pa-options.gni:577",
      equation: "True",
    },
    {
      name: "REALLOC_GROWTH_FACTOR_MITIGATION",
      value: 0,
      gnVariable: "partition_alloc_realloc_growth_factor_mitigation",
      mappingLine: 201,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:147",
      equation: "False",
    },
    {
      name: "RECORD_ALLOC_INFO",
      value: 0,
      gnVariable: "record_alloc_info",
      mappingLine: 202,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:25",
      equation: "False",
    },
    {
      name: "SHIM_SUPPORTS_ALLOC_TOKEN",
      value: 0,
      gnVariable: "shim_supports_alloc_token",
      mappingLine: 203,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:178",
      equation: "False",
    },
    {
      name: "SHIM_SUPPORTS_SIZED_DEALLOC",
      value: 1,
      gnVariable: "shim_supports_sized_dealloc",
      mappingLine: 204,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:170-171; pa-overrides.gni:106",
      equation: "use_allocator_shim and use_sized_deallocation",
    },
    {
      name: "SMALLER_PARTITION_COOKIE",
      value: 0,
      gnVariable: "smaller_partition_cookie",
      mappingLine: 205,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:254",
      equation: "False",
    },
    {
      name: "STACK_SCAN_SUPPORTED",
      value: 1,
      gnVariable: "stack_scan_supported",
      mappingLine: 206,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "patched-pa-build.gn:128-130",
      equation:
        'current_cpu in ("x64","x86","arm","arm64","riscv64","loong64")',
    },
    {
      name: "USE_ALLOCATOR_SHIM",
      value: 1,
      gnVariable: "use_allocator_shim",
      mappingLine: 207,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:135",
      equation: "use_allocator_shim_default and is_clang_or_gcc",
    },
    {
      name: "USE_ASAN_BACKUP_REF_PTR",
      value: 0,
      gnVariable: "use_asan_backup_ref_ptr",
      mappingLine: 208,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:300-302",
      equation:
        "build_with_chromium and is_asan and (is_win or is_android or is_linux or is_apple or is_chromeos)",
    },
    {
      name: "USE_ASAN_BACKUP_REF_PTR_V2",
      value: 0,
      gnVariable: "use_asan_backup_ref_ptr_v2",
      mappingLine: 209,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:314",
      equation: "False and use_asan_backup_ref_ptr and is_linux",
    },
    {
      name: "USE_FULL_MTE",
      value: 0,
      gnVariable: "use_full_mte",
      mappingLine: 210,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:402,448",
      equation: "False",
    },
    {
      name: "USE_LARGE_EMPTY_SLOT_SPAN_RING",
      value: 1,
      gnVariable: "use_large_empty_slot_span_ring",
      mappingLine: 211,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:111",
      equation: "True",
    },
    {
      name: "USE_PARTITION_ALLOC",
      value: 1,
      gnVariable: "use_partition_alloc",
      mappingLine: 212,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:154",
      equation: "use_partition_alloc_default and is_clang_or_gcc",
    },
    {
      name: "USE_PARTITION_ALLOC_AS_MALLOC",
      value: 1,
      gnVariable: "use_partition_alloc_as_malloc",
      mappingLine: 213,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:167-168",
      equation:
        "use_partition_alloc and use_allocator_shim and use_partition_alloc_as_malloc_default",
    },
    {
      name: "USE_PARTITION_COOKIE",
      value: 1,
      gnVariable: "use_partition_cookie",
      mappingLine: 214,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:247-248",
      equation: "partition_alloc_is_debug or partition_alloc_dcheck_always_on",
    },
    {
      name: "USE_RAW_PTR_ASAN_UNOWNED_IMPL",
      value: 0,
      gnVariable: "use_raw_ptr_asan_unowned_impl",
      mappingLine: 215,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:305",
      equation: "False",
    },
    {
      name: "USE_RAW_PTR_BACKUP_REF_IMPL",
      value: 1,
      gnVariable: "use_raw_ptr_backup_ref_impl",
      mappingLine: 216,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:286",
      equation: "enable_backup_ref_ptr_support",
    },
    {
      name: "USE_RAW_PTR_HOOKABLE_IMPL",
      value: 0,
      gnVariable: "use_raw_ptr_hookable_impl",
      mappingLine: 217,
      mappingSourceSha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
      source: "pa-options.gni:319",
      equation: "use_asan_backup_ref_ptr",
    },
  ],
  sourcePins: [
    {
      label: "patched-pa-build.gn",
      bytes: 45891,
      sha256:
        "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
    },
    {
      label: "patched-cef-build.gn",
      bytes: 97568,
      sha256:
        "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
    },
    {
      label: "pa-options.gni",
      bytes: 27958,
      sha256:
        "eb4cda4f3b0fbbde6b1dbf9ea1b023167bc11c674f304750f6970f74e37335b8",
    },
    {
      label: "pa-overrides.gni",
      bytes: 6283,
      sha256:
        "07ff68955fbdc900e62c1e6d04b68cc1a1f05574c94d0ea01cab23b38baca89e",
    },
    {
      label: "chromium-buildconfig.gn",
      bytes: 33848,
      sha256:
        "5df70bd3d47e744fb3737e28dacf7cec42df9785f097d7343bb701e267e6ae39",
    },
    {
      label: "build-overrides.gni",
      bytes: 4282,
      sha256:
        "7e24e685d1748e6fff8aab619f86a850d9cd57a5c6873a9339e8f04d84615e15",
    },
    {
      label: "cast.gni",
      bytes: 2038,
      sha256:
        "57a814bfb6663145adec65b76f4b5e29db904d54a950d4455c70f844ad4d4425",
    },
    {
      label: "cef-gclient-hook.py",
      bytes: 6312,
      sha256:
        "9c94bec19cc48f5a23405eeb3488aa8f2c36810675e2d08721d24f89daff15de",
    },
    {
      label: "cef-gn-args.py",
      bytes: 26541,
      sha256:
        "ab94e3b3c214198b396c8b4858b5d5e9cb42be956bbc294d651dd86eac44df6e",
    },
    {
      label: "cef-gn-config.patch",
      bytes: 6831,
      sha256:
        "39beb378c153b0b37a93af5bddb9b446dbf51a5209b83defc092e683abf0fac7",
    },
    {
      label: "cef-patch.cfg",
      bytes: 35690,
      sha256:
        "c0bfe3531c89c512977b1c6667acc07eb3550cabb7a2e0563511abbc7ccafb09",
    },
    {
      label: "chromium-DEPS",
      bytes: 197649,
      sha256:
        "cd59c0f5c31e1dbbc65b2db96bb11a18f7bdc91496fafb5b6a4e7f94d8ad797c",
    },
    {
      label: "compiler.gni",
      bytes: 19143,
      sha256:
        "7c36e0aa7b9ff6bff1a296edb89e8703f6e82d0d93795ff90a10457bb1a6a8e8",
    },
    {
      label: "cronet.gni",
      bytes: 1777,
      sha256:
        "aa345afb958873cacf5d42ac2f90e9987c54afcf59b7350a33ad7462b69d55c8",
    },
    {
      label: "dcheck.gni",
      bytes: 1866,
      sha256:
        "aee32456b3a7dd217b2c777e9e648636289f68c4a2d3c0a88a516cda895cad8a",
    },
    {
      label: "dot-gn",
      bytes: 8495,
      sha256:
        "c03b19e31549974930c329fa112592f72db3e8db237454b946bd183fb3620786",
    },
    {
      label: "sanitizers.gni",
      bytes: 23649,
      sha256:
        "2f3b48f0d1ac900696a50372de07ffb38996eaa3701a03120786c99b8f655650",
    },
    {
      label: "win-toolchain.gni",
      bytes: 36991,
      sha256:
        "b9e31da12aadf8611b41d0b7597930935a7a0fd9ee68a89e7ecfa10fcce15304",
    },
    {
      label: "win-toolchains.gn",
      bytes: 2431,
      sha256:
        "a805f46696b7a18f306dbfe08e646c438b62a5f596a1662d2ff309db97f27e5f",
    },
    {
      label: "pa-build.gn",
      bytes: 45276,
      sha256:
        "0d12ddbf0e9ffb4df8eb2ad91ba72546146f4418747dd33f27195f4b99fa78fe",
    },
    {
      label: "pa-header.gni",
      bytes: 4133,
      sha256:
        "1ac0cd4025922ec85635696eb7cef13f7e6980b6fc194efb8b965a007f66a5f6",
    },
    {
      label: "pa-writer.py",
      bytes: 3507,
      sha256:
        "7c21cf63a64a89c514cb8f32055feb9733fc3b569dce1f352c7b65814c251118",
    },
    {
      label: "cef-config.py",
      bytes: 2210,
      sha256:
        "2c10414a9b2429b6756577f55bfb08b7f71de5d895e04f89dc0ce534183af51c",
    },
    {
      label: "gn-args.cc",
      bytes: 17609,
      sha256:
        "2f79a7cf16e873ce7730d3da3e4b8885038ba9b71817fb8be99703814c0e5d29",
    },
    {
      label: "gn-command-desc.cc",
      bytes: 26192,
      sha256:
        "3f5c1efabece03738b7fff556857371cd0a615cae81e0552dfbdae3e38b43bae",
    },
  ],
  fullArm64DefaultsQualified: false,
  executionAdmitted: false,
});

function need(value, code) {
  if (!value) throw new Error(code);
}
function ownRecord(value, fields) {
  need(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
    "ARM64_DEFAULTS_FIELDS",
  );
  const keys = Reflect.ownKeys(value);
  need(
    keys.length === fields.length && fields.every((key) => keys.includes(key)),
    "ARM64_DEFAULTS_FIELDS",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value),
    copied = Object.create(null);
  for (const key of fields) {
    const descriptor = descriptors[key];
    need(
      Object.hasOwn(descriptor, "value") && descriptor.enumerable,
      "ARM64_DEFAULTS_FIELDS",
    );
    copied[key] = descriptor.value;
  }
  return copied;
}
function denseArray(value, length) {
  need(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype,
    "ARM64_DEFAULTS_ROWS",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(value);
  need(
    descriptors.length.value === length && keys.length === length + 1,
    "ARM64_DEFAULTS_ROWS",
  );
  const copied = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[index];
    need(
      descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable,
      "ARM64_DEFAULTS_ROWS",
    );
    copied.push(descriptor.value);
  }
  return copied;
}
function compareRows(rows, expected) {
  const names = Object.keys(expected),
    seen = new Set();
  for (const row of denseArray(rows, names.length)) {
    const [name, value] = denseArray(row, 2);
    need(
      typeof name === "string" && Object.hasOwn(expected, name),
      "ARM64_DEFAULTS_NAME",
    );
    need(!seen.has(name), "ARM64_DEFAULTS_DUPLICATE");
    seen.add(name);
    need(
      Number.isSafeInteger(value) && !Object.is(value, -0),
      "ARM64_DEFAULTS_VALUE_TYPE",
    );
    need(value === expected[name], "ARM64_DEFAULTS_MISMATCH");
  }
  need(seen.size === names.length, "ARM64_DEFAULTS_ROWS");
}

// Dense name/value pairs preserve duplicate evidence. Feed Object.entries of
// independently strict parsed data; this function neither reads nor trusts JSON.
export function inspectExpectedArm64Defaults(input) {
  const value = ownRecord(input, [
    "target",
    "image",
    "sourceId",
    "partitionAllocActionValues",
    "partitionAllocHeaderValues",
    "cefHeaderValues",
  ]);
  const policy = ARM64_EXPECTED_DEFAULTS_POLICY;
  need(
    value.target === policy.target &&
      typeof value.image === "string" &&
      Object.hasOwn(policy.reviewedSources, value.image) &&
      value.sourceId === policy.reviewedSources[value.image],
    "ARM64_DEFAULTS_SCOPE",
  );
  compareRows(value.partitionAllocActionValues, policy.values);
  compareRows(value.partitionAllocHeaderValues, policy.values);
  compareRows(value.cefHeaderValues, policy.cefHeaderValues);
  return Object.freeze({
    kind: "windows-arm64-expected-defaults-data-comparison",
    target: value.target,
    image: value.image,
    sourceId: value.sourceId,
    expectedMacroCount: 61,
    partitionAllocActionValuesMatch: true,
    partitionAllocHeaderValuesMatch: true,
    cefV8SandboxValue: 1,
    sourceDerivedConditionalExpectation: true,
    dataOnly: true,
    processProvenanceVerified: false,
    fullArm64DefaultsQualified: false,
    executionAdmitted: false,
  });
}
