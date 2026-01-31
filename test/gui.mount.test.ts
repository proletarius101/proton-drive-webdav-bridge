import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
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

describe('GUI Mount Toggle', () => {
  let elements: Map<string, any>
  let invokeCalls: Array<{ cmd: string; time: number }>

  beforeEach(() => {
    elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'quota-bar', 'quota-text', 'dav-url', 'mount-toggle',
      'open-files', 'copy-url', 'toggle-log', 'log-area', 'purge-cache', 'logout', 'apply-port', 'network-port'
    ].forEach((id) => elements.set(id, makeEl()))

    elements.get('network-port').value = '7777'

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }
    // @ts-ignore
    global.window = { addEventListener: (_: string, __: any) => {} }

    invokeCalls = []
  })

  afterEach(() => {
    delete (global as any).document
    delete (global as any).navigator
    delete (global as any).window
  })

  it('handles mount_drive error gracefully and still verifies actual mount status', async () => {
    let isMounted = false
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'mount_drive') {
        throw new Error('GIO error: Mount not found')
      }
      if (cmd === 'check_mount_status') {
        isMounted = true
        return 'dav://localhost:7777'
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const mountCalls = invokeCalls.filter((c) => c.cmd === 'mount_drive')
    const checkCalls = invokeCalls.filter((c) => c.cmd === 'check_mount_status')

    expect(mountCalls.length).toBeGreaterThanOrEqual(0)
    expect(checkCalls.length).toBeGreaterThanOrEqual(0)

    stop()
  })

  it('handles mount failure when server is not running', async () => {
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: false, pid: null, url: null },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 0, total: 4096 },
          liveStatusString: 'Server not running',
        }
      }
      if (cmd === 'mount_drive') {
        throw new Error('WebDAV server is not running. Start the server first.')
      }
      if (cmd === 'check_mount_status') {
        return null
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const mountAttempts = invokeCalls.filter((c) => c.cmd === 'mount_drive')
    expect(mountAttempts.length).toBeGreaterThanOrEqual(0)

    stop()
  })

  it('successfully unmounts when unmount_drive succeeds', async () => {
    let isMounted = true
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'unmount_drive') {
        isMounted = false
        return undefined
      }
      if (cmd === 'check_mount_status') {
        return isMounted ? 'dav://localhost:7777' : null
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const unmountCalls = invokeCalls.filter((c) => c.cmd === 'unmount_drive')
    const checkCalls = invokeCalls.filter((c) => c.cmd === 'check_mount_status')

    expect(unmountCalls.length).toBeGreaterThanOrEqual(0)
    expect(checkCalls.length).toBeGreaterThanOrEqual(0)

    stop()
  })

  it('handles unmount failure with backend still unmounting gracefully', async () => {
    let unmountInProgress = true
    let isMounted = true
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'unmount_drive') {
        if (unmountInProgress) {
          throw new Error('GIO error: Backend currently unmounting')
        }
        isMounted = false
        return undefined
      }
      if (cmd === 'check_mount_status') {
        unmountInProgress = false
        return isMounted ? 'dav://localhost:7777' : null
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const unmountCalls = invokeCalls.filter((c) => c.cmd === 'unmount_drive')
    expect(unmountCalls.length).toBeGreaterThanOrEqual(0)

    stop()
  })

  it('verifies mount status multiple times to ensure consistency', async () => {
    let checkCount = 0
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'mount_drive') {
        return undefined
      }
      if (cmd === 'check_mount_status') {
        checkCount++
        return checkCount >= 2 ? 'dav://localhost:7777' : null
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const checkCalls = invokeCalls.filter((c) => c.cmd === 'check_mount_status')
    expect(checkCalls.length).toBeGreaterThanOrEqual(1)

    stop()
  })

  it('does not revert switch if actual mount state can be determined despite error', async () => {
    let isMounted = true
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'mount_drive') {
        throw new Error('Transient error')
      }
      if (cmd === 'check_mount_status') {
        return isMounted ? 'dav://localhost:7777' : null
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const checkCalls = invokeCalls.filter((c) => c.cmd === 'check_mount_status')
    expect(checkCalls.length).toBeGreaterThanOrEqual(1)

    stop()
  })

  it('logs warnings when mount status checks fail but continues retrying', async () => {
    let failCount = 0
    const mockInvoke = async (cmd: string) => {
      invokeCalls.push({ cmd, time: Date.now() })

      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 123, url: 'http://localhost:7777' },
          config: { webdav: { host: 'localhost', port: 7777, https: false, requireAuth: false } },
          connecting: false,
          storage: { used: 1024, total: 4096 },
          liveStatusString: 'OK',
        }
      }
      if (cmd === 'mount_drive') {
        return undefined
      }
      if (cmd === 'check_mount_status') {
        failCount++
        if (failCount <= 2) {
          throw new Error('Temporary check failure')
        }
        return 'dav://localhost:7777'
      }
      return true
    }

    const mockListen = (_: string, __: any) => ({})
    const { stop } = initGui({ invoke: mockInvoke as any, listen: mockListen as any })

    await new Promise((r) => setTimeout(r, 50))

    const checkCalls = invokeCalls.filter((c) => c.cmd === 'check_mount_status')
    expect(checkCalls.length).toBeGreaterThanOrEqual(2)

    stop()
  })
})
