// Run by backend's test:integration against its disposable database and server.
// Ordinary frontend tests skip this check and need no running API or MySQL.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { test, expect, vi } from 'vitest'
import App from '../src/App'
import { drawMonth, monthEnd } from '../src/lottery-shared'

const base = process.env.LOTTO_TEST_API_URL
const integrationTest = base ? test : test.skip
globalThis.IS_REACT_ACT_ENVIRONMENT = true

integrationTest('Customer Buy ticket and Pay save a real purchase visible in My Tickets and receipts', async () => {
  const realFetch = globalThis.fetch
  let cookie = ''
  vi.stubGlobal('fetch', async (path, options = {}) => {
    const response = await realFetch(base + path, { ...options, headers: {
      ...options.headers, ...(cookie ? { Cookie: cookie } : {}),
    } })
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]
    return response
  })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  async function settled(check) {
    for (let attempt = 0; attempt < 150; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      if (check()) return
    }
    throw new Error('UI did not settle: ' + container.textContent.slice(-1200))
  }
  async function go(path) {
    await act(async () => {
      window.history.replaceState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate'))
      root.render(<App />)
    })
  }
  const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text)
  const inputValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    await go('/login')
    const login = container.querySelector('.sign-in-form')
    login.elements.email.value = 'ui-purchase@integration.test'
    login.elements.password.value = 'Integration123'
    await act(async () => login.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settled(() => container.textContent.includes('Signed in as UI Customer'))
    await go('/buy-lottery')
    await settled(() => container.querySelector('tbody tr'))
    await act(async () => container.querySelectorAll('.custom-pick__inputs input').forEach((input, i) => inputValue(input, '000123'[i])))
    const buy = container.querySelector('[aria-label="Buy chosen ticket"]')
    expect(buy.disabled).toBe(false)
    await act(async () => buy.click())
    await settled(() => button('Pay ฿100.00'))
    expect(window.location.pathname).toBe('/checkout')
    expect(button('Pay ฿100.00').disabled).toBe(false)
    expect(container.querySelector('.checkout-item__details h3').textContent).toBe('000123')
    expect(container.querySelector('.checkout-item__details p').textContent).toBe('Draw: ' + drawMonth(monthEnd()))
    await act(async () => container.querySelector('[aria-label="Increase 000123 quantity"]').click())
    await settled(() => button('Pay ฿200.00'))
    const current = await (await fetch('/api/draws/current')).json()
    const stock = await (await fetch(`/api/draws/${current.data.drawId}/numbers?ticketNumber=000123`)).json()
    expect(stock.data.items[0].availableQuantity).toBe(5)
    expect((await (await fetch('/api/me/payments')).json()).data.items).toHaveLength(0)
    await act(async () => container.querySelector('[aria-label="Decrease 000123 quantity"]').click())
    await settled(() => button('Pay ฿100.00'))
    expect(container.textContent).not.toContain('Quantity updated.')
    expect(container.querySelector('.order-summary').textContent).not.toContain('Copies')
    expect(container.textContent).not.toContain('Simulated payment only. The backend checks')
    await act(async () => button('Pay ฿100.00').click())
    await settled(() => container.querySelector('.receipt') && container.textContent.includes('Your cart is empty'))
    expect(container.textContent).toContain('Purchase complete')
    expect(container.querySelector('.receipt > p').textContent).toBe('฿100.00 · 1 ticket copy · Draw: ' + drawMonth(monthEnd()))
    expect(container.querySelector('.receipt').textContent).not.toContain('Draw #')
    expect(container.querySelector('.receipt a')).toBeNull()
    const receiptId = container.querySelector('.receipt h2').textContent.match(/#(\d+)/)[1]
    await go('/cart')
    await settled(() => container.querySelector('.cart-ticket h3'))
    expect(container.querySelector('.cart-ticket h3').textContent).toBe('000123')
    expect(container.textContent).not.toContain('purchased ticket copies on this page')
    await act(async () => button('Receipts').click())
    await settled(() => button(`View receipt #${receiptId}`))
    await act(async () => button(`View receipt #${receiptId}`).click())
    await settled(() => container.querySelector('.receipt'))
    expect(container.querySelector('.receipt').textContent).toContain('฿100.00')
    expect(container.querySelector('.receipt > p').textContent).toContain('Draw: ' + drawMonth(monthEnd()))
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals()
  }
}, 25000)
