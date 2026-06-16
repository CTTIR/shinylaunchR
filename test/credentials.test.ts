import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../src/main/logger';
import {
  __setKeytarForTests,
  getStatus,
  getToken,
  removeToken,
  setToken,
} from '../src/main/credentials';

/** In-memory fake of the keytar surface — never touches the real OS keychain. */
function fakeKeytar() {
  const store = new Map<string, string>();
  const key = (s: string, a: string) => `${s}:${a}`;
  return {
    store,
    getPassword: async (s: string, a: string) => store.get(key(s, a)) ?? null,
    setPassword: async (s: string, a: string, p: string) => void store.set(key(s, a), p),
    deletePassword: async (s: string, a: string) => store.delete(key(s, a)),
  };
}

beforeEach(() => {
  logger.clearSecrets();
});

afterEach(() => {
  __setKeytarForTests(undefined); // reset to auto-detection
});

describe('credential masking & storage', () => {
  it('stores via the backend and only ever exposes the last 4 chars', async () => {
    const kt = fakeKeytar();
    __setKeytarForTests(kt);
    const status = await setToken('ghp_ABCDEFGHIJKLMNOP1234');
    expect(status.present).toBe(true);
    expect(status.last4).toBe('1234');
    expect(status.backend).toBe('keytar');
    // the masked status must NOT carry the full token
    expect(JSON.stringify(status)).not.toContain('ABCDEFGH');
    // but the raw token is retrievable internally for the installer child
    expect(await getToken()).toBe('ghp_ABCDEFGHIJKLMNOP1234');
  });

  it('removes the token from the backend and memory', async () => {
    const kt = fakeKeytar();
    __setKeytarForTests(kt);
    await setToken('ghp_TOKEN_TO_DELETE_XYZ');
    expect(kt.store.size).toBe(1);
    const status = await removeToken();
    expect(status.present).toBe(false);
    expect(kt.store.size).toBe(0);
    expect(await getToken()).toBeNull();
  });

  it('falls back to a session-only store and reports unavailable', async () => {
    __setKeytarForTests(null);
    const status = await setToken('ghp_SESSION_ONLY_TOKEN');
    expect(status.backend).toBe('unavailable');
    expect(status.last4).toBe('OKEN');
    expect((await getStatus()).present).toBe(true);
  });
});

describe('logger redaction', () => {
  it('masks a registered secret everywhere in a message', () => {
    logger.addSecret('ghp_SuperSecretValue123');
    const out = logger.redact('installing with token ghp_SuperSecretValue123 ok');
    expect(out).not.toContain('SuperSecret');
    expect(out).toContain('«redacted»');
  });

  it('masks anything matching a GitHub token shape even if not registered', () => {
    const out = logger.redact('leaked ghp_0123456789abcdefghij in output');
    expect(out).not.toContain('0123456789abcdefghij');
  });

  it('ignores secrets shorter than 4 chars', () => {
    logger.addSecret('ab');
    expect(logger.redact('value ab here')).toContain('ab here');
  });

  it('registering a token as a secret redacts it from later logs', async () => {
    __setKeytarForTests(null);
    await setToken('ghp_REGISTER_ME_PLEASE_9999');
    expect(logger.redact('saw ghp_REGISTER_ME_PLEASE_9999')).not.toContain('REGISTER_ME');
  });
});
