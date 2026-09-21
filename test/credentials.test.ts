import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CredentialStore,
  type EncryptionBackend,
  type LegacyBackend,
} from '../src/main/credentials';
import { logger } from '../src/main/logger';
let dir: string;
const token = 'fake-local-secret-for-tests-1234';
function backend(selected = 'gnome_libsecret'): EncryptionBackend {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => selected,
    encryptString: (value) => Buffer.from([...value].reverse().join('')),
    decryptString: (value) => [...value.toString()].reverse().join(''),
  };
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-test-'));
  logger.clearSecrets();
});
afterEach(() => {
  vi.restoreAllMocks();
  logger.clearSecrets();
  fs.rmSync(dir, { recursive: true, force: true });
});
it('persists ciphertext, masks status, reloads and registers retrieved secrets', async () => {
  const store = new CredentialStore(dir, backend(), undefined, 'linux');
  expect(await store.set(token)).toEqual({
    present: true,
    last4: '1234',
    backend: 'safeStorage',
  });
  expect(
    fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8'),
  ).not.toContain(token);
  logger.clearSecrets();
  expect(
    await new CredentialStore(dir, backend(), undefined, 'linux').getToken(),
  ).toBe(token);
  expect(logger.redact(`before ${token} after`)).toBe(
    'before «redacted» after',
  );
});
it('migrates only after durable encryption, then removes legacy token', async () => {
  const legacy: LegacyBackend = {
    getPassword: vi.fn(async () => token),
    deletePassword: vi.fn(async () => {
      expect(fs.existsSync(path.join(dir, 'credentials.json'))).toBe(true);
      return true;
    }),
  };
  const store = new CredentialStore(dir, backend(), legacy, 'linux');
  expect(await store.getToken()).toBe(token);
  expect(legacy.deletePassword).toHaveBeenCalledOnce();
  expect(await store.getToken()).toBe(token);
  expect(legacy.getPassword).toHaveBeenCalledOnce();
});
it('never deletes the legacy token when encryption fails', async () => {
  const crypto = backend();
  crypto.encryptString = () => {
    throw new Error('locked');
  };
  const legacy = {
    getPassword: vi.fn(async () => token),
    deletePassword: vi.fn(async () => true),
  };
  await expect(
    new CredentialStore(dir, crypto, legacy, 'linux').getToken(),
  ).rejects.toThrow('locked');
  expect(legacy.deletePassword).not.toHaveBeenCalled();
});
it('reports legacy removal failure without claiming the credential is gone', async () => {
  const legacy = {
    getPassword: vi.fn(async () => token),
    deletePassword: vi.fn(async () => false),
  };
  const store = new CredentialStore(dir, backend(), legacy, 'linux');
  await store.set(token);
  await expect(store.remove()).rejects.toThrow(/could not be removed/);
  expect((await store.status()).present).toBe(true);
});
it('removal survives restart and does not forget secrets that children may still emit', async () => {
  const store = new CredentialStore(dir, backend(), undefined, 'linux');
  await store.set(token);
  expect((await store.remove()).present).toBe(false);
  expect(
    await new CredentialStore(dir, backend(), undefined, 'linux').getToken(),
  ).toBeNull();
  expect(logger.redact(token)).toBe('«redacted»');
});
it('Linux basic_text is session-only and never writes plaintext credentials', async () => {
  const store = new CredentialStore(
    dir,
    backend('basic_text'),
    undefined,
    'linux',
  );
  expect((await store.set(token)).backend).toBe('session');
  expect(await store.getToken()).toBe(token);
  expect(fs.existsSync(path.join(dir, 'credentials.json'))).toBe(false);
  expect(
    (
      await new CredentialStore(
        dir,
        backend('basic_text'),
        undefined,
        'linux',
      ).status()
    ).present,
  ).toBe(false);
});
it('does not overwrite existing secure credentials when the backend becomes unavailable', async () => {
  await new CredentialStore(dir, backend(), undefined, 'linux').set(token);
  const locked = new CredentialStore(
    dir,
    backend('basic_text'),
    undefined,
    'linux',
  );
  await expect(locked.set('fake-replacement')).rejects.toThrow(/Unlock/);
  expect(
    await new CredentialStore(dir, backend(), undefined, 'linux').getToken(),
  ).toBe(token);
});
it('rejects invalid tokens and redacts fine-grained token shapes', async () => {
  const store = new CredentialStore(dir, backend(), undefined, 'linux');
  for (const value of ['', 'x\ny', 'x'.repeat(1025)])
    await expect(store.set(value)).rejects.toThrow();
  expect(logger.redact('github_pat_FAKE_TEST_1234 ghp_FAKE_TEST_5678')).toBe(
    '«redacted» «redacted»',
  );
});
it('serializes concurrent set/remove and exposes persistence errors', async () => {
  const store = new CredentialStore(dir, backend(), undefined, 'linux');
  await Promise.all([store.set(token), store.remove()]);
  expect(await store.getToken()).toBeNull();
  const broken = new CredentialStore(
    path.join(dir, 'not-a-directory'),
    backend(),
    undefined,
    'linux',
  );
  fs.writeFileSync(path.join(dir, 'not-a-directory'), 'file');
  await expect(broken.set(token)).rejects.toThrow();
});

it('session-only credentials can be set again after removal and restart', async () => {
  const first = new CredentialStore(
    dir,
    backend('basic_text'),
    undefined,
    'linux',
  );
  await first.set(token);
  await first.remove();
  await first.set('fake-session-replacement');
  expect(await first.getToken()).toBe('fake-session-replacement');
  const next = new CredentialStore(
    dir,
    backend('basic_text'),
    undefined,
    'linux',
  );
  await next.set('fake-next-session');
  expect(await next.getToken()).toBe('fake-next-session');
});
it('removal also removes recovery copies containing obsolete ciphertext', async () => {
  const store = new CredentialStore(dir, backend(), undefined, 'linux');
  await store.set(token);
  await store.set('fake-second-token');
  expect(fs.existsSync(path.join(dir, 'credentials.json.bak'))).toBe(true);
  await store.remove();
  expect(fs.existsSync(path.join(dir, 'credentials.json.bak'))).toBe(false);
});
