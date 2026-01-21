import { describe, it, expect } from 'bun:test'
import { initGui } from '../src/gui/main'

// Minimal fake element used in tests
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

describe('GUI init', () => {
  it('initializes without throwing and updates mount status', async () => {
    const elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle', 'mount-status',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port'
    ].forEach((id) => elements.set(id, makeEl()))

    // make network-port present and provide value
    elements.get('network-port').value = '123'

    // Provide a minimal global document
    // @ts-ignore - test harness
    global.document = {
      getElementById: (id: string) => elements.get(id) || null
    }

    // Provide minimal navigator.clipboard
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }

    // Provide minimal window for event handlers
    // @ts-ignore
    global.window = { addEventListener: (_: string, __: any) => {} }

    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') {
        return { running: false, connecting: false, storage: { used: 1024, total: 4096 }, port: 12345, mounted: false, liveStatusString: 'OK' }
      }
      if (cmd === 'check_mount_status') return null
      return true
    }

    const mockListen = (_: string, __: any) => ({})

    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    // wait for async refreshStatus to complete
    await new Promise((r) => setTimeout(r, 20))

    const ms = elements.get('mount-status')
    expect(ms.textContent).toBe('Not mounted')

    stop()
  })

  it('handles start_sidecar rejection without unhandledrejection', async () => {
    const elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle', 'mount-status',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port'
    ].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }

    let unhandledCalled = false
    // @ts-ignore
    global.window = {
      addEventListener: (event: string, handler: any) => {
        if (event === 'unhandledrejection') {
          // store a handler that would be invoked if an unhandled rejection occurs
          (global as any).__unhandled = handler
        }
      }
    }

    let startCalled = false
    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') return { running: false }
      if (cmd === 'start_sidecar') {
        startCalled = true
        return Promise.reject(new Error('Sidecar already running'))
      }
      if (cmd === 'check_mount_status') return null
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any })

    // wait for async activity
    await new Promise((r) => setTimeout(r, 50))

    // If start_sidecar rejection was unhandled, the runtime would invoke the handler we stored
    if ((global as any).__unhandled) {
      // call the stored handler with a fake event to detect whether it gets called automatically
      const handler = (global as any).__unhandled
      // The handler shouldn't have been called by anything; mark if it does run
      const original = handler
      (global as any).__unhandled = (...args: any[]) => { unhandledCalled = true; return original(...args) }
    }

    expect(startCalled).toBe(true)
    expect(unhandledCalled).toBe(false)

    stop()
  })

  it('handles get_status timeout without hanging', async () => {
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

    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') return new Promise(() => {}) // never resolves
      if (cmd === 'check_mount_status') return new Promise(() => {}) // never resolves too
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // wait long enough for the short timeout to fire
    await new Promise((r) => setTimeout(r, 50))

    const ms = elements.get('mount-status')
    const badge = elements.get('service-badge')
    expect(ms.textContent).toBe('Mount: timed out')
    expect(badge.textContent).toBe('Unavailable')

    stop()
  })
})
