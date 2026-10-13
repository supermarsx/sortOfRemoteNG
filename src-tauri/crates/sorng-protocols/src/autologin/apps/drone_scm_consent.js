/* Private auto-login apps/drone_scm_consent.js (r1-drone). Assembled inside
 * the native login client IIFE. NOT WIRED YET: the click needs its own
 * one-shot native action stage (see .orchestration/logs/r1-drone.md).
 *
 * Finds the ONE control that approves Drone's OAuth application on the Git
 * provider's consent page, or null. Every value it compares against comes
 * from the native-owned bridge configuration (saved SCM origin, reviewed
 * path and selectors, saved client id, Drone's own callback), never from the
 * page. It reads the page only to check it, and never clicks.
 *
 * bridge = { origin, paths, formAction, formSelector, buttonSelector,
 *            clientId, redirectUri }   (droneScmBridge.ts `consent`)
 */
function droneScmConsentTarget(doc, bridge) {
  try {
    var view = doc && doc.defaultView;
    if (!view || !bridge || typeof bridge !== "object") return null;
    var location = view.location;
    if (
      location.protocol !== "https:" ||
      location.origin !== bridge.origin ||
      !Array.isArray(bridge.paths) ||
      bridge.paths.indexOf(location.pathname) < 0 ||
      typeof bridge.clientId !== "string" ||
      !bridge.clientId ||
      typeof bridge.redirectUri !== "string" ||
      view.top !== view
    )
      return null;
    // The address that rendered the page must name the same application and
    // the same callback; a mismatch is another application's consent.
    var query = new URL(location.href).searchParams;
    if (
      query.getAll("client_id").length !== 1 ||
      query.get("client_id") !== bridge.clientId ||
      query.getAll("redirect_uri").length !== 1 ||
      query.get("redirect_uri") !== bridge.redirectUri
    )
      return null;
    var forms = doc.querySelectorAll(bridge.formSelector);
    if (forms.length !== 1) return null;
    var form = forms[0];
    var action = new URL(form.getAttribute("action") || "", location.href);
    if (
      action.origin !== bridge.origin ||
      action.pathname !== bridge.formAction ||
      action.search ||
      form.hasAttribute("target")
    )
      return null;
    // Hidden fields the provider posts back: exactly one of each, equal to
    // the saved application and Drone's own callback.
    function only(name) {
      var fields = form.querySelectorAll(
        'input[type="hidden"][name="' + name + '"]',
      );
      return fields.length === 1 ? fields[0].value : null;
    }
    if (
      only("client_id") !== bridge.clientId ||
      only("redirect_uri") !== bridge.redirectUri
    )
      return null;
    var buttons = doc.querySelectorAll(bridge.buttonSelector);
    if (buttons.length !== 1) return null;
    var button = buttons[0];
    if (
      button.form !== form ||
      button.disabled ||
      button.hasAttribute("formaction") ||
      button.hasAttribute("formtarget") ||
      button.hasAttribute("formmethod") ||
      button.getAttribute("aria-disabled") === "true" ||
      !button.isConnected ||
      (typeof isVisible === "function" && !isVisible(button))
    )
      return null;
    return button;
  } catch (_) {
    return null;
  }
}
