import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectionTemplates from '../../src/components/connection/ConnectionTemplates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// Mock the Select component to render a simple <select>
vi.mock('../../src/components/ui/forms', () => ({
  Select: ({ value, onChange, options }: any) => (
    <select data-testid="select" value={value} onChange={(e: any) => onChange(e.target.value)}>
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

const STORAGE_KEY = 'sor-connection-templates';

describe('ConnectionTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the template list with builtin templates', () => {
    render(<ConnectionTemplates />);
    expect(screen.getByText('Connection Templates')).toBeInTheDocument();
    expect(screen.getByText('SSH Linux Server')).toBeInTheDocument();
    expect(screen.getByText('RDP Windows Server')).toBeInTheDocument();
    expect(screen.getByText('VNC Server')).toBeInTheDocument();
  });

  it('shows template details when a card is clicked', () => {
    render(<ConnectionTemplates />);
    fireEvent.click(screen.getByText('SSH Linux Server'));
    // Detail panel should show description (appears in card + detail, so use getAllByText)
    const descs = screen.getAllByText(/Standard SSH connection to a Linux server/);
    expect(descs.length).toBeGreaterThanOrEqual(2); // card desc + detail desc
    // Shows tags
    expect(screen.getByText('linux')).toBeInTheDocument();
    // Shows settings table
    expect(screen.getByText('authMethod')).toBeInTheDocument();
  });

  it('fires onCreateFromTemplate when Use Template is clicked', () => {
    const onCreate = vi.fn();
    render(<ConnectionTemplates onCreateFromTemplate={onCreate} />);
    // Click the first "Use Template" button directly (not from detail panel)
    const useButtons = screen.getAllByText('Use Template');
    fireEvent.click(useButtons[0]);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SSH Linux Server' }),
    );
  });

  it('filters templates by search query', () => {
    render(<ConnectionTemplates />);
    const searchInput = screen.getByPlaceholderText('Search templates by name or tag…');
    fireEvent.change(searchInput, { target: { value: 'postgres' } });
    expect(screen.getByText('Database PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByText('SSH Linux Server')).not.toBeInTheDocument();
  });

  it('filters templates by category pill', () => {
    render(<ConnectionTemplates />);
    // Click the RDP pill specifically (not the badge)
    const pills = screen.getAllByText('RDP');
    const rdpPill = pills.find(el => el.classList.contains('sor-tpl-pill'))!;
    fireEvent.click(rdpPill);
    expect(screen.getByText('RDP Windows Server')).toBeInTheDocument();
    expect(screen.getByText('RDP Workstation')).toBeInTheDocument();
    expect(screen.queryByText('SSH Linux Server')).not.toBeInTheDocument();
  });

  it('shows "No templates match" when search yields no results', () => {
    render(<ConnectionTemplates />);
    const searchInput = screen.getByPlaceholderText('Search templates by name or tag…');
    fireEvent.change(searchInput, { target: { value: 'zzz_nonexistent_zzz' } });
    expect(screen.getByText('No templates match your search.')).toBeInTheDocument();
  });

  it('opens create form when New Template is clicked', () => {
    render(<ConnectionTemplates />);
    fireEvent.click(screen.getByText(/New Template/));
    expect(screen.getByText('Create Template')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ConnectionTemplates onClose={onClose} />);
    // The header close button has title="Close"
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
