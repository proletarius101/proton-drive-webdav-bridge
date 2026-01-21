import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'


// Utilities
const $ = (id: string) => document.getElementById(id) as HTMLElement
const setBadge = (state: 'active' | 'connecting' | 'stopped', text: string) => {
  const b = $('service-badge')
  b.className = 'badge ' + state
  b.textContent = text
}


async function refreshStatus() {
  try {
    const s: any = await invoke('get_status')
    setBadge(s.running ? 'active' : 'stopped', s.running ? 'Active' : (s.connecting ? 'Connecting' : 'Stopped'))
    const live = $('live-status')
    live.textContent = s.liveStatusString ? s.liveStatusString : 'Live status: N/A'
    // quota
    const quotaPercent = s.storage && s.storage.total > 0 ? Math.round((s.storage.used / s.storage.total) * 100) : 0
    const bar = $('quota-bar') as HTMLProgressElement
    bar.value = quotaPercent
    $('quota-text').textContent = `${formatBytes(s.storage.used)} / ${formatBytes(s.storage.total)} (${quotaPercent}%)`
    // address
    const dav = $('dav-url') as HTMLInputElement
    dav.value = `dav://localhost:${s.port || 12345}`
    const mountToggle = $('mount-toggle') as HTMLInputElement
    mountToggle.checked = !!s.mounted

    // Mount status (more explicit than badge)
    try {
      const m: any = await invoke('check_mount_status')
      const ms = $('mount-status')
      if (m) {
        ms.textContent = `Mounted: ${m}`
        ms.className = 'mount-status ok'
      } else {
        ms.textContent = mountToggle.checked ? 'Pending...' : 'Not mounted'
        ms.className = 'mount-status'
      }
  } catch (err) {
      const ms = $('mount-status') as HTMLElement
      ms.textContent = 'Mount: error checking status'
      ms.className = 'mount-status err'
      console.debug('check_mount_status error:', err)
    }
  } catch (e) {
    setBadge('stopped', 'Error')
  }
}


function formatBytes(n = 0) {
  if (n === 0) return '0 B'
  const units = ['B','KB','MB','GB','TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}


// UI actions
$('open-files').addEventListener('click', async () => {
  try {
    await invoke('open_in_files')
  } catch (err) {
    console.error('open_in_files failed', err)
    setBadge('stopped', 'Error')
  }
})
$('mount-toggle').addEventListener('change', async (e) => {
  const on = (e.target as HTMLInputElement).checked
  const ms = $('mount-status') as HTMLElement
  try {
    if (on) {
      ms.textContent = 'Mounting...'
      ms.className = 'mount-status'
    } else {
      ms.textContent = 'Unmounting...'
      ms.className = 'mount-status'
    }
    
    await invoke(on ? 'mount_drive' : 'unmount_drive')
    
    // Success: update explicit message and refresh status
    if (on) {
      ms.textContent = 'Mounted successfully'
      ms.className = 'mount-status ok'
    } else {
      ms.textContent = 'Unmounted'
      ms.className = 'mount-status'
    }
    // Wait a bit for GIO mount to complete before refreshing
    await new Promise(r => setTimeout(r, 1000))
    await refreshStatus()
  } catch (err: any) {
    console.error('mount action failed', err)
    // show actionable error message to the user
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Mount action failed')
    ms.textContent = `Mount error: ${errorMsg}`
    ms.className = 'mount-status err'
    // revert toggle to previous state on failure
    (e.target as HTMLInputElement).checked = !on
    await refreshStatus()
  }
})
$('copy-url').addEventListener('click', async () => {
  const dav = ($('dav-url') as HTMLInputElement).value
  await navigator.clipboard.writeText(dav)
})
$('toggle-log').addEventListener('click', () => {
  const a = $('log-area')
  a.classList.toggle('hidden')
})
$('purge-cache').addEventListener('click', () => invoke('purge_cache').then(() => refreshStatus()))
$('logout').addEventListener('click', () => invoke('logout'))
$('apply-port').addEventListener('click', () => {
  const p = Number((document.getElementById('network-port') as HTMLInputElement).value)
  invoke('set_network_port', { port: p }).then(() => refreshStatus())
})


// Log streaming - listen to sidecar logs with payload { level, message }
listen<{ level: string; message: string }>('sidecar:log', (event) => {
  const area = $('log-area') as HTMLPreElement
  const payload = event.payload || { level: 'info', message: '' }
  // Trim trailing newline to avoid double spacing
  const msg = String(payload.message).replace(/\n$/, '')
  area.textContent += `[${payload.level}] ${msg}\n`
  area.scrollTop = area.scrollHeight
})


// Periodic refresh
refreshStatus()
setInterval(refreshStatus, 3000)


// Start sidecar on load if not running (optional)
invoke('get_status').then((s: any) => { if (!s || !s.running) invoke('start_sidecar') })


// TODO: Add authentication flow wiring and permission icons handlers
