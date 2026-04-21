import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionNotes } from '../../src/components/connection/ConnectionNotes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const STORAGE_KEY = (id: string) => `sor-conn-notes-${id}`;

describe('ConnectionNotes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders header with connection name', () => {
    render(<ConnectionNotes connectionId="c1" connectionName="My Server" />);
    expect(screen.getByText(/Notes — My Server/)).toBeInTheDocument();
  });

  it('shows empty state placeholder when no notes exist', () => {
    render(<ConnectionNotes connectionId="c1" connectionName="Server" />);
    expect(screen.getByPlaceholderText('Write your notes here…')).toBeInTheDocument();
  });

  it('renders existing notes from localStorage', () => {
    const data = { content: 'Existing note text', tags: [], lastModified: Date.now(), runbookSteps: [] };
    localStorage.setItem(STORAGE_KEY('c2'), JSON.stringify(data));
    render(<ConnectionNotes connectionId="c2" connectionName="Server" />);
    const textarea = screen.getByPlaceholderText('Write your notes here…') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Existing note text');
  });

  it('user can edit notes by typing in textarea', () => {
    render(<ConnectionNotes connectionId="c3" connectionName="Server" />);
    const textarea = screen.getByPlaceholderText('Write your notes here…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    expect(textarea.value).toBe('Hello world');
  });

  it('persists notes to localStorage after debounce', () => {
    render(<ConnectionNotes connectionId="c4" connectionName="Server" />);
    const textarea = screen.getByPlaceholderText('Write your notes here…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Saved content' } });
    // Advance past the 2000ms debounce
    vi.advanceTimersByTime(2500);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY('c4')) || '{}');
    expect(stored.content).toBe('Saved content');
  });

  it('shows char and word count in footer', () => {
    const data = { content: 'three word count', tags: [], lastModified: Date.now(), runbookSteps: [] };
    localStorage.setItem(STORAGE_KEY('c5'), JSON.stringify(data));
    render(<ConnectionNotes connectionId="c5" connectionName="Server" />);
    expect(screen.getByText(/16 chars/)).toBeInTheDocument();
    expect(screen.getByText(/3 words/)).toBeInTheDocument();
  });

  it('handles long text content', () => {
    const longText = 'word '.repeat(1000).trim();
    const data = { content: longText, tags: [], lastModified: Date.now(), runbookSteps: [] };
    localStorage.setItem(STORAGE_KEY('c6'), JSON.stringify(data));
    render(<ConnectionNotes connectionId="c6" connectionName="Server" />);
    const textarea = screen.getByPlaceholderText('Write your notes here…') as HTMLTextAreaElement;
    expect(textarea.value).toBe(longText);
    expect(screen.getByText(/1000 words/)).toBeInTheDocument();
  });

  it('renders close button and calls onClose', () => {
    const onClose = vi.fn();
    render(<ConnectionNotes connectionId="c7" connectionName="Server" onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders Notes and Runbooks tabs', () => {
    render(<ConnectionNotes connectionId="c8" connectionName="Server" />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Runbooks')).toBeInTheDocument();
  });
});
