import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Session } from 'electron';
const external = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(),
);
vi.mock('electron', () => ({ shell: { openExternal: external } }));
import {
  httpsUrl,
  openHttps,
  restrictSession,
  restrictWindow,
  sameOrigin,
  trustedSender,
} from '../src/main/window-policy';

describe('window and session policy', () => {
  it('matches parsed origins, rejecting prefixes, credentials and protocol changes', () => {
    expect(
      sameOrigin('https://example.org/path?q=1', 'https://example.org'),
    ).toBe(true);
    for (const url of [
      'https://example.org.evil.test',
      'https://example.org@evil.test',
      'https://user:secret@example.org',
      'http://example.org',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ])
      expect(sameOrigin(url, 'https://example.org')).toBe(false);
    expect(sameOrigin('http://127.0.0.1:81234', 'http://127.0.0.1:8123')).toBe(
      false,
    );
    expect(
      sameOrigin('http://127.0.0.1:8123/app', 'http://127.0.0.1:8123'),
    ).toBe(true);
  });
  it('opens only HTTPS links without embedded credentials', async () => {
    external.mockClear();
    for (const url of [
      'https://user:secret@example.org',
      'file:///tmp/a',
      'http://example.org',
      'javascript:alert(1)',
    ]) {
      expect(httpsUrl(url)).toBe(false);
      await expect(openHttps(url)).rejects.toThrow();
    }
    expect(external).not.toHaveBeenCalled();
    await openHttps('https://example.org/help');
    expect(external).toHaveBeenCalledWith('https://example.org/help');
  });
  it('denies permission requests, permission checks, device permissions and downloads', () => {
    const session = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
    });
    restrictSession(session as unknown as Session);
    const respond = vi.fn();
    session.setPermissionRequestHandler.mock.calls[0]![0](
      null,
      'media',
      respond,
    );
    expect(respond).toHaveBeenCalledWith(false);
    expect(session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false);
    expect(session.setDevicePermissionHandler.mock.calls[0]![0]()).toBe(false);
    const event = { preventDefault: vi.fn() };
    session.emit('will-download', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it('guards navigation and redirects and blocks webviews and arbitrary new windows', () => {
    const contents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
    });
    restrictWindow(
      { webContents: contents } as unknown as BrowserWindow,
      (url) => sameOrigin(url, 'https://example.org'),
    );
    for (const eventName of ['will-navigate', 'will-redirect']) {
      const allowed = { preventDefault: vi.fn() },
        denied = { preventDefault: vi.fn() };
      contents.emit(eventName, allowed, 'https://example.org/app');
      contents.emit(eventName, denied, 'https://example.org.evil.test');
      expect(allowed.preventDefault).not.toHaveBeenCalled();
      expect(denied.preventDefault).toHaveBeenCalledOnce();
    }
    const frame = {
      isMainFrame: true,
      url: 'file:///etc/passwd',
      preventDefault: vi.fn(),
    };
    contents.emit('will-frame-navigate', frame);
    expect(frame.preventDefault).toHaveBeenCalledOnce();
    const view = { preventDefault: vi.fn() };
    contents.emit('will-attach-webview', view);
    expect(view.preventDefault).toHaveBeenCalledOnce();
    expect(
      contents.setWindowOpenHandler.mock.calls[0]![0]({
        url: 'https://example.org',
      }),
    ).toEqual({ action: 'deny' });
  });
  it('requires the exact dashboard window and main frame, with strict packaged URL equality', () => {
    const mainFrame = { url: 'file:///app/renderer/index.html' };
    const contents = { mainFrame };
    const win = {
      webContents: contents,
      isDestroyed: () => false,
    } as unknown as BrowserWindow;
    const event = { sender: contents, senderFrame: mainFrame } as Parameters<
      typeof trustedSender
    >[0];
    expect(trustedSender(event, win, mainFrame.url)).toBe(true);
    expect(
      trustedSender(
        { ...event, sender: {} as typeof event.sender },
        win,
        mainFrame.url,
      ),
    ).toBe(false);
    expect(
      trustedSender(
        {
          ...event,
          senderFrame: { url: mainFrame.url } as typeof event.senderFrame,
        },
        win,
        mainFrame.url,
      ),
    ).toBe(false);
    mainFrame.url += '?spoof=1';
    expect(trustedSender(event, win, 'file:///app/renderer/index.html')).toBe(
      false,
    );
    mainFrame.url = 'http://localhost:5173/app';
    expect(trustedSender(event, win, 'http://localhost:5173', true)).toBe(true);
    mainFrame.url = 'http://localhost.evil.test:5173';
    expect(trustedSender(event, win, 'http://localhost:5173', true)).toBe(
      false,
    );
  });
});
