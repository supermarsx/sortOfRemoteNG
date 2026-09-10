// Called only from the exact, versioned QuickConnect redirect() adapter.
// Source origin is a native-validated, JSON-encoded constant, not page input.
// Foreign destinations go to native review; this never navigates there directly.
function sorngQuickConnectNavigation(raw) {
  "use strict";
  var source = new URL(__SORNG_QUICKCONNECT_SOURCE_ORIGIN__);
  var destination = new URL(raw, source.href);
  var local = new URL(window.location.origin);
  if (
    destination.origin === source.origin &&
    !destination.username &&
    !destination.password
  ) {
    local.pathname = destination.pathname;
    local.search = destination.search;
    local.hash = destination.hash;
    return local.href;
  }
  local.pathname = "/__sortofremoteng_quickconnect_redirect_v1";
  local.searchParams.set("destination", destination.href);
  return local.href;
}
