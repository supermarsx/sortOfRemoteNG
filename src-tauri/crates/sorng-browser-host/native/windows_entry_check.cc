// Entry ABI probe only. This does not initialize a browser or prove sandboxing.
#include "include/cef_sandbox_win.h"
#include <cstring>

static_assert(CEF_VERSION_MAJOR == 154 && CEF_VERSION_MINOR == 0 && CEF_VERSION_PATCH == 32);
static_assert(sizeof(cef_version_info_t) == 104);

extern "C" __declspec(dllexport) int RunWinMain(
    HINSTANCE instance, LPWSTR, int, void* sandbox, cef_version_info_t* version) {
  if (!instance || !sandbox || !version || version->size < sizeof(*version)) return 91;
  if (version->installer_error_code != 0 ||
      version->cef_version_major != 154 || version->cef_version_minor != 0 ||
      version->cef_version_patch != 32 || version->cef_commit_number != 3631 ||
      version->chrome_version_major != 154 || version->chrome_version_minor != 0 ||
      version->chrome_version_build != 8037 || version->chrome_version_patch != 58 ||
      std::memcmp(version->sandbox_compat_hash, CEF_SANDBOX_COMPAT_HASH, 17) != 0) return 92;
  // Distinctive return value proves that bootstrap reached this export.
  return 73;
}
