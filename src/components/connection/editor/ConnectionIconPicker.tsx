import React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  integrationRegistry,
  type IntegrationDescriptor,
} from "../../../types/integrations/registry";
import {
  CONNECTION_ICON_CATEGORIES,
  getConnectionIconDefinition,
  type ConnectionIconCategory,
  type ConnectionIconDefinition,
  type ConnectionIconKey,
} from "../../../utils/icons/connectionIconCatalog";
import {
  getConnectionIntegrationKey,
  type EffectiveConnectionIcon,
} from "../../../utils/icons/resolveConnectionIcon";
import {
  CONNECTION_ICON_CATEGORY_LABELS,
  filterConnectionIcons,
  getRecommendedConnectionIconKeys,
  resolveEditorConnectionIcon,
  type ConnectionIconPickerConnection,
} from "./connectionIconPickerModel";

export interface ConnectionIconPickerProps {
  connection: ConnectionIconPickerConnection;
  onChange: (key: ConnectionIconKey | undefined) => void;
}

type CatalogDefinition = ConnectionIconDefinition<ConnectionIconKey>;

const getSourceCopy = (
  effective: EffectiveConnectionIcon,
  connection: ConnectionIconPickerConnection,
  descriptor: IntegrationDescriptor | undefined,
): { title: string; detail: string } => {
  if (effective.source === "override") {
    return {
      title: "Manual override",
      detail: "This saved icon takes priority over the automatic choice.",
    };
  }
  if (effective.source === "integration") {
    const integrationName = descriptor?.label ?? effective.integrationKey;
    return {
      title: `Automatic · ${integrationName ?? "Integration"} integration`,
      detail: "Recommended by the active integration.",
    };
  }
  if (effective.source === "protocol") {
    return {
      title: `Automatic · ${connection.protocol.toUpperCase()} protocol`,
      detail: "Recommended for the active connection protocol.",
    };
  }
  return {
    title: "Automatic · Generic fallback",
    detail: "Used because this protocol has no specific icon default yet.",
  };
};

const ConnectionIconPreview: React.FC<{
  effective: EffectiveConnectionIcon;
  sourceTitle: string;
}> = ({ effective, sourceTitle }) => {
  const EffectiveIcon = effective.icon;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary"
        aria-label={`Current effective icon: ${effective.label}`}
      >
        <EffectiveIcon size={32} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--color-text)]">
          {effective.label}
        </p>
        <p className="truncate text-xs text-[var(--color-textSecondary)]">
          {sourceTitle}
        </p>
        <code className="mt-1 block truncate text-[10px] text-[var(--color-textMuted)]">
          {effective.key}
        </code>
      </div>
      <div
        className="hidden shrink-0 items-end gap-2 sm:flex"
        aria-label="Icon size previews"
      >
        {[16, 24, 32].map((size) => (
          <span
            key={size}
            className="flex flex-col items-center gap-1 text-[9px] text-[var(--color-textMuted)]"
          >
            <EffectiveIcon size={size} aria-hidden="true" />
            {size}
          </span>
        ))}
      </div>
    </div>
  );
};

export const ConnectionIconPicker: React.FC<ConnectionIconPickerProps> = ({
  connection,
  onChange,
}) => {
  const reactId = React.useId().replace(/:/g, "");
  const searchId = `connection-icon-search-${reactId}`;
  const paletteId = `connection-icon-palette-${reactId}`;
  const [query, setQuery] = React.useState("");

  const integrationKey = getConnectionIntegrationKey(connection);
  const descriptor = integrationKey
    ? integrationRegistry.find((candidate) => candidate.key === integrationKey)
    : undefined;
  const effective = resolveEditorConnectionIcon(connection);
  const automatic = resolveEditorConnectionIcon({
    ...connection,
    icon: undefined,
  });
  const sourceCopy = getSourceCopy(effective, connection, descriptor);
  const recommendedKeys = getRecommendedConnectionIconKeys(connection);
  const recommendedDefinitions = recommendedKeys
    .map(getConnectionIconDefinition)
    .filter((definition): definition is CatalogDefinition => !!definition);
  const hasManualOverride = !!connection.icon?.trim();
  const isFiltering = query.trim().length > 0;
  const matches = React.useMemo(() => filterConnectionIcons(query), [query]);
  const groupedMatches = React.useMemo(
    () =>
      CONNECTION_ICON_CATEGORIES.map((category) => ({
        category,
        definitions: matches.filter(
          (definition) => definition.category === category,
        ),
      })).filter((group) => group.definitions.length > 0),
    [matches],
  );
  const [expandedCategories, setExpandedCategories] = React.useState<
    ReadonlySet<ConnectionIconCategory>
  >(() => new Set([effective.category]));
  const optionRefs = React.useRef(
    new Map<ConnectionIconKey, HTMLButtonElement>(),
  );

  React.useEffect(() => {
    setExpandedCategories((current) => {
      if (current.has(effective.category)) return current;
      return new Set([...current, effective.category]);
    });
  }, [effective.category]);

  const visibleDefinitions = React.useMemo(
    () =>
      groupedMatches.flatMap((group) =>
        isFiltering || expandedCategories.has(group.category)
          ? group.definitions
          : [],
      ),
    [expandedCategories, groupedMatches, isFiltering],
  );
  const visibleKeys = React.useMemo(
    () => visibleDefinitions.map((definition) => definition.key),
    [visibleDefinitions],
  );
  const [activeKey, setActiveKey] = React.useState<
    ConnectionIconKey | undefined
  >(effective.key);

  React.useEffect(() => {
    if (visibleKeys.length === 0) {
      if (activeKey !== undefined) setActiveKey(undefined);
      return;
    }
    if (activeKey && visibleKeys.includes(activeKey)) return;
    setActiveKey(
      visibleKeys.includes(effective.key) ? effective.key : visibleKeys[0],
    );
  }, [activeKey, effective.key, visibleKeys]);

  const focusOption = React.useCallback((key: ConnectionIconKey) => {
    setActiveKey(key);
    optionRefs.current.get(key)?.focus();
  }, []);

  const moveOptionFocus = React.useCallback(
    (currentKey: ConnectionIconKey, offset: number) => {
      const currentIndex = visibleKeys.indexOf(currentKey);
      if (currentIndex < 0 || visibleKeys.length === 0) return;
      const nextIndex =
        (currentIndex + offset + visibleKeys.length) % visibleKeys.length;
      focusOption(visibleKeys[nextIndex]);
    },
    [focusOption, visibleKeys],
  );

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: ConnectionIconKey,
  ) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveOptionFocus(key, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveOptionFocus(key, -1);
        break;
      case "Home":
        event.preventDefault();
        if (visibleKeys[0]) focusOption(visibleKeys[0]);
        break;
      case "End":
        event.preventDefault();
        if (visibleKeys.length > 0) {
          focusOption(visibleKeys[visibleKeys.length - 1]);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onChange(key);
        break;
    }
  };

  const toggleCategory = (category: ConnectionIconCategory) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <ConnectionIconPreview
          effective={effective}
          sourceTitle={sourceCopy.title}
        />
        <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-2 border-t border-[var(--color-border)] pt-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[var(--color-textSecondary)]">
              {sourceCopy.detail}
            </p>
            {effective.overrideState === "unknown" && (
              <p className="mt-1 break-words text-[11px] text-warning">
                Saved icon “{effective.unknownOverrideKey}” is unavailable, so
                the automatic icon is shown.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={!hasManualOverride}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-textSecondary)] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Use automatic icon
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
          Recommended for{" "}
          {descriptor?.label ?? (connection.protocol || "this item")}
        </p>
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-2">
          {recommendedDefinitions.map((definition, index) => {
            const RecommendedIcon = definition.icon;
            return (
              <span
                key={definition.key}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-textSecondary)]"
              >
                <RecommendedIcon size={14} aria-hidden="true" />
                <span className="truncate">{definition.label}</span>
                {index === 0 && (
                  <span className="rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary">
                    Automatic
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="min-w-0">
        <label
          htmlFor={searchId}
          className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]"
        >
          Search icon palette
        </label>
        <div className="relative min-w-0">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            role="combobox"
            aria-label="Search connection icons"
            aria-controls={paletteId}
            aria-expanded={visibleDefinitions.length > 0}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              activeKey ? `${paletteId}-option-${activeKey}` : undefined
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && visibleKeys[0]) {
                event.preventDefault();
                focusOption(activeKey ?? visibleKeys[0]);
              }
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search labels, keys, protocols, integrations…"
            className="sor-form-input w-full min-w-0 py-2 pl-9 pr-9 text-sm"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear icon search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-textMuted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div
        id={paletteId}
        className="max-h-[min(34rem,55vh)] min-w-0 space-y-1.5 overflow-y-auto overflow-x-hidden pr-1"
        aria-label="Connection icon palette"
      >
        {groupedMatches.length === 0 ? (
          <div
            role="status"
            className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center"
          >
            <p className="text-sm font-medium text-[var(--color-text)]">
              No icons found
            </p>
            <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
              Try a label, stable key, category, protocol, or integration name.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          groupedMatches.map(({ category, definitions }) => {
            const categoryLabel = CONNECTION_ICON_CATEGORY_LABELS[category];
            const isExpanded = isFiltering || expandedCategories.has(category);
            const categoryId = `${paletteId}-category-${category}`;
            return (
              <section
                key={category}
                className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={categoryId}
                  disabled={isFiltering}
                  onClick={() => toggleCategory(category)}
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-border)]/40 disabled:cursor-default"
                >
                  {isExpanded ? (
                    <ChevronDown size={14} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {categoryLabel}
                  </span>
                  <span className="rounded-full bg-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--color-textMuted)]">
                    {definitions.length}
                  </span>
                </button>
                {isExpanded && (
                  <div
                    id={categoryId}
                    role="listbox"
                    aria-label={`${categoryLabel} icons`}
                    className="grid min-w-0 grid-cols-2 gap-1.5 border-t border-[var(--color-border)] p-2 sm:grid-cols-3 lg:grid-cols-4"
                  >
                    {definitions.map((definition) => {
                      const Icon = definition.icon;
                      const isSelected = effective.key === definition.key;
                      const isAutomatic = automatic.key === definition.key;
                      const isRecommended = recommendedKeys.includes(
                        definition.key,
                      );
                      return (
                        <button
                          key={definition.key}
                          ref={(node) => {
                            if (node)
                              optionRefs.current.set(definition.key, node);
                            else optionRefs.current.delete(definition.key);
                          }}
                          id={`${paletteId}-option-${definition.key}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          aria-label={`${definition.label} (${definition.key})${isSelected ? ", current effective icon" : ""}${isRecommended ? ", recommended" : ""}`}
                          tabIndex={activeKey === definition.key ? 0 : -1}
                          onFocus={() => setActiveKey(definition.key)}
                          onClick={() => onChange(definition.key)}
                          onKeyDown={(event) =>
                            handleOptionKeyDown(event, definition.key)
                          }
                          className={`group relative flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            isSelected
                              ? "border-primary/60 bg-primary/15 text-primary"
                              : "border-transparent bg-[var(--color-background)] text-[var(--color-textSecondary)] hover:border-primary/35 hover:text-[var(--color-text)]"
                          }`}
                        >
                          {isSelected && (
                            <Check
                              size={11}
                              className="absolute right-1 top-1"
                              aria-hidden="true"
                            />
                          )}
                          <Icon size={22} aria-hidden="true" />
                          <span className="w-full truncate text-[10px] font-medium">
                            {definition.label}
                          </span>
                          <code className="w-full truncate text-[9px] text-[var(--color-textMuted)]">
                            {definition.key}
                          </code>
                          {(isAutomatic || isRecommended) && (
                            <span className="max-w-full truncate rounded bg-primary/10 px-1 text-[8px] font-semibold uppercase tracking-wide text-primary">
                              {isAutomatic ? "Automatic" : "Recommended"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};
