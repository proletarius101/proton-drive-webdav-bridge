import { describe, it, expect } from 'bun:test'
import { initGui } from '../src/gui/main'
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
    const elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle', 'mount-status',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port'
    ].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }
    // @ts-ignore
    global.window = { addEventListener: (_: string, __: any) => {} }

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

    const ms = elements.get('mount-status')
    const badge = elements.get('service-badge')
    expect(ms.textContent).toBe('Mount: timed out')
    expect(badge.textContent).toBe('Unavailable')

    stop()
  })

  it('uses real sidecar output to show mounted state', async () => {
    const elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle', 'mount-status',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port'
    ].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }
    // @ts-ignore
    global.window = { addEventListener: (_: string, __: any) => {} }

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

    // wait for refresh to complete (poll until mount-status is set)
    const start = Date.now()
    let msText = ''
    while (Date.now() - start < 1000) {
      const ms = elements.get('mount-status')
      msText = ms?.textContent || ''
      if (msText && msText.length > 0) break
      await new Promise((r) => setTimeout(r, 20))
    }

    const ms = elements.get('mount-status')
    const badge = elements.get('service-badge')
    // Ensure check_mount_status was invoked
    expect(calls.includes('check_mount_status')).toBe(true)

    // Wait for badge to become 'Active' and mount-status to be set
    const startWait = Date.now()
    let lastBadge = badge.textContent
    while (Date.now() - startWait < 1000) {
      if (badge.textContent === 'Active' && ms.textContent === 'Mounted: dav-mount-1') break
      lastBadge = badge.textContent
      await new Promise((r) => setTimeout(r, 20))
    }

    expect(calls.includes('get_status')).toBe(true)
    expect(calls.includes('check_mount_status')).toBe(true)
    expect(ms.textContent).toBe('Mounted: dav-mount-1')

    // No unexpected console errors
    console.error = originalErr
    expect(errors.join('\n')).toBe('')

    stop()
  })
})
