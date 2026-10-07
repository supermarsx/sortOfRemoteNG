// Compile-only verification against the pinned CEF SDK. No library/init needed.
// clang-cl /Zs /I<CEF SDK root> windows_bootstrap_abi.cc
#define CEF_API_VERSION 15400
#include "include/cef_sandbox_win.h"
#include <cstddef>

static_assert(CEF_VERSION_MAJOR == 154 && CEF_VERSION_MINOR == 0 && CEF_VERSION_PATCH == 32);
#if defined(_WIN64)
static_assert(sizeof(cef_version_info_t) == 104);
static_assert(offsetof(cef_version_info_t, sandbox_compat_hash) == 40);
static_assert(offsetof(cef_version_info_t, libcef_path) == 64);
static_assert(offsetof(cef_version_info_t, installer_error_message) == 96);
#else
static_assert(sizeof(cef_version_info_t) == 76);
static_assert(offsetof(cef_version_info_t, sandbox_compat_hash) == 36);
static_assert(offsetof(cef_version_info_t, libcef_path) == 56);
static_assert(offsetof(cef_version_info_t, installer_error_message) == 72);
#endif
