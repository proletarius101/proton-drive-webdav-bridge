import { describe, it, expect } from 'bun:test'
import { initGui } from '../src/gui/main'

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

describe('mount-status events', () => {
  it('updates mount status from mount-status event', async () => {
    const elements = new Map<string, any>()
    ;['mount-status', 'service-badge'].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // fake listen implementation that immediately invokes handler when called
    const capture: { event?: string; handler?: Function } = {}
    const listen = (evt: string, handler: Function) => { capture.event = evt; capture.handler = handler }

    const { stop } = initGui({ invoke: async (_: string) => ({} as any), listen: listen as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // Simulate an intermediate 'checking' event
    capture.handler && capture.handler({ payload: 'Checking mount: dav://foo' })
    const ms = elements.get('mount-status')
    expect(ms.textContent).toBe('Checking mount: dav://foo')
    expect(ms.className).toBe('mount-status')

    // Simulate final 'No matching' event
    capture.handler && capture.handler({ payload: 'No matching mount found' })
    expect(ms.textContent).toBe('No matching mount found')
    expect(ms.className).toBe('mount-status err')

    // Simulate final mounted result
    capture.handler && capture.handler({ payload: 'Mounted: dav-mount-1' })
    expect(ms.textContent).toBe('Mounted: dav-mount-1')
    expect(ms.className).toBe('mount-status ok')

    stop()
  })

  it('sets mount-status on global failure', async () => {
    const elements = new Map<string, any>()
    ;['mount-status', 'service-badge'].forEach((id) => elements.set(id, makeEl()))

    // @ts-ignore
    global.document = { getElementById: (id: string) => elements.get(id) || null }
    // Make invoke reject so refreshStatus outer catch is hit
    const invoke = async (cmd: string) => {
      if (cmd === 'get_status') return Promise.reject(new Error('boom'))
      return null
    }

    const { stop } = initGui({ invoke: invoke as any, listen: (_: string, __: any) => ({}) as any, checkTimeoutMs: 20, statusTimeoutMs: 20 })

    // wait for refresh attempt
    await new Promise((r) => setTimeout(r, 50))

    const ms = elements.get('mount-status')
    const badge = elements.get('service-badge')
    expect(ms.textContent).toBe('Mount: error checking status')
    expect(ms.className).toBe('mount-status err')
    expect(badge.textContent).toBe('Error')

    stop()
  })
})