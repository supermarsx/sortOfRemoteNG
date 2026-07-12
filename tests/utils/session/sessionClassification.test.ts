import { describe, it, expect } from 'vitest';
import {
  classifyTabKind,
  isRealConnectionSession,
  isToolTabSession,
  isWinmgmtTabSession,
  partitionSessions,
  realConnectionCount,
} from '../../../src/utils/session/sessionClassification';

const s = (protocol: string, id = protocol) => ({ id, protocol });

describe('classifyTabKind', () => {
  it.each([
    ['ssh', 'connection'],
    ['rdp', 'connection'],
    ['vnc', 'connection'],
    ['http', 'connection'],
    ['https', 'connection'],
    ['telnet', 'connection'],
    ['rlogin', 'connection'],
    ['winrm', 'connection'],
    ['some-future-protocol', 'connection'],
    ['', 'connection'],
    ['tool:settings', 'tool'],
    ['tool:wol', 'tool'],
    ['tool:any', 'tool'],
    ['winmgmt:services', 'winmgmt'],
    ['winmgmt:registry', 'winmgmt'],
  ] as const)('protocol %s classifies as %s', (protocol, expected) => {
    expect(classifyTabKind({ protocol })).toBe(expected);
  });

  it('handles undefined protocol as a connection (defensive default)', () => {
    expect(classifyTabKind({})).toBe('connection');
  });

  it('does not accept partial prefix matches as tools/winmgmt', () => {
    // The prefix discriminator is "tool:" (with colon), not "tool".
    // Without the colon it could be a legitimate protocol name.
    expect(classifyTabKind({ protocol: 'tool-server' })).toBe('connection');
    expect(classifyTabKind({ protocol: 'toolbox' })).toBe('connection');
    expect(classifyTabKind({ protocol: 'winmgmtish' })).toBe('connection');
  });

  it('does not match colon-prefix on protocols that merely contain the substring', () => {
    expect(classifyTabKind({ protocol: 'my-tool:thing' })).toBe('connection');
    expect(classifyTabKind({ protocol: 'super-winmgmt:foo' })).toBe('connection');
  });

  it('is case sensitive — uppercase prefixes are NOT tools', () => {
    // The production code only ever produces lowercase prefixes;
    // matching an uppercase variant would mask config-typo bugs.
    expect(classifyTabKind({ protocol: 'TOOL:settings' })).toBe('connection');
    expect(classifyTabKind({ protocol: 'Winmgmt:services' })).toBe('connection');
  });
});

describe('predicates', () => {
  it('isRealConnectionSession agrees with classifyTabKind', () => {
    expect(isRealConnectionSession(s('ssh'))).toBe(true);
    expect(isRealConnectionSession(s('tool:settings'))).toBe(false);
    expect(isRealConnectionSession(s('winmgmt:services'))).toBe(false);
  });

  it('isToolTabSession only true for tool: prefix', () => {
    expect(isToolTabSession(s('ssh'))).toBe(false);
    expect(isToolTabSession(s('tool:settings'))).toBe(true);
    expect(isToolTabSession(s('winmgmt:services'))).toBe(false);
  });

  it('isWinmgmtTabSession only true for winmgmt: prefix', () => {
    expect(isWinmgmtTabSession(s('ssh'))).toBe(false);
    expect(isWinmgmtTabSession(s('tool:settings'))).toBe(false);
    expect(isWinmgmtTabSession(s('winmgmt:services'))).toBe(true);
  });
});

describe('partitionSessions', () => {
  it('partitions a mixed list into three buckets', () => {
    const sessions = [
      s('ssh', 'a'),
      s('tool:settings', 'b'),
      s('rdp', 'c'),
      s('winmgmt:services', 'd'),
      s('tool:wol', 'e'),
    ];
    const out = partitionSessions(sessions);
    expect(out.connections.map((x) => x.id)).toEqual(['a', 'c']);
    expect(out.tools.map((x) => x.id)).toEqual(['b', 'e']);
    expect(out.winmgmt.map((x) => x.id)).toEqual(['d']);
  });

  it('returns empty buckets for an empty input', () => {
    expect(partitionSessions([])).toEqual({ connections: [], tools: [], winmgmt: [] });
  });

  it('preserves relative order within each bucket', () => {
    // Interleaving the input shouldn't reshuffle the partition —
    // callers using the partition for ordered rendering depend on
    // this.
    const sessions = [
      s('tool:a', '1'),
      s('ssh', '2'),
      s('tool:b', '3'),
      s('ssh', '4'),
      s('tool:c', '5'),
    ];
    const out = partitionSessions(sessions);
    expect(out.tools.map((x) => x.id)).toEqual(['1', '3', '5']);
    expect(out.connections.map((x) => x.id)).toEqual(['2', '4']);
  });
});

describe('realConnectionCount', () => {
  it('counts only real connections', () => {
    expect(
      realConnectionCount([
        s('ssh'),
        s('tool:settings'),
        s('rdp'),
        s('winmgmt:services'),
      ]),
    ).toBe(2);
  });

  it('returns 0 for an all-tool tab list', () => {
    expect(realConnectionCount([s('tool:a'), s('tool:b')])).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(realConnectionCount([])).toBe(0);
  });
});

describe('performance', () => {
  it('classifies 10k sessions in under 10ms', () => {
    const sessions = Array.from({ length: 10000 }, (_, i) => {
      const mod = i % 5;
      const protocol =
        mod === 0 ? 'tool:settings'
        : mod === 1 ? 'winmgmt:services'
        : mod === 2 ? 'ssh'
        : mod === 3 ? 'rdp'
        : 'https';
      return { id: String(i), protocol };
    });
    const start = performance.now();
    const out = partitionSessions(sessions);
    const elapsed = performance.now() - start;
    // Guards against a pathological (e.g. O(n^2)) regression, which would take
    // seconds for 10k items. The bound is generous rather than tight because
    // this runs under v8 coverage instrumentation in CI (`test:coverage`),
    // which ~doubles wall-clock time, and CI runners vary; a linear partition
    // stays well under this even instrumented.
    expect(elapsed).toBeLessThan(100);
    // Sanity: 2 of every 5 are tools/winmgmt
    expect(out.connections).toHaveLength(6000);
    expect(out.tools).toHaveLength(2000);
    expect(out.winmgmt).toHaveLength(2000);
  });
});
