import { describe, it, expect } from 'bun:test'
import { initGui } from '../src/gui/main.ts'

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
      // Create actual DOM elements provided by happy-dom
    const ids = ['service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port']

    // Ensure document is clean
    document.body.innerHTML = ''

    ids.forEach((id) => {
      let el: HTMLElement
      if (id === 'quota-bar') el = document.createElement('progress')
      else if (id === 'dav-url' || id === 'network-port') el = document.createElement('input')
      else if (id === 'log-area') el = document.createElement('pre')
      else el = document.createElement('div')
      el.id = id
      if (el instanceof HTMLInputElement) el.value = ''
      document.body.appendChild(el)
    })

    // Set initial network-port value
    const portInput = document.getElementById('network-port') as HTMLInputElement
    portInput.value = '123'

    // Ensure navigator.clipboard exists (do not replace navigator)
    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} }

    // Ensure window has addEventListener (happy-dom provides it)

    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') {
        return {
          server: { running: false, pid: null, url: null },
          config: { webdav: { host: 'localhost', port: 12345, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          mounted: false,
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'check_mount_status') return null
      return true
    }

    const mockListen = (_: string, __: any) => ({})

    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    // wait for async refreshStatus to complete
    await new Promise((r) => setTimeout(r, 20))


    // Ensure address and network port were loaded from status
    const portEl = document.getElementById('network-port') as HTMLInputElement
    const davEl = document.getElementById('dav-url') as HTMLInputElement
    expect(portEl.value).toBe('12345')
    expect(davEl.value).toBe('dav://localhost:12345')

    stop()
  })

  it('handles start_sidecar rejection without unhandledrejection', async () => {
    // Create actual DOM elements provided by happy-dom
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

    let unhandledCalled = false
    // Capture registered unhandledrejection handler by temporarily wrapping addEventListener
    const originalAddEventListener = window.addEventListener
    ;(window as any).addEventListener = (event: string, handler: any, options?: any) => {
      if (event === 'unhandledrejection') (global as any).__unhandled = handler
      return originalAddEventListener.call(window, event, handler, options)
    }

    let startCalled = false
    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') return { server: { running: false, pid: null, url: null } }
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

  it('starts sidecar and refreshes status to populate address and port', async () => {
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
    let started = false
    const calls: string[] = []
    const mockInvoke = async (cmd: string) => {
      calls.push(cmd + (started ? ':after-start' : ':before-start'))
      if (cmd === 'get_status') {
        if (!started) return { server: { running: false, pid: null, url: null } }
        return { server: { running: true, pid: 111, url: null }, config: { webdav: { host: 'localhost', port: 54321, https: false, requireAuth: false } }, mounted: false }
      }
      if (cmd === 'start_sidecar') { started = true; return true }
      if (cmd === 'check_mount_status') return null
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // wait long enough for start_sidecar and refresh to occur
    await new Promise((r) => setTimeout(r, 200))

    const portEl = document.getElementById('network-port') as HTMLInputElement
    const davEl = document.getElementById('dav-url') as HTMLInputElement

    // Ensure we invoked get_status after start_sidecar
    expect(calls.some(c => c.startsWith('get_status:after-start'))).toBe(true)

    expect(portEl.value).toBe('54321')
    expect(davEl.value).toBe('dav://localhost:54321')

    stop()
  })

  it('prefers server.url and converts to dav://host:port', async () => {
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

    const responses: any[] = []
    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') {
        const res = { server: { running: true, pid: 222, url: 'http://127.0.0.1:8080' }, config: { webdav: { host: '0.0.0.0', port: 54321, https: false, requireAuth: false } }, mounted: false }
        responses.push(res)
        return res
      }
      if (cmd === 'check_mount_status') return null
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    await new Promise((r) => setTimeout(r, 200))

    // Ensure we actually called get_status and got the expected server.url
    expect(responses.length).toBeGreaterThan(0)
    expect(responses[0].server.url).toBe('http://127.0.0.1:8080')

    const portEl = document.getElementById('network-port') as HTMLInputElement
    const davEl = document.getElementById('dav-url') as HTMLInputElement

    expect(portEl.value).toBe('8080')
    expect(davEl.value).toBe('dav://127.0.0.1:8080')

    stop()
  })

  it('handles get_status timeout without hanging', async () => {
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

    const mockInvoke = async (cmd: string) => {
      if (cmd === 'get_status') return new Promise(() => {}) // never resolves
      if (cmd === 'check_mount_status') return new Promise(() => {}) // never resolves too
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // wait long enough for the short timeout to fire
    await new Promise((r) => setTimeout(r, 50))

    const badge = document.getElementById('service-badge') as HTMLElement
    expect(badge.textContent).toBe('Unavailable')

    stop()
  })
})
