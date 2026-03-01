

export type Mgr = ReturnType<typeof usePerformanceMonitor>;

export interface PerformanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
