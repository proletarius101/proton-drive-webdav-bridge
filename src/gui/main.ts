import { invoke } from '@tauri-apps/api/tauri'
import { event } from '@tauri-apps/api/event'

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
$('open-files').addEventListener('click', () => invoke('open_in_files'))
$('mount-toggle').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked
  invoke(on ? 'mount_drive' : 'unmount_drive').then(() => refreshStatus())
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

// Log streaming
event.listen('log_line', (e: any) => {
  const area = $('log-area') as HTMLPreElement
  area.textContent += `${e.payload.line}\n`
  area.scrollTop = area.scrollHeight
})

// Periodic refresh
refreshStatus()
setInterval(refreshStatus, 3000)

// Start sidecar on load if not running (optional)
invoke('get_status').then((s: any) => { if (!s || !s.running) invoke('start_sidecar') })

// TODO: Add authentication flow wiring and permission icons handlers
