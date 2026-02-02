import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { App } from '../src/gui/App'
import { initGui } from '../src/gui/main'
import { renderWithTauri } from './helpers/renderWithTauri'
import type { TauriApi } from '../src/gui/tauri/TauriProvider'

describe('Sidebar toggle behaviour', () => {
  it('shows and hides the sidebar when the toggle button is clicked', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = ''
    const ids = ['root', 'service-badge', 'permissions']
    ids.forEach((id) => {
      const el = document.createElement('div')
      el.id = id
      document.body.appendChild(el)
    })

    const mockInvoke = (async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'list_accounts') return []
      return true
    }) as TauriApi['invoke']

    // stub listen
    const mockListen: TauriApi['listen'] = async (_: string, __: any) => { return async () => {} }

    // initialize gui with tauri provider
    (initGui as any)({ invoke: mockInvoke as any, listen: mockListen as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    const container = document.getElementById('root')!
    await act(async () => {
      renderWithTauri(container, React.createElement(App, null), { invoke: mockInvoke, listen: mockListen } as any)
      await new Promise((r) => setTimeout(r, 0))
    })

    // wait for sidebar content to appear (Autostart toggle label)
    const start = Date.now()
    while (Date.now() - start < 1000) {
      if (document.body.textContent && document.body.textContent.includes('Autostart')) break
      await new Promise((r) => setTimeout(r, 20))
    }

    expect(document.body.textContent?.includes('Autostart')).toBe(true)

    // find the header toggle button (shows '≡') and click it
    const buttons = Array.from(document.querySelectorAll('button'))
    const toggle = buttons.find((b) => (b.textContent || '').trim() === '≡')
    if (!toggle) throw new Error('Toggle button not found')


    // use the native click method which triggers React handlers
    await act(async () => {
      (toggle as HTMLButtonElement).click()
      await new Promise((r) => setTimeout(r, 0))
    })

    // poll for 'opened' class to be removed for up to 1s
    const startHide = Date.now()
    let closed = false
    while (Date.now() - startHide < 1000) {
      const sidebarEl = document.querySelector('.mie.sidebar') as HTMLElement | null
      if (!sidebarEl) {
        closed = true
        break
      }

      const cls = sidebarEl.className || ''
      // when closed, Mielo removes the 'opened' class
      if (!/\bopened\b/.test(cls)) {
        closed = true
        break
      }

      await new Promise((r) => setTimeout(r, 20))
    }

    if (!closed) {
      const sidebarEl = document.querySelector('.mie.sidebar')
      console.log('Sidebar root outerHTML (debug):', sidebarEl ? (sidebarEl as HTMLElement).outerHTML : '(not found)')
    }

    expect(closed).toBe(true)
  })
})