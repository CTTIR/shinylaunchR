/**
 * GitHub Personal Access Token management.
 *
 * The token is stored in the OS secure store via `keytar` (Keychain / Windows
 * Credential Vault / libsecret) and NEVER written to the registry/settings JSON
 * or logged. The raw value never crosses IPC to the renderer — only a masked
 * status (last 4 chars) and a test result are exposed.
 *
 * keytar is a native, optional dependency: if it cannot be loaded (no prebuild,
 * missing libsecret on Linux) we degrade to an in-process, session-only store
 * and report backend "unavailable" so the UI can warn the user.
 */
import https from 'node:https';
import type { CredentialStatus, TokenTestResult } from '@shared/types';
import { logger } from './logger';

const SERVICE = 'shinylaunchR';
const ACCOUNT = 'github-pat';

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytar: Keytar | null | undefined;
let sessionToken: string | null = null; // fallback when keytar is unavailable

function loadKeytar(): Keytar | null {
  if (keytar !== undefined) return keytar;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    keytar = require('keytar') as Keytar;
  } catch (err) {
    logger.warn('credentials', `keytar unavailable, using session-only store: ${String(err)}`);
    keytar = null;
  }
  return keytar;
}

export function credentialsBackend(): 'keytar' | 'unavailable' {
  return loadKeytar() ? 'keytar' : 'unavailable';
}

/** Returns the raw token for internal (main-process) use only. */
export async function getToken(): Promise<string | null> {
  const kt = loadKeytar();
  if (kt) {
    try {
      return await kt.getPassword(SERVICE, ACCOUNT);
    } catch (err) {
      logger.error('credentials', `keytar read failed: ${String(err)}`);
      return null;
    }
  }
  return sessionToken;
}

function mask(token: string | null): CredentialStatus {
  const backend = credentialsBackend();
  if (!token) return { present: false, backend };
  return { present: true, last4: token.slice(-4), backend };
}

export async function getStatus(): Promise<CredentialStatus> {
  return mask(await getToken());
}

export async function setToken(token: string): Promise<CredentialStatus> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('token is empty');
  logger.addSecret(trimmed);
  const kt = loadKeytar();
  if (kt) {
    await kt.setPassword(SERVICE, ACCOUNT, trimmed);
  } else {
    sessionToken = trimmed;
  }
  logger.info('credentials', `Stored GitHub token (••••${trimmed.slice(-4)})`);
  return mask(trimmed);
}

export async function removeToken(): Promise<CredentialStatus> {
  const kt = loadKeytar();
  if (kt) {
    try {
      await kt.deletePassword(SERVICE, ACCOUNT);
    } catch (err) {
      logger.error('credentials', `keytar delete failed: ${String(err)}`);
    }
  }
  sessionToken = null;
  logger.clearSecrets();
  logger.info('credentials', 'Removed stored GitHub token');
  return mask(null);
}

/** Test the stored token against the GitHub API; reports the authenticated user. */
export async function testToken(): Promise<TokenTestResult> {
  const token = await getToken();
  if (!token) return { ok: false, message: 'No token stored' };
  return new Promise<TokenTestResult>((resolve) => {
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
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const scopes = (res.headers['x-oauth-scopes'] as string | undefined)
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(body) as { login?: string };
              resolve({ ok: true, login: json.login, scopes });
            } catch {
              resolve({ ok: true, scopes });
            }
          } else {
            resolve({
              ok: false,
              message: `GitHub returned ${res.statusCode ?? '?'}`,
              scopes,
            });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: 'Request timed out' });
    });
    req.on('error', (err) => resolve({ ok: false, message: String(err) }));
    req.end();
  });
}
