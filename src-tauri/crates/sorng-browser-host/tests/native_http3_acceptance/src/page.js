function runOwnedHttp3Fixture({ index, check, alternateOrigin, probeNonce }) {
  if (check === "revoke") {
    let ready = false;
    let used = false;
    const validNonce =
      typeof probeNonce === "string" && /^[a-f0-9-]{1,80}$/.test(probeNonce);
    const request = typeof fetch === "function" ? fetch.bind(globalThis) : null;
    const answer = (attempted, blocked) => ({
      attempted,
      blocked,
      tag: probeNonce,
    });
    Object.defineProperty(globalThis, "__ownedH3RevokeProbe", {
      configurable: false,
      writable: false,
      value: async (tag) => {
        if (!validNonce || !ready || used || tag !== probeNonce || !request)
          return answer(false, false);
        used = true;
        let pending;
        try {
          pending = request(`/__post-revoke/${probeNonce}`, {
            cache: "no-store",
            redirect: "error",
          });
          if (!pending || typeof pending.then !== "function")
            return answer(false, false);
        } catch {
          // Invalid/missing fetch or a synchronous programming error is not network rejection proof.
          return answer(false, false);
        }
        try {
          await pending;
          return answer(true, false);
        } catch {
          return answer(true, true);
        }
      },
    });
    setTimeout(async () => {
      try {
        if (!validNonce || !request)
          throw new Error("Fixture revoke nonce unavailable");
        const deadline = performance.now() + 8000;
        // Sequential, completed bodies only: fallback is not H3, and never32 in flight.
        for (
          let attempt = 0;
          attempt < 8 && performance.now() < deadline;
          attempt++
        ) {
          const response = await request("/asset/0", {
            cache: "no-store",
            redirect: "error",
          });
          const body = await response.text();
          if (response.ok && body === "owned-h3:/asset/0") {
            ready = true;
            document.title = `h3-revoke-ready-${index}`;
            return;
          }
        }
        throw new Error("Fixture initial owned H3 unavailable");
      } catch {
        document.title = `request-rejected-${index}`;
      }
    }, 750);
    return;
  }
  // Only the delayed-admission check separates connection warmup from the
  // measured 32 assets. A TCP body is never protocol evidence for this phase.
  async function waitForHttp3Warmup() {
    const deadline = performance.now() + 8000;
    for (
      let attempt = 0;
      attempt < 8 && performance.now() < deadline;
      attempt++
    ) {
      const controller = new AbortController();
      let timer;
      try {
        const expiration = new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new Error("Owned H3 warmup request deadline"));
            },
            Math.max(1, Math.min(1000, deadline - performance.now())),
          );
        });
        const observed = await Promise.race([
          fetch("/warmup", {
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          }).then(async (response) => ({
            ok: response.ok,
            body: await response.text(),
          })),
          expiration,
        ]);
        if (
          performance.now() < deadline &&
          observed.ok &&
          observed.body === "owned-h3:/warmup"
        ) {
          return;
        }
      } catch {
        // A bounded retry may observe the newly admitted same-authority QUIC
        // session. No alternate endpoint or direct-network fallback is used.
      } finally {
        clearTimeout(timer);
      }
      if (performance.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, deadline - performance.now())),
        );
      }
    }
    throw new Error("Owned H3 warmup was not observed");
  }

  if (check === "isolation" && index === 1) {
    setInterval(() => fetch("/survivor").catch(() => null), 250);
  }
  setTimeout(async () => {
    try {
      if (check === "delay") await waitForHttp3Warmup();
      const results = await Promise.all(
        Array.from({ length: 32 }, (_, i) =>
          fetch(
            "/asset/" + i,
            check === "delay" ? { cache: "no-store" } : undefined,
          ).then((response) => response.text()),
        ),
      );
      if (check === "cross-authority") {
        await fetch(alternateOrigin + "/bootstrap-alternate").catch(() => null);
        await fetch(alternateOrigin + "/asset/denied").catch(() => null);
      }
      document.title = results.every((body) => body.startsWith("owned-h3:"))
        ? `h3-done-${index}`
        : `fallback-done-${index}`;
    } catch {
      document.title = `request-rejected-${index}`;
    }
  }, 750);
}
