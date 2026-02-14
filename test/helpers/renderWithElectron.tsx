import { render } from '@testing-library/react';
import * as React from 'react';
import type { InvokeFn } from '../../src/ipc/types.js';
import { ElectronProvider } from '../../src/renderer/electron/ElectronProvider.js';

export interface ElectronTestApi {
  // Allow strongly-typed invoke while keeping flexibility in tests
  invoke: InvokeFn;
  // Listen receives the response payload type for a given channel
  listen?: <K extends string>(
    event: K,
    handler: (data: unknown) => void
  ) => (() => void) | Promise<() => void> | void;
}

function createWindowElectron(api: ElectronTestApi) {
  // events implementation - delegate to api.listen when available
  const events = {
    on: (event: string, handler: (data: unknown) => void) => {
      if (api.listen) {
        // listen may return an unsubscribe function asynchronously; ignore here
        void api.listen(event, handler);
      }
    },
    off: (_event: string, _handler: (data: unknown) => void) => {
      // no-op for tests; api.listen may return unsub which tests can ignore
    },
    once: (event: string, handler: (data: unknown) => void) => {
      if (api.listen) void api.listen(event, handler);
    },
  };

  // Proxy services to forward method calls to api.invoke as "service:method"
  const servicesProxy = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'events') return events;
        if (prop === 'send') return () => {};
        // return an object whose methods forward to api.invoke
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return (...args: unknown[]) =>
                api.invoke(`${String(prop)}:${String(method)}`, ...args);
            },
          }
        );
      },
    }
  );

  type TestWindowElectron = {
    events: {
      on: (event: string, handler: (data: unknown) => void) => void;
      off: (event: string, handler: (data: unknown) => void) => void;
      once: (event: string, handler: (data: unknown) => void) => void;
    };
    send?: (...args: unknown[]) => void;
    // other service namespaces with arbitrary methods returning Promise<unknown>
    [service: string]: unknown;
  };

  return servicesProxy as unknown as TestWindowElectron;
}

export function renderWithElectron(element: React.ReactElement, api: ElectronTestApi) {
  // attach a minimal window.electron used by ElectronProvider in renderer
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - tests run in JSDOM; assign for runtime only
  window.electron = createWindowElectron(api);

  const result = render(React.createElement(ElectronProvider, null, element));

  const restore = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete window.electron;
    } catch (e) {
      // ignore
    }
  };

  return Object.assign(result, { restore, api });
}

export default renderWithElectron;
