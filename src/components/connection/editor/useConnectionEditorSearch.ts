import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  navigateToConnectionEditorSearchDescriptor,
  type ConnectionEditorExpandableSectionId,
  type ConnectionEditorSearchDescriptor,
  type ConnectionEditorTabId,
} from "./editorRegistry";

const SKIP_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SCRIPT",
  "STYLE",
  "SELECT",
  "OPTION",
]);

function clearAllMarks(container: HTMLElement) {
  const marks = container.querySelectorAll("mark[data-sh]");
  marks.forEach((mark) => {
    const text = document.createTextNode(mark.textContent || "");
    mark.parentNode?.replaceChild(text, mark);
  });
  container.normalize();
}

function applyHighlights(container: HTMLElement, query: string): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-search-bar]")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.hasAttribute("data-sh")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);

  let count = 0;
  for (const textNode of nodes) {
    const value = textNode.textContent || "";
    const index = value.toLowerCase().indexOf(query);
    if (index === -1) continue;
    count++;

    const fragment = document.createDocumentFragment();
    if (index > 0) {
      fragment.appendChild(document.createTextNode(value.slice(0, index)));
    }
    const mark = document.createElement("mark");
    mark.setAttribute("data-sh", "1");
    mark.className = "bg-warning/40 text-[var(--color-text)] rounded-sm px-0.5";
    mark.textContent = value.slice(index, index + query.length);
    fragment.appendChild(mark);
    if (index + query.length < value.length) {
      fragment.appendChild(
        document.createTextNode(value.slice(index + query.length)),
      );
    }
    textNode.parentNode!.replaceChild(fragment, textNode);
  }
  return count;
}

function focusMatch(container: HTMLElement, index: number) {
  const marks = container.querySelectorAll("mark[data-sh]");
  marks.forEach((mark, matchIndex) => {
    if (matchIndex === index) {
      mark.className =
        "bg-warning text-[var(--color-text)] rounded-sm px-0.5 ring-1 ring-warning";
      const scroller = container.parentElement;
      if (scroller) {
        const markRect = (mark as HTMLElement).getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const offset =
          markRect.top -
          scrollerRect.top -
          scroller.clientHeight / 2 +
          markRect.height / 2;
        scroller.scrollBy({ top: offset, behavior: "smooth" });
      }
    } else {
      mark.className =
        "bg-warning/30 text-[var(--color-text)] rounded-sm px-0.5";
    }
  });
}

function findSearchTarget(
  container: HTMLElement,
  fieldId: string,
  sectionId: string,
): HTMLElement | null {
  const fieldTarget = Array.from(
    container.querySelectorAll<HTMLElement>(
      "[data-editor-search-field], [data-testid]",
    ),
  ).find(
    (candidate) =>
      candidate.dataset.editorSearchField === fieldId ||
      candidate.dataset.testid === `editor-${fieldId}`,
  );

  if (fieldTarget) return fieldTarget;

  return (
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-editor-search-section]"),
    ).find(
      (candidate) => candidate.dataset.editorSearchSection === sectionId,
    ) ?? null
  );
}

function focusSearchTarget(target: HTMLElement) {
  const focusableSelector =
    'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusable = target.matches(focusableSelector)
    ? target
    : target.querySelector<HTMLElement>(focusableSelector);
  focusable?.focus();
  target.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

interface ConnectionEditorSearchNavigationOptions {
  descriptors: readonly ConnectionEditorSearchDescriptor[];
  activateTab: (tabId: ConnectionEditorTabId) => void;
  expandSection: (sectionId: ConnectionEditorExpandableSectionId) => void;
}

export function useConnectionEditorSearch(
  containerRef: RefObject<HTMLElement | null>,
  refreshKey: unknown,
  navigation: ConnectionEditorSearchNavigationOptions,
) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    clearAllMarks(container);

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      setMatchCount(0);
      setCurrentIndex(0);
      return;
    }

    const count = applyHighlights(container, normalizedQuery);
    setMatchCount(count);
    setCurrentIndex(count > 0 ? 0 : -1);

    if (count > 0) focusMatch(container, 0);
  }, [query, containerRef, refreshKey]);

  const goNext = useCallback(() => {
    if (matchCount <= 0) return;
    const next = (currentIndex + 1) % matchCount;
    setCurrentIndex(next);
    if (containerRef.current) focusMatch(containerRef.current, next);
  }, [currentIndex, matchCount, containerRef]);

  const goPrev = useCallback(() => {
    if (matchCount <= 0) return;
    const previous = (currentIndex - 1 + matchCount) % matchCount;
    setCurrentIndex(previous);
    if (containerRef.current) focusMatch(containerRef.current, previous);
  }, [currentIndex, matchCount, containerRef]);

  const focusField = useCallback(
    (fieldId: string, sectionId: string) => {
      const schedule: (callback: FrameRequestCallback) => number =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame.bind(window)
          : (callback) =>
              window.setTimeout(() => callback(performance.now()), 0);
      schedule(() => {
        const container = containerRef.current;
        if (!container) return;
        const target = findSearchTarget(container, fieldId, sectionId);
        if (target) focusSearchTarget(target);
      });
    },
    [containerRef],
  );

  const navigateToDescriptor = useCallback(
    (sectionId: string, fieldId?: string) =>
      navigateToConnectionEditorSearchDescriptor(
        sectionId,
        {
          activateTab: navigation.activateTab,
          expandSection: navigation.expandSection,
          focusField,
        },
        fieldId,
        navigation.descriptors,
      ),
    [focusField, navigation],
  );

  return {
    query,
    setQuery,
    matchCount,
    currentIndex,
    goNext,
    goPrev,
    descriptors: navigation.descriptors,
    navigateToDescriptor,
  };
}
