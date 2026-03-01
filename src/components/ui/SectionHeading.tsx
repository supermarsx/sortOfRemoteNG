import React from "react";

/**
 * SectionHeading — Consistent heading used across all settings panels.
 *
 *   <SectionHeading icon={<Shield className="w-5 h-5" />} title="Security" />
 */
export const SectionHeading: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
}> = ({ icon, title, description }) => (
  <>
    <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
      {icon}
      {title}
    </h3>
    {description && (
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        {description}
      </p>
    )}
  </>
);

export default SectionHeading;
