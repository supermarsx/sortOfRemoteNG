/* Private auto-login forms/advanced.js. Assembled inside the coordinator IIFE. */
function bootstrapFill(
  creds,
  ov,
  rawOptions,
  readinessProfile,
  readinessDeadline,
) {
  if (instagramSelectors(ov))
    return runInstagramForm(creds, ov, rawOptions, readinessDeadline);
  // This promise OWNS the secret until detection finishes. Clearing it in
  // the fetch caller before a delayed SPA render used to submit null values.
  return new Promise(function (resolve) {
    var tries = 0;
    var finished = false;
    var retryTimer = null;
    var lifetimeTimer = null;
    var origin = window.location.origin;
    var options;
    var activeCapture;
    var submitAttempted = false;
    var cpanel =
      readinessProfile === "cpanel"
        ? createCpanelLifecycle({
            isFinished: function () {
              return finished;
            },
            guarded: guarded,
            fail: fail,
            valuesMatch: function (captured) {
              return (
                captured.target.user.value === creds.username &&
                captured.target.pw.value === creds.password &&
                captured.extras.every(function (field) {
                  return field.element.value === field.value;
                })
              );
            },
          })
        : null;
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(retryTimer);
      clearTimeout(lifetimeTimer);
      if (cpanel) cpanel.dispose();
      document.removeEventListener("DOMContentLoaded", tick);
      if (cancelActive === cancel) cancelActive = null;
      creds.username = null;
      creds.password = null;
      creds = null;
      if (options)
        options.fields.forEach(function (field) {
          field.value = "";
        });
      if (activeCapture)
        activeCapture.extras.forEach(function (field) {
          field.value = "";
        });
      report(result);
      resolve(result);
    }
    function cancel() {
      finish({ ok: false, reason: "cancelled" });
    }
    function guarded(captured) {
      if (
        !finished &&
        readinessDeadline !== undefined &&
        Date.now() >= readinessDeadline
      ) {
        finish({ ok: false, reason: "form-not-found-timeout" });
        return false;
      }
      return (
        !finished &&
        !stopped &&
        window.location.origin === origin &&
        sameCapturedTarget(captured, ov, options)
      );
    }
    function fail() {
      // Hydration can replace/disable controls during input handlers. Only
      // cPanel may reacquire them, and only before the one submit attempt.
      // Retain the original action/field contract across that reacquisition.
      if (readinessProfile === "cpanel" && !submitAttempted) {
        try {
          if (
            !finished &&
            !stopped &&
            window.location.origin === origin &&
            activeCapture &&
            cpanel.canReacquire(activeCapture)
          ) {
            if (cpanel) cpanel.dispose();
            activeCapture = null;
            clearTimeout(retryTimer);
            retryTimer = setTimeout(tick, 0);
            return;
          }
        } catch (_) {}
      }
      finish({ ok: false, reason: "form-changed-or-unsafe" });
    }
    function fill(captured) {
      if (finished) return;
      try {
        if (!guarded(captured)) {
          fail();
          return;
        }
        var target = captured.target;
        var validate = function () {
          return guarded(captured);
        };
        if (target.user) {
          fillField(target.user, creds.username, validate);
          if (!guarded(captured)) {
            fail();
            return;
          }
        }
        fillField(target.pw, creds.password, validate);
        if (!guarded(captured)) {
          fail();
          return;
        }
        if (
          target.pw.value !== creds.password &&
          readinessProfile !== "cpanel" &&
          !target.porkbun
        )
          typeField(target.pw, creds.password, validate);
        if (
          !guarded(captured) ||
          target.pw.value !== creds.password ||
          (target.user && target.user.value !== creds.username)
        ) {
          fail();
          return;
        }
        for (var i = 0; i < captured.extras.length; i++) {
          var field = captured.extras[i];
          if (!guarded(captured)) {
            fail();
            return;
          }
          fillField(field.element, field.value, validate);
          if (!guarded(captured) || field.element.value !== field.value) {
            fail();
            return;
          }
        }
        if (!options.submit) {
          finish({ ok: true, reason: "filled-only" });
          return;
        }
        var submit = function () {
          if (finished) return;
          try {
            if (
              !guarded(captured) ||
              target.pw.value !== creds.password ||
              (target.user && target.user.value !== creds.username) ||
              captured.extras.some(function (field) {
                return field.element.value !== field.value;
              })
            ) {
              fail();
              return;
            }
            if (captured.joomlaMfa || hasJoomlaTwoFactorField(target)) {
              finish(manualJoomlaMfa(target));
              return;
            }
            submitAttempted = true;
            var via = guardedSubmit(target, ov, readinessProfile);
            finish({
              ok: true,
              reason: "submitted",
              via: via,
              userFilled: !!target.user,
              pwFilled: true,
            });
          } catch (_) {
            fail();
          }
        };
        if (readinessProfile === "cpanel")
          cpanel.wait(
            captured,
            submit,
            Math.max(options.submitDelayMs, CPANEL_POLICY.submitSettleMs),
            true,
          );
        else if (options.submitDelayMs)
          retryTimer = setTimeout(submit, options.submitDelayMs);
        else submit();
      } catch (_) {
        fail();
      }
    }
    function tick() {
      if (finished) return;
      if (stopped || window.location.origin !== origin) {
        cancel();
        return;
      }
      try {
        var target = findLoginForm(ov, options);
        if (!target) openFreepbxAdmin(ov);
        if (target && target.pw) {
          // No retries after an attempted submit, including thrown handlers.
          var captured = captureTarget(target, options);
          activeCapture = captured;
          if (readinessProfile === "cpanel") {
            if (!cpanel.accept(captured)) {
              finish({ ok: false, reason: "form-changed-or-unsafe" });
              return;
            }
            if (!target.form || !target.user || !target.submit) {
              activeCapture = null;
              retryTimer = setTimeout(tick, Math.min(100 + tries * 50, 400));
              return;
            }
            cpanel.wait(
              captured,
              function () {
                fill(captured);
              },
              Math.max(options.fillDelayMs, CPANEL_POLICY.pageSettleMs),
              false,
            );
            return;
          }
          if (options.fillDelayMs)
            retryTimer = setTimeout(function () {
              fill(captured);
            }, options.fillDelayMs);
          else fill(captured);
          return;
        }
        if (++tries >= 20 && rawOptions == null) {
          finish({ ok: false, reason: "form-not-found-timeout" });
          return;
        }
        retryTimer = setTimeout(tick, Math.min(100 + tries * 50, 400));
      } catch (error) {
        var reason =
          error &&
          [
            "unsafe-form-action",
            "unsafe-form-method",
            "unsafe-form-target",
            "invalid-extra-field",
          ].indexOf(error.message) >= 0
            ? error.message
            : "form-fill-failed";
        finish({ ok: false, reason: reason });
      }
    }
    cancelActive = cancel;
    try {
      options = normalizeFormOptions(rawOptions);
    } catch (_) {
      finish({ ok: false, reason: "invalid-form-options" });
      return;
    }
    // Bounds even a document which never reaches DOMContentLoaded.
    lifetimeTimer = setTimeout(
      function () {
        finish({ ok: false, reason: "form-not-found-timeout" });
      },
      readinessDeadline !== undefined
        ? Math.max(
            0,
            Math.min(
              options.detectionTimeoutMs,
              readinessDeadline - Date.now(),
            ),
          )
        : readinessProfile === "cpanel"
          ? Math.max(options.detectionTimeoutMs, CPANEL_POLICY.detectionFloorMs)
          : options.detectionTimeoutMs,
    );
    if (stopped) {
      cancel();
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tick, { once: true });
    } else {
      tick();
    }
  });
}
