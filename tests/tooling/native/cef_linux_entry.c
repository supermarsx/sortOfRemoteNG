// Actual pinned-runtime ABI/entry probe, NOT browser/sandbox acceptance.
// No cef_initialize, page, profile, subprocess launch, or network operation.
#include "include/cef_api_versions.h"
#define CEF_API_VERSION CEF_API_VERSION_LAST
#include "include/cef_api_hash.h"
#include "include/capi/cef_app_capi.h"
#include <X11/Xlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char** argv) {
  // Reject arbitrary arguments: never act as a caller-controlled CEF helper.
  if (argc != 1) return 2;
  const char* backend = getenv("GDK_BACKEND");
  if (!backend || strcmp(backend, "x11") || !getenv("DISPLAY")) return 3;
  if (!XInitThreads()) return 4;
  Display* display = XOpenDisplay(NULL);
  if (!display) return 5;
  XCloseDisplay(display);
  const char* api = cef_api_hash(CEF_API_VERSION_LAST, 0);
  const char* revision = cef_api_hash(CEF_API_VERSION_LAST, 2);
  if (!api || !revision || cef_api_version() != CEF_API_VERSION_LAST ||
      strcmp(revision, "682c378d70d5780061e96644dca16ddd8fd157a9")) return 6;
  cef_main_args_t args = {.argc = argc, .argv = argv};
  const int dispatched = cef_execute_process(&args, NULL, NULL);
  if (dispatched != -1) return 7;
  printf("{\"platform\":\"linux\",\"apiVersion\":%d,\"revision\":\"%s\","
         "\"x11Connected\":true,\"dispatch\":\"browser\","
         "\"cefInitialized\":false,\"rendererSandbox\":\"not-tested\","
         "\"productionReady\":false}\n", cef_api_version(), revision);
  return 0;
}
