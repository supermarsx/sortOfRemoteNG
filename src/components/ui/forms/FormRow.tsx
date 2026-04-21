import React from 'react';
import { cx } from '../lib/cx';

export interface FormRowProps {
  /** Number of columns (maps to Tailwind grid-cols) */
  columns?: 2 | 3 | 4;
  /** Gap size */
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
}

const COL_CLASS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };
const GAP_CLASS = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' };

export const FormRow: React.FC<FormRowProps> = ({
  columns = 2,
  gap = 'md',
  className,
  children,
}) => (
  <div className={cx('grid', COL_CLASS[columns], GAP_CLASS[gap], className)}>
    {children}
  </div>
);
