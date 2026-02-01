import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
  disable as autostartDisable,
} from '@tauri-apps/plugin-autostart';
import { isCommandError, getErrorMessage, ErrorMessages } from '../errors/types.js';

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Show error notification to user (currently unused - errors logged to console)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function showError(error: unknown) {
  const message = isCommandError(error)
    ? ErrorMessages[error.code]
    : getErrorMessage(error);
  
  const alertEl = document.getElementById('error-alert');
  if (alertEl) {
    alertEl.textContent = message;
    alertEl.style.display = 'block';
    setTimeout(() => {
      alertEl.style.display = 'none';
    }, 5000);
  } else {
    console.error('Error:', message);
  }
}

/**
 * Handle command invocation with error discrimination
 */
// Note: invokeCommand is kept for reference but not used; code uses invoke() directly
// async function invokeCommand<T>(
//   command: string,
//   args?: Record<string, unknown>
// ): Promise<T | null> {
//   try {
//     return await invoke<T>(command, args);
//   } catch (error) {
//     if (isCommandError(error)) {
//       // Handle specific error codes
//       switch (error.code) {
//         case ErrorCodes.SIDECAR_ALREADY_RUNNING:
//           console.log('Server already running');
//           break;
//         case ErrorCodes.SERVER_NOT_RUNNING:
//           setBadge('stopped', 'Stopped');
//           break;
//         case ErrorCodes.MOUNT_TIMEOUT:
//         case ErrorCodes.SERVER_INIT_TIMEOUT:
//           setBadge('stopped', 'Timeout');
//           break;
//         case ErrorCodes.PORT_IN_USE:
//         case ErrorCodes.INVALID_PORT:
//           console.warn('Port configuration error:', error.message);
//           break;
//         case ErrorCodes.AUTH_FAILED:
//           console.warn('Authentication error:', error.message);
//           break;
//         default:
//           console.error(`[${error.code}] ${error.message}`);
//       }
//     }
//     showError(error);
//     return null;
//   }
// }

// Utilities
const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
const setBadge = (state: 'active' | 'connecting' | 'stopped', text: string) => {
  const b = $('service-badge');
  if (!b) return;
  b.className = 'badge ' + state;
  b.textContent = text;
};

// Switch helpers: support both adw-switch web components and legacy native inputs
function setSwitchState(baseId: string, active: boolean) {
  const adw = document.getElementById(baseId + '-switch') as any;
  const input = document.getElementById(baseId + '-toggle') as HTMLInputElement | null;
  if (adw) {
    try {
      adw.active = !!active;
    } catch (e) {
      adw.setAttribute && adw.setAttribute('active', active ? 'true' : 'false');
    }
  }
  if (input) input.checked = !!active;
}
function getSwitchState(baseId: string) {
  const adw = document.getElementById(baseId + '-switch') as any;
  const input = document.getElementById(baseId + '-toggle') as HTMLInputElement | null;
  if (adw) {
    try {
      return !!adw.active;
    } catch (e) {
      return adw.getAttribute && adw.getAttribute('active') === 'true';
    }
  }
  if (input) return !!input.checked;
  return false;
}
function addSwitchListener(baseId: string, handler: (on: boolean, e?: any) => void) {
  const adw = document.getElementById(baseId + '-switch') as any;
  const input = document.getElementById(baseId + '-toggle') as HTMLInputElement | null;
  if (adw) {
    // adw components emit click and sometimes change events
    adw.addEventListener('click', () => handler(getSwitchState(baseId), { target: adw }));
    adw.addEventListener('change', (e: any) => handler(getSwitchState(baseId), e));
  }
  if (input)
    input.addEventListener('change', (e: any) =>
      handler((e.target as HTMLInputElement).checked, e)
    );
}

// Input helpers: work with adw-input or fallback inputs
function setInputValue(id: string, value: string) {
  const el = document.getElementById(id) as any;
  if (!el) return;
  try {
    // adw-input supports .value
    if ('value' in el) {
      el.value = value;
      return;
    }
    // If it wraps an input, try to set it
    const inner = el.querySelector && el.querySelector('input');
    if (inner) {
      inner.value = value;
      return;
    }
  } catch (e) {}
  // fallback legacy id with -fallback
  const fb = document.getElementById(id + '-fallback') as HTMLInputElement | null;
  if (fb) fb.value = value;
}
function getInputValue(id: string) {
  const el = document.getElementById(id) as any;
  if (!el) return '';
  try {
    if ('value' in el) return String(el.value ?? '');
    const inner = el.querySelector && el.querySelector('input');
    if (inner) return String(inner.value ?? '');
  } catch (e) {}
  const fb = document.getElementById(id + '-fallback') as HTMLInputElement | null;
  return fb ? String(fb.value ?? '') : '';
}
function addInputListener(id: string, handler: (value: string) => void) {
  const el = document.getElementById(id) as any;
  if (!el) return;
  try {
    if (el.addEventListener) el.addEventListener('change', () => handler(getInputValue(id)));
    const inner = el.querySelector && el.querySelector('input');
    if (inner && inner.addEventListener)
      inner.addEventListener('change', () => handler(getInputValue(id)));
  } catch (e) {
    const fb = document.getElementById(id + '-fallback') as HTMLInputElement | null;
    if (fb) fb.addEventListener('change', () => handler(getInputValue(id)));
  }
}
// Local invoke reference for account fetches
let _invokeFn: typeof invoke | undefined;

// Account list rendering & selection
let _selectedAccountId: string | null = null;
export function renderAccounts(accounts: Array<any>) {
  // test hook
  try {
    if ((globalThis as any).__test_hook_calls)
      (globalThis as any).__test_hook_calls.push(`renderAccounts:${accounts.length}`);
  } catch (e) {}

  const list = document.getElementById('account-list');
  if (!list) return;
  list.innerHTML = '';
  accounts.forEach((a: any) => {
    // create a button for the sidebar
    let btn: any;
    try {
      btn = document.createElement('button');
      btn.className = 'nav-sidebar-btn';
      btn.type = 'button';
    } catch (e) {
      btn = {
        addEventListener: (_: string, __: Function) => {},
        setAttribute: (_: string, __: string) => {},
        dataset: {},
        className: '',
      };
    }

    if (btn.setAttribute) btn.setAttribute('role', 'option');
    btn.innerHTML = `<span class="nav-icon" aria-hidden="true">👤</span><div style="display:inline-block;margin-left:8px"><div class="nav-label">${a.email ?? a.name ?? String(a)}</div><div class="nav-subtitle">${a.email ?? ''}</div></div>`;
    btn.dataset['aid'] = a.id ?? a.email ?? String(a);
    btn.addEventListener('click', () => selectAccount(btn.dataset['aid']!, a));
    // keyboard activation (Enter / Space)
    btn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        (btn as HTMLButtonElement).click();
      }
    });

    if (list.appendChild) list.appendChild(btn);
  });
  // pick first if available (force selection so headless tests and early render get details)
  if (accounts.length > 0)
    selectAccount(accounts[0].id ?? accounts[0].email ?? String(accounts[0]), accounts[0]);
}
function selectAccount(id: string, account?: any) {
  // test hook
  try {
    if ((globalThis as any).__test_hook_calls)
      (globalThis as any).__test_hook_calls.push(`selectAccount:${id}`);
  } catch (e) {}

  _selectedAccountId = id;
  const list = document.getElementById('account-list');
  if (!list) return;
  Array.from(list.children).forEach((c: any) => {
    try {
      const btn = c;
      const isSelected = btn && btn.dataset && btn.dataset['aid'] === id;
      if (btn && btn.setAttribute) btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      try {
        if (btn && btn.classList && typeof btn.classList.toggle === 'function')
          btn.classList.toggle('active', isSelected);
        else {
          if (isSelected && btn && !String(btn.className).includes('active'))
            btn.className = (String(btn.className) + ' active').trim();
          if (!isSelected && btn)
            btn.className = String(btn.className)
              .replace(/\bactive\b/g, '')
              .trim();
        }
      } catch (e) {}
    } catch (e) {}
  });
  // Update UI to reflect selected account
  const b = document.getElementById('service-badge');
  if (b && account && account.email) {
    b.className = 'badge active';
    b.textContent = account.email;
  }
  const live = document.getElementById('live-status');
  if (live) live.textContent = account?.status ?? 'Live status: N/A';

  // fetch and render per-account details
  fetchAccountDetails(id);
}

export async function fetchAccountDetails(id: string) {
  // test hook: allow tests to detect fetch attempts
  try {
    if ((globalThis as any).__test_hook_calls)
      (globalThis as any).__test_hook_calls.push(`fetchAccountDetails:${id}`);
  } catch (e) {}

  const invokeF = _invokeFn ?? invoke;
  try {
    const acc: any = await invokeF('get_account', { id }).catch(() => null);
    renderAccountDetails(acc);
  } catch (e) {
    // ignore
    renderAccountDetails(null);
  }
}

function renderAccountDetails(account: any | null) {
  const emailEl = document.getElementById('account-email');
  const statusEl = document.getElementById('account-status-text');
  if (!emailEl || !statusEl) return;
  if (!account) {
    emailEl.textContent = 'No account selected';
    statusEl.textContent = '—';
    setSwitchState('account-mount', false);
    return;
  }
  emailEl.textContent = account.email ?? account.id ?? 'Account';
  statusEl.textContent = account.status ?? 'Live status: N/A';
  setSwitchState('account-mount', !!account.mounted);
}

async function refreshStatus(
  invokeFn: typeof invoke = invoke,
  _checkTimeoutMs = 1000,
  statusTimeoutMs = 2000
) {
  try {
    // Race get_status with a timeout so the UI doesn't hang indefinitely
    const getStatusPromise = invokeFn('get_status');
    const s: any = await Promise.race([
      getStatusPromise,
      new Promise((r) => setTimeout(() => r('__timeout__'), statusTimeoutMs)),
    ]);

    if (s === '__timeout__') {
      // Mark as unavailable so the user isn't left waiting on status
      setBadge('stopped', 'Unavailable');
      const live = $('live-status');
      if (live) live.textContent = 'Status unavailable';
      return;
    }

    const running = s?.server?.running ?? s?.running ?? false;
    setBadge(
      running ? 'active' : 'stopped',
      running ? 'Active' : s?.connecting ? 'Connecting' : 'Stopped'
    );
    const live = $('live-status');
    if (live) live.textContent = s.liveStatusString ? s.liveStatusString : 'Live status: N/A';
    // quota
    const used = s?.storage?.used ?? 0;
    const total = s?.storage?.total ?? 0;
    const quotaPercent = total > 0 ? Math.round((used / total) * 100) : 0;
    const bar = $('quota-bar') as HTMLProgressElement | null;
    if (bar) bar.value = quotaPercent;
    const qt = $('quota-text');
    if (qt)
      qt.textContent =
        total > 0 ? `${formatBytes(used)} / ${formatBytes(total)} (${quotaPercent}%)` : '--';
    // address and network port

    // Prefer server.url if available but normalize it to a dav:// host:port form.
    // Fall back to config.webdav.host/port or legacy s.port values.
    const defaultPort = s?.config?.webdav?.port ?? s?.port ?? 12345;
    let host = s?.config?.webdav?.host ?? 'localhost';
    let port = defaultPort;
    let davUrl = `dav://${host}:${port}`;

    if (s?.server?.url) {
      try {
        const parsed = new URL(s.server.url);
        const parsedHost = parsed.hostname;
        const parsedPort = parsed.port || String(port);
        host = parsedHost;
        port = parsedPort;
        davUrl = `dav://${host}${parsedPort ? `:${parsedPort}` : ''}`;
      } catch (e) {
        // If parsing fails, fall back to config-derived URL
      }
    }

    // set address and port on ADWave inputs or fallbacks
    setInputValue('dav-url', davUrl);
    setInputValue('network-port', String(port));
    
    // Check actual mount status via check_mount_status command
    // (not via s.mounted which doesn't exist in the status response)
    try {
      const mountStatus = await invokeFn('check_mount_status');
      const isMounted = mountStatus !== null;
      setSwitchState('mount', isMounted);
      setSwitchState('account-mount', isMounted);
    } catch (err) {
      // If check_mount_status fails, don't crash the status update
      // Just leave the mount switches in their current state
      console.warn('Failed to check mount status:', err);
    }
  } catch (e) {
    setBadge('stopped', 'Error');
  }
}

function formatBytes(n = 0) {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// UI actions moved into an init function for lifecycle safety and testability
export function initGui(opts?: {
  invoke?: typeof invoke;
  listen?: typeof listen;
  checkTimeoutMs?: number;
  statusTimeoutMs?: number;
}) {
  const invokeFn = opts?.invoke ?? invoke;
  const listenFn = opts?.listen ?? listen;

  // Defensive helper for getting elements
  const $safe = (id: string) => document.getElementById(id) as HTMLElement | null;

  // Wire UI actions (guard elements and use optional chaining)
  $safe('open-files')?.addEventListener('click', async () => {
    try {
      await invokeFn('open_in_files');
    } catch (err) {
      console.error('open_in_files failed', err);
      setBadge('stopped', 'Error');
    }
  });

  addSwitchListener('mount', async (on) => {
    try {
      // Try the mount/unmount operation
      // This may fail temporarily due to GIO timing, but we'll verify the actual state after
      try {
        await invokeFn(on ? 'mount_drive' : 'unmount_drive');
      } catch (err: any) {
        // Log the error but continue - we'll verify the actual mount state
        console.warn(`${on ? 'mount' : 'unmount'} command returned error, verifying actual state:`, err);
      }

      // Wait for GIO mount/unmount to stabilize with retries
      // GIO operations can take time and may need multiple checks
      const maxRetries = 8;
      const retryDelayMs = 1500;
      let mountStatus: string | null = null;
      let lastError: any = null;

      for (let i = 0; i < maxRetries; i++) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        try {
          mountStatus = await invokeFn('check_mount_status');
          const isMounted = mountStatus !== null;
          
          // If mount status matches desired state, we're done
          if (isMounted === on) {
            console.info(`Mount status verified: ${on ? 'mounted' : 'unmounted'}`);
            break;
          }
          // If this is the last retry and status doesn't match, log it
          if (i === maxRetries - 1) {
            lastError = new Error(
              `Mount status mismatch: expected ${on ? 'mounted' : 'unmounted'}, ` +
              `got ${isMounted ? 'mounted' : 'unmounted'}`
            );
          }
        } catch (err) {
          lastError = err;
          console.warn(`Mount status check attempt ${i + 1}/${maxRetries} failed:`, err);
          // Continue retrying
        }
      }

      // Update the switch based on the final mount status
      const finalMountStatus = mountStatus !== null;
      setSwitchState('mount', finalMountStatus);
      setSwitchState('account-mount', finalMountStatus);
      
      // Refresh other status info
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000);
      
      // Log any persistent errors for debugging
      if (lastError) {
        console.warn('Mount operation completed with status:', { 
          requested: on, 
          actual: mountStatus !== null,
          error: lastError.message 
        });
      }
    } catch (err: any) {
      console.error('mount action failed with unexpected error:', err);
      // Try to determine actual mount state before reverting
      try {
        const actualMountStatus = await invokeFn('check_mount_status');
        const isMounted = actualMountStatus !== null;
        setSwitchState('mount', isMounted);
        setSwitchState('account-mount', isMounted);
      } catch (statusErr) {
        // If we can't determine state, revert the switch
        setSwitchState('mount', !on);
        setSwitchState('account-mount', !on);
      }
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000);
    }
  });

  // Autostart toggle wiring - uses @tauri-apps/plugin-autostart
  (async () => {
    const adw = document.getElementById('autostart-switch') as any;
    const input = $safe('autostart-toggle') as HTMLInputElement | null;
    if (!adw && !input) return;

    try {
      // Disable while probing the current state
      if (adw) adw.disabled = true;
      if (input) input.disabled = true;
      const enabled = await autostartIsEnabled();
      setSwitchState('autostart', !!enabled);
      setSwitchState('autostart-side', !!enabled);
    } catch (err) {
      if (typeof console !== 'undefined' && (console.error as any))
        (console.error as any)('autostart isEnabled failed', err);
      // Fallback: plugin may not be available in this environment (tests/SSR).
      // Try to read the persisted preference from the backend and allow persisting
      // the preference even if system autostart is unsupported.
      try {
        const persisted: any = await invokeFn('get_autostart').catch(() => ({ enabled: false }));
        setSwitchState('autostart', !!persisted);
        setSwitchState('autostart-side', !!persisted);
      } catch (e) {
        // If that also fails, keep it disabled and show a tooltip
        if (input) {
          input.title = 'Autostart unsupported in this environment';
          input.disabled = true;
        }
        if (adw) adw.title = 'Autostart unsupported in this environment';
        return;
      }
    } finally {
      if (adw) adw.disabled = false;
      if (input) input.disabled = false;
    }

    // Shared autostart toggle helper used by both main and sidebar switches
    async function doAutostartToggle(on: boolean) {
      const mainAdw = document.getElementById('autostart-switch') as any;
      const mainInput = $safe('autostart-toggle') as HTMLInputElement | null;
      const sideAdw = document.getElementById('autostart-switch-side') as any;
      const sideInput = $safe('autostart-toggle-side') as HTMLInputElement | null;

      if (mainAdw) mainAdw.disabled = true;
      if (mainInput) mainInput.disabled = true;
      if (sideAdw) sideAdw.disabled = true;
      if (sideInput) sideInput.disabled = true;

      try {
        if (on) await autostartEnable();
        else await autostartDisable();

        // Persist preference in config via Rust command
        try {
          await invokeFn('set_autostart', { enabled: on });
          // Keep both switches in sync
          setSwitchState('autostart', !!on);
          setSwitchState('autostart-side', !!on);
        } catch (err) {
          if (typeof console !== 'undefined' && (console.error as any))
            (console.error as any)('set_autostart failed', err);
          // If persisting fails, revert toggles to previous state to avoid divergence
          setSwitchState('autostart', !on);
          setSwitchState('autostart-side', !on);
        }
      } catch (err) {
        if (typeof console !== 'undefined' && (console.error as any))
          (console.error as any)('autostart toggle failed', err);
        // revert toggle on failure
        setSwitchState('autostart', !on);
        setSwitchState('autostart-side', !on);
      } finally {
        if (mainAdw) mainAdw.disabled = false;
        if (mainInput) mainInput.disabled = false;
        if (sideAdw) sideAdw.disabled = false;
        if (sideInput) sideInput.disabled = false;
      }
    }

    // Wire both the main control and the sidebar mirror to the shared handler
    addSwitchListener('autostart', (on: boolean) => {
      void doAutostartToggle(on);
    });
    addSwitchListener('autostart-side', (on: boolean) => {
      void doAutostartToggle(on);
    });
  })();

  $safe('copy-url')?.addEventListener('click', async () => {
    const dav = getInputValue('dav-url');
    if (dav && navigator?.clipboard) await navigator.clipboard.writeText(dav);
  });

  // per-account actions
  $safe('configure-account')?.addEventListener('click', async () => {
    if (!_selectedAccountId) return;
    try {
      await _invokeFn?.('configure_account', { id: _selectedAccountId });
    } catch (e) {
      console.error('configure failed', e);
    }
  });
  $safe('signout-account')?.addEventListener('click', async () => {
    if (!_selectedAccountId) return;
    try {
      await _invokeFn?.('signout_account', { id: _selectedAccountId });
    } catch (e) {
      console.error('signout failed', e);
    }
  });

  // Per-account mount switch proxies global mount/unmount commands. Backend currently
  // exposes only global mount/unmount, so we proxy those and keep UI consistent.
  addSwitchListener('account-mount', async (on) => {
    const statusEl = $safe('account-status-text');
    if (!_selectedAccountId) {
      // No account selected – revert and inform
      setSwitchState('account-mount', !on);
      if (statusEl) statusEl.textContent = 'No account selected';
      return;
    }

    try {
      if (on) {
        if (statusEl) {
          statusEl.textContent = 'Mounting...';
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'Unmounting...';
        }
      }

      await invokeFn(on ? 'mount_drive' : 'unmount_drive');

      if (on) {
        if (statusEl) statusEl.textContent = 'Mounted successfully';
      } else {
        if (statusEl) statusEl.textContent = 'Unmounted';
      }

      // Refresh global status so both switches reflect the true state
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000);
    } catch (err: any) {
      console.error('account mount failed', err);
      setSwitchState('account-mount', !on);
      if (statusEl) statusEl.textContent = `Mount error: ${err?.message ?? String(err)}`;
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000);
    }
  });

  $safe('toggle-log')?.addEventListener('click', () => {
    $safe('log-area')?.classList.toggle('hidden');
  });

  // Disable apply until user changes the network-port field (improves UX; listener wired via addInputListener)
  const _applyBtn = $safe('apply-port');
  if (_applyBtn) {
    if (typeof (_applyBtn as any).setAttribute === 'function')
      (_applyBtn as any).setAttribute('disabled', 'true');
    else if ('disabled' in _applyBtn) (_applyBtn as any).disabled = true;
  }
  addInputListener('network-port', () => {
    const btn = $safe('apply-port');
    if (!btn) return;
    if (typeof (btn as any).removeAttribute === 'function')
      (btn as any).removeAttribute('disabled');
    else if ('disabled' in btn) (btn as any).disabled = false;
  });
  $safe('purge-cache')?.addEventListener('click', () =>
    invokeFn('purge_cache').then(() => refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000))
  );
  $safe('logout')?.addEventListener('click', () => invokeFn('logout'));
  $safe('apply-port')?.addEventListener('click', () => {
    const p = Number(getInputValue('network-port'));
    invokeFn('set_network_port', { port: p }).then(() =>
      refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000)
    );
  });

  // Log streaming - listen to sidecar logs with payload { level, message }
  try {
    listenFn('sidecar:log', (event: any) => {
      const area = $safe('log-area') as HTMLPreElement | null;
      const payload = event.payload || { level: 'info', message: '' };
      // Trim trailing newline to avoid double spacing
      const msg = String(payload.message).replace(/\n$/, '');
      if (!area) return;
      area.textContent += `[${payload.level}] ${msg}\n`;
      area.scrollTop = area.scrollHeight;
    });

    // Mount status events are ignored by the UI (explicit mount:status element removed).

    // Accounts change updates
    listenFn('accounts:changed', (event: any) => {
      const payload = event.payload ?? event;
      if (Array.isArray(payload)) renderAccounts(payload);
    });

    // Account updated event (update details if currently selected)
    listenFn('account:updated', (event: any) => {
      const payload = event.payload ?? event;
      if (!payload || !payload.id) return;
      if (payload.id === _selectedAccountId) renderAccountDetails(payload);
    });

    // Global autostart status - update sidebar control only
    listenFn('global:autostart', (event: any) => {
      const val = event.payload ?? event ?? false;
      setSwitchState('autostart-side', !!val);
    });

    // Mount status events from the sidecar — display briefly and log
    listenFn('mount:status', (event: any) => {
      const payload = event.payload ?? event ?? '';
      try {
        const msg = String(payload);
        const live = $('live-status');
        if (live) live.textContent = msg;
        const area = $('log-area') as HTMLPreElement | null;
        if (area) {
          area.textContent += `[mount] ${msg}\n`;
          area.scrollTop = area.scrollHeight;
        }
      } catch (e) {
        // ignore
      }
    });
  } catch (err) {
    // listen may not be available in tests; ignore failures
  }

  // Periodic refresh and initial run
  const interval = setInterval(
    () => refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000),
    3000
  );
  // Run initial refresh now
  refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000);

  // expose invokeFn for account helpers
  _invokeFn = invokeFn;

  // NOTE: renderAccounts() is no longer called here since React now owns the account list.
  // The account list will be populated by React event listeners from the 'accounts:changed' event
  // that fires when the Rust backend sends account updates via Tauri events.
  // (async () => {
  //   try {
  //     const accounts = await invokeFn('list_accounts').catch(() => null);
  //     if (accounts && Array.isArray(accounts)) {
  //       renderAccounts(accounts);
  //       // ensure details are fetched early
  //       try {
  //         if (accounts.length > 0)
  //           fetchAccountDetails(accounts[0].id ?? accounts[0].email ?? String(accounts[0]));
  //       } catch (e) {}
  //     }
  //   } catch (e) {}
  // })();

  // Start sidecar on load if not running (optional)
  invokeFn('get_status')
    .then(async (s: any) => {
      if (!s || !(s?.server?.running ?? s?.running)) {
        try {
          await invokeFn('start_sidecar');
          // After starting, refresh status immediately so address/port are populated
          await refreshStatus(
            invokeFn,
            opts?.checkTimeoutMs ?? 1000,
            opts?.statusTimeoutMs ?? 2000
          );

          // Extra safety: fetch current status and directly populate address/port
          try {
            const fresh: any = await invokeFn('get_status').catch(() => null);
            if (fresh) {
              const host = fresh?.config?.webdav?.host ?? 'localhost';
              const port = fresh?.config?.webdav?.port ?? fresh?.port ?? 12345;
              const url = fresh?.server?.url ?? `dav://${host}:${port}`;
              setInputValue('dav-url', url);
              setInputValue('network-port', String(port));
            }
          } catch (e) {
            // Ignore errors from this secondary probe
          }
        } catch (err: any) {
          // Common benign error — don't surface as an unhandled rejection in the UI
          const msg = String(err?.message ?? err ?? '');
          if (msg.toLowerCase().includes('already')) {
            console.debug('start_sidecar: already running');
            // Ensure UI reflects the current status even if sidecar was already running
            await refreshStatus(
              invokeFn,
              opts?.checkTimeoutMs ?? 1000,
              opts?.statusTimeoutMs ?? 2000
            );

            try {
              const fresh: any = await invokeFn('get_status').catch(() => null);
              if (fresh) {
                const host = fresh?.config?.webdav?.host ?? 'localhost';
                const port = fresh?.config?.webdav?.port ?? fresh?.port ?? 12345;
                const url = fresh?.server?.url ?? `dav://${host}:${port}`;
                setInputValue('dav-url', url);
                setInputValue('network-port', String(port));
              }
            } catch (e) {}
          } else {
            console.error('start_sidecar failed:', err);
          }
        }
      }
    })
    .catch(() => {});

  // When the sidecar process terminates, refresh status so the UI updates accordingly
  try {
    listenFn('sidecar:terminated', async () => {
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000);
    });
  } catch (err) {
    // listening may not be available in tests; ignore
  }

  // Return a stop() function to help tests/cleanup
  return {
    stop: () => clearInterval(interval),
  };
}

// Apply system color scheme to ADWave theme and set up change listener
function applySystemTheme() {
  try {
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const body = document && document.body;
    if (body) {
      body.classList.toggle('dark-theme', !!prefersDark);
      body.classList.toggle('light-theme', !prefersDark);
    }

    // react to changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e: any) => {
        const b = document && document.body;
        if (!b) return;
        b.classList.toggle('dark-theme', !!e.matches);
        b.classList.toggle('light-theme', !e.matches);
      });
    }
  } catch (e) {
    // ignore in non-DOM/test environments
  }
}

// Top-level guards for uncaught errors and to kick off init on DOM ready
if (typeof window !== 'undefined') {
  // set theme early
  applySystemTheme();

  window.addEventListener('error', (e: any) => {
    console.error('Uncaught error in UI', e.error ?? e.message ?? e);
  });
  window.addEventListener('unhandledrejection', (e: any) => {
    console.error('Unhandled promise rejection in UI', e.reason ?? e);
  });

  // Note: initGui() is called from main.tsx after React components mount
  // to ensure DOM elements are available for event listener attachment
}

// TODO: Add authentication flow wiring and permission icons handlers
