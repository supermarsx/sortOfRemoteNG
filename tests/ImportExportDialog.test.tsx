import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportExport } from '../src/components/ImportExport';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  exportCollection: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('../src/contexts/useConnections', () => ({
  useConnections: () => ({
    state: {
      connections: [
        {
          id: 'conn-1',
          name: 'Server A',
          protocol: 'ssh',
          hostname: '10.0.0.20',
          port: 22,
          username: 'root',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('../src/contexts/ToastContext', () => ({
  useToastContext: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }),
}));

vi.mock('../src/utils/collectionManager', () => ({
  CollectionManager: {
    getInstance: () => ({
      getCurrentCollection: () => ({ id: 'collection-1' }),
      exportCollection: mocks.exportCollection.mockResolvedValue('[]'),
    }),
  },
}));

vi.mock('../src/utils/settingsManager', () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: mocks.logAction,
    }),
  },
}));

vi.mock('../src/components/ImportExport/ExportTab', () => ({
  default: ({
    handleExport,
  }: {
    handleExport: () => void;
  }) => (
    <div>
      <div data-testid="export-tab-content">export-content</div>
      <button onClick={handleExport}>run-export</button>
    </div>
  ),
}));

vi.mock('../src/components/ImportExport/ImportTab', () => ({
  default: () => <div data-testid="import-tab-content">import-content</div>,
}));

describe('ImportExport dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed and not embedded', () => {
    render(<ImportExport isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Import / Export Connections')).not.toBeInTheDocument();
  });

  it('renders modal content when open', () => {
    render(<ImportExport isOpen onClose={() => {}} />);
    expect(screen.getByText('Import / Export Connections')).toBeInTheDocument();
    expect(screen.getByTestId('export-tab-content')).toBeInTheDocument();
  });

  it('switches tabs between export and import', () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('Import'));
    expect(screen.getByTestId('import-tab-content')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Export'));
    expect(screen.getByTestId('export-tab-content')).toBeInTheDocument();
  });

  it('closes on Escape and backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(<ImportExport isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector('.sor-modal-backdrop');
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders inline when embedded and skips overlay', () => {
    const { container } = render(<ImportExport isOpen={false} embedded onClose={() => {}} />);

    expect(screen.queryByText('Import / Export Connections')).not.toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(container.querySelector('.sor-modal-backdrop')).toBeNull();
  });
});

