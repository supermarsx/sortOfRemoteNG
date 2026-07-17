import React, { useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { ConnectionEditorSearchResult } from "./connectionEditorSearchIndex";

const RESULTS_ID = "connection-editor-search-results";

const HighlightedText: React.FC<{ text: string; query: string }> = ({
  text,
  query,
}) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (!normalizedQuery || index < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-warning/45 px-0.5 text-[var(--color-text)]">
        {text.slice(index, index + query.trim().length)}
      </mark>
      {text.slice(index + query.trim().length)}
    </>
  );
};

export const ConnectionEditorSearchBar: React.FC<{
  query: string;
  setQuery: (query: string) => void;
  results: readonly ConnectionEditorSearchResult[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  selectCurrent: () => void;
  selectResult: (index: number) => void;
  goNext: () => void;
  goPrev: () => void;
}> = ({
  query,
  setQuery,
  results,
  currentIndex,
  setCurrentIndex,
  selectCurrent,
  selectResult,
  goNext,
  goPrev,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;
  const matchCount = results.length;

  const moveActive = (direction: 1 | -1) => {
    if (matchCount === 0) return;
    const start = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;
    setCurrentIndex((start + direction + matchCount) % matchCount);
  };

  return (
    <div
      data-search-bar
      className="relative w-full min-w-0 max-w-[340px] flex-[1_1_240px]"
    >
      <div
        data-testid="editor-search-bar"
        className="flex h-9 items-center gap-1 rounded-lg bg-[var(--color-border)]/60 px-2 py-1"
      >
        <Search
          size={13}
          aria-hidden="true"
          className="flex-shrink-0 text-[var(--color-textMuted)]"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search connection settings"
          aria-autocomplete="list"
          aria-expanded={hasQuery}
          aria-controls={hasQuery ? RESULTS_ID : undefined}
          aria-activedescendant={
            hasQuery && currentIndex >= 0
              ? `connection-editor-search-result-${currentIndex}`
              : undefined
          }
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.preventDefault();
              return;
            }
            if (event.key === "ArrowDown") {
              moveActive(1);
              event.preventDefault();
              return;
            }
            if (event.key === "ArrowUp") {
              moveActive(-1);
              event.preventDefault();
              return;
            }
            if (event.key === "Home" && matchCount > 0) {
              setCurrentIndex(0);
              event.preventDefault();
              return;
            }
            if (event.key === "End" && matchCount > 0) {
              setCurrentIndex(matchCount - 1);
              event.preventDefault();
              return;
            }
            if (event.key === "Enter") {
              if (matchCount > 0) selectCurrent();
              event.preventDefault();
              return;
            }
            if (
              event.key === "F3" ||
              (event.key.toLocaleLowerCase() === "g" &&
                (event.ctrlKey || event.metaKey))
            ) {
              if (event.shiftKey) goPrev();
              else goNext();
              event.preventDefault();
            }
          }}
          placeholder="Search all settings…"
          className="w-full min-w-0 border-none bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-textMuted)]"
        />
        {hasQuery && (
          <>
            <span
              aria-live="polite"
              className="whitespace-nowrap text-[10px] font-medium tabular-nums text-[var(--color-textSecondary)]"
            >
              {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0"}
            </span>
            <button
              type="button"
              onClick={goPrev}
              disabled={matchCount === 0}
              aria-label="Previous search result"
              className="flex-shrink-0 rounded p-0.5 text-[var(--color-textMuted)] transition-colors hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] disabled:opacity-30"
              title="Previous (Shift+F3 or Ctrl+Shift+G)"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={matchCount === 0}
              aria-label="Next search result"
              className="flex-shrink-0 rounded p-0.5 text-[var(--color-textMuted)] transition-colors hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] disabled:opacity-30"
              title="Next (F3 or Ctrl+G)"
            >
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear settings search"
              className="flex-shrink-0 rounded p-0.5 text-[var(--color-textMuted)] transition-colors hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>

      {hasQuery && (
        <div
          id={RESULTS_ID}
          role="listbox"
          aria-label="Connection setting search results"
          className="absolute right-0 top-full z-[70] mt-1 max-h-80 w-[min(28rem,80vw)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-2xl"
        >
          {results.length === 0 ? (
            <div role="status" className="px-3 py-5 text-center">
              <p className="text-sm font-medium text-[var(--color-textSecondary)]">
                No settings found
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-textMuted)]">
                Try a label, option, help phrase, or saved value.
              </p>
            </div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                id={`connection-editor-search-result-${index}`}
                type="button"
                role="option"
                aria-selected={index === currentIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setCurrentIndex(index)}
                onClick={() => selectResult(index)}
                className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  index === currentIndex
                    ? "bg-primary/15 text-[var(--color-text)]"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                }`}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
                  {result.breadcrumb}
                </span>
                <span className="mt-0.5 block text-xs font-medium text-[var(--color-text)]">
                  {result.fieldLabel}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--color-textSecondary)]">
                  <HighlightedText text={result.snippet} query={query} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
