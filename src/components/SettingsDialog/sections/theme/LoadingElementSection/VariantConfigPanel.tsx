import React from 'react';
import { Checkbox, NumberInput, Select, Slider } from '../../../../ui/forms';
import { InfoTooltip } from '../../../../ui/InfoTooltip';
import type {
  LoadingElementType,
  ParamField,
  VariantConfigMap,
} from '../../../../ui/display/loadingElement/types';
import type { UseLoadingElementSettings } from '../../../../../hooks/settings/useLoadingElementSettings';

interface Props {
  mgr: UseLoadingElementSettings;
}

export const VariantConfigPanel: React.FC<Props> = ({ mgr }) => {
  const { le, currentDescriptor, setVariantConfig } = mgr;
  const currentType = currentDescriptor.type as LoadingElementType;
  // Schema-driven access reads fields by string key, so we need an
  // indexable view of the union-typed config. The cast is contained
  // to read-only access; writes go through the typed setVariantConfig.
  const config = le.perType[currentType] as unknown as Record<string, unknown>;

  const update = (key: string, value: unknown) => {
    setVariantConfig(currentType, { [key]: value } as Partial<VariantConfigMap[LoadingElementType]>);
  };

  return (
    <div className="sor-settings-card">
      <h5 className="text-sm font-medium text-[var(--color-text)]">
        {currentDescriptor.label} parameters
      </h5>
      <div className="space-y-4">
        {currentDescriptor.paramSchema.fields.map((field) => (
          <FieldRow key={field.key} field={field} value={config[field.key]} onChange={(v) => update(field.key, v)} />
        ))}
        {currentDescriptor.paramSchema.fields.length === 0 && (
          <p className="text-xs text-[var(--color-textMuted)]">This loader has no tunable parameters.</p>
        )}
      </div>
    </div>
  );
};

const FieldRow: React.FC<{
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ field, value, onChange }) => {
  const labelEl = (
    <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1 min-w-[160px]">
      {field.label}
      {field.help && <InfoTooltip text={field.help} />}
    </label>
  );

  switch (field.kind) {
    case 'integer': {
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <NumberInput
            value={v}
            onChange={(n: number) => onChange(Math.round(n))}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            className="w-32"
          />
        </div>
      );
    }
    case 'number': {
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <NumberInput
            value={v}
            onChange={(n: number) => onChange(n)}
            min={field.min}
            max={field.max}
            step={field.step}
            className="w-32"
          />
        </div>
      );
    }
    case 'percent': {
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <Slider
            value={v}
            onChange={(n: number) => onChange(n)}
            min={field.min}
            max={field.max}
            step={field.step}
            variant="full"
            className="flex-1"
          />
          <span className="text-xs text-[var(--color-textMuted)] w-12 text-right">
            {(v * 100).toFixed(0)}%
          </span>
        </div>
      );
    }
    case 'seconds': {
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <NumberInput
            value={v}
            onChange={(n: number) => onChange(n)}
            min={field.min}
            max={field.max}
            step={field.step}
            className="w-28"
          />
          <span className="text-xs text-[var(--color-textMuted)]">s</span>
        </div>
      );
    }
    case 'color': {
      const v = typeof value === 'string' ? value : '#00f0ff';
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <input
            type="color"
            value={v}
            onChange={(e) => onChange(e.target.value)}
            className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
          />
          <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded">
            {v}
          </span>
        </div>
      );
    }
    case 'boolean': {
      const v = !!value;
      return (
        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox checked={v} onChange={(b: boolean) => onChange(b)} />
          <span className="text-xs text-[var(--color-textSecondary)]">
            {field.label}
            {field.help && <> <InfoTooltip text={field.help} /></>}
          </span>
        </label>
      );
    }
    case 'select': {
      const v = value as string | number | undefined;
      return (
        <div className="flex items-center gap-3">
          {labelEl}
          <Select
            value={v ?? ''}
            onChange={(s: string) => {
              const opt = field.options.find((o) => String(o.value) === s);
              onChange(opt ? opt.value : s);
            }}
            options={field.options.map((o) => ({ value: o.value, label: o.label }))}
            className="sor-settings-select flex-1"
          />
        </div>
      );
    }
    default:
      return null;
  }
};

export default VariantConfigPanel;
