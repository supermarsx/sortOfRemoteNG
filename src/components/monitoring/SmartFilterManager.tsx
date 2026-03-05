import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useFilters } from "../../hooks/monitoring/useFilters";
import type {
  FilterCondition,
  FilterField,
  FilterLogic,
  FilterOperator,
  FilterPreset,
  SmartGroup,
} from "../../types/filters";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FIELD_OPTIONS: FilterField[] = [
  "protocol",
  "hostname",
  "port",
  "healthStatus",
  "tags",
  "parentId",
  "name",
  "lastConnected",
];

const OPERATOR_OPTIONS: FilterOperator[] = [
  "equals",
  "contains",
  "starts_with",
  "greater_than",
  "less_than",
  "in",
  "not_in",
  "regex_match",
];

const EMPTY_CONDITION: FilterCondition = {
  field: "protocol",
  operator: "equals",
  value: "",
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface ConditionRowProps {
  condition: FilterCondition;
  index: number;
  onChange: (index: number, c: FilterCondition) => void;
  onRemove: (index: number) => void;
  t: (key: string) => string;
}

const ConditionRow: React.FC<ConditionRowProps> = ({
  condition,
  index,
  onChange,
  onRemove,
  t,
}) => (
  <div className="sor-filter-condition-row">
    <select
      className="sor-filter-select"
      value={condition.field}
      onChange={(e) =>
        onChange(index, { ...condition, field: e.target.value as FilterField })
      }
      aria-label={t("smartFilter.field")}
    >
      {FIELD_OPTIONS.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>

    <select
      className="sor-filter-select"
      value={condition.operator}
      onChange={(e) =>
        onChange(index, {
          ...condition,
          operator: e.target.value as FilterOperator,
        })
      }
      aria-label={t("smartFilter.operator")}
    >
      {OPERATOR_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>

    <input
      className="sor-filter-input"
      type="text"
      placeholder={t("smartFilter.valuePlaceholder")}
      value={String(condition.value ?? "")}
      onChange={(e) => onChange(index, { ...condition, value: e.target.value })}
      aria-label={t("smartFilter.value")}
    />

    <button
      className="sor-filter-btn-icon sor-filter-btn-danger"
      onClick={() => onRemove(index)}
      title={t("smartFilter.removeCondition")}
      aria-label={t("smartFilter.removeCondition")}
    >
      ✕
    </button>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export interface SmartFilterManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SmartFilterManager: React.FC<SmartFilterManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const {
    filters,
    smartGroups,
    presets,
    stats,
    loading,
    error,
    fetchFilters,
    createFilter,
    deleteFilter,
    fetchPresets,
    createSmartGroup,
    deleteSmartGroup,
    fetchSmartGroups,
    evaluateFilter,
    fetchStats,
  } = useFilters();

  /* ----- local state ----- */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [filterName, setFilterName] = useState("");
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { ...EMPTY_CONDITION },
  ]);
  const [logic, setLogic] = useState<FilterLogic>("and");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  /* ----- bootstrap data ----- */
  useEffect(() => {
    if (!isOpen) return;
    fetchFilters();
    fetchSmartGroups();
    fetchPresets();
    fetchStats();
  }, [isOpen, fetchFilters, fetchSmartGroups, fetchPresets, fetchStats]);

  /* ----- condition helpers ----- */
  const handleConditionChange = useCallback(
    (idx: number, c: FilterCondition) => {
      setConditions((prev) => prev.map((item, i) => (i === idx ? c : item)));
    },
    [],
  );

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, { ...EMPTY_CONDITION }]);
  }, []);

  const removeCondition = useCallback(
    (idx: number) => {
      setConditions((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((_, i) => i !== idx);
      });
    },
    [],
  );

  /* ----- validation ----- */
  const validate = useCallback((): boolean => {
    if (!filterName.trim()) {
      setNameError(t("smartFilter.nameRequired"));
      return false;
    }
    if (conditions.some((c) => !String(c.value ?? "").trim())) {
      setNameError(t("smartFilter.allFieldsRequired"));
      return false;
    }
    setNameError(null);
    return true;
  }, [filterName, conditions, t]);

  /* ----- save filter & create smart group ----- */
  const handleSave = useCallback(async () => {
    if (!validate()) return;
    const filterId = await createFilter(filterName.trim(), conditions, logic);
    if (filterId) {
      await createSmartGroup(filterName.trim(), filterId);
      setFilterName("");
      setConditions([{ ...EMPTY_CONDITION }]);
      setPreviewCount(null);
    }
  }, [validate, createFilter, createSmartGroup, filterName, conditions, logic]);

  /* ----- preview ----- */
  const handlePreview = useCallback(async () => {
    if (!validate()) return;
    const tempId = await createFilter(
      `__preview_${Date.now()}`,
      conditions,
      logic,
    );
    if (tempId) {
      const result = await evaluateFilter(tempId, []);
      setPreviewCount(result?.matchCount ?? 0);
      await deleteFilter(tempId);
    }
  }, [validate, createFilter, evaluateFilter, deleteFilter, conditions, logic]);

  /* ----- apply preset ----- */
  const applyPreset = useCallback(
    (preset: FilterPreset) => {
      setFilterName(preset.name);
      setConditions([...preset.rule.conditions]);
      setLogic(preset.rule.logic);
      setPreviewCount(null);
      setNameError(null);
    },
    [],
  );

  /* ----- select smart group ----- */
  const handleSelectGroup = useCallback(
    (group: SmartGroup) => {
      setSelectedGroupId(group.id);
      const rule = filters.find((f) => f.id === group.filterId);
      if (rule) {
        setFilterName(rule.name);
        setConditions([...rule.conditions]);
        setLogic(rule.logic);
      }
      setPreviewCount(null);
      setNameError(null);
    },
    [filters],
  );

  /* ----- delete smart group ----- */
  const handleDeleteGroup = useCallback(
    async (group: SmartGroup) => {
      await deleteSmartGroup(group.id);
      await deleteFilter(group.filterId);
      if (selectedGroupId === group.id) setSelectedGroupId(null);
    },
    [deleteSmartGroup, deleteFilter, selectedGroupId],
  );

  if (!isOpen) return null;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="sor-filter-manager-backdrop" onClick={onClose}>
      <div
        className="sor-filter-manager-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("smartFilter.title")}
      >
        {/* ---------- Header ---------- */}
        <header className="sor-filter-header">
          <h2 className="sor-filter-title">{t("smartFilter.title")}</h2>
          <button
            className="sor-filter-btn-icon"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>

        {error && <div className="sor-filter-error">{error}</div>}

        <div className="sor-filter-body">
          {/* ========== LEFT: Smart Groups Sidebar ========== */}
          <aside className="sor-filter-sidebar">
            <h3 className="sor-filter-sidebar-title">
              {t("smartFilter.smartGroups")}
            </h3>

            {smartGroups.length === 0 && !loading && (
              <p className="sor-filter-empty">
                {t("smartFilter.noGroupsYet")}
              </p>
            )}

            <ul className="sor-filter-group-list" role="listbox">
              {smartGroups.map((g) => (
                <li
                  key={g.id}
                  role="option"
                  aria-selected={g.id === selectedGroupId}
                  className={`sor-filter-group-item ${g.id === selectedGroupId ? "sor-filter-group-item--active" : ""}`}
                  onClick={() => handleSelectGroup(g)}
                >
                  <span
                    className="sor-filter-group-icon"
                    style={{ color: g.color }}
                  >
                    {g.icon === "folder" ? "📁" : g.icon}
                  </span>
                  <span className="sor-filter-group-name">{g.name}</span>
                  <span className="sor-filter-group-count">
                    {g.memberCount}
                  </span>
                  <button
                    className="sor-filter-btn-icon sor-filter-btn-danger sor-filter-btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(g);
                    }}
                    title={t("smartFilter.deleteGroup")}
                    aria-label={`${t("smartFilter.deleteGroup")} ${g.name}`}
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* ========== RIGHT: Filter Builder ========== */}
          <section className="sor-filter-builder">
            {/* Filter name */}
            <label className="sor-filter-label" htmlFor="sor-filter-name">
              {t("smartFilter.filterName")}
            </label>
            <input
              id="sor-filter-name"
              className={`sor-filter-input sor-filter-name-input ${nameError ? "sor-filter-input--error" : ""}`}
              type="text"
              value={filterName}
              onChange={(e) => {
                setFilterName(e.target.value);
                setNameError(null);
              }}
              placeholder={t("smartFilter.filterNamePlaceholder")}
            />
            {nameError && (
              <span className="sor-filter-validation">{nameError}</span>
            )}

            {/* Logic toggle */}
            <div className="sor-filter-logic-toggle">
              <span className="sor-filter-label">
                {t("smartFilter.matchLogic")}
              </span>
              <button
                className={`sor-filter-logic-btn ${logic === "and" ? "sor-filter-logic-btn--active" : ""}`}
                onClick={() => setLogic("and")}
              >
                AND
              </button>
              <button
                className={`sor-filter-logic-btn ${logic === "or" ? "sor-filter-logic-btn--active" : ""}`}
                onClick={() => setLogic("or")}
              >
                OR
              </button>
            </div>

            {/* Condition rows */}
            <div className="sor-filter-conditions">
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  index={i}
                  condition={c}
                  onChange={handleConditionChange}
                  onRemove={removeCondition}
                  t={t}
                />
              ))}
            </div>

            <button className="sor-filter-btn sor-filter-btn-add" onClick={addCondition}>
              + {t("smartFilter.addCondition")}
            </button>

            {/* Actions */}
            <div className="sor-filter-actions">
              <button
                className="sor-filter-btn sor-filter-btn-secondary"
                onClick={handlePreview}
                disabled={loading}
              >
                {t("smartFilter.preview")}
              </button>
              <button
                className="sor-filter-btn sor-filter-btn-primary"
                onClick={handleSave}
                disabled={loading}
              >
                {loading
                  ? t("smartFilter.saving")
                  : t("smartFilter.saveFilter")}
              </button>
            </div>

            {previewCount !== null && (
              <p className="sor-filter-preview-result">
                {t("smartFilter.matchedConnections", { count: previewCount })}
              </p>
            )}

            {/* ---------- Presets ---------- */}
            <div className="sor-filter-presets">
              <h3 className="sor-filter-presets-title">
                {t("smartFilter.presets")}
              </h3>

              {presets.length === 0 && (
                <p className="sor-filter-empty">
                  {t("smartFilter.noPresets")}
                </p>
              )}

              <div className="sor-filter-preset-grid">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    className="sor-filter-preset-card"
                    onClick={() => applyPreset(p)}
                    title={p.description}
                  >
                    <span className="sor-filter-preset-name">{p.name}</span>
                    <span className="sor-filter-preset-cat">
                      {p.category}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ---------- Stats Footer ---------- */}
        <footer className="sor-filter-footer">
          <span>
            {t("smartFilter.totalFilters")}: {stats?.totalFilters ?? 0}
          </span>
          <span>
            {t("smartFilter.totalSmartGroups")}:{" "}
            {stats?.totalSmartGroups ?? 0}
          </span>
          <span>
            {t("smartFilter.cacheHitRate")}:{" "}
            {stats ? `${(stats.cacheHitRate * 100).toFixed(1)}%` : "—"}
          </span>
        </footer>
      </div>
    </div>
  );
};

export default SmartFilterManager;
