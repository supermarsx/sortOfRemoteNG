import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Folder,
  Home,
  Search,
  X,
} from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import {
  ROOT_PARENT_FOLDER_VALUE,
  filterParentFolderOptions,
  type ParentFolderOption,
} from "../../../utils/connection/parentFolderTree";

type ParentSelectorManager = Pick<
  ConnectionEditorMgr,
  "formData" | "parentFolderProjection" | "handleParentFolderChange"
>;

interface ParentSelectorProps {
  mgr: ParentSelectorManager;
}

function firstSelectableIndex(options: readonly ParentFolderOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastSelectableIndex(options: readonly ParentFolderOption[]): number {
  for (let index = options.length - 1; index >= 0; index--) {
    if (!options[index].disabled) return index;
  }
  return -1;
}

function nextSelectableIndex(
  options: readonly ParentFolderOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;

  for (let offset = 1; offset <= options.length; offset++) {
    const candidate =
      (currentIndex + direction * offset + options.length) % options.length;
    if (!options[candidate].disabled) return candidate;
  }

  return -1;
}

export const ParentSelector: React.FC<ParentSelectorProps> = ({ mgr }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = mgr.parentFolderProjection.options;
  const selected = mgr.parentFolderProjection.selected;
  const visibleOptions = useMemo(
    () => filterParentFolderOptions(options, query),
    [options, query],
  );

  const scheduleInputFocus = useCallback(() => {
    const schedule: (callback: FrameRequestCallback) => number =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(() => callback(performance.now()), 0);
    schedule(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const openPicker = useCallback(() => {
    if (open) return;
    setOpen(true);
    setQuery("");
    scheduleInputFocus();
  }, [open, scheduleInputFocus]);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const currentIndex = visibleOptions.findIndex(
      (option) => option.current && !option.disabled,
    );
    setActiveIndex(
      currentIndex >= 0 ? currentIndex : firstSelectableIndex(visibleOptions),
    );
  }, [open, visibleOptions]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePicker();
    };
    document.addEventListener("mousedown", handleOutsidePointer);
    return () =>
      document.removeEventListener("mousedown", handleOutsidePointer);
  }, [closePicker, open]);

  const selectOption = useCallback(
    (option: ParentFolderOption) => {
      if (option.disabled) return;
      if (!mgr.handleParentFolderChange(option.value)) return;
      closePicker();
      scheduleInputFocus();
    },
    [closePicker, mgr, scheduleInputFocus],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)
      ) {
        event.preventDefault();
        openPicker();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) =>
          nextSelectableIndex(visibleOptions, current, 1),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) =>
          nextSelectableIndex(visibleOptions, current, -1),
        );
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstSelectableIndex(visibleOptions));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastSelectableIndex(visibleOptions));
        break;
      case "Enter": {
        event.preventDefault();
        const option = visibleOptions[activeIndex];
        if (option) selectOption(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        closePicker();
        inputRef.current?.blur();
        break;
    }
  };

  const activeDescendant =
    open && activeIndex >= 0
      ? `editor-parent-folder-option-${activeIndex}`
      : undefined;

  return (
    <div
      ref={rootRef}
      data-editor-search-section="general-parent"
      data-editor-search-field="parent-folder"
      className="relative"
    >
      <label
        htmlFor="editor-parent-folder-combobox"
        className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1"
      >
        Parent Folder
      </label>
      <div className="relative flex items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-input)] focus-within:ring-2 focus-within:ring-primary/50">
        {selected.kind === "root" ? (
          <Home
            size={15}
            aria-hidden="true"
            className="absolute left-3 text-[var(--color-textMuted)]"
          />
        ) : (
          <Folder
            size={15}
            aria-hidden="true"
            className="absolute left-3 text-[var(--color-textMuted)]"
          />
        )}
        <input
          ref={inputRef}
          id="editor-parent-folder-combobox"
          data-testid="editor-parent-folder"
          role="combobox"
          aria-label="Parent Folder"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? "editor-parent-folder-options" : undefined}
          aria-activedescendant={activeDescendant}
          aria-invalid={selected.orphaned || undefined}
          autoComplete="off"
          readOnly={!open}
          value={open ? query : selected.path}
          onFocus={openPicker}
          onClick={openPicker}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search folders..."
          className="w-full bg-transparent py-2.5 pl-9 pr-20 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-textMuted)]"
        />
        {((open && query) || (!open && selected.kind !== "root")) && (
          <button
            type="button"
            aria-label={
              open ? "Clear folder search" : "Reset parent folder to Root"
            }
            title={open ? "Clear search" : "Reset to Root"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) {
                setQuery("");
                scheduleInputFocus();
              } else {
                mgr.handleParentFolderChange(ROOT_PARENT_FOLDER_VALUE);
              }
            }}
            className="absolute right-9 rounded p-1 text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label={
            open ? "Close parent folder picker" : "Open parent folder picker"
          }
          aria-expanded={open}
          aria-controls={open ? "editor-parent-folder-options" : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              closePicker();
            } else {
              openPicker();
            }
          }}
          className="absolute right-2 rounded p-1 text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
        >
          <ChevronDown
            size={15}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {selected.orphaned && !open && (
        <p
          className="mt-1 flex items-center gap-1 text-xs text-warning"
          role="status"
        >
          <AlertTriangle size={12} aria-hidden="true" />
          {selected.reason ?? "Selected folder has an unavailable ancestor"}.
          Choose Root or an available folder.
        </p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textMuted)]">
            <Search size={13} aria-hidden="true" />
            Search by folder name or full path
          </div>
          <div
            id="editor-parent-folder-options"
            role="listbox"
            aria-label="Parent folders"
            className="max-h-64 overflow-y-auto py-1"
          >
            {visibleOptions.length > 0 ? (
              <>
                {visibleOptions.map((option, index) => {
                  const highlighted = index === activeIndex;
                  const OptionIcon = option.kind === "root" ? Home : Folder;
                  return (
                    <button
                      key={`${option.kind}:${option.value}`}
                      id={`editor-parent-folder-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={option.current}
                      aria-disabled={option.disabled}
                      disabled={option.disabled}
                      data-depth={option.depth}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => {
                        if (!option.disabled) setActiveIndex(index);
                      }}
                      onClick={() => selectOption(option)}
                      className={`flex w-full items-start gap-2 py-2 pr-3 text-left transition-colors ${
                        option.disabled
                          ? "cursor-not-allowed opacity-55"
                          : highlighted
                            ? "bg-primary/15 text-primary"
                            : "text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                      }`}
                      style={{ paddingLeft: `${12 + option.depth * 16}px` }}
                    >
                      <OptionIcon
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{option.name}</span>
                          {option.current && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                              Current
                            </span>
                          )}
                          {option.orphaned && (
                            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                              Orphaned
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-[var(--color-textMuted)]">
                          {option.path}
                        </span>
                        {option.reason && (
                          <span className="block text-xs text-warning">
                            {option.reason}
                          </span>
                        )}
                      </span>
                      {option.current && (
                        <Check
                          size={14}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0"
                        />
                      )}
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="px-4 py-6 text-center" role="status">
                <p className="text-sm text-[var(--color-textSecondary)]">
                  No folders found
                </p>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery("");
                    scheduleInputFocus();
                  }}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Reset search
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
