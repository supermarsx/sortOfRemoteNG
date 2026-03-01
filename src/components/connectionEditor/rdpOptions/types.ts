export interface SectionBaseProps {
  rdp: Record<string, unknown>;
  updateRdp: (updates: Record<string, unknown>) => void;
}
