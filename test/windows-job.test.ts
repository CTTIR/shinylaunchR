import { describe, expect, it } from 'vitest';
import {
  quoteWindowsArgument,
  windowsJobScript,
} from '../src/main/windows-job';

describe('Windows native command construction', () => {
  it.each([
    ['', '""'],
    ['plain', '"plain"'],
    ['with spaces', '"with spaces"'],
    ['a"b', '"a\\"b"'],
    ['C:\\folder\\', '"C:\\folder\\\\"'],
    ['a\\"b', '"a\\\\\\"b"'],
  ])('quotes %j without losing argument boundaries', (value, expected) => {
    expect(quoteWindowsArgument(value)).toBe(expected);
  });
  it('transports command data as UTF-16 base64 without source interpolation', () => {
    const command = 'C:\\Program Files\\R\\Rscript.exe';
    const args = ['--vanilla', "λ ' ; $(throw 'injected')", 'backslash\\'];
    const source = windowsJobScript(command, args, 'fixture-123');
    expect(source).not.toContain(args[1]);
    const encoded = source.match(/FromBase64String\('([^']+)'\)/)![1]!;
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(
      [command, ...args].map(quoteWindowsArgument).join(' '),
    );
  });
  it('rejects invalid identifiers, NUL and oversized native command lines', () => {
    expect(() => windowsJobScript('Rscript', [], "bad'; exit")).toThrow(
      /marker/,
    );
    expect(() => windowsJobScript('Rscript', ['a\0b'], 'fixture')).toThrow(
      /NUL/,
    );
    expect(() =>
      windowsJobScript('Rscript', ['x'.repeat(32767)], 'fixture'),
    ).toThrow(/too long/);
  });
});
