(() => {
  const status = document.getElementById("action-status");
  async function copy(id) {
    const text = document.getElementById(id)?.textContent ?? "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.readOnly = true;
      field.style.cssText = "position:fixed;left:-10000px;top:0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) throw new Error("copy unavailable");
    }
    if (status) status.textContent = id === "full-report" ? "Full report copied" : "Error copied";
  }
  document.getElementById("retry")?.addEventListener("click", () => {
    // A new URL navigation uses GET; reload() could resubmit a failed POST.
    window.location.assign(window.location.href);
  });
  for (const [button, report] of [["copy-error", "short-report"], ["copy-full", "full-report"]]) {
    document.getElementById(button)?.addEventListener("click", () => {
      copy(report).catch(() => { if (status) status.textContent = "Copy unavailable. Select the report in Technical details."; });
    });
  }
})();
