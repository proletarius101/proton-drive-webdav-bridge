import { describe, it, expect } from 'bun:test';
import * as React from 'react';
import { act } from 'react';
import { App } from '../../src/gui/App';
import { renderWithTauri } from '../helpers/renderWithTauri';
import type { TauriApi } from '../../src/gui/tauri/TauriProvider';

describe('Debug: Account Selection Flow', () => {
  it('traces the full flow from list_accounts to AccountDetails', async () => {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} };

    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      console.log(`[DEBUG] ${msg}`);
    };

    const mockInvoke = (async (cmd: string, args?: Record<string, unknown>) => {
      log(`invoke: ${cmd} ${args ? JSON.stringify(args) : ''}`);

      if (cmd === 'get_status') {
        const result = {
          server: { running: true, pid: 1234, url: 'http://127.0.0.1:8080' },
          auth: { loggedIn: true, username: 'user@proton.me' },
          config: {
            webdav: { host: '127.0.0.1', port: 8080, https: false, requireAuth: false },
            remotePath: '/',
          },
          logFile: '/tmp/test.log',
        };
        log(`get_status returning: ${JSON.stringify(result.auth)}`);
        return result;
      }

      if (cmd === 'list_accounts') {
        const result = [{ id: 'user@proton.me', email: 'user@proton.me', status: 'active' }];
        log(`list_accounts returning: ${JSON.stringify(result)}`);
        return result;
      }

      if (cmd === 'get_account') {
        const id = (args as any)?.id;
        log(`get_account checking id: "${id}"`);
        if (id === 'user@proton.me') {
          const result = { id: 'user@proton.me', email: 'user@proton.me', status: 'active' };
          log(`get_account returning: ${JSON.stringify(result)}`);
          return result;
        }
        log('get_account returning: null (no match)');
        return null;
      }

      if (cmd === 'get_autostart') {
        return false;
      }

      return true;
    }) as TauriApi['invoke'];

    const mockListen: TauriApi['listen'] = async (event: string, _handler: any) => {
      log(`listen registered: ${event}`);
      return async () => {};
    };

    const container = document.getElementById('root')!;
    renderWithTauri(container, React.createElement(App, null), { invoke: mockInvoke, listen: mockListen });

    log('Rendered App component');

    // Helper to wait for condition with timeout
    const waitFor = async (
      condition: () => boolean,
      options: { timeout?: number; interval?: number } = {}
    ): Promise<void> => {
      const { timeout = 2000, interval = 50 } = options;
      const startTime = Date.now();
      
      while (!condition()) {
        if (Date.now() - startTime > timeout) {
          throw new Error('Timeout waiting for condition');
        }
        await act(async () => {
          await new Promise((r) => setTimeout(r, interval));
        });
      }
    };

    // Wait for account title to be populated (not fallback values)
    await waitFor(
      () => {
        const header = document.querySelector('#app-header');
        const title = header?.querySelector('.title');
        const text = title?.textContent || '';
        log(`Checking title: "${text}"`);
        return text === 'user@proton.me';
      },
      { timeout: 3000 }
    );

    log('\n=== Final State ===');
    log(`All logs:\n${logs.join('\n')}`);
    
    const header = document.querySelector('#app-header');
    const titleEl = header?.querySelector('.title');
    const subtitleEl = header?.querySelector('.subtitle');
    log(`account-title: "${titleEl?.textContent}"`);
    log(`account-status: "${subtitleEl?.textContent}"`);

    expect(titleEl?.textContent).toBe('user@proton.me');
    expect(subtitleEl?.textContent).toBe('active');
  });
});
