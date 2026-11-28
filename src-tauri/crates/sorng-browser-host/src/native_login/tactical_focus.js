// Pure pre-grant decision: no DOM mutation, timers, credentials or host grants.
// DOM identity/handler checks remain in the OTP adapter before this is called.
function tacticalFocusRetryAllowed(state) {
  if (
    state.stopped ||
    !state.beforeGrant ||
    state.attempts >= 3 ||
    !state.sameScope ||
    !state.empty
  )
    return false;
  if (state.sameInput)
    return state.focus === "body" || state.focus === "container";
  return (
    state.previousDetached &&
    ["body", "input", "container"].includes(state.focus)
  );
}
