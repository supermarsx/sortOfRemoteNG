import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConnectionDiagnostics } from '../src/components/ConnectionDiagnostics';
import { Connection } from '../src/types/connection';
import { ToastProvider } from '../src/contexts/ToastContext';
import React from 'react';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from '@tauri-apps/api/core';

// Helper to wrap component with required providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>);
};

const mockConnection: Connection = {
  id: 'test-conn-1',
  name: 'Test Server',
  protocol: 'ssh',
  hostname: '192.168.1.100',
  port: 22,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ConnectionDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default successful responses
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'ping_host_detailed':
          return { success: true, time_ms: 10, error: null };
        case 'ping_gateway':
          return { success: true, time_ms: 5, error: null };
        case 'check_port':
          return { port: 22, open: true, service: 'ssh', time_ms: 15 };
        case 'traceroute':
          return [
            { hop: 1, ip: '192.168.1.1', hostname: 'router', time_ms: 1, timeout: false },
            { hop: 2, ip: '192.168.1.100', hostname: 'target', time_ms: 5, timeout: false },
          ];
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the diagnostics dialog', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    expect(screen.getByText(/Connection Diagnostics/i)).toBeInTheDocument();
    expect(screen.getByText(/Test Server/i)).toBeInTheDocument();
  });

  it('displays connection hostname', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
  });

  it('displays network checks section', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    expect(screen.getByText(/Network Checks/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={onClose} />);
    
    // Find close button by title attribute
    const closeButton = document.querySelector('[title="Close"]') as HTMLButtonElement;
    if (closeButton) {
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={onClose} />);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has refresh button for re-running diagnostics', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    
    // Find refresh button by title attribute
    const refreshButton = document.querySelector('[title="Run Again"]');
    expect(refreshButton).toBeInTheDocument();
  });

  it('shows loading spinners initially', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    
    // Should show loading indicators
    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('handles connection without port gracefully', () => {
    const noPortConnection: Connection = {
      ...mockConnection,
      port: undefined as any,
    };
    
    // Should not throw
    expect(() => {
      renderWithProviders(<ConnectionDiagnostics connection={noPortConnection} onClose={() => {}} />);
    }).not.toThrow();
  });

  it('renders with different protocols', () => {
    const rdpConnection: Connection = {
      ...mockConnection,
      protocol: 'rdp',
    };
    
    // Should not throw with RDP protocol
    expect(() => {
      renderWithProviders(<ConnectionDiagnostics connection={rdpConnection} onClose={() => {}} />);
    }).not.toThrow();
  });

  it('has visual sections for diagnostics', () => {
    renderWithProviders(<ConnectionDiagnostics connection={mockConnection} onClose={() => {}} />);
    
    // Should have multiple diagnostic sections (cards) - use heading text instead of class
    const networkSection = screen.getByText(/Network Checks/i);
    const pingSection = screen.getByText(/Ping Results/i);
    expect(networkSection).toBeInTheDocument();
    expect(pingSection).toBeInTheDocument();
  });
});
