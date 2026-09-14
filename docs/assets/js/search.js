const normalize = (text) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function searchTokens(query) {
  return [
    ...new Set(normalize(query.slice(0, 120)).match(/[\p{L}\p{N}]+/gu) || []),
  ].slice(0, 12);
}

export function prepareSearchIndex(payload, indexUrl) {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 5000)
    throw new Error("Invalid documentation index");
  const base = new URL(".", indexUrl);
  const seen = new Set();
  return payload.map((entry) => {
    if (
      !entry ||
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      typeof entry.url !== "string" ||
      !entry.url.startsWith("/") ||
      entry.url.startsWith("//") ||
      typeof entry.description !== "string" ||
      typeof entry.content !== "string"
    )
      throw new Error("Invalid documentation page");
    const url = new URL(entry.url, base);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(base.pathname) ||
      /[\\\u0000-\u001f]/.test(decodedPath) ||
      decodedPath.split("/").some((part) => part === ".." || part === ".") ||
      seen.has(url.href)
    )
      throw new Error("Invalid documentation URL");
    seen.add(url.href);
    return {
      title: entry.title,
      url: url.pathname,
      description: entry.description,
      content: entry.content,
      titleText: normalize(entry.title),
      descriptionText: normalize(entry.description),
      contentText: normalize(entry.content),
    };
  });
}

export function rankSearchPages(pages, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const phrase = normalize(query.trim());
  return pages
    .flatMap((page) => {
      let score =
        page.titleText === phrase
          ? 1000
          : page.titleText.includes(phrase)
            ? 200
            : 0;
      for (const token of tokens) {
        const title = page.titleText.includes(token);
        const description = page.descriptionText.includes(token);
        const content = page.contentText.includes(token);
        if (!title && !description && !content) return [];
        score += (title ? 40 : 0) + (description ? 10 : 0) + (content ? 1 : 0);
      }
      return [{ page, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.page.title.localeCompare(right.page.title),
    );
}

export function searchSnippet(page, query) {
  const tokens = searchTokens(query);
  const source = tokens.some((token) => page.contentText.includes(token))
    ? page.content
    : page.description || page.content;
  const positions = tokens
    .map((token) => normalize(source).indexOf(token))
    .filter((position) => position >= 0);
  const position = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, position - 55);
  if (start) {
    const boundary = source.indexOf(" ", start);
    if (boundary >= 0 && boundary < position) start = boundary + 1;
  }
  const end = Math.min(source.length, start + 190);
  return `${start ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
}

export function mountDocsSearch(dialog, { fetcher = globalThis.fetch } = {}) {
  if (typeof dialog.showModal !== "function") return () => {};
  const doc = dialog.ownerDocument;
  const input = dialog.querySelector("[data-search-input]");
  const status = dialog.querySelector("[data-search-status]");
  const results = dialog.querySelector("[data-search-results]");
  const retry = dialog.querySelector("[data-search-retry]");
  const triggers = [...doc.querySelectorAll("[data-search-open]")];
  const listeners = [];
  let pages = null;
  let loading = false;
  let failed = false;
  let disposed = false;
  let returnFocus = null;
  let request = null;
  let timeout = null;
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const render = () => {
    if (disposed || !dialog.open) return;
    results.replaceChildren();
    results.setAttribute("aria-busy", String(loading));
    retry.hidden = !failed;
    if (loading) {
      status.textContent = "Loading the documentation index…";
      return;
    }
    if (failed) {
      status.textContent =
        "Search could not load. Check your connection and retry, or use the documentation navigation.";
      return;
    }
    if (!searchTokens(input.value).length) {
      status.textContent =
        "Search page titles and the full documentation text.";
      return;
    }
    const matches = rankSearchPages(pages || [], input.value);
    const shown = matches.slice(0, 20);
    status.textContent = matches.length
      ? `${matches.length} ${matches.length === 1 ? "page" : "pages"} found${matches.length > shown.length ? "; showing the best 20" : ""}.`
      : "No matching pages. Try fewer words or a different term.";
    for (const { page } of shown) {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      link.href = page.url;
      const title = doc.createElement("strong");
      emphasize(title, page.title);
      const snippet = doc.createElement("span");
      snippet.className = "search-snippet";
      emphasize(snippet, searchSnippet(page, input.value));
      const route = doc.createElement("small");
      route.textContent = page.url;
      link.append(title, snippet, route);
      item.append(link);
      results.append(item);
    }
  };
  const emphasize = (element, value) => {
    // Tokens contain only letters/numbers. Neither index text nor the query
    // is ever interpreted as HTML or as arbitrary regular-expression syntax.
    const tokens = searchTokens(input.value).sort(
      (a, b) => b.length - a.length,
    );
    const pattern = new RegExp(tokens.join("|"), "giu");
    let position = 0;
    for (const match of value.matchAll(pattern)) {
      element.append(doc.createTextNode(value.slice(position, match.index)));
      const mark = doc.createElement("mark");
      mark.textContent = match[0];
      element.append(mark);
      position = match.index + match[0].length;
    }
    element.append(doc.createTextNode(value.slice(position)));
  };
  const load = async () => {
    if (loading || pages || disposed) return;
    loading = true;
    failed = false;
    render();
    request = new AbortController();
    try {
      const indexUrl = new URL(dialog.dataset.searchIndex, doc.baseURI);
      if (
        indexUrl.origin !== new URL(doc.baseURI).origin ||
        indexUrl.search ||
        indexUrl.hash
      )
        throw new Error("Invalid search index URL");
      const payload = await Promise.race([
        (async () => {
          const response = await fetcher(indexUrl.href, {
            credentials: "omit",
            signal: request.signal,
            redirect: "error",
          });
          if (!response.ok) throw new Error("Search unavailable");
          return response.json();
        })(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            request.abort();
            reject(new Error("Search timed out"));
          }, 10000);
        }),
      ]);
      if (!disposed) pages = prepareSearchIndex(payload, indexUrl);
    } catch {
      if (!disposed) failed = true;
    } finally {
      clearTimeout(timeout);
      timeout = null;
      loading = false;
      render();
    }
  };
  const close = () => dialog.close();
  const open = () => {
    if (dialog.open || disposed) return;
    returnFocus = doc.activeElement;
    doc.dispatchEvent(new CustomEvent("docs-search-open"));
    if (
      returnFocus?.closest("[inert]") ||
      returnFocus?.closest("#site-navigation")?.inert
    )
      returnFocus = doc.querySelector(".mobile-search");
    dialog.showModal();
    doc.body.classList.add("search-open");
    input.focus();
    render();
    if (!failed) void load();
  };
  for (const trigger of triggers) {
    trigger.hidden = false;
    const key = trigger.querySelector("kbd");
    if (key && /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || ""))
      key.textContent = "⌘ K";
    on(trigger, "click", open);
  }
  on(dialog.querySelector("[data-search-close]"), "click", close);
  on(dialog, "cancel", (event) => {
    event.preventDefault();
    close();
  });
  on(dialog, "close", () => {
    doc.body.classList.remove("search-open");
    input.value = "";
    results.replaceChildren();
    returnFocus?.focus();
    returnFocus = null;
  });
  on(dialog, "click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  });
  on(input, "input", render);
  on(retry, "click", () => void load());
  on(dialog.querySelector("[data-search-form]"), "submit", (event) => {
    event.preventDefault();
    results.querySelector("a")?.click();
  });
  on(doc, "keydown", (event) => {
    if (event.isComposing) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "k"
    ) {
      event.preventDefault();
      open();
      input.focus();
      return;
    }
    if (!dialog.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const links = [...results.querySelectorAll("a")];
    if (
      !links.length ||
      (doc.activeElement !== input && !links.includes(doc.activeElement))
    )
      return;
    event.preventDefault();
    const current = links.indexOf(doc.activeElement);
    const next =
      event.key === "ArrowDown"
        ? current + 1
        : current < 0
          ? links.length - 1
          : current - 1;
    const target = next < 0 || next >= links.length ? input : links[next];
    target.focus();
    target.scrollIntoView?.({ block: "nearest" });
  });
  return () => {
    disposed = true;
    request?.abort();
    clearTimeout(timeout);
    if (dialog.open) close();
    doc.body.classList.remove("search-open");
    listeners.forEach((remove) => remove());
    triggers.forEach((trigger) => {
      trigger.hidden = true;
    });
    pages = null;
  };
}

if (typeof document !== "undefined")
  for (const dialog of document.querySelectorAll("[data-docs-search]"))
    mountDocsSearch(dialog);
