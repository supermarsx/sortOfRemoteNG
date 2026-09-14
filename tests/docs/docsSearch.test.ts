import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import {
  mountDocsSearch,
  prepareSearchIndex,
  rankSearchPages,
  searchSnippet,
  searchTokens,
} from "../../docs/assets/js/search.js";

const indexUrl = "https://docs.example/sortOfRemoteNG/search.json";
const fixture = [
  {
    title: "SSH connections",
    url: "/sortOfRemoteNG/ssh/",
    description: "Connect to a server",
    content: "Configure SSH keys and terminal sessions.",
  },
  {
    title: "Saved passwords",
    url: "/sortOfRemoteNG/passwords/",
    description: "Credentials for SSH",
    content: "Use the encrypted credential vault.",
  },
  {
    title: "A general guide",
    url: "/sortOfRemoteNG/guide/",
    description: "Everyday tasks",
    content: "Connect to SSH with a saved password.",
  },
];
const markup = readFileSync("docs/_includes/search.html", "utf8").replace(
  "{{ '/search.json' | relative_url }}",
  "/sortOfRemoteNG/search.json",
);
const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  document.head.querySelectorAll("base").forEach((base) => base.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount(
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }),
) {
  const base = document.createElement("base");
  base.href = "https://docs.example/sortOfRemoteNG/deep/page/";
  document.head.append(base);
  document.body.innerHTML = `<button data-search-open hidden>Search</button>${markup}`;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  // jsdom has no native top-layer/focus-inert model. Exercise our lifecycle
  // around the real browser's modal methods, not a simulated focus trap.
  dialog.showModal = vi.fn(() => {
    dialog.open = true;
  });
  dialog.close = vi.fn(() => {
    dialog.open = false;
    dialog.dispatchEvent(new Event("close"));
  });
  const dispose = mountDocsSearch(dialog, { fetcher });
  disposals.push(dispose);
  return {
    dialog,
    fetcher,
    dispose,
    trigger: document.querySelector<HTMLButtonElement>("[data-search-open]")!,
    input: dialog.querySelector<HTMLInputElement>("input")!,
    status: dialog.querySelector<HTMLElement>("[data-search-status]")!,
    results: dialog.querySelector<HTMLOListElement>("ol")!,
    retry: dialog.querySelector<HTMLButtonElement>("[data-search-retry]")!,
    open() {
      fireEvent.click(this.trigger);
    },
    query(value: string) {
      fireEvent.input(this.input, { target: { value } });
    },
  };
}

describe("documentation full-text search", () => {
  it("ranks title before description before body, matching every query term", () => {
    const pages = prepareSearchIndex(fixture, indexUrl);
    expect(
      rankSearchPages(pages, "ssh").map(
        ({ page }: { page: { title: string } }) => page.title,
      ),
    ).toEqual(["SSH connections", "Saved passwords", "A general guide"]);
    expect(
      rankSearchPages(pages, "ssh password").map(
        ({ page }: { page: { title: string } }) => page.title,
      ),
    ).toEqual(["Saved passwords", "A general guide"]);
    expect(rankSearchPages(pages, "ssh missing")).toEqual([]);
    expect(rankSearchPages(pages, "!? ")).toEqual([]);
  });

  it("normalizes accents and case and bounds query work without regex injection", () => {
    expect(searchTokens("CAFÉ café [ssh].*")).toEqual(["cafe", "ssh"]);
    expect(searchTokens("q ".repeat(500))).toEqual(["q"]);
    expect(
      searchTokens(
        "one two three four five six seven eight nine ten eleven twelve thirteen",
      ),
    ).toHaveLength(12);
    const pages = prepareSearchIndex(
      [{ ...fixture[0], title: "Café access" }],
      indexUrl,
    );
    expect(rankSearchPages(pages, "CAFE")).toHaveLength(1);
  });

  it("searches the full page, with a bounded snippet around a deep content match", () => {
    const content = `${"Introduction ".repeat(300)}A unique Synology grant boundary. ${"More text ".repeat(100)}`;
    const [page] = prepareSearchIndex([{ ...fixture[0], content }], indexUrl);
    expect(rankSearchPages([page], "grant")).toHaveLength(1);
    const snippet = searchSnippet(page, "grant");
    expect(snippet).toContain("Synology grant boundary");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(192);
  });

  it.each([
    "https://evil.example/page/",
    "//evil.example/page/",
    "/outside/",
    "/sortOfRemoteNG/../outside/",
    "/sortOfRemoteNG/%5coutside/",
    "/sortOfRemoteNG/%00page/",
    "/sortOfRemoteNG/ssh/?token=private",
    "/sortOfRemoteNG/ssh/#fragment",
    "javascript:alert(1)",
  ])("rejects an unsafe result URL: %s", (url) => {
    expect(() =>
      prepareSearchIndex([{ ...fixture[0], url }], indexUrl),
    ).toThrow();
  });

  it("accepts both project-site and root-site URLs, rejecting malformed or duplicate indexes", () => {
    expect(prepareSearchIndex(fixture, indexUrl)[0].url).toBe(fixture[0].url);
    expect(
      prepareSearchIndex(
        [{ ...fixture[0], url: "/ssh/" }],
        "https://docs.example/search.json",
      )[0].url,
    ).toBe("/ssh/");
    for (const value of [
      null,
      [],
      {},
      [{ ...fixture[0], title: "" }],
      [fixture[0], fixture[0]],
    ])
      expect(() => prepareSearchIndex(value, indexUrl)).toThrow();
  });

  it("fetches lazily once, retains only its in-memory index, and never sends typed queries", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const view = mount();
    expect(view.fetcher).not.toHaveBeenCalled();
    view.trigger.focus();
    view.open();
    expect(view.dialog.showModal).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(view.input);
    expect(view.status).toHaveTextContent("Loading");
    view.query("ssh secret typed query");
    await waitFor(() =>
      expect(view.status).toHaveTextContent("No matching pages"),
    );
    expect(view.fetcher).toHaveBeenCalledWith(
      indexUrl,
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    expect(storageWrite).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: "Escape" });
    expect(view.input.value).toBe("");
    expect(document.activeElement).toBe(view.trigger);
    view.open();
    view.query("ssh");
    expect(view.results.querySelectorAll("a")).toHaveLength(3);
    expect(view.fetcher).toHaveBeenCalledTimes(1);
  });

  it("supports Ctrl/Cmd K, arrow browsing, return to input, Enter, and Escape", async () => {
    const view = mount();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(view.dialog.open).toBe(true);
    view.query("ssh");
    await waitFor(() =>
      expect(view.results.querySelectorAll("a")).toHaveLength(3),
    );
    const links = [...view.results.querySelectorAll("a")];
    fireEvent.keyDown(view.input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(links[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(view.input);
    fireEvent.keyDown(view.input, { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[2]);
    fireEvent.keyDown(links[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(view.input);
    const navigate = vi.fn((event: Event) => event.preventDefault());
    links[0].addEventListener("click", navigate);
    fireEvent.submit(view.dialog.querySelector("form")!);
    expect(navigate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.dialog.open).toBe(false);
    fireEvent.keyDown(document, { key: "K", metaKey: true });
    expect(view.dialog.open).toBe(true);
    expect(view.fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts during IME composition", () => {
    const view = mount();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, isComposing: true });
    expect(view.dialog.open).toBe(false);
    expect(view.fetcher).not.toHaveBeenCalled();
  });

  it("uses safe text nodes for titles, snippets, and attacker-shaped queries", async () => {
    const payload = [
      {
        ...fixture[0],
        title: '<img src=x onerror="alert(1)">',
        content: "script <script>alert(2)</script>",
      },
    ];
    const view = mount(
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    );
    view.open();
    view.query("script");
    await waitFor(() => expect(view.results.querySelector("a")).not.toBeNull());
    expect(view.results.querySelector("img, script")).toBeNull();
    expect(view.results).toHaveTextContent("<script>alert(2)</script>");
    expect(view.results.querySelector("mark")).toHaveTextContent("script");
    expect(view.results.querySelector("mark")?.children).toHaveLength(0);
    view.query('<img src="x">');
    expect(view.results.querySelector("img")).toBeNull();
  });

  it("caps displayed results and explains no-result and punctuation-only queries", async () => {
    const payload = Array.from({ length: 30 }, (_, number) => ({
      ...fixture[0],
      url: `/sortOfRemoteNG/page-${number}/`,
      title: `SSH ${number}`,
    }));
    const view = mount(
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    );
    view.open();
    view.query("ssh");
    await waitFor(() =>
      expect(view.status).toHaveTextContent(
        "30 pages found; showing the best 20",
      ),
    );
    expect(view.results.children).toHaveLength(20);
    view.query("missing");
    expect(view.status).toHaveTextContent("No matching pages");
    expect(view.results.children).toHaveLength(0);
    view.query("***");
    expect(view.status).toHaveTextContent("Search page titles");
  });

  it("reports failure and retries only intentionally, preserving the current query", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => fixture });
    const view = mount(fetcher);
    view.open();
    view.query("ssh");
    await waitFor(() => expect(view.retry.hidden).toBe(false));
    expect(view.status).toHaveTextContent("Search could not load");
    view.query("ssh connections");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(view.retry);
    fireEvent.click(view.retry);
    await waitFor(() => expect(view.results.children).toHaveLength(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.retry.hidden).toBe(true);
  });

  it.each(["request", "body"])(
    "times out a stalled %s and ignores its late response",
    async (stage) => {
      vi.useFakeTimers();
      let resolve!: (value: unknown) => void;
      const stalled = new Promise((done) => {
        resolve = done;
      });
      const fetcher =
        stage === "request"
          ? vi.fn(() => stalled)
          : vi.fn().mockResolvedValue({ ok: true, json: () => stalled });
      const view = mount(fetcher);
      view.open();
      await vi.advanceTimersByTimeAsync(10000);
      expect(view.status).toHaveTextContent("Search could not load");
      expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
      resolve(
        stage === "request" ? { ok: true, json: async () => fixture } : fixture,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(view.results.children).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("aborts pending work and removes shortcuts on disposal", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const view = mount(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    view.open();
    view.dispose();
    expect(view.fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    resolve({ ok: true, json: async () => fixture });
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(view.dialog.open).toBe(false);
    expect(view.trigger.hidden).toBe(true);
    expect(document.body).not.toHaveClass("search-open");
  });

  it("closes mobile navigation before entering the modal and returns focus to a visible trigger", () => {
    const view = mount();
    view.dispose();
    const mobile = document.createElement("button");
    mobile.className = "mobile-search";
    const sidebar = document.createElement("aside");
    sidebar.id = "site-navigation";
    document.body.prepend(mobile, sidebar);
    sidebar.append(view.trigger);
    const onOpen = vi.fn(() => {
      sidebar.inert = true;
    });
    document.addEventListener("docs-search-open", onOpen, { once: true });
    disposals.push(mountDocsSearch(view.dialog, { fetcher: view.fetcher }));
    view.trigger.focus();
    view.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(sidebar.inert).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(mobile);
    expect(readFileSync("docs/assets/js/site.js", "utf8")).toContain(
      'document.addEventListener("docs-search-open"',
    );
  });
});

describe("static search index contract", () => {
  it("uses built-in Jekyll filters for all public pages, not a hand-picked navigation subset", () => {
    const source = readFileSync("docs/search.json", "utf8");
    expect(source).toContain("layout: null");
    expect(source).toContain("search: false");
    expect(source).toContain("site.pages | sort: 'url'");
    expect(source).not.toContain("site.data.navigation");
    expect(source).toContain("entry.layout == 'default'");
    expect(source).toContain("entry.search != false");
    expect(source).toContain("entry.published != false");
    for (const excluded of [
      "plans",
      "cedar-reference",
      "assets",
      "README.md",
      "/404.html",
    ])
      expect(source).toContain(excluded);
    expect(source).toContain("entry.url | relative_url | jsonify");
    expect(source).toContain(
      "entry.content | markdownify | strip_html | normalize_whitespace | jsonify",
    );
    expect(source).not.toMatch(/truncate|site\.posts/);
  });

  it("ships accessible, baseurl-safe entry points on desktop and mobile", () => {
    const layout = readFileSync("docs/_layouts/default.html", "utf8");
    expect(layout).toContain("include search.html");
    expect(layout).toContain("'/assets/js/search.js' | relative_url");
    expect(layout).toContain("data-search-open");
    expect(readFileSync("docs/_includes/sidebar.html", "utf8")).toContain(
      "data-search-open",
    );
    expect(markup).toContain('aria-labelledby="docs-search-title"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('autocomplete="off"');
    const source = readFileSync("docs/assets/js/search.js", "utf8");
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|history\./,
    );
    expect(readFileSync("docs/assets/css/site.css", "utf8")).toContain(
      "100dvh",
    );
  });
});
