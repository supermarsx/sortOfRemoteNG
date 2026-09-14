const FORM_CONTROLS = "form, input, textarea, select";
const PRIVACY_ATTRIBUTES = {
  autocomplete: "off",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/**
 * Request no browser form history in the application document. Native WebView
 * policy separately disables autofill/password saving where supported; browsers
 * and extensions can override HTML hints. Never inspect values or enter frames.
 */
export function installAppFormPrivacy(appDocument: Document): () => void {
  const root = appDocument.documentElement;
  const view = appDocument.defaultView;
  if (!root || !view) return () => {};

  const protectControl = (element: Element) => {
    if (!element.matches(FORM_CONTROLS)) return;
    for (const [attribute, value] of Object.entries(PRIVACY_ATTRIBUTES)) {
      if (element.getAttribute(attribute) !== value)
        element.setAttribute(attribute, value);
    }
  };
  const protectSubtree = (element: Element) => {
    if (element.ownerDocument !== appDocument || !root.contains(element))
      return;
    protectControl(element);
    element.querySelectorAll(FORM_CONTROLS).forEach(protectControl);
  };
  protectSubtree(root);

  const observer = new view.MutationObserver((mutations) => {
    const added = new Set<Element>();
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        protectControl(mutation.target as Element);
      } else {
        for (const node of mutation.addedNodes) {
          if (node instanceof view.Element) added.add(node);
        }
      }
    }
    for (const element of added) {
      let ancestor = element.parentElement;
      while (ancestor && !added.has(ancestor))
        ancestor = ancestor.parentElement;
      if (!ancestor) protectSubtree(element);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: Object.keys(PRIVACY_ATTRIBUTES),
  });

  // Cover synchronous focus/submit before the mutation observer's next turn.
  const onFocus = (event: Event) => {
    if (event.target instanceof view.Element) protectControl(event.target);
  };
  const onSubmit = (event: Event) => {
    if (event.target instanceof view.Element) protectSubtree(event.target);
  };
  appDocument.addEventListener("focus", onFocus, true);
  appDocument.addEventListener("submit", onSubmit, true);
  return () => {
    observer.disconnect();
    appDocument.removeEventListener("focus", onFocus, true);
    appDocument.removeEventListener("submit", onSubmit, true);
  };
}
