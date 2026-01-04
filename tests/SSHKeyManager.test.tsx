import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SSHKeyManager } from '../src/components/SSHKeyManager';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(),
  join: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, readDir, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

describe('SSHKeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appDataDir).mockResolvedValue('/app/data');
    vi.mocked(join).mockImplementation(async (...parts) => parts.join('/'));
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([]);
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  it('renders when open', async () => {
    render(<SSHKeyManager isOpen={true} onClose={() => {}} onSelectKey={() => {}} />);
    expect(screen.getByText('SSH Key Manager')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<SSHKeyManager isOpen={false} onClose={() => {}} onSelectKey={() => {}} />);
    expect(screen.queryByText('SSH Key Manager')).not.toBeInTheDocument();
  });

  it('loads existing keys on mount', async () => {
    vi.mocked(readDir).mockResolvedValue([
      { name: 'my_key', isFile: false, isDirectory: true, isSymlink: false },
    ]);
    vi.mocked(readTextFile).mockResolvedValue('ssh-rsa AAAA... comment');

    render(<SSHKeyManager isOpen={true} onClose={() => {}} onSelectKey={() => {}} />);

    await waitFor(() => {
      expect(readDir).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('has generate key button', async () => {
    render(<SSHKeyManager isOpen={true} onClose={() => {}} onSelectKey={() => {}} />);

    expect(screen.getByText('Generate Key')).toBeInTheDocument();
  });

  it('imports SSH key from file', async () => {
    vi.mocked(open).mockResolvedValue('/path/to/key');
    vi.mocked(readTextFile).mockResolvedValue('ssh-rsa AAAA... imported-key');
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(readDir).mockResolvedValue([]);

    render(<SSHKeyManager isOpen={true} onClose={() => {}} onSelectKey={() => {}} />);

    const importButton = screen.getByText('Import Key');
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
  });

  it('has close button', async () => {
    const onClose = vi.fn();
    render(<SSHKeyManager isOpen={true} onClose={onClose} onSelectKey={() => {}} />);

    // Find the close button at bottom
    const closeButton = screen.getByText('Close');
    expect(closeButton).toBeInTheDocument();
  });
});
