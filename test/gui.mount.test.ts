import { fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { useMountStatus } from '../src/renderer/hooks/useMountStatus';
import { renderWithElectron, type ElectronTestApi } from './helpers/renderWithElectron';

function TestMount({
  options,
}: {
  options?: { mountRetryDelayMs?: number; mountMaxRetries?: number };
}) {
  const { isMounted, isToggling, toggleMount } = useMountStatus(options);
  return React.createElement(
    'div',
    null,
    React.createElement('span', { 'data-testid': 'mounted' }, isMounted ? 'yes' : 'no'),
    React.createElement('span', { 'data-testid': 'toggling' }, isToggling ? 'yes' : 'no'),
    React.createElement('button', { onClick: () => toggleMount(true) }, 'Mount'),
    React.createElement('button', { onClick: () => toggleMount(false) }, 'Unmount')
  );
}

describe('GUI Mount Logic (useMountStatus)', () => {
  it('verifies actual mount state after mount_drive error', async () => {
    let checkCount = 0;
    const invoke: ElectronTestApi['invoke'] = async (cmd) => {
      if (cmd === 'mount_drive') {
        throw new Error('GIO error: Mount not found');
      }
      if (cmd === 'check_mount_status') {
        checkCount += 1;
        return checkCount >= 2 ? 'dav://localhost:7777' : null;
      }
      return true as any;
    };

    const listen: ElectronTestApi['listen'] = async () => async () => {};

    const { getByText, getByTestId } = renderWithElectron(
      React.createElement(TestMount, { options: { mountRetryDelayMs: 10, mountMaxRetries: 3 } }),
      { invoke, listen }
    );

    await waitFor(() => expect(getByTestId('mounted').textContent).toBe('no'));

    fireEvent.click(getByText('Mount'));

    await waitFor(() => expect(getByTestId('mounted').textContent).toBe('yes'));
    expect(checkCount).toBeGreaterThanOrEqual(2);
  });

  it('unmounts after successful unmount_drive', async () => {
    let mounted = true;
    const invoke: ElectronTestApi['invoke'] = async (cmd) => {
      if (cmd === 'unmount_drive') {
        mounted = false;
        return undefined as any;
      }
      if (cmd === 'check_mount_status') {
        return mounted ? 'dav://localhost:7777' : null;
      }
      return true as any;
    };

    const listen: ElectronTestApi['listen'] = async () => async () => {};

    const { getByText, getByTestId } = renderWithElectron(
      React.createElement(TestMount, { options: { mountRetryDelayMs: 10, mountMaxRetries: 2 } }),
      { invoke, listen }
    );

    await waitFor(() => expect(getByTestId('mounted').textContent).toBe('yes'));

    fireEvent.click(getByText('Unmount'));

    await waitFor(() => expect(getByTestId('mounted').textContent).toBe('no'));
  });
});
