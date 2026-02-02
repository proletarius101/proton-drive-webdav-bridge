import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../src/gui/App'
import { TauriProvider } from '../src/gui/tauri/TauriProvider'
import { initGui } from '../src/gui/main'

describe('Sidebar account loading', () => {
  it('loads accounts via invoke and renders list', async () => {
    document.body.innerHTML = ''
    const ids = ['root', 'service-badge']
    ids.forEach((id) => {
      const el = document.createElement('div')
      el.id = id
      document.body.appendChild(el)
    })

    // mock invoke and listen
    const calls: string[] = []
    const mockInvoke = async (cmd: string, args?: any) => {
      calls.push(cmd)
      if (cmd === 'list_accounts') return [{ id: 'a1', email: 'me@example.com' }]
      if (cmd === 'get_account') return { id: 'a1', email: 'me@example.com', status: 'OK', mounted: true, address: 'dav://127.0.0.1:7777', port: 7777 }
      return true
    }

    // stub listen so Sidebar can subscribe
    const mockListen = async (_: string, __: any) => { return async () => {} }

    // ensure main.js uses our invoke and stubbed listen
    const gui = (initGui as any)({ invoke: mockInvoke as any, listen: mockListen as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    const container = document.getElementById('root')!
    createRoot(container).render(
      React.createElement(
        TauriProvider,
        { invoke: mockInvoke, listen: mockListen },
        React.createElement(App, null)
      )
    )


    // wait for async activity and rendered list and details
    const start = Date.now()
    while (Date.now() - start < 1000) {
      const list = document.getElementById('account-list')
      const email = document.getElementById('account-email')
      if (list && list.children && list.children.length > 0 && email && email.textContent === 'me@example.com') break
      await new Promise((r) => setTimeout(r, 20))
    }

    const accList = document.getElementById('account-list')!
    expect(accList).toBeDefined()
    expect(accList.children.length).toBeGreaterThan(0)
    expect(calls.includes('list_accounts')).toBe(true)

    const email = document.getElementById('account-email') as HTMLElement
    expect(email.textContent).toBe('me@example.com')
  })
})