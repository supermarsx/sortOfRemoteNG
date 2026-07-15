import React, { useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

export const ConnectionEditorSearchBar: React.FC<{
  query: string;
  setQuery: (query: string) => void;
  matchCount: number;
  currentIndex: number;
  goNext: () => void;
  goPrev: () => void;
}> = ({ query, setQuery, matchCount, currentIndex, goNext, goPrev }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      data-search-bar
      className="flex items-center gap-1 bg-[var(--color-border)]/60 rounded-lg px-2 py-1 min-w-[180px] max-w-[300px]"
    >
      <Search
        size={13}
        className="text-[var(--color-textMuted)] flex-shrink-0"
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setQuery("");
            inputRef.current?.blur();
          }
          if (event.key === "Enter" && matchCount > 0) {
            if (event.shiftKey) {
              goPrev();
            } else {
              goNext();
            }
            event.preventDefault();
          }
          if (
            event.key === "F3" ||
            (event.key === "g" && (event.ctrlKey || event.metaKey))
          ) {
            if (event.shiftKey) {
              goPrev();
            } else {
              goNext();
            }
            event.preventDefault();
          }
        }}
        placeholder="Search settings..."
        className="bg-transparent border-none outline-none text-xs text-[var(--color-text)] placeholder-[var(--color-textMuted)] w-full min-w-0"
      />
      {query && (
        <>
          <span className="text-[10px] font-medium text-[var(--color-textSecondary)] whitespace-nowrap tabular-nums">
            {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0"}
          </span>
          <button
            type="button"
            onClick={goPrev}
            disabled={matchCount === 0}
            className="p-0.5 text-[var(--color-textMuted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors flex-shrink-0"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={matchCount === 0}
            className="p-0.5 text-[var(--color-textMuted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors flex-shrink-0"
            title="Next (Enter)"
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="p-0.5 text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors flex-shrink-0"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
};
