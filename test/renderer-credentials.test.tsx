// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  api: {
    credStatus: vi.fn(),
    credRemove: vi.fn(),
    credSet: vi.fn(),
    credTest: vi.fn(),
  },
}));
vi.mock('../src/renderer/lib/api', () => mock);
import { CredentialsPanel } from '../src/renderer/components/CredentialsPanel';
beforeEach(() => {
  Object.values(mock.api).forEach((fn) => fn.mockReset());
  mock.api.credStatus.mockRejectedValue(
    new Error(
      'Saved token cannot be decrypted. Unlock secure storage or remove it.',
    ),
  );
  mock.api.credRemove.mockResolvedValue({
    present: false,
    backend: 'safeStorage',
  });
});
afterEach(cleanup);
it('shows unknown status and permits removing an unreadable token', async () => {
  render(<CredentialsPanel onClose={() => {}} />);
  await screen.findByRole('alert');
  expect(
    screen.getByText('unknown — unable to read stored token'),
  ).toBeTruthy();
  expect(screen.queryByText('none')).toBeNull();
  const remove = screen.getByRole('button', { name: 'Remove' });
  expect(remove).toHaveProperty('disabled', false);
  fireEvent.click(remove);
  await waitFor(() => expect(mock.api.credRemove).toHaveBeenCalledOnce());
  await screen.findByText('none');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(remove).toHaveProperty('disabled', true);
});
it('keeps removal available after a failed recovery and allows retrying status', async () => {
  mock.api.credRemove.mockRejectedValueOnce(
    new Error('Credential store is locked.'),
  );
  render(<CredentialsPanel onClose={() => {}} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('store is locked'),
  );
  expect(screen.getByRole('button', { name: 'Remove' })).toHaveProperty(
    'disabled',
    false,
  );
  mock.api.credStatus.mockResolvedValueOnce({
    present: true,
    last4: 'abcd',
    backend: 'safeStorage',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
  await screen.findByText('•••• •••• abcd');
  expect(screen.queryByRole('alert')).toBeNull();
});
