import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  buildConnectionEditorSearchIndex,
  searchConnectionEditorIndex,
  type ConnectionEditorSearchDynamicValues,
  type ConnectionEditorSearchFormData,
  type ConnectionEditorSearchResult,
} from "./connectionEditorSearchIndex";
import {
  type ConnectionEditorExpandableSectionId,
  type ConnectionEditorProtocolSubtabId,
  type ConnectionEditorSearchDescriptor,
  type ConnectionEditorTabDescriptor,
  type ConnectionEditorTabId,
} from "./editorRegistry";
import { scrollElementWithinContainer } from "./scrollWithinContainer";

const ACTIVE_HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-warning",
  "ring-offset-2",
  "ring-offset-[var(--color-surface)]",
  "rounded-md",
] as const;

const FOCUSABLE_SELECTOR =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const EDITOR_SCROLL_PADDING = 16;

const normalizeVisibleText = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();

function clearSearchHighlight(container: HTMLElement) {
  container
    .querySelectorAll("mark[data-editor-search-mark]")
    .forEach((mark) => {
      mark.parentNode?.replaceChild(
        document.createTextNode(mark.textContent ?? ""),
        mark,
      );
    });

  container
    .querySelectorAll<HTMLElement>("[data-editor-search-active]")
    .forEach((element) => {
      element.removeAttribute("data-editor-search-active");
      element.classList.remove(...ACTIVE_HIGHLIGHT_CLASSES);
      element.normalize();
    });
}

function findSection(container: HTMLElement, sectionId: string) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-editor-search-section]"),
  ).find((candidate) => candidate.dataset.editorSearchSection === sectionId);
}

function findExplicitTarget(scope: HTMLElement, fieldId: string) {
  const candidates = [
    scope,
    ...Array.from(
      scope.querySelectorAll<HTMLElement>(
        "[data-editor-search-field], [data-testid], [id]",
      ),
    ),
  ];
  return candidates.find(
    (candidate) =>
      candidate.dataset.editorSearchField === fieldId ||
      candidate.dataset.editorSearchSection === fieldId ||
      candidate.dataset.testid === `editor-${fieldId}` ||
      candidate.id === fieldId ||
      candidate.id === `editor-${fieldId}`,
  );
}

function findLabelTarget(scope: HTMLElement, fieldLabel?: string) {
  const normalizedLabel = normalizeVisibleText(fieldLabel);
  if (!normalizedLabel) return undefined;

  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>(
      "label, legend, h2, h3, h4, h5, button, [role=heading]",
    ),
  );
  return candidates.find((candidate) => {
    const text = normalizeVisibleText(candidate.textContent);
    const accessibleLabel = normalizeVisibleText(
      candidate.getAttribute("aria-label"),
    );
    return (
      text === normalizedLabel ||
      text.startsWith(`${normalizedLabel} `) ||
      accessibleLabel === normalizedLabel ||
      accessibleLabel.startsWith(`${normalizedLabel} `)
    );
  });
}

function resolveFocusable(
  labelTarget: HTMLElement | undefined,
  explicitTarget: HTMLElement | undefined,
  section: HTMLElement,
) {
  if (labelTarget) {
    if (labelTarget.matches(FOCUSABLE_SELECTOR)) return labelTarget;
    if (labelTarget instanceof HTMLLabelElement && labelTarget.htmlFor) {
      const controlled = document.getElementById(labelTarget.htmlFor);
      if (controlled instanceof HTMLElement) return controlled;
    }
    const nested = labelTarget.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (nested) return nested;
    const parentControl =
      labelTarget.parentElement?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (parentControl) return parentControl;
    const rowControl = labelTarget
      .closest<HTMLElement>("div")
      ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (rowControl) return rowControl;
  }

  if (explicitTarget?.matches(FOCUSABLE_SELECTOR)) return explicitTarget;
  return (
    explicitTarget?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
    section.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
  );
}

function applyTextMark(target: HTMLElement, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return;

  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-search-bar]")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        parent.matches("input, textarea, select, option, script, style") ||
        parent.closest("mark[data-editor-search-mark]")
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent ?? "";
    const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
    if (index < 0) continue;

    const fragment = document.createDocumentFragment();
    if (index > 0)
      fragment.append(document.createTextNode(text.slice(0, index)));
    const mark = document.createElement("mark");
    mark.dataset.editorSearchMark = "true";
    mark.className = "rounded-sm bg-warning/55 px-0.5 text-[var(--color-text)]";
    mark.textContent = text.slice(index, index + query.trim().length);
    fragment.append(mark);
    if (index + query.trim().length < text.length) {
      fragment.append(
        document.createTextNode(text.slice(index + query.trim().length)),
      );
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
    return;
  }
}

export function scrollConnectionEditorSearchTargetIntoView(
  container: HTMLElement,
  target: HTMLElement,
  padding = EDITOR_SCROLL_PADDING,
): boolean {
  const pane =
    target.closest<HTMLElement>("[data-editor-scroll-pane]") ??
    container.closest<HTMLElement>("[data-editor-scroll-pane]");
  return !!pane && !!scrollElementWithinContainer(pane, target, { padding });
}

function focusAndHighlightSearchTarget({
  container,
  fieldId,
  sectionId,
  fieldLabel,
  protocolSubtabId,
  query,
}: {
  container: HTMLElement;
  fieldId: string;
  sectionId: string;
  fieldLabel?: string;
  protocolSubtabId?: ConnectionEditorProtocolSubtabId;
  query: string;
}): boolean {
  if (
    protocolSubtabId &&
    !Array.from(
      container.querySelectorAll<HTMLElement>("[data-protocol-subtab]"),
    ).some((panel) => panel.dataset.protocolSubtab === protocolSubtabId)
  ) {
    return false;
  }
  clearSearchHighlight(container);
  const section = findSection(container, sectionId);
  if (!section) return false;

  const tabScope =
    section.closest<HTMLElement>("[data-editor-search-tab]") ?? section;
  const explicitTarget = findExplicitTarget(tabScope, fieldId);
  const labelTarget = findLabelTarget(tabScope, fieldLabel);
  const highlightTarget =
    labelTarget ??
    explicitTarget?.closest<HTMLElement>("[data-editor-search-field]") ??
    explicitTarget ??
    section;
  const focusable = resolveFocusable(labelTarget, explicitTarget, section);

  highlightTarget.dataset.editorSearchActive = "true";
  highlightTarget.classList.add(...ACTIVE_HIGHLIGHT_CLASSES);
  applyTextMark(highlightTarget, query);
  focusable?.focus({ preventScroll: true });
  scrollConnectionEditorSearchTargetIntoView(container, highlightTarget);
  return true;
}

function scheduleAfterTabRender(callback: () => boolean): () => void {
  let cancelled = false;
  let scheduledFrame: number | undefined;
  let scheduledTimeout: number | undefined;

  const schedule = (next: () => void) => {
    if (typeof window.requestAnimationFrame === "function") {
      scheduledFrame = window.requestAnimationFrame(next);
    } else {
      scheduledTimeout = window.setTimeout(next, 0);
    }
  };

  let attempts = 0;
  const tryResolve = () => {
    if (cancelled) return;
    attempts += 1;
    if (!callback() && attempts < 3) schedule(tryResolve);
  };
  schedule(tryResolve);

  return () => {
    cancelled = true;
    if (scheduledFrame !== undefined) {
      window.cancelAnimationFrame(scheduledFrame);
    }
    if (scheduledTimeout !== undefined) {
      window.clearTimeout(scheduledTimeout);
    }
  };
}

interface ConnectionEditorSearchNavigationOptions {
  descriptors: readonly ConnectionEditorSearchDescriptor[];
  tabs: readonly ConnectionEditorTabDescriptor[];
  formData: ConnectionEditorSearchFormData;
  dynamicValues?: ConnectionEditorSearchDynamicValues;
  activateTab: (tabId: ConnectionEditorTabId) => void;
  activateProtocolSubtab?: (subtabId: ConnectionEditorProtocolSubtabId) => void;
  expandSection: (sectionId: ConnectionEditorExpandableSectionId) => void;
}

export function useConnectionEditorSearch(
  containerRef: RefObject<HTMLElement | null>,
  navigation: ConnectionEditorSearchNavigationOptions,
) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const lastNavigatedResultId = useRef<string | undefined>(undefined);
  const cancelPendingNavigation = useRef<() => void>(() => {});

  const index = useMemo(
    () =>
      buildConnectionEditorSearchIndex({
        descriptors: navigation.descriptors,
        tabs: navigation.tabs,
        formData: navigation.formData,
        dynamicValues: navigation.dynamicValues,
      }),
    [
      navigation.descriptors,
      navigation.dynamicValues,
      navigation.formData,
      navigation.tabs,
    ],
  );
  const results = useMemo(
    () => searchConnectionEditorIndex(index, query),
    [index, query],
  );

  useEffect(() => {
    cancelPendingNavigation.current();
    setCurrentIndex(results.length > 0 ? 0 : -1);
    lastNavigatedResultId.current = undefined;
    const container = containerRef.current;
    if (container) clearSearchHighlight(container);
  }, [containerRef, query, results.length]);

  useEffect(
    () => () => {
      cancelPendingNavigation.current();
      const container = containerRef.current;
      if (container) clearSearchHighlight(container);
    },
    [containerRef],
  );

  useEffect(() => {
    const container = containerRef.current;
    const pane = container?.closest<HTMLElement>("[data-editor-scroll-pane]");
    if (!container || !pane) return;

    let scheduledFrame: number | undefined;
    const keepActiveTargetContained = () => {
      if (scheduledFrame !== undefined) {
        window.cancelAnimationFrame(scheduledFrame);
      }
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = undefined;
        const activeTarget = container.querySelector<HTMLElement>(
          '[data-editor-search-active="true"]',
        );
        if (activeTarget) {
          scrollConnectionEditorSearchTargetIntoView(container, activeTarget);
        }
      });
    };

    window.addEventListener("resize", keepActiveTargetContained);
    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(keepActiveTargetContained)
        : undefined;
    resizeObserver?.observe(pane);

    return () => {
      window.removeEventListener("resize", keepActiveTargetContained);
      resizeObserver?.disconnect();
      if (scheduledFrame !== undefined) {
        window.cancelAnimationFrame(scheduledFrame);
      }
    };
  }, [containerRef]);

  const focusField = useCallback(
    (
      fieldId: string,
      sectionId: string,
      fieldLabel?: string,
      protocolSubtabId?: ConnectionEditorProtocolSubtabId,
    ) => {
      cancelPendingNavigation.current();
      cancelPendingNavigation.current = scheduleAfterTabRender(() => {
        const container = containerRef.current;
        if (!container) return false;
        return focusAndHighlightSearchTarget({
          container,
          fieldId,
          sectionId,
          fieldLabel,
          protocolSubtabId,
          query,
        });
      });
    },
    [containerRef, query],
  );

  const navigateToResult = useCallback(
    (result: ConnectionEditorSearchResult) => {
      const descriptor = navigation.descriptors.find(
        (candidate) => candidate.id === result.sectionId,
      );
      if (!descriptor) return false;

      navigation.activateTab(result.tabId);
      if (result.protocolSubtabId) {
        navigation.activateProtocolSubtab?.(result.protocolSubtabId);
      }
      if (descriptor.expandableSectionId) {
        navigation.expandSection(descriptor.expandableSectionId);
      }
      focusField(
        result.focusId,
        result.sectionId,
        result.fieldLabel,
        result.protocolSubtabId,
      );
      lastNavigatedResultId.current = result.id;
      return true;
    },
    [focusField, navigation],
  );

  const selectResult = useCallback(
    (resultIndex: number) => {
      const result = results[resultIndex];
      if (!result) return false;
      setCurrentIndex(resultIndex);
      return navigateToResult(result);
    },
    [navigateToResult, results],
  );

  const selectCurrent = useCallback(
    () => selectResult(currentIndex),
    [currentIndex, selectResult],
  );

  const navigateRelative = useCallback(
    (direction: 1 | -1) => {
      if (results.length === 0) return;
      const currentResult = results[currentIndex];
      const hasNavigatedCurrent =
        currentResult?.id === lastNavigatedResultId.current;
      const nextIndex = hasNavigatedCurrent
        ? (currentIndex + direction + results.length) % results.length
        : Math.max(currentIndex, 0);
      selectResult(nextIndex);
    },
    [currentIndex, results, selectResult],
  );

  const goNext = useCallback(() => navigateRelative(1), [navigateRelative]);
  const goPrev = useCallback(() => navigateRelative(-1), [navigateRelative]);

  return {
    query,
    setQuery,
    results,
    matchCount: results.length,
    currentIndex,
    setCurrentIndex,
    selectCurrent,
    selectResult,
    goNext,
    goPrev,
    descriptors: navigation.descriptors,
  };
}
