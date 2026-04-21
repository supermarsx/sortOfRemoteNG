import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabBar, Tab } from '../../src/components/ui/display/TabBar';

const TABS: Tab[] = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
];

describe('TabBar', () => {
  it('renders with role="tablist" on wrapper', () => {
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders role="tab" on each button', () => {
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('sets aria-selected="true" on active tab and "false" on others', () => {
    render(<TabBar tabs={TABS} activeTab="two" onTabChange={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('sets tabIndex=0 on active tab and -1 on others', () => {
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight moves to the next tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('two');
  });

  it('ArrowLeft moves to the previous tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="two" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('one');
  });

  it('Home moves to the first tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="three" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(onTabChange).toHaveBeenCalledWith('one');
  });

  it('End moves to the last tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onTabChange).toHaveBeenCalledWith('three');
  });

  it('ArrowRight wraps from last to first', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="three" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('one');
  });

  it('ArrowLeft wraps from first to last', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={TABS} activeTab="one" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('three');
  });
});
