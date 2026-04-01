import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RDPErrorScreen from '../../src/components/rdp/RDPErrorScreen';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Mock the hook to control the manager state
vi.mock('../../src/hooks/rdp/useRdpErrorScreen', () => {
  const RDP_ERROR_CATEGORY_LABELS: Record<string, string> = {
    duplicate_session: 'Duplicate Session',
    negotiation_failure: 'Negotiation Failure',
    credssp_post_auth: 'CredSSP Post-Auth',
    credssp_oracle: 'CredSSP Oracle',
    credentials: 'Credentials',
    timeout: 'Timeout',
    network: 'Network',
    tls: 'TLS / Certificate',
    unknown: 'Unknown',
  };

  return {
    RDP_ERROR_CATEGORY_LABELS,
    useRDPErrorScreen: vi.fn(),
  };
});

import { useRDPErrorScreen } from '../../src/hooks/rdp/useRdpErrorScreen';

function makeMgr(overrides: Partial<ReturnType<typeof useRDPErrorScreen>> = {}): ReturnType<typeof useRDPErrorScreen> {
  return {
    copied: false,
    showRawError: false,
    expandedCause: 0,
    diagnosticReport: null,
    isRunningDiagnostics: false,
    diagnosticError: null,
    expandedStep: null,
    category: 'network' as const,
    diagnostics: [
      {
        icon: null,
        title: 'Connection refused',
        description: 'The remote host refused the connection.',
        remediation: ['Check if the host is reachable.', 'Verify the port is open.'],
        severity: 'high' as const,
      },
    ],
    handleCopy: vi.fn(),
    toggleCause: vi.fn(),
    runDeepDiagnostics: vi.fn(),
    toggleStep: vi.fn(),
    toggleRawError: vi.fn(),
    ...overrides,
  };
}

const baseProps = {
  sessionId: 'abc12345-session-id-full',
  hostname: 'server.example.com',
  errorMessage: 'Connection refused by remote host',
};

describe('RDPErrorScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRDPErrorScreen).mockReturnValue(makeMgr());
  });

  it('renders Connection Failed heading and hostname', () => {
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText('Connection Failed')).toBeInTheDocument();
    expect(screen.getByText(/server\.example\.com/)).toBeInTheDocument();
  });

  it('shows error category label from the hook', () => {
    vi.mocked(useRDPErrorScreen).mockReturnValue(makeMgr({ category: 'timeout' }));
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText('Timeout')).toBeInTheDocument();
  });

  it('renders Retry Connection button and fires onRetry', () => {
    const onRetry = vi.fn();
    render(<RDPErrorScreen {...baseProps} onRetry={onRetry} />);
    const btn = screen.getByText('Retry Connection');
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render Retry button when onRetry is not provided', () => {
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.queryByText('Retry Connection')).not.toBeInTheDocument();
  });

  it('renders Edit Settings button and fires onEditConnection', () => {
    const onEdit = vi.fn();
    render(<RDPErrorScreen {...baseProps} onEditConnection={onEdit} />);
    const btn = screen.getByText('Edit Settings');
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders Copy Error button and calls handleCopy', () => {
    const handleCopy = vi.fn();
    vi.mocked(useRDPErrorScreen).mockReturnValue(makeMgr({ handleCopy }));
    render(<RDPErrorScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Copy Error'));
    expect(handleCopy).toHaveBeenCalledOnce();
  });

  it('shows "Copied" text when copy is done', () => {
    vi.mocked(useRDPErrorScreen).mockReturnValue(makeMgr({ copied: true }));
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('renders probable causes from diagnostics', () => {
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.getByText('Probable Causes')).toBeInTheDocument();
  });

  it('shows raw error text when showRawError is true', () => {
    vi.mocked(useRDPErrorScreen).mockReturnValue(makeMgr({ showRawError: true }));
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText(baseProps.errorMessage)).toBeInTheDocument();
    expect(screen.getByText(/Hide/)).toBeInTheDocument();
  });

  it('shows Deep Diagnostics button when connectionDetails are provided', () => {
    render(
      <RDPErrorScreen
        {...baseProps}
        connectionDetails={{ port: 3389, username: 'admin', password: 'pass' }}
      />,
    );
    expect(screen.getByText('Deep Diagnostics')).toBeInTheDocument();
  });

  it('shows truncated session id', () => {
    render(<RDPErrorScreen {...baseProps} />);
    expect(screen.getByText('abc12345')).toBeInTheDocument();
  });
});
