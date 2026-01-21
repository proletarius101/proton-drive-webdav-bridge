import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'


// Utilities
const $ = (id: string) => document.getElementById(id) as HTMLElement | null
const setBadge = (state: 'active' | 'connecting' | 'stopped', text: string) => {
  const b = $('service-badge')
  if (!b) return
  b.className = 'badge ' + state
  b.textContent = text
}


async function refreshStatus(invokeFn: typeof invoke = invoke, checkTimeoutMs = 1000, statusTimeoutMs = 2000) {
  try {
    // Race get_status with a timeout so the UI doesn't hang indefinitely
    const getStatusPromise = invokeFn('get_status')
    const s: any = await Promise.race([
      getStatusPromise,
      new Promise((r) => setTimeout(() => r('__timeout__'), statusTimeoutMs)),
    ])

    if (s === '__timeout__') {
      // Mark as unavailable and set mount as timed out so the user isn't left at 'Checking mount status...'
      setBadge('stopped', 'Unavailable')
      const live = $('live-status')
      if (live) live.textContent = 'Status unavailable'
      const ms = $('mount-status') as HTMLElement | null
      if (ms) { ms.textContent = 'Mount: timed out'; ms.className = 'mount-status err' }
      return
    }

    const running = s?.server?.running ?? s?.running ?? false
    setBadge(running ? 'active' : 'stopped', running ? 'Active' : (s?.connecting ? 'Connecting' : 'Stopped'))
    const live = $('live-status')
    if (live) live.textContent = s.liveStatusString ? s.liveStatusString : 'Live status: N/A'
    // quota
    const used = s?.storage?.used ?? 0
    const total = s?.storage?.total ?? 0
    const quotaPercent = total > 0 ? Math.round((used / total) * 100) : 0
    const bar = $('quota-bar') as HTMLProgressElement | null
    if (bar) bar.value = quotaPercent
    const qt = $('quota-text')
    if (qt) qt.textContent = total > 0 ? `${formatBytes(used)} / ${formatBytes(total)} (${quotaPercent}%)` : '--'
    // address and network port
    const dav = $('dav-url') as HTMLInputElement | null
    const portInput = ($('network-port') as HTMLInputElement | null)

    // Prefer server.url if available but normalize it to a dav:// host:port form.
    // Fall back to config.webdav.host/port or legacy s.port values.
    const defaultPort = s?.config?.webdav?.port ?? s?.port ?? 12345
    let host = s?.config?.webdav?.host ?? 'localhost'
    let port = defaultPort
    let davUrl = `dav://${host}:${port}`

    if (s?.server?.url) {
      try {
        const parsed = new URL(s.server.url)
        const parsedHost = parsed.hostname
        const parsedPort = parsed.port || String(port)
        host = parsedHost
        port = parsedPort
        davUrl = `dav://${host}${parsedPort ? `:${parsedPort}` : ''}`
      } catch (e) {
        // If parsing fails, fall back to config-derived URL
      }
    }

    if (dav) dav.value = davUrl
    if (portInput) portInput.value = String(port)
    const mountToggle = $('mount-toggle') as HTMLInputElement | null
    if (mountToggle) mountToggle.checked = !!s.mounted

    // Mount status (more explicit than badge)
    try {
      // Race the mount-check with a timeout so the UI doesn't hang forever
      const checkPromise = invokeFn('check_mount_status')
      const res = await Promise.race([
        checkPromise,
        new Promise((r) => setTimeout(() => r('__timeout__'), checkTimeoutMs)),
      ])

      const ms = $('mount-status') as HTMLElement | null
      if (!ms) return

      if (res === '__timeout__') {
        ms.textContent = 'Mount: timed out'
        ms.className = 'mount-status err'
      } else if (res) {
        ms.textContent = `Mounted: ${res}`
        ms.className = 'mount-status ok'
      } else {
        ms.textContent = mountToggle && mountToggle.checked ? 'Pending...' : 'Not mounted'
        ms.className = 'mount-status'
      }
  } catch (err) {
      const ms = $('mount-status') as HTMLElement | null
      if (ms) {
        ms.textContent = 'Mount: error checking status'
        ms.className = 'mount-status err'
      }
      console.debug('check_mount_status error:', err)
    }
  } catch (e) {
    setBadge('stopped', 'Error')
    // Ensure mount status is updated on global failures so the UI doesn't stay at the initial placeholder.
    const ms = $('mount-status')
    if (ms) {
      ms.textContent = 'Mount: error checking status'
      ms.className = 'mount-status err'
    }
  }
}


function formatBytes(n = 0) {
  if (n === 0) return '0 B'
  const units = ['B','KB','MB','GB','TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}


// UI actions moved into an init function for lifecycle safety and testability
export function initGui(opts?: { invoke?: typeof invoke; listen?: typeof listen; checkTimeoutMs?: number; statusTimeoutMs?: number }) {
  const invokeFn = opts?.invoke ?? invoke
  const listenFn = opts?.listen ?? listen

  // Defensive helper for getting elements
  const $safe = (id: string) => document.getElementById(id) as HTMLElement | null

  // Wire UI actions (guard elements and use optional chaining)
  $safe('open-files')?.addEventListener('click', async () => {
    try {
      await invokeFn('open_in_files')
    } catch (err) {
      console.error('open_in_files failed', err)
      setBadge('stopped', 'Error')
    }
  })

  $safe('mount-toggle')?.addEventListener('change', async (e) => {
    const on = (e.target as HTMLInputElement).checked
    const ms = $safe('mount-status') as HTMLElement | null
    try {
      if (on) {
        if (ms) { ms.textContent = 'Mounting...'; ms.className = 'mount-status' }
      } else {
        if (ms) { ms.textContent = 'Unmounting...'; ms.className = 'mount-status' }
      }

      await invokeFn(on ? 'mount_drive' : 'unmount_drive')

      // Success: update explicit message and refresh status
      if (on) {
        if (ms) { ms.textContent = 'Mounted successfully'; ms.className = 'mount-status ok' }
      } else {
        if (ms) { ms.textContent = 'Unmounted'; ms.className = 'mount-status' }
      }
      // Wait a bit for GIO mount to complete before refreshing
      await new Promise(r => setTimeout(r, 1000))
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000)
    } catch (err: any) {
      console.error('mount action failed', err)
      // show actionable error message to the user
      const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Mount action failed')
      if (ms) { ms.textContent = `Mount error: ${errorMsg}`; ms.className = 'mount-status err' }
      // revert toggle to previous state on failure
      (e.target as HTMLInputElement).checked = !on
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000)
    }
  })

  $safe('copy-url')?.addEventListener('click', async () => {
    const dav = ($safe('dav-url') as HTMLInputElement | null)?.value
    if (dav && navigator?.clipboard) await navigator.clipboard.writeText(dav)
  })
  $safe('toggle-log')?.addEventListener('click', () => {
    $safe('log-area')?.classList.toggle('hidden')
  })
  $safe('purge-cache')?.addEventListener('click', () => invokeFn('purge_cache').then(() => refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000)))
  $safe('logout')?.addEventListener('click', () => invokeFn('logout'))
  $safe('apply-port')?.addEventListener('click', () => {
    const p = Number((document.getElementById('network-port') as HTMLInputElement).value)
    invokeFn('set_network_port', { port: p }).then(() => refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000))
  })

  // Log streaming - listen to sidecar logs with payload { level, message }
  try {
    listenFn('sidecar:log', (event: any) => {
      const area = $safe('log-area') as HTMLPreElement | null
      const payload = event.payload || { level: 'info', message: '' }
      // Trim trailing newline to avoid double spacing
      const msg = String(payload.message).replace(/\n$/, '')
      if (!area) return
      area.textContent += `[${payload.level}] ${msg}\n`
      area.scrollTop = area.scrollHeight
    })

    // Mount status updates - the sidecar emits intermediate events like "Checking mount: ..."
    listenFn('mount-status', (event: any) => {
      const ms = $safe('mount-status') as HTMLElement | null
      if (!ms) return
      const payload = event.payload ?? event
      const msg = typeof payload === 'string' ? payload : String(payload)
      ms.textContent = msg
      // Class heuristics: if it's checking, leave plain; if it mentions 'No matching', mark as err
      if (msg.toLowerCase().includes('no matching') || msg.toLowerCase().includes('error')) {
        ms.className = 'mount-status err'
      } else if (msg.toLowerCase().includes('checking')) {
        ms.className = 'mount-status'
      } else {
        // otherwise assume it's a final result like 'Mounted: NAME'
        ms.className = 'mount-status ok'
      }
    })
  } catch (err) {
    // listen may not be available in tests; ignore failures
  }

  // Periodic refresh and initial run
  const interval = setInterval(() => refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000), 3000)
  // Run initial refresh now
  refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000)

  // Start sidecar on load if not running (optional)
  invokeFn('get_status').then(async (s: any) => {
    if (!s || !(s?.server?.running ?? s?.running)) {
      try {
        await invokeFn('start_sidecar')
        // After starting, refresh status immediately so address/port are populated
        await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000)

        // Extra safety: fetch current status and directly populate address/port
        try {
          const fresh: any = await invokeFn('get_status').catch(() => null)
          if (fresh) {
            const host = fresh?.config?.webdav?.host ?? 'localhost'
            const port = fresh?.config?.webdav?.port ?? fresh?.port ?? 12345
            const url = fresh?.server?.url ?? `dav://${host}:${port}`
            const davEl = $safe('dav-url') as HTMLInputElement | null
            const portEl = $safe('network-port') as HTMLInputElement | null
            if (davEl) davEl.value = url
            if (portEl) portEl.value = String(port)
          }
        } catch (e) {
          // Ignore errors from this secondary probe
        }
      } catch (err: any) {
        // Common benign error — don't surface as an unhandled rejection in the UI
        const msg = String(err?.message ?? err ?? '')
        if (msg.toLowerCase().includes('already')) {
          console.debug('start_sidecar: already running')
          // Ensure UI reflects the current status even if sidecar was already running
          await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000)

          try {
            const fresh: any = await invokeFn('get_status').catch(() => null)
            if (fresh) {
              const host = fresh?.config?.webdav?.host ?? 'localhost'
              const port = fresh?.config?.webdav?.port ?? fresh?.port ?? 12345
              const url = fresh?.server?.url ?? `dav://${host}:${port}`
              const davEl = $safe('dav-url') as HTMLInputElement | null
              const portEl = $safe('network-port') as HTMLInputElement | null
              if (davEl) davEl.value = url
              if (portEl) portEl.value = String(port)
            }
          } catch (e) {}
        } else {
          console.error('start_sidecar failed:', err)
        }
      }
    }
  }).catch(() => {})

  // When the sidecar process terminates, refresh status so the UI updates accordingly
  try {
    listenFn('sidecar:terminated', async () => {
      await refreshStatus(invokeFn, opts?.checkTimeoutMs ?? 1000, opts?.statusTimeoutMs ?? 2000)
    })
  } catch (err) {
    // listening may not be available in tests; ignore
  }

  // Return a stop() function to help tests/cleanup
  return {
    stop: () => clearInterval(interval),
  }
}

// Top-level guards for uncaught errors and to kick off init on DOM ready
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e: any) => {
    console.error('Uncaught error in UI', e.error ?? e.message ?? e)
  })
  window.addEventListener('unhandledrejection', (e: any) => {
    console.error('Unhandled promise rejection in UI', e.reason ?? e)
  })

  window.addEventListener('DOMContentLoaded', () => {
    try {
      initGui()
    } catch (err) {
      console.error('Failed to initialize GUI', err)
    }
  })
}

// TODO: Add authentication flow wiring and permission icons handlers
