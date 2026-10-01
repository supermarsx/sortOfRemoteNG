/* FreePBX reviewed launcher. Assembled inside the private auto-login IIFE.
 * Shared seam: stopped, isVisible; entrypoint: openFreepbxAdmin(ov).
 * Owns only launcher attempt state; never receives or retains credentials. */
var freepbxLaunchAttempted = false;
function freepbxLauncherProofIsCurrent(destination) {
  if (!destination.search) return true;
  if (typeof window.__sorng_map_navigation !== "function") return false;
  try {
    // Ask the existing router to stamp a CLEAN URL. Never let it replace a
    // stale candidate proof and then mistake the replacement for validation.
    // The native bootstrap uses its navigation token as requestGeneration.
    var clean = destination.origin + "/admin/";
    var routed = new URL(window.__sorng_map_navigation(clean));
    var current = /^\?__sorng_generation_v1=([0-9a-f]{32})$/.exec(
      routed.search,
    );
    if (
      !current ||
      routed.origin !== destination.origin ||
      routed.pathname !== "/admin/" ||
      routed.username ||
      routed.password ||
      routed.hash
    )
      return false;
    var seen = {};
    return destination.search
      .slice(1)
      .split("&")
      .every(function (pair) {
        // Exact raw spelling rejects encoded names/values, duplicate proofs,
        // empty pairs, application queries and unsupported private markers.
        var proof =
          /^(__sorng_generation_v1|__sorng_navigation_v1)=([0-9a-f]{32})$/.exec(
            pair,
          );
        if (!proof || seen[proof[1]] || proof[2] !== current[1]) return false;
        seen[proof[1]] = true;
        return true;
      });
  } catch (_) {
    return false;
  }
}

// FreePBX's admin launcher opens a modal from its hidden form template.
// Keep this exception bound to the complete reviewed profile, never generic
// login-looking links. No credentials are needed to activate the launcher.
function openFreepbxAdmin(ov) {
  if (
    freepbxLaunchAttempted ||
    stopped ||
    !ov ||
    ov.username !==
      '.ui-dialog form[id="loginform"] input[name="username"][type="text"]' ||
    ov.password !==
      '.ui-dialog form[id="loginform"] input[name="password"][type="password"]' ||
    ov.submit !==
      '.ui-dialog form[id="loginform"] button[id="customContinue"][type="button"]' ||
    document.readyState !== "complete" ||
    !/^\/admin\/?$/.test(location.pathname)
  )
    return;
  // A partially mounted or disabled dialog must settle, not be opened twice.
  if (
    document.querySelector(ov.username) ||
    document.querySelector(ov.password)
  )
    return;
  var links = document.querySelectorAll("#login_admin");
  var launcher = links.length === 1 ? links[0] : null;
  if (
    !launcher ||
    !launcher.matches("a.login_item") ||
    !isVisible(launcher) ||
    launcher.hasAttribute("download") ||
    (launcher.getAttribute("target") &&
      launcher.getAttribute("target") !== "_self") ||
    launcher.closest('[inert], [aria-busy="true"], [aria-disabled="true"]')
  )
    return;
  var destination;
  try {
    destination = new URL(launcher.getAttribute("href"), document.baseURI);
  } catch (_) {
    return;
  }
  if (
    destination.origin !== location.origin ||
    destination.username ||
    destination.password ||
    destination.pathname !== "/admin/" ||
    destination.hash ||
    !freepbxLauncherProofIsCurrent(destination)
  )
    return;
  freepbxLaunchAttempted = true;
  // Invoke the site's click handlers, but don't reload the landing page if
  // its modal handler has not loaded. Poll for fields within the same bound.
  var preventNavigation = function (event) {
    event.preventDefault();
  };
  launcher.addEventListener("click", preventNavigation);
  try {
    launcher.click();
  } finally {
    launcher.removeEventListener("click", preventNavigation);
  }
}
