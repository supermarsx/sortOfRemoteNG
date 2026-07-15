(() => {
  const body = document.body;
  const sidebar = document.querySelector("#site-navigation");
  const toggle = document.querySelector("[data-nav-toggle]");
  const closeButton = document.querySelector("[data-nav-close]");
  const scrim = document.querySelector("[data-nav-scrim]");
  const desktop = window.matchMedia("(min-width: 64rem)");
  let returnFocus = null;

  if (!sidebar || !toggle || !closeButton || !scrim) return;

  const focusable = () =>
    Array.from(
      sidebar.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

  const closeNavigation = ({ restoreFocus = true } = {}) => {
    body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && returnFocus instanceof HTMLElement) returnFocus.focus();
    returnFocus = null;
  };

  const openNavigation = () => {
    returnFocus = document.activeElement;
    body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    closeButton.focus();
  };

  toggle.addEventListener("click", () => {
    if (body.classList.contains("nav-open")) closeNavigation();
    else openNavigation();
  });
  closeButton.addEventListener("click", () => closeNavigation());
  scrim.addEventListener("click", () => closeNavigation());

  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a") && !desktop.matches) {
      closeNavigation({ restoreFocus: false });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!body.classList.contains("nav-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const handleViewportChange = (event) => {
    if (event.matches) closeNavigation({ restoreFocus: false });
  };
  desktop.addEventListener?.("change", handleViewportChange);
})();
