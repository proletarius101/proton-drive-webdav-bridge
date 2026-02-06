import { describe, it, expect } from 'bun:test';
import * as React from 'react';
import { render, waitFor } from '@testing-library/react';
import { TauriProvider, type TauriApi } from '../src/gui/tauri/TauriProvider';
import { ServiceBadge } from '../src/gui/components/ServiceBadge';

describe('GUI ServiceBadge (useServiceStatus)', () => {
  it('shows Active when server is running', async () => {
    const invoke: TauriApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { server: { running: true } } as any;
      }
      return true as any;
    };
    const listen: TauriApi['listen'] = async () => async () => {};

    const { getByText } = render(
      React.createElement(TauriProvider, { invoke, listen }, React.createElement(ServiceBadge))
    );

    await waitFor(() => expect(getByText('Active')).toBeTruthy());
  });

  it('shows Connecting when status reports connecting', async () => {
    const invoke: TauriApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { connecting: true } as any;
      }
      return true as any;
    };
    const listen: TauriApi['listen'] = async () => async () => {};

    const { getByText } = render(
      React.createElement(TauriProvider, { invoke, listen }, React.createElement(ServiceBadge))
    );

    await waitFor(() => expect(getByText('Connecting')).toBeTruthy());
  });

  it('shows Stopped when server is not running', async () => {
    const invoke: TauriApi['invoke'] = async (cmd) => {
      if (cmd === 'get_status') {
        return { server: { running: false } } as any;
      }
      return true as any;
    };
    const listen: TauriApi['listen'] = async () => async () => {};

    const { getByText } = render(
      React.createElement(TauriProvider, { invoke, listen }, React.createElement(ServiceBadge))
    );

    await waitFor(() => expect(getByText('Stopped')).toBeTruthy());
  });
});
