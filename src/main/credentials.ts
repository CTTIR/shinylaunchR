/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import type { CredentialStatus, TokenTestResult } from '@shared/types';
import { logger } from './logger';
import { assertInside } from './safe-path';
import { writeAtomicJson } from './atomic-store';
export interface EncryptionBackend {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export interface LegacyBackend {
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}
export class CredentialStore {
  private session: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private crypto: EncryptionBackend,
    private legacy?: LegacyBackend,
    private platform = process.platform,
  ) {}
  private get file(): string {
    return path.join(this.directory, 'credentials.json');
  }
  private secure(): boolean {
    return (
      this.crypto.isEncryptionAvailable() &&
      (this.platform !== 'linux' ||
        !['basic_text', 'unknown'].includes(
          this.crypto.getSelectedStorageBackend?.() ?? 'unknown',
        ))
    );
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.catch(() => {}).then(fn);
    this.queue = p;
    return p;
  }
  private async read(): Promise<string | null> {
    if (this.session) return this.session;
    assertInside(this.directory, this.file);
    if (fs.existsSync(this.file)) {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as {
        encrypted?: string;
        removed?: boolean;
      };
      if (value.removed) return null;
      if (!this.secure())
        throw new Error(
          'Secure storage is unavailable; unlock your system credential store to read the saved token.',
        );
      if (typeof value.encrypted !== 'string')
        throw new Error('Stored credential is invalid. Remove or replace it.');
      const token = this.crypto.decryptString(
        Buffer.from(value.encrypted, 'base64'),
      );
      logger.addSecret(token);
      return token;
    }
    if (this.legacy && this.secure()) {
      const token = await this.legacy.getPassword('shinylaunchR', 'github-pat');
      if (token) {
        logger.addSecret(token);
        this.persist(token);
        // Delete legacy only after a durable encrypted copy exists. Failures are visible and retried on removal.
        if (!(await this.legacy.deletePassword('shinylaunchR', 'github-pat')))
          logger.warn(
            'credentials',
            'Encrypted token imported; no legacy token was deleted.',
          );
        return token;
      }
    }
    return null;
  }
  private persist(token: string | null): void {
    if (token === null) {
      writeAtomicJson(this.file, { version: 1, removed: true });
      fs.rmSync(assertInside(this.directory, `${this.file}.bak`), {
        force: true,
      });
      return;
    }
    writeAtomicJson(this.file, {
      version: 1,
      encrypted: this.crypto.encryptString(token).toString('base64'),
    });
    fs.chmodSync(this.file, 0o600);
  }
  private mask(token: string | null): CredentialStatus {
    return {
      present: !!token,
      last4: token?.slice(-4),
      backend: this.session
        ? 'session'
        : this.secure()
          ? 'safeStorage'
          : 'unavailable',
    };
  }
  getToken(): Promise<string | null> {
    return this.serial(async () => {
      const token = await this.read();
      if (token) logger.addSecret(token);
      return token;
    });
  }
  status(): Promise<CredentialStatus> {
    return this.serial(async () => this.mask(await this.read()));
  }
  set(token: string): Promise<CredentialStatus> {
    return this.serial(async () => {
      const value = token.trim();
      if (!value || value.length > 1024 || /[\r\n\0]/.test(value))
        throw new Error('Enter a valid token.');
      logger.addSecret(value);
      if (this.secure()) {
        this.persist(value);
        this.session = null;
      } else {
        // Do not leave an old disk credential to unexpectedly reappear after a session replacement.
        if (
          fs.existsSync(this.file) &&
          JSON.parse(
            fs.readFileSync(assertInside(this.directory, this.file), 'utf8'),
          ).removed !== true
        )
          throw new Error(
            'Unlock secure storage before replacing an existing saved token.',
          );
        this.session = value;
      }
      return this.mask(value);
    });
  }
  remove(): Promise<CredentialStatus> {
    return this.serial(async () => {
      if (this.legacy) {
        const token = await this.legacy.getPassword(
          'shinylaunchR',
          'github-pat',
        );
        if (
          token &&
          !(await this.legacy.deletePassword('shinylaunchR', 'github-pat'))
        )
          throw new Error('Legacy credential could not be removed.');
      }
      this.persist(null);
      this.session = null;
      return this.mask(null);
    });
  }
}
let store: CredentialStore | undefined;
export function initCredentials(
  directory: string,
  crypto: EncryptionBackend,
  legacy?: LegacyBackend,
): void {
  store = new CredentialStore(directory, crypto, legacy);
}
function current(): CredentialStore {
  if (!store) throw new Error('Credentials have not been initialized.');
  return store;
}
export const getToken = (): Promise<string | null> => current().getToken();
export const getStatus = (): Promise<CredentialStatus> => current().status();
export const setToken = (token: string): Promise<CredentialStatus> =>
  current().set(token);
export const removeToken = (): Promise<CredentialStatus> => current().remove();
export async function testToken(): Promise<TokenTestResult> {
  const token = await getToken();
  if (!token) return { ok: false, message: 'No token stored' };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TokenTestResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const req = https.request(
      {
        host: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
          'User-Agent': 'shinylaunchR',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 65536) req.destroy(new Error('Response too large'));
        });
        res.on('error', () =>
          finish({ ok: false, message: 'Credential test connection failed.' }),
        );
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { login?: string };
            finish(
              res.statusCode === 200
                ? { ok: true, login: json.login }
                : { ok: false, message: `GitHub returned ${res.statusCode}` },
            );
          } catch {
            finish({ ok: false, message: 'Invalid GitHub response' });
          }
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, message: 'Request timed out' });
    }, 10000);
    req.on('close', () => clearTimeout(timer));
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', () =>
      finish({
        ok: false,
        message: 'Credential test failed; check network and token.',
      }),
    );
    req.end();
  });
}
