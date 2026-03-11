import React from 'react';
import { cx } from '../lib/cx';

export interface FormSectionProps {
  /** Optional heading for this section */
  title?: string;
  /** Optional icon rendered before the title */
  icon?: React.ReactNode;
  /** Optional description below the title */
  description?: string;
  /** Consistent vertical gap between children */
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
}

const GAP_CLASS = { sm: 'space-y-2', md: 'space-y-4', lg: 'space-y-6' };

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  icon,
  description,
  gap = 'md',
  className,
  children,
}) => (
  <div className={cx(GAP_CLASS[gap], className)}>
    {title && (
      <div className="sor-form-section-heading">
        <div className="flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </div>
        {description && <p className="text-xs text-[var(--color-textMuted)] mt-0.5 font-normal">{description}</p>}
      </div>
    )}
    {children}
  </div>
);
