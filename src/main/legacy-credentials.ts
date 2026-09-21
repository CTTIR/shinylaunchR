/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { LegacyBackend } from './credentials';
import { logger } from './logger';

export interface LegacyCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
}
export type LegacyRunner = (
  file: string,
  args: string[],
) => Promise<LegacyCommandResult>;

/** Never reject with execFile's error: it can contain command output and a secret. */
export const runLegacyCommand: LegacyRunner = (file, args) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    delete env.GITHUB_PAT;
    delete env.GH_TOKEN;
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 16384,
        windowsHide: true,
        env,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error
            ? typeof error.code === 'number'
              ? error.code
              : null
            : 0,
          stdout,
          stderr,
          errorCode: error
            ? typeof error.code === 'string'
              ? error.code
              : error.killed
                ? 'TIMEOUT'
                : undefined
            : undefined,
        });
      },
    );
  });

// keytar stores a generic Windows credential at service/account with a UTF-8 blob.
// Keep the target and native program constant; no caller text is interpolated.
const WINDOWS_NATIVE = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ShinyLaunchLegacyCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] static extern bool ReadNative(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] static extern bool DeleteNative(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
  public static string Read() {
    IntPtr pointer;
    if (!ReadNative("shinylaunchR/github-pat", 1, 0, out pointer)) {
      if (Marshal.GetLastWin32Error() == 1168) return null;
      throw new InvalidOperationException();
    }
    try {
      Credential c = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      if (c.CredentialBlobSize > 4096) throw new InvalidOperationException();
      byte[] bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
      return new UTF8Encoding(false, true).GetString(bytes);
    } finally { CredFree(pointer); }
  }
  public static bool Delete() {
    if (DeleteNative("shinylaunchR/github-pat", 1, 0)) return true;
    if (Marshal.GetLastWin32Error() == 1168) return false;
    throw new InvalidOperationException();
  }
}
'@
`;
const WINDOWS_READ = `${WINDOWS_NATIVE}
$value = [ShinyLaunchLegacyCredential]::Read()
if ($null -eq $value) { exit 44 }
[Console]::Write($value)
exit 0
} catch { exit 45 }
`;
const WINDOWS_DELETE = `${WINDOWS_NATIVE}
if ([ShinyLaunchLegacyCredential]::Delete()) { exit 0 }
exit 44
} catch { exit 45 }
`;

export class NativeLegacyBackend implements LegacyBackend {
  private warned = false;
  constructor(
    private platform: NodeJS.Platform = process.platform,
    private runner: LegacyRunner = runLegacyCommand,
  ) {}
  private validate(service: string, account: string): void {
    if (service !== 'shinylaunchR' || account !== 'github-pat')
      throw new Error('Unsupported legacy credential target.');
  }
  private async command(remove: boolean): Promise<LegacyCommandResult> {
    let file: string, args: string[];
    if (this.platform === 'darwin') {
      file = '/usr/bin/security';
      args = [
        remove ? 'delete-generic-password' : 'find-generic-password',
        '-s',
        'shinylaunchR',
        '-a',
        'github-pat',
        ...(remove ? [] : ['-w']),
      ];
    } else if (this.platform === 'linux') {
      file = 'secret-tool';
      args = [
        remove ? 'clear' : 'lookup',
        'service',
        'shinylaunchR',
        'account',
        'github-pat',
      ];
    } else if (this.platform === 'win32') {
      file = path.win32.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        remove ? WINDOWS_DELETE : WINDOWS_READ,
      ];
    } else return { code: null, stdout: '', stderr: '', errorCode: 'ENOENT' };
    try {
      return await this.runner(file, args);
    } catch {
      throw new Error(
        'Legacy credential access failed. Unlock the OS credential store and retry.',
      );
    }
  }
  private absent(result: LegacyCommandResult): boolean {
    return (
      !result.errorCode &&
      (this.platform === 'linux'
        ? result.code === 1 && !result.stderr.trim()
        : result.code === 44)
    );
  }
  async getPassword(service: string, account: string): Promise<string | null> {
    this.validate(service, account);
    const result = await this.command(false);
    if (result.errorCode === 'ENOENT') {
      if (!this.warned) {
        logger.warn(
          'credentials',
          'Legacy credential helper unavailable. On Linux install secret-tool (libsecret tools) to migrate an existing token; otherwise enter your token again. Existing OS credentials were not inspected or removed.',
        );
        this.warned = true;
      }
      return null;
    }
    if (this.absent(result)) return null;
    if (result.code !== 0 || result.errorCode)
      throw new Error(
        'Legacy credential lookup failed or timed out. Unlock your OS credential store and retry; no legacy token was removed.',
      );
    const token = result.stdout.replace(/\r?\n$/, '');
    if (!token) return null;
    logger.addSecret(token);
    if (token.length > 1024 || /[\r\n\0]/.test(token))
      throw new Error(
        'Legacy credential has an unsupported format. Replace it manually in Credentials.',
      );
    return token;
  }
  async deletePassword(service: string, account: string): Promise<boolean> {
    this.validate(service, account);
    const result = await this.command(true);
    if (this.absent(result)) return false;
    if (result.code !== 0 || result.errorCode)
      throw new Error(
        'Legacy credential removal failed or timed out. Unlock the OS credential store or restore its helper and retry.',
      );
    return true;
  }
}

export function createLegacyBackend(
  platform: NodeJS.Platform = process.platform,
  runner: LegacyRunner = runLegacyCommand,
): LegacyBackend {
  return new NativeLegacyBackend(platform, runner);
}
