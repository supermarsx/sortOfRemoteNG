import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ShortcutManagerDialog } from '../src/components/ShortcutManagerDialog';
import { ConnectionProvider } from '../src/contexts/ConnectionProvider';

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
vi.mock('../src/contexts/ToastContext', () => ({
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
    expect(screen.queryByText(/Shortcut Manager/i)).not.toBeInTheDocument();
  });

  it('renders when open', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    expect(screen.getByText(/Shortcut Manager/i)).toBeInTheDocument();
  });

  it('displays folder location options', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should have folder preset options
    expect(screen.getByText(/Desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/Documents/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProvider({ isOpen: true, onClose });
    
    // Find and click close button
    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no shortcuts exist', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should show message about no shortcuts
    expect(screen.getByText(/No shortcuts created/i)).toBeInTheDocument();
  });

  it('displays create shortcut form', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should have create shortcut UI elements - use getAllByText since there are multiple
    const createShortcutElements = screen.getAllByText(/Create Shortcut/i);
    expect(createShortcutElements.length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/My Server Connection/i)).toBeInTheDocument();
  });

  it('has folder selection dropdown', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should have folder dropdown with options - select elements don't have accessible name by default
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBeGreaterThan(0);
    
    // Folder dropdown should have Desktop option
    expect(screen.getByText('Desktop')).toBeInTheDocument();
  });

  it('displays help text', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should have helpful description
    expect(screen.getByText(/Shortcuts can open a collection/i)).toBeInTheDocument();
  });

  it('has refresh button', () => {
    renderWithProvider({ isOpen: true, onClose: () => {} });
    
    // Should have refresh button
    const refreshButton = screen.getByLabelText('Refresh');
    expect(refreshButton).toBeInTheDocument();
  });
});
