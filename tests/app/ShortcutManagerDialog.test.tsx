import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ShortcutManagerDialog } from '../../src/components/app/ShortcutManagerDialog';
import { ConnectionProvider } from '../../src/contexts/ConnectionProvider';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (typeof fallback === 'object' && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
  }),
}));

// Mock ToastContext
vi.mock('../../src/contexts/ToastContext', () => ({
  useToastContext: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));

import { invoke } from '@tauri-apps/api/core';

describe('ShortcutManagerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    
    // Setup default invoke responses
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'get_desktop_path':
          return 'C:\\Users\\Test\\Desktop';
        case 'get_documents_path':
          return 'C:\\Users\\Test\\Documents';
        case 'get_appdata_path':
          return 'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
        case 'check_file_exists':
          return false;
        case 'create_desktop_shortcut':
          return undefined;
        case 'delete_file':
          return undefined;
        case 'open_folder':
          return undefined;
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithProvider = (props: { isOpen: boolean; onClose: () => void }) => {
    return render(
      <ConnectionProvider>
        <ShortcutManagerDialog {...props} />
      </ConnectionProvider>
    );
  };

  it('does not render when closed', () => {
    renderWithProvider({ isOpen: false, onClose: () => {} });
    expect(screen.queryByText('Shortcuts')).not.toBeInTheDocument();
  });

  it('renders when open with sidebar tabs', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText('Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Scan')).toBeInTheDocument();
  });

  it('can switch to scan tab', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    const scanTab = screen.getByText('Scan');
    fireEvent.click(scanTab);
    // Scan tab shows scan description text
    expect(screen.getByText(/Scan desktop, documents/i)).toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithProvider({ isOpen: true, onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no shortcuts exist', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText(/No shortcuts created/i)).toBeInTheDocument();
  });

  it('has new shortcut button', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText('New Shortcut')).toBeInTheDocument();
  });

  it('shows shortcut count', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    // With no shortcuts, shows "0 shortcuts"
    expect(screen.getByText(/0 shortcuts/i)).toBeInTheDocument();
  });

  it('shows create hint in empty state', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText(/Click 'New Shortcut' to get started/i)).toBeInTheDocument();
  });

  it('has refresh button', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });
});
