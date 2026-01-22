import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
  disable as autostartDisable,
} from '@tauri-apps/plugin-autostart';

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
    setInputValue('account-dav-url', '');
    setInputValue('account-network-port', '');
    setSwitchState('account-mount', false);
    return;
  }
  emailEl.textContent = account.email ?? account.id ?? 'Account';
  statusEl.textContent = account.status ?? 'Live status: N/A';
  setInputValue('account-dav-url', account.address ?? account.url ?? '');
  setInputValue('account-network-port', String(account.port ?? ''));
  setSwitchState('account-mount', !!account.mounted);
}

async function refreshStatus(
  invokeFn: typeof invoke = invoke,
  checkTimeoutMs = 1000,
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
      // Mark as unavailable and set mount as timed out so the user isn't left at 'Checking mount status...'
      setBadge('stopped', 'Unavailable');
      const live = $('live-status');
      if (live) live.textContent = 'Status unavailable';
      const ms = $('mount-status') as HTMLElement | null;
      if (ms) {
        ms.textContent = 'Mount: timed out';
        ms.className = 'mount-status err';
      }
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
    // prefer ADWave switch, fall back to legacy input
    setSwitchState('mount', !!s.mounted);

    // Mount status (more explicit than badge)
    try {
      // Race the mount-check with a timeout so the UI doesn't hang forever
      const checkPromise = invokeFn('check_mount_status');
      const res = await Promise.race([
        checkPromise,
        new Promise((r) => setTimeout(() => r('__timeout__'), checkTimeoutMs)),
      ]);

      const ms = $('mount-status') as HTMLElement | null;
      if (!ms) return;

      if (res === '__timeout__') {
        ms.textContent = 'Mount: timed out';
        ms.className = 'mount-status err';
      } else if (res) {
        ms.textContent = `Mounted: ${res}`;
        ms.className = 'mount-status ok';
      } else {
        const cur = getSwitchState('mount');
        ms.textContent = cur ? 'Pending...' : 'Not mounted';
        ms.className = 'mount-status';
      }
    } catch (err) {
      const ms = $('mount-status') as HTMLElement | null;
      if (ms) {
        ms.textContent = 'Mount: error checking status';
        ms.className = 'mount-status err';
      }
      console.debug('check_mount_status error:', err);
    }
  } catch (e) {
    setBadge('stopped', 'Error');
    // Ensure mount status is updated on global failures so the UI doesn't stay at the initial placeholder.
    const ms = $('mount-status');
    if (ms) {
      ms.textContent = 'Mount: error checking status';
      ms.className = 'mount-status err';
    }
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
    const ms = $safe('mount-status') as HTMLElement | null;
    try {
      if (on) {
        if (ms) {
          ms.textContent = 'Mounting...';
          ms.className = 'mount-status';
        }
      } else {
        if (ms) {
          ms.textContent = 'Unmounting...';
          ms.className = 'mount-status';
        }
      }

      await invokeFn(on ? 'mount_drive' : 'unmount_drive');

      // Success: update explicit message and refresh status
      if (on) {
        if (ms) {
          ms.textContent = 'Mounted successfully';
          ms.className = 'mount-status ok';
        }
      } else {
        if (ms) {
          ms.textContent = 'Unmounted';
          ms.className = 'mount-status';
        }
      }
      // Wait a bit for GIO mount to complete before refreshing
      await new Promise((r) => setTimeout(r, 1000));
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000);
    } catch (err: any) {
      console.error('mount action failed', err);
      // show actionable error message to the user
      const errorMsg =
        typeof err === 'string' ? err : err?.message || String(err) || 'Mount action failed';
      if (ms) {
        ms.textContent = `Mount error: ${errorMsg}`;
        ms.className = 'mount-status err';
      }
      // revert toggle to previous state on failure
      setSwitchState('mount', !on);
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
    } catch (err) {
      if (typeof console !== 'undefined' && (console.error as any))
        (console.error as any)('autostart isEnabled failed', err);
      // Fallback: plugin may not be available in this environment (tests/SSR).
      // Try to read the persisted preference from the backend and allow persisting
      // the preference even if system autostart is unsupported.
      try {
        const persisted: any = await invokeFn('get_autostart').catch(() => ({ enabled: false }));
        setSwitchState('autostart', !!persisted);
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

    addSwitchListener('autostart', async (on) => {
      if (adw) adw.disabled = true;
      if (input) input.disabled = true;
      try {
        if (on) await autostartEnable();
        else await autostartDisable();

        // Persist preference in config via Rust command
        try {
          await invokeFn('set_autostart', { enabled: on });
        } catch (err) {
          if (typeof console !== 'undefined' && (console.error as any))
            (console.error as any)('set_autostart failed', err);
          // If persisting fails, revert toggle to previous state to avoid divergence
          setSwitchState('autostart', !on);
        }
      } catch (err) {
        if (typeof console !== 'undefined' && (console.error as any))
          (console.error as any)('autostart toggle failed', err);
        // revert toggle on failure
        setSwitchState('autostart', !on);
      } finally {
        if (adw) adw.disabled = false;
        if (input) input.disabled = false;
      }
    });
  })();

  $safe('copy-url')?.addEventListener('click', async () => {
    const dav = getInputValue('dav-url');
    if (dav && navigator?.clipboard) await navigator.clipboard.writeText(dav);
  });

  // per-account actions
  $safe('account-copy-url')?.addEventListener('click', async () => {
    const dav = getInputValue('account-dav-url');
    if (dav && navigator?.clipboard) await navigator.clipboard.writeText(dav);
  });
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

    // Mount status updates - the sidecar emits intermediate events like "Checking mount: ..."
    listenFn('mount-status', (event: any) => {
      const ms = $safe('mount-status') as HTMLElement | null;
      if (!ms) return;
      const payload = event.payload ?? event;
      const msg = typeof payload === 'string' ? payload : String(payload);
      ms.textContent = msg;
      // Class heuristics: if it's checking, leave plain; if it mentions 'No matching', mark as err
      if (msg.toLowerCase().includes('no matching') || msg.toLowerCase().includes('error')) {
        ms.className = 'mount-status err';
      } else if (msg.toLowerCase().includes('checking')) {
        ms.className = 'mount-status';
      } else {
        // otherwise assume it's a final result like 'Mounted: NAME'
        ms.className = 'mount-status ok';
      }
    });

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

    // Global switch in sidebar (mirror autostart)
    listenFn('global:autostart', (event: any) => {
      const val = event.payload ?? event ?? false;
      setSwitchState('autostart', !!val);
      setSwitchState('autostart-side', !!val);
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

  // Try to populate accounts list early (do this immediately so selection is available quickly)
  (async () => {
    try {
      const accounts = await invokeFn('list_accounts').catch(() => null);
      if (accounts && Array.isArray(accounts)) {
        renderAccounts(accounts);
        // ensure details are fetched early
        try {
          if (accounts.length > 0)
            fetchAccountDetails(accounts[0].id ?? accounts[0].email ?? String(accounts[0]));
        } catch (e) {}
      }
    } catch (e) {}
  })();

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

  window.addEventListener('DOMContentLoaded', async () => {
    // Load ADWave assets only in a real browser runtime to avoid test/runtime errors
    try {
      // @ts-ignore - dynamic CSS import for bundler
      await import('adwavecss/dist/styles.css');
    } catch (e) {
      // ignore in test / SSR environments
      console.debug('adwavecss load skipped or failed', e);
    }
    try {
      // @ts-ignore - dynamic import web components
      await import('adwaveui');
    } catch (e) {
      console.debug('adwaveui load skipped or failed', e);
    }

    try {
      initGui();
    } catch (err) {
      console.error('Failed to initialize GUI', err);
    }
  });
}

// TODO: Add authentication flow wiring and permission icons handlers
