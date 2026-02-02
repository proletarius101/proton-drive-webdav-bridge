import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { App } from '../src/gui/App'
import { initGui } from '../src/gui/main'
import { renderWithTauri } from './helpers/renderWithTauri'
import type { TauriApi } from '../src/gui/tauri/TauriProvider'

// This test ensures the React-driven account list and details work end-to-end
// using the test invoke/listen hooks (so we don't rely on Tauri internals).

describe('Accounts UI (React)', () => {
  it('renders accounts and shows per-account details', async () => {
    // Minimal DOM root for the SPA
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} }

    // Mock invoke to provide accounts and per-account details
    const calls: string[] = []

    const mockInvoke = (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push(cmd + (args ? ':' + JSON.stringify(args) : ''))
      if (cmd === 'get_status') return { server: { running: false, pid: null, url: null } }
      if (cmd === 'list_accounts') return [{ id: 'a1', email: 'me@example.com' }]
      if (cmd === 'get_account') return { id: 'a1', email: 'me@example.com', status: 'OK', mounted: true, address: 'dav://127.0.0.1:7777', port: 7777 }
      return true
    }) as TauriApi['invoke']

    // stub listen so initGui doesn't rely on Tauri internals
    const mockListen: TauriApi['listen'] = async (_: string, __: any) => { return async () => {} }

    // ensure init wiring uses our invoke and stubbed listen
    const gui = (initGui as any)({ invoke: mockInvoke as any, listen: mockListen as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // render the SPA within a provider so components use our mock API
    const container = document.getElementById('root')!
    renderWithTauri(container, React.createElement(App, null), { invoke: mockInvoke, listen: mockListen })

    // wait for async activity and rendered list and details
    const start = Date.now()
    while (Date.now() - start < 2000) {
      const list = document.getElementById('account-list')
      const email = document.getElementById('account-email')
      if (list && list.children && list.children.length > 0 && email && email.textContent === 'me@example.com') break
      await new Promise((r) => setTimeout(r, 20))
    }

    const accList = document.getElementById('account-list') as HTMLElement
    expect(accList).toBeDefined()
    expect(accList.children.length).toBeGreaterThan(0)
    expect(calls.includes('list_accounts')).toBe(true)

    const email = document.getElementById('account-email') as HTMLElement
    expect(email.textContent).toBe('me@example.com')

    // stop gui interval (if returned)
    try { if (gui && typeof gui.stop === 'function') gui.stop(); } catch (e) {}
  })

  it('shows account when get_status returns logged-in auth data', async () => {
    // Test scenario: get_status returns proper auth data (simulating sidecar with credentials)
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    if (!(navigator as any).clipboard) (navigator as any).clipboard = { writeText: async () => {} }

    const calls: string[] = []

    // This mock simulates what happens when the sidecar has been authenticated
    const mockInvoke = (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push(cmd + (args ? ':' + JSON.stringify(args) : ''))
      if (cmd === 'get_status') {
        return {
          server: { running: true, pid: 1234, url: 'http://127.0.0.1:8080' },
          auth: { loggedIn: true, username: 'user@proton.me' },
          config: {
            webdav: { host: '127.0.0.1', port: 8080, https: false, requireAuth: false },
            remotePath: '/',
          },
          logFile: '/tmp/test.log',
        }
      }
      if (cmd === 'list_accounts') return [{ id: 'user@proton.me', email: 'user@proton.me', status: 'active' }]
      if (cmd === 'get_account') {
        const id = (args as any)?.id
        if (id === 'user@proton.me') {
          return { id: 'user@proton.me', email: 'user@proton.me', status: 'active' }
        }
        return null
      }
      return true
    }) as TauriApi['invoke']

    const mockListen: TauriApi['listen'] = async (_: string, __: any) => { return async () => {} }

    const gui = (initGui as any)({ invoke: mockInvoke as any, listen: mockListen as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    const container = document.getElementById('root')!
    renderWithTauri(container, React.createElement(App, null), { invoke: mockInvoke, listen: mockListen })

    // Wait for the account email to appear
    const start = Date.now()
    while (Date.now() - start < 2000) {
      const email = document.getElementById('account-email')
      if (email && email.textContent && email.textContent !== 'No account selected') {
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }

    const emailEl = document.getElementById('account-email') as HTMLElement
    expect(emailEl).toBeDefined()
    expect(emailEl.textContent).toBe('user@proton.me')

    const statusEl = document.getElementById('account-status-text') as HTMLElement
    expect(statusEl).toBeDefined()
    expect(statusEl.textContent).toBe('active')

    // Verify that list_accounts was called
    expect(calls.some((c) => c === 'list_accounts')).toBe(true)
    // Verify that get_account was called with the correct ID
    expect(calls.some((c) => c.startsWith('get_account:'))).toBe(true)

    try { if (gui && typeof gui.stop === 'function') gui.stop(); } catch (e) {}
  })
})