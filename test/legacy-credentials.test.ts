import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import {
  NativeLegacyBackend,
  runLegacyCommand,
  type LegacyCommandResult,
} from '../src/main/legacy-credentials';
import { logger } from '../src/main/logger';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const target = ['shinylaunchR', 'github-pat'] as const;
const result = (
  patch: Partial<LegacyCommandResult> = {},
): LegacyCommandResult => ({ code: 0, stdout: '', stderr: '', ...patch });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  logger.clearSecrets();
});

describe('native legacy credential migration adapter (fake OS helpers only)', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'reads %s with a fixed target and registers the token before returning',
    async (platform) => {
      const secret = 'fixture-token-not-a-recognized-prefix';
      const runner = vi.fn(async () =>
        result({ stdout: secret + (platform === 'win32' ? '' : '\n') }),
      );
      const backend = new NativeLegacyBackend(platform, runner);
      expect(await backend.getPassword(...target)).toBe(secret);
      expect(logger.redact(secret)).toBe('«redacted»');
      const [file, args] = runner.mock.calls[0]! as unknown as [
        string,
        string[],
      ];
      expect(args.join(' ')).not.toContain(secret);
      if (platform === 'darwin') {
        expect(file).toBe('/usr/bin/security');
        expect(args).toEqual([
          'find-generic-password',
          '-s',
          'shinylaunchR',
          '-a',
          'github-pat',
          '-w',
        ]);
      } else if (platform === 'linux') {
        expect(file).toBe('secret-tool');
        expect(args).toEqual([
          'lookup',
          'service',
          'shinylaunchR',
          'account',
          'github-pat',
        ]);
      } else {
        expect(file).toMatch(/WindowsPowerShell.*powershell.exe$/);
        expect(args).toContain('-NonInteractive');
        expect(args).toContain('-NoProfile');
        const script = args.at(-1)!;
        expect(script).toContain('CredReadW');
        expect(script).toContain('shinylaunchR/github-pat');
        expect(script).toContain(
          'new UTF8Encoding(false, true).GetString(bytes)',
        );
        expect(script).toContain('finally { CredFree(pointer); }');
      }
    },
  );
  it.each(['darwin', 'linux', 'win32'] as const)(
    'deletes only the configured %s legacy target',
    async (platform) => {
      const runner = vi.fn(async () => result());
      expect(
        await new NativeLegacyBackend(platform, runner).deletePassword(
          ...target,
        ),
      ).toBe(true);
      const args = (runner.mock.calls[0]! as unknown as [string, string[]])[1];
      if (platform === 'darwin')
        expect(args).toEqual([
          'delete-generic-password',
          '-s',
          'shinylaunchR',
          '-a',
          'github-pat',
        ]);
      else if (platform === 'linux')
        expect(args).toEqual([
          'clear',
          'service',
          'shinylaunchR',
          'account',
          'github-pat',
        ]);
      else
        expect(args.at(-1)).toContain(
          '[ShinyLaunchLegacyCredential]::Delete()',
        );
    },
  );
  it.each(['darwin', 'linux', 'win32'] as const)(
    'treats %s not-found as an empty old store',
    async (platform) => {
      const runner = vi.fn(async () =>
        result({ code: platform === 'linux' ? 1 : 44 }),
      );
      const backend = new NativeLegacyBackend(platform, runner);
      expect(await backend.getPassword(...target)).toBeNull();
      expect(await backend.deletePassword(...target)).toBe(false);
    },
  );
  it('does not block a clean user when the helper is missing, but never claims successful removal', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const runner = vi.fn(async () =>
      result({ code: null, errorCode: 'ENOENT' }),
    );
    const backend = new NativeLegacyBackend('linux', runner);
    expect(await backend.getPassword(...target)).toBeNull();
    expect(await backend.getPassword(...target)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toContain('not inspected or removed');
    await expect(backend.deletePassword(...target)).rejects.toThrow(
      /restore its helper/,
    );
  });
  it('does not mistake a locked Linux keyring error for missing credentials or expose command output', async () => {
    const secret = 'sensitive-helper-output';
    const backend = new NativeLegacyBackend('linux', async () =>
      result({ code: 1, stdout: secret, stderr: `locked ${secret}` }),
    );
    for (const operation of [
      backend.getPassword(...target),
      backend.deletePassword(...target),
    ]) {
      await expect(operation).rejects.toThrow(/credential/);
    }
    await expect(backend.getPassword(...target)).rejects.not.toThrow(secret);
  });
  it('sanitizes runner exceptions and timeout/buffer failures', async () => {
    const backend = new NativeLegacyBackend('darwin', async () => {
      throw new Error('a-private-secret');
    });
    await expect(backend.getPassword(...target)).rejects.toThrow(
      'Legacy credential access failed.',
    );
    for (const errorCode of ['TIMEOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']) {
      const timed = new NativeLegacyBackend('darwin', async () =>
        result({ code: null, errorCode, stdout: 'secret' }),
      );
      await expect(timed.getPassword(...target)).rejects.toThrow(
        /failed or timed out/,
      );
    }
  });
  it('rejects caller-controlled targets before running a helper', async () => {
    const runner = vi.fn(async () => result());
    const backend = new NativeLegacyBackend('win32', runner);
    await expect(
      backend.getPassword('other; command', 'github-pat'),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      backend.deletePassword('shinylaunchR', 'other'),
    ).rejects.toThrow(/Unsupported/);
    expect(runner).not.toHaveBeenCalled();
  });
  it('rejects malformed token output after registering it for redaction', async () => {
    const token = 'fixture-token\nsecond-line';
    const backend = new NativeLegacyBackend('linux', async () =>
      result({ stdout: token }),
    );
    await expect(backend.getPassword(...target)).rejects.toThrow(
      /unsupported format/,
    );
    expect(logger.redact(token)).toBe('«redacted»');
  });
  it('bounds native execution, hides the window and strips ambient tokens without invoking an OS helper', async () => {
    vi.stubEnv('GITHUB_PAT', 'ambient-fixture');
    vi.stubEnv('GH_TOKEN', 'ambient-other');
    const mocked = vi.mocked(execFile);
    mocked.mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      callback(
        { code: 'ENOENT', message: 'secret-error' },
        'secret-output',
        'secret-stderr',
      );
      return {};
    }) as never);
    const response = await runLegacyCommand('fake-fixture-only', ['lookup']);
    expect(response.errorCode).toBe('ENOENT');
    const options = mocked.mock.calls.at(-1)![2] as {
      timeout: number;
      maxBuffer: number;
      killSignal: string;
      windowsHide: boolean;
      env: NodeJS.ProcessEnv;
      shell?: boolean;
    };
    expect(options).toMatchObject({
      timeout: 5000,
      maxBuffer: 16384,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    expect(options.env.GITHUB_PAT).toBeUndefined();
    expect(options.env.GH_TOKEN).toBeUndefined();
    expect(options.shell).toBeUndefined();
  });
});
