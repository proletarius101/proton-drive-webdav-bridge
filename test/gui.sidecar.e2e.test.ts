import { describe, it, expect } from 'bun:test'
import { initGui } from '../src/gui/main.ts'
import { runSidecarCommand } from './fixtures/sidecar-stub'

function makeEl() {
  return {
    textContent: '',
    className: '',
    value: '',
    checked: false,
    addEventListener: (_: string, __: Function) => {},
    classList: { toggle: (_: string) => {} },
    scrollTop: 0,
    scrollHeight: 0,
  }
}

describe('GUI E2E with sidecar stub', () => {
  it('shows Unavailable if sidecar status command hangs', async () => {
    // Create DOM elements via happy-dom
    const ids = ['service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port']
    document.body.innerHTML = ''
    ids.forEach((id) => {
      let el: HTMLElement
      if (id === 'quota-bar') el = document.createElement('progress')
      else if (id === 'dav-url' || id === 'network-port') el = document.createElement('input')
      else if (id === 'log-area') el = document.createElement('pre')
      else el = document.createElement('div')
      el.id = id
      document.body.appendChild(el)
    })

    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} }

    // Implement an invoke function that shells out to the sidecar stub
    const invoke = async (cmd: string) => {
      if (cmd === 'get_status') {
        // Simulate a hanging sidecar command by delaying beyond statusTimeoutMs
        const { stdout } = await runSidecarCommand(['status', '--json'], { delayMs: 500 })
        // Find JSON in stdout
        const idx = stdout.indexOf('{')
        if (idx === -1) return {}
        const json = JSON.parse(stdout.slice(idx))
        return json
      }
      if (cmd === 'check_mount_status') {
        const { stdout } = await runSidecarCommand(['check_mount_status'], { delayMs: 0 })
        return stdout ? stdout : null
      }
      return null
    }

    const { stop } = initGui({ invoke: invoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // wait for status timeout to happen
    await new Promise((r) => setTimeout(r, 100))

    const badge = document.getElementById('service-badge') as HTMLElement
    expect(badge.textContent).toBe('Unavailable')

    stop()
  })

  it('uses real sidecar output to show mounted state', async () => {
    // Create DOM elements via happy-dom
    const ids = ['service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port']
    document.body.innerHTML = ''
    ids.forEach((id) => {
      let el: HTMLElement
      if (id === 'quota-bar') el = document.createElement('progress')
      else if (id === 'dav-url' || id === 'network-port') el = document.createElement('input')
      else if (id === 'log-area') el = document.createElement('pre')
      else el = document.createElement('div')
      el.id = id
      document.body.appendChild(el)
    })

    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} }

    const calls: string[] = []
    const invoke = async (cmd: string) => {
      calls.push(cmd)
      if (cmd === 'get_status') {
        const { stdout } = await runSidecarCommand(['status', '--json'], { delayMs: 0 })
        const idx = stdout.indexOf('{')
        if (idx === -1) return {}
        const json = JSON.parse(stdout.slice(idx))
        return json
      }
      if (cmd === 'check_mount_status') {
        // Simulate an active mount
        const { stdout } = await runSidecarCommand(['check_mount_status'], { mounted: 'dav-mount-1' })
        return stdout ? stdout : null
      }
      return null
    }

    // Capture console errors to help diagnose unexpected failures
    const originalErr = console.error
    const errors: string[] = []
    console.error = ((m?: unknown, ..._args: unknown[]) => { errors.push(String(m)); }) as typeof console.error

    const { stop } = initGui({ invoke: invoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 2000, statusTimeoutMs: 2000 })

    // Wait for badge to become 'Active'
    const badge = document.getElementById('service-badge') as HTMLElement
    const startWait = Date.now()
    while (Date.now() - startWait < 1000) {
      if (badge.textContent === 'Active') break
      await new Promise((r) => setTimeout(r, 20))
    }

    expect(calls.includes('get_status')).toBe(true)
    // GUI calls check_mount_status to verify mount; ensure it invoked it
    expect(calls.includes('check_mount_status')).toBe(true)
    expect(badge.textContent).toBe('Active')

    // No unexpected console errors
    console.error = originalErr
    expect(errors.join('\n')).toBe('')

    stop()
  })
})
