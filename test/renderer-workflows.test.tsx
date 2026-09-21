// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEntry, AppSettings, MenuCommand } from '../src/shared/types';
const mock = vi.hoisted(() => ({
  api: {} as Record<
    string,
    ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>
  >,
}));
vi.mock('../src/renderer/lib/api', () => mock);
import { App } from '../src/renderer/main';
import { RegisterDialog } from '../src/renderer/components/RegisterDialog';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';
import { AppTile } from '../src/renderer/components/AppTile';
import {
  LogConsole,
  type DisplayLog,
} from '../src/renderer/components/LogConsole';
const app: AppEntry = {
  id: 'one',
  name: 'Example',
  source: { kind: 'url', url: 'https://example.org' },
  installed: true,
  createdAt: '2026-09-21',
};
const settings: AppSettings = {
  theme: 'system',
  defaultWindowWidth: 1000,
  defaultWindowHeight: 700,
  startupLaunchLast: false,
  portBehavior: 'auto',
  portRangeStart: 4000,
  portRangeEnd: 5000,
  cranMirror: 'https://cloud.r-project.org',
  preferPak: true,
};
let menu: (cmd: MenuCommand) => void;
beforeEach(() => {
  Object.keys(mock.api).forEach((key) => delete mock.api[key]);
  for (const name of [
    'listApps',
    'getSettings',
    'getStatuses',
    'rStatus',
    'onLog',
    'onStatus',
    'onMenu',
    'selectApp',
    'launch',
    'stop',
    'setSettings',
    'removeApp',
    'addApp',
    'install',
  ])
    mock.api[name] = vi.fn();
  mock.api.listApps!.mockResolvedValue([app]);
  mock.api.getSettings!.mockResolvedValue(settings);
  mock.api.getStatuses!.mockResolvedValue([]);
  mock.api.rStatus!.mockResolvedValue({ found: true });
  for (const name of ['onLog', 'onStatus'])
    mock.api[name]!.mockReturnValue(() => {});
  mock.api.onMenu!.mockImplementation((handler) => {
    menu = handler as (cmd: MenuCommand) => void;
    return () => {};
  });
  mock.api.launch!.mockResolvedValue({ ok: true });
  mock.api.removeApp!.mockResolvedValue({ ok: true });
  mock.api.setSettings!.mockImplementation(async (patch) => ({
    ...settings,
    ...(patch as Partial<AppSettings>),
  }));
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
});
afterEach(cleanup);
describe('renderer workflows with mocked IPC', () => {
  it('native menu targets the current keyboard selection and Cancel aborts removal', async () => {
    render(<App />);
    const tile = await screen.findByRole('button', { name: 'Example, Ready' });
    fireEvent.focus(tile);
    act(() => menu('remove-selected'));
    expect(screen.queryByText(/uninstall package/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mock.api.removeApp).not.toHaveBeenCalled();
    act(() => menu('edit-selected'));
    expect(screen.getByLabelText('Display name')).toHaveProperty(
      'value',
      'Example',
    );
  });
  it('catches launch failure, offers retry, and permits cancellation without duplicate launch', async () => {
    let finish!: (result: { ok: boolean; message?: string }) => void;
    mock.api.launch!.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mock.api.stop!.mockResolvedValue({ ok: true });
    render(<App />);
    const tile = await screen.findByRole('button', { name: 'Example, Ready' });
    fireEvent.doubleClick(tile);
    fireEvent.doubleClick(tile);
    expect(mock.api.launch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Example' }));
    expect(mock.api.stop).toHaveBeenCalledWith('one');
    await act(async () =>
      finish({ ok: false, message: 'Server exited before startup' }),
    );
    expect(screen.getByRole('alert').textContent).toContain('Server exited');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mock.api.launch).toHaveBeenCalledTimes(2));
  });
  it('supports keyboard context actions and restores focus after closing a modal', async () => {
    render(<App />);
    const tile = await screen.findByRole('button', { name: 'Example, Ready' });
    act(() => tile.focus());
    fireEvent.keyDown(tile, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Launch');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Stop / cancel');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(tile);
    act(() => menu('edit-selected'));
    const save = screen.getByRole('button', { name: 'Save' });
    act(() => save.focus());
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Display name'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });
  it('registers before installing so the new installation can be cancelled and retried without a duplicate app', async () => {
    const installed = {
      ...app,
      id: 'new',
      name: 'New package',
      pkg: 'shiny',
      fun: 'runApp',
      installed: false,
      source: { kind: 'cran' as const },
    };
    mock.api.addApp!.mockResolvedValue(installed);
    let resolveInstall!: (result: { ok: boolean }) => void;
    mock.api.install!.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve;
        }),
    );
    mock.api.stop!.mockResolvedValue({ ok: true });
    render(<App />);
    await screen.findByRole('button', { name: 'Example, Ready' });
    fireEvent.click(screen.getByRole('button', { name: 'Add package' }));
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'New package' },
    });
    fireEvent.change(screen.getByLabelText('Package name'), {
      target: { value: 'shiny' },
    });
    fireEvent.change(screen.getByLabelText('Launcher function'), {
      target: { value: 'runApp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add & install' }));
    await waitFor(() => expect(mock.api.install).toHaveBeenCalledWith('new'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel New package' }));
    expect(mock.api.stop).toHaveBeenCalledWith('new');
    await act(async () => resolveInstall({ ok: false }));
    mock.api.install!.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mock.api.install).toHaveBeenCalledTimes(2));
    expect(mock.api.addApp).toHaveBeenCalledTimes(1);
  });
  it('opens runtime setup when R is missing', async () => {
    mock.api.rStatus!.mockResolvedValue({ found: false });
    render(<App />);
    expect(
      await screen.findByRole('dialog', { name: 'R Runtime' }),
    ).toBeTruthy();
    expect(screen.queryByText('Bootstrap managed R')).toBeNull();
  });
  it('blocks duplicate registration and keeps values after a failure for retry', async () => {
    let reject!: (e: Error) => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    render(
      <RegisterDialog
        initialFamily="url"
        onClose={() => {}}
        onSubmit={submit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Hosted' },
    });
    fireEvent.change(screen.getByLabelText('App URL'), {
      target: { value: 'https://example.org' },
    });
    const add = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Unable to save registry')));
    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to save registry',
    );
    expect(screen.getByLabelText('Display name')).toHaveProperty(
      'value',
      'Hosted',
    );
    expect(screen.queryByText('Frameless launched window')).toBeNull();
  });
  it('saves full drafts on blur or Enter and preserves rejected values', async () => {
    render(<SettingsPanel onClose={() => {}} onSettingsChanged={() => {}} />);
    const width = await screen.findByLabelText('Window width');
    fireEvent.change(width, { target: { value: '1200' } });
    expect(mock.api.setSettings).not.toHaveBeenCalled();
    fireEvent.keyDown(width, { key: 'Enter' });
    await waitFor(() =>
      expect(mock.api.setSettings).toHaveBeenCalledWith({
        defaultWindowWidth: 1200,
      }),
    );
    const mirror = screen.getByLabelText('CRAN mirror');
    mock.api.setSettings!.mockRejectedValueOnce(new Error('HTTPS required'));
    fireEvent.change(mirror, { target: { value: 'broken' } });
    fireEvent.blur(mirror);
    await screen.findByRole('alert');
    expect(mirror).toHaveProperty('value', 'broken');
  });
  it('preserves encoded icon URI characters and shows fallback after load failure', () => {
    const { container } = render(
      <AppTile
        app={{ ...app, iconPath: 'slr-icon://cache/a%23b%3Fc.png' }}
        selected={false}
        status={undefined}
        onSelect={() => {}}
        onLaunch={() => {}}
        onContextMenu={() => {}}
      />,
    );
    const icon = container.querySelector('img')!;
    expect(icon.getAttribute('src')).toBe('slr-icon://cache/a%23b%3Fc.png');
    fireEvent.error(icon);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
  it('caps rendered logs and does not force scroll when inspecting earlier output', () => {
    const logs: DisplayLog[] = Array.from({ length: 500 }, (_, displayId) => ({
      displayId,
      ts: '2026-09-21T12:00:00Z',
      level: 'info',
      scope: 'test',
      message: String(displayId),
    }));
    const { container, rerender } = render(
      <LogConsole
        logs={logs}
        apps={[]}
        onClose={() => {}}
        onClear={() => {}}
      />,
    );
    expect(container.querySelectorAll('.log-line')).toHaveLength(400);
    const body = screen.getByLabelText('Log output');
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      value: 3000,
    });
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    body.scrollTop = 200;
    fireEvent.scroll(body);
    rerender(
      <LogConsole
        logs={[...logs, { ...logs[0]!, displayId: 501 }]}
        apps={[]}
        onClose={() => {}}
        onClear={() => {}}
      />,
    );
    expect(body.scrollTop).toBe(200);
    expect(container.querySelectorAll('.log-line')).toHaveLength(400);
  });
});
