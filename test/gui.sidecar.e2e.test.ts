import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { waitFor } from '@testing-library/react';
import { renderWithElectron, type ElectronTestApi } from './helpers/renderWithElectron';
import { ServiceBadge } from '../src/renderer/components/ServiceBadge';

describe('GUI ServiceBadge (useServiceStatus)', () => {
  it('shows Active when server is running', async () => {
    const invoke: ElectronTestApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { server: { running: true } } as any;
      }
      return true as any;
    };
    const listen: ElectronTestApi['listen'] = async () => async () => {};

    const { getByText } = renderWithElectron(React.createElement(ServiceBadge), { invoke, listen });

    await waitFor(() => expect(getByText('Active')).toBeTruthy());
  });

  it('shows Connecting when status reports connecting', async () => {
    const invoke: ElectronTestApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { connecting: true } as any;
      }
      return true as any;
    };
    const listen: ElectronTestApi['listen'] = async () => async () => {};

    const { getByText } = renderWithElectron(React.createElement(ServiceBadge), { invoke, listen });

    await waitFor(() => expect(getByText('Connecting')).toBeTruthy());
  });

  it('shows Stopped when server is not running', async () => {
    const invoke: ElectronTestApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { server: { running: false } } as any;
      }
      return true as any;
    };
    const listen: ElectronTestApi['listen'] = async () => async () => {};

    const { getByText } = renderWithElectron(React.createElement(ServiceBadge), { invoke, listen });

    await waitFor(() => expect(getByText('Stopped')).toBeTruthy());
  });
});
