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

    const dav = document.getElementById('account-dav-url') as HTMLInputElement
    expect(dav.value).toBe('dav://127.0.0.1:7777')

    const port = document.getElementById('account-network-port') as HTMLInputElement
    expect(port.value).toBe('7777')

    // stop gui interval (if returned)
    try { if (gui && typeof gui.stop === 'function') gui.stop(); } catch (e) {}
  })
})