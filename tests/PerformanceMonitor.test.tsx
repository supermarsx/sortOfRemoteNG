import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PerformanceMonitor } from '../src/components/PerformanceMonitor';
import { invoke } from '@tauri-apps/api/core';

const mocks = vi.hoisted(() => ({
  getPerformanceMetrics: vi.fn(),
  getSettings: vi.fn(),
  loadSettings: vi.fn(),
  recordPerformanceMetric: vi.fn(),
  saveSettings: vi.fn(),
  clearPerformanceMetrics: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../src/utils/settingsManager', () => ({
  SettingsManager: {
    getInstance: () => ({
      getPerformanceMetrics: mocks.getPerformanceMetrics,
      getSettings: mocks.getSettings,
      loadSettings: mocks.loadSettings,
      recordPerformanceMetric: mocks.recordPerformanceMetric,
      saveSettings: mocks.saveSettings,
      clearPerformanceMetrics: mocks.clearPerformanceMetrics,
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getSettings.mockReturnValue({
      performancePollIntervalMs: 20000,
      performanceLatencyTarget: '1.1.1.1',
    });
    mocks.loadSettings.mockResolvedValue({
      performancePollIntervalMs: 20000,
      performanceLatencyTarget: '1.1.1.1',
    });
    mocks.getPerformanceMetrics.mockReturnValue([
      {
        connectionTime: 0,
        dataTransferred: 0,
        latency: 22,
        throughput: 850,
        cpuUsage: 35,
        memoryUsage: 45,
        timestamp: Date.now(),
      },
    ]);
    mocks.saveSettings.mockResolvedValue(undefined);

    vi.mocked(invoke).mockResolvedValue({
      connectionTime: 0,
      dataTransferred: 0,
      latency: 18,
      throughput: 910,
      cpuUsage: 28,
      memoryUsage: 40,
      timestamp: Date.now(),
    });
  });

  it('renders with current and summary sections', async () => {
    render(<PerformanceMonitor isOpen onClose={() => {}} />);

    expect(await screen.findByText('performance.title')).toBeInTheDocument();
    expect(screen.getByText('Current Performance')).toBeInTheDocument();
    expect(screen.getByText('Summary Statistics')).toBeInTheDocument();
  });

  it('records refreshed metrics from backend', async () => {
    render(<PerformanceMonitor isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_system_metrics');
      expect(mocks.recordPerformanceMetric).toHaveBeenCalled();
    });
  });

  it('clears metrics after confirmation', async () => {
    render(<PerformanceMonitor isOpen onClose={() => {}} />);

    fireEvent.click(await screen.findByText('Clear'));
    fireEvent.click(await screen.findByText('Clear', {}, { timeout: 2000 }));

    expect(mocks.clearPerformanceMetrics).toHaveBeenCalled();
  });

  it('closes on Escape and backdrop click', async () => {
    const onClose = vi.fn();
    const { container } = render(<PerformanceMonitor isOpen onClose={onClose} />);

    await screen.findByText('performance.title');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector('.sor-modal-backdrop');
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

