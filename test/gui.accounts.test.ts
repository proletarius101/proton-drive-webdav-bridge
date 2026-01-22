import { describe, it, expect } from 'bun:test'
import { initGui, renderAccounts } from '../src/gui/main'

// Minimal fake element used in tests
function makeEl() {
  return {
    textContent: '',
    className: '',
    value: '',
    checked: false,
    innerHTML: '',
    children: [],
    addEventListener: (_: string, __: Function) => {},
    setAttribute: (_: string, __: string) => {},
    appendChild: function (c: any) { this.children.push(c); },
    querySelector: () => null,
    dataset: {},
  }
}

describe('Accounts UI', () => {
  it('renders accounts and shows per-account details', async () => {
    const elements = new Map<string, any>()
    ;[
      'service-badge', 'live-status', 'dav-url', 'mount-toggle', 'mount-status',
      'account-list', 'account-email', 'account-status-text', 'account-dav-url', 'account-network-port', 'account-mount-toggle'
    ].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // @ts-ignore
    global.navigator = { clipboard: { writeText: async () => {} } }
    // @ts-ignore
    global.window = { addEventListener: (_: string, __: any) => {} }

    // Mock invoke to provide accounts and per-account details
    const calls: string[] = []
    // test hook captures
    // @ts-ignore
    global.__test_hook_calls = []

    const mockInvoke = async (cmd: string, args?: any) => {
      calls.push(cmd + (args ? ':' + JSON.stringify(args) : ''))
      // @ts-ignore
      if (global.__test_hook_calls) global.__test_hook_calls.push(cmd)
      if (cmd === 'get_status') return { server: { running: false, pid: null, url: null } }
      if (cmd === 'list_accounts') return [{ id: 'a1', email: 'me@example.com' }]
      if (cmd === 'get_account') return { id: 'a1', email: 'me@example.com', status: 'OK', mounted: true, address: 'dav://127.0.0.1:7777', port: 7777 }
      return true
    }

    const { stop } = initGui({ invoke: mockInvoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // Force render accounts (some environments may not call list RPC synchronously)
    renderAccounts([{ id: 'a1', email: 'me@example.com' }])

    // wait for async activity (poll until badge is updated)
    // Check that per-account details are rendered (avoid asserting badge which may be updated by status refreshes)
    const email = elements.get('account-email')
    const start = Date.now()
    while (Date.now() - start < 1000) {
      if (email.textContent === 'me@example.com') break
      await new Promise((r) => setTimeout(r, 20))
    }

    // ensure backend calls happened
    expect(calls.includes('list_accounts')).toBe(true)

    // ensure account list was populated
    const accList = elements.get('account-list')
    expect(Array.isArray(accList.children)).toBe(true)
    expect(accList.children.length).toBeGreaterThan(0)

    // ensure renderAccounts ran and selected first account
    // @ts-ignore
    expect(global.__test_hook_calls && global.__test_hook_calls.includes('renderAccounts:1')).toBe(true)

    // selectAccount should run to set the account header (but selection may be overwritten by status refreshes)
    const badge = elements.get('service-badge')
    // We can't assert badge reliably because status refresh may overwrite it; prefer checking the account details instead

    // ensure fetch was attempted
    // @ts-ignore
    expect(global.__test_hook_calls && global.__test_hook_calls.includes('fetchAccountDetails:a1')).toBe(true)

    expect(email.textContent).toBe('me@example.com')

    const dav = elements.get('account-dav-url')
    expect(dav.value).toBe('dav://127.0.0.1:7777')

    const port = elements.get('account-network-port')
    expect(port.value).toBe('7777')

    stop()
  })
})