import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../src/App'
import { monthEnd, countdownParts, customerDrawChoices, drawMonth } from '../src/lottery-shared'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => structuredClone(body) })
let root, container, fetchMock, state, checkoutMock
const number = { lotteryNumberId: 101, ticketNumber: '000001', availableQuantity: 5 }
const ticket = { ticketId: 501, ticketNumber: '000001', drawId: 1, paymentId: 81, drawDate: '2026-10-31', userId: 17 }
const payment = { paymentId: 81, userId: 17, amount: '200.00', paymentDate: '2026-10-29T03:00:00Z' }
const receipt = { ...payment, drawDate: '2026-10-31', tickets: [ticket, { ...ticket, ticketId: 502 }] }
const makePrizes = () => Array.from({ length: 13 }, (_, i) => ({ prizeId: i + 1, prizeType: ['1st', '2nd', '3rd'][i] ?? '4th', prizeAmount: ['6000000.00', '200000.00', '80000.00'][i] ?? '2000.00', winningNumber: String(i).padStart(6, '0') }))
function savedItem(quantity = 2) { return { ...number, quantity, cartItemId: 11, drawId: 1, drawDate: '2026-10-31', available: true, unitPrice: '100.00' } }
const success = data => response(200, { data })
function list(items, query, total = items.length) { return response(200, { data: { items }, meta: { page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 20), totalItems: total } }) }

beforeEach(() => {
  state = {
    user: { userId: 17, name: 'Demo Customer', role: 'Customer' },
    profile: { userId: 17, name: 'Demo Customer', phone: '0812345678', email: 'test@lotto.test' },
    draw: { drawId: 1, drawDate: monthEnd(), drawAt: '2099-10-31T11:00:00Z', salesCloseAt: '2099-10-31T10:00:00Z', drawStatus: 'Open', initializationStatus: 'Ready', published: false, purchasable: true, isCurrent: true, unitPrice: '100.00' },
    cart: [], payments: [], tickets: [], prizes: [],
    customers: [{ userId: 17, name: 'Demo Customer', email: 'test@lotto.test', phone: '0812345678', accountStatus: 'Active' }],
    result: { status: 'pending', prizeAmount: null, prizeType: null },
  }
  checkoutMock = vi.fn(async () => { state.cart = []; state.payments = [payment]; state.tickets = receipt.tickets; return response(201, { data: { ...receipt, drawId: 1, tickets: receipt.tickets.map(({ drawId, ...ticket }) => ticket) } }) })
  fetchMock = vi.fn(async (url, options = {}) => {
    const parsed = new URL(url, 'http://localhost'), path = parsed.pathname, query = parsed.searchParams
    const method = options.method ?? 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    if (path === '/api/admin/draws' && method === 'GET') return list([state.draw], query)
    if (path === '/api/admin/draws/1' && method === 'GET') return success(state.draw)
    if (path === '/api/admin/draws/1/results' && method === 'GET') return success({ drawId: 1, status: state.draw.published ? 'published' : 'pending', items: state.prizes, publishedAt: state.draw.published ? '2026-10-31T11:00:00Z' : undefined })
    if (path === '/api/auth/me') return state.user ? success(state.user) : response(401, { error: { code: 'LOGIN_REQUIRED', message: 'Please sign in.' } })
    if (path === '/api/auth/csrf') return success({ csrfToken: 'current-session-token' })
    if (path === '/api/developer/inventory') {
      const items = [{ lotteryNumberId: 12, ticketNumber: query.get('ticketNumber') ?? (query.get('page') === '2' ? '000020' : '000123'), purchasedCopies: 2, availableQuantity: query.has('inconsistentOnly') ? 4 : 3, consistent: !query.has('inconsistentOnly') }]
      return response(200, { data: { draw: state.draw,
        summary: { expectedNumbers: 1000000, numberCount: 1000000, missingNumbers: 0, purchasedCopies: 2, availableCopies: 4999999, inconsistentNumbers: 1, consistent: false }, items },
        meta: { page: Number(query.get('page') ?? 1), pageSize: 20, totalItems: query.has('ticketNumber') || query.has('inconsistentOnly') ? 1 : 1000000 } })
    }
    if (path === '/api/me/profile') {
      if (method === 'PATCH') { Object.assign(state.profile, body); state.user.name = state.profile.name }
      return success(state.profile)
    }
    if (path === '/api/me/winnings') return success({ totalWinnings: '0.00', winningCopies: 0 })
    if (path === '/api/draws/current' || path === '/api/draws/1') return success(state.draw)
    if (path === '/api/draws') return list([state.draw], query)
    if (path === '/api/draws/1/numbers') {
      const requested = query.get('ticketNumber')
      const items = requested ? [{ ...number, ticketNumber: requested }] : Number(query.get('page')) === 2 ? [{ ...number, lotteryNumberId: 103, ticketNumber: '000020' }] : [number, { lotteryNumberId: 102, ticketNumber: '000002', availableQuantity: 0 }]
      return response(200, { data: { drawId: 1, purchasable: state.draw.purchasable, items }, meta: { page: Number(query.get('page')), pageSize: 20, totalItems: requested ? 1 : 1000000 } })
    }
    if (path === '/api/draws/1/results') return success({ drawId: 1, status: state.draw.published ? 'published' : 'pending', items: state.prizes, publishedAt: state.draw.published ? '2026-10-31T11:00:00Z' : undefined })
    if (path === '/api/draws/1/check') return success({ ...state.result, drawId: 1, ticketNumber: query.get('ticketNumber') })
    if (path === '/api/me/cart') {
      if (method === 'POST') { state.cart.push({ ...savedItem(body.quantity), lotteryNumberId: body.lotteryNumberId }); return response(201, { data: state.cart.at(-1) }) }
      return success({ items: state.cart, totalCopies: state.cart.reduce((n, i) => n + i.quantity, 0) })
    }
    if (path === '/api/me/cart/11') {
      if (method === 'DELETE') state.cart = []
      if (method === 'PATCH') state.cart[0].quantity = body.quantity
      return success({ message: 'Updated' })
    }
    if (path === '/api/checkout') return checkoutMock(url, options)
    if (path === '/api/me/payments') return list(state.payments, query)
    if (path === '/api/me/tickets') return list(state.tickets, query)
    if (path === '/api/me/payments/81') return success(receipt)
    if (/\/api\/me\/tickets\/\d+\/result/.test(path)) return success(state.result)
    if (path === '/api/admin/dashboard') return success({ totalUsers: 1, totalTicketsSold: 2, totalSales: '200.00' })
    if (path === '/api/admin/customers') return list(state.customers, query)
    if (path === '/api/admin/customers/17/deactivate') { state.customers[0].accountStatus = 'Deactivated'; return success({ userId: 17, accountStatus: 'Deactivated' }) }
    if (path === '/api/admin/tickets') return list(state.tickets, query)
    if (path === '/api/admin/payments') return list(state.payments, query)
    if (path === '/api/admin/draws/1/close') { state.draw.drawStatus = 'Closed'; state.draw.drawAt = '2000-01-31T11:00:00Z'; return success(state.draw) }
    if (path === '/api/admin/draws/1/generate') { state.draw.published = true; state.prizes = makePrizes(); return response(201, { data: { items: state.prizes } }) }
    if (path === '/api/admin/draws/1/winners') return list([], query)
    throw new Error('Unexpected request: ' + method + ' ' + url)
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
async function mount(path) { await act(async () => { window.history.replaceState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); root.render(<App />) }) }
function button(text) { const b = [...container.querySelectorAll('button')].find(b => b.textContent === text); expect(b, text).toBeTruthy(); return b }
async function click(text) { await act(async () => button(text).click()) }
function setValue(input, value) { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }
const submit = form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const mutations = () => fetchMock.mock.calls.filter(([, options]) => options?.method)

test('Developer can open a read-only inventory report from the navigation', async () => {
  state.user.role = 'Developer'
  await mount('/developer')
  expect(container.querySelector('.nav a[href="/developer"]')?.textContent).toBe('Inventory report')
  expect(container.textContent).toContain('1,000,000')
  expect(container.textContent).toContain('4,999,999')
  expect(container.textContent).toContain('Inventory needs checking')
  expect(container.querySelector('tbody').textContent).toContain('00012323Correct')
  expect(mutations()).toHaveLength(0)
})

test('Developer search preserves zeros, resets pagination and filters inconsistent rows', async () => {
  state.user.role = 'Developer'
  await mount('/developer')
  await click('Next')
  expect(container.querySelector('tbody').textContent).toContain('000020')
  await act(async () => {
    setValue(container.querySelector('[aria-label="Search inventory number"]'), '000456')
    container.querySelector('.confirmation input').click()
  })
  await act(async () => submit(container.querySelector('form')))
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/developer/inventory?page=1&pageSize=20&ticketNumber=000456&inconsistentOnly=true')).toBe(true)
  expect(container.querySelector('tbody').textContent).toContain('00045624Inconsistent')
  const count = fetchMock.mock.calls.length
  await click('Refresh')
  expect(fetchMock.mock.calls.length).toBeGreaterThan(count)
  expect(mutations()).toHaveLength(0)
})

test.each(['Visitor', 'Customer', 'Admin'])('%s cannot load the Developer report', async role => {
  state.user = role === 'Visitor' ? null : { ...state.user, role }
  await mount('/developer')
  expect(container.querySelector('table')).toBeNull()
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/developer/'))).toBe(false)
  expect(container.querySelector('.nav a[href="/developer"]')).toBeNull()
})

test('Developer report shows safe errors and retries without fabricating inventory', async () => {
  state.user.role = 'Developer'
  const original = fetchMock.getMockImplementation()
  let fail = true
  fetchMock.mockImplementation(async (url, options) => url.startsWith('/api/developer/') && fail
    ? response(404, { error: { code: 'DRAW_NOT_FOUND', message: 'The current monthly draw is missing.' } }) : original(url, options))
  await mount('/developer')
  expect(container.textContent).toContain('The current monthly draw is missing.')
  expect(container.querySelector('table')).toBeNull()
  fail = false
  await click('Try again')
  expect(container.querySelector('table')).not.toBeNull()
})

test('customer selects copies, saves a real cart and completes one payment with server ticket IDs', async () => {
  await mount('/buy-lottery')
  expect(container.querySelectorAll('.ticket-options .ticket-card')).toHaveLength(2)
  await act(async () => container.querySelector('.number-browser-extra > summary').click())
  expect(container.textContent).toContain('000001')
  expect(button('Sold out').disabled).toBe(true)
  await act(async () => setValue(container.querySelector('[aria-label="Copies of 000001"]'), '2'))
  await click('Add to cart')
  expect(state.cart[0].quantity).toBe(2)
  expect(container.querySelector('.ticket-message').textContent.trim()).toBe('')
  await mount('/checkout')
  expect(window.location.pathname).toBe('/checkout')
  expect(container.querySelector('.checkout-cart__panel .checkout-grid')).not.toBeNull()
  expect(container.querySelector('.checkout-item__details h3').textContent).toBe('000001')
  expect(container.querySelector('.checkout-item__details p').textContent).toBe('Draw: October 2026')
  expect(container.querySelector('.checkout-item').textContent).not.toContain('Ticket Price')
  expect(container.textContent).toContain('฿200.00')
  await click('Pay ฿200.00')
  expect(checkoutMock).toHaveBeenCalledTimes(1)
  const [, options] = checkoutMock.mock.calls[0]
  expect(JSON.parse(options.body)).toEqual({ drawId: 1, items: [{ lotteryNumberId: 101, quantity: 2 }] })
  expect(container.textContent).toContain('Receipt #81')
  expect(container.textContent).toContain('Ticket #502')
  expect(container.querySelector('.receipt > p').textContent).toBe('฿200.00 · 2 ticket copies · Draw: October 2026')
  expect(container.querySelector('.receipt').textContent).not.toContain('Draw #')
  expect(container.querySelector('.receipt').textContent).not.toContain('Simulated payment:')
  expect(container.querySelector('.receipt a')).toBeNull()
  expect(container.textContent).not.toContain('undefined')
  expect(container.textContent).toContain('Your cart is empty')
  expect(container.querySelector('.order-summary').textContent).not.toContain('Copies')
  expect(container.querySelector('.order-summary').textContent).not.toContain('Simulated payment only')
  for (const [, options] of mutations()) {
    expect(options.credentials).toBe('same-origin')
    expect(options.headers['X-CSRF-Token']).toBe('current-session-token')
  }
})

test('number searches keep leading zeros and pagination uses the server metadata', async () => {
  await mount('/buy-lottery')
  await click('Next')
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/numbers?page=2'))).toBe(true)
  await act(async () => { setValue(container.querySelector('[aria-label="Search lottery number"]'), '000007') })
  await act(async () => submit(container.querySelector('form')))
  expect(fetchMock.mock.calls.some(([url]) => url.includes('ticketNumber=000007'))).toBe(true)
  expect(container.textContent).toContain('000007')
  expect(container.textContent).toContain('1 records')
})

test('the original custom-digit card checks stock and saves one copy before opening checkout', async () => {
  await mount('/buy-lottery')
  const digits = container.querySelectorAll('.custom-pick__inputs input')
  expect(digits).toHaveLength(6)
  await act(async () => digits.forEach((input, i) => setValue(input, '000001'[i])))
  await act(async () => container.querySelector('[aria-label="Buy chosen ticket"]').click())
  expect(window.location.pathname).toBe('/checkout')
  expect(state.cart).toHaveLength(1)
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ lotteryNumberId: 101, quantity: 1 })
  expect(button('Pay ฿100.00').disabled).toBe(false)
  expect(checkoutMock).not.toHaveBeenCalled()
})

test('a sold-out number chosen through the original card shows the stock error without creating a cart item', async () => {
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (path, options) => path === '/api/draws/1/numbers?ticketNumber=000001' ? success({ purchasable: true, items: [{ ...number, availableQuantity: 0 }] }) : original(path, options))
  await mount('/buy-lottery')
  await act(async () => container.querySelectorAll('.custom-pick__inputs input').forEach((input, i) => setValue(input, '000001'[i])))
  await act(async () => container.querySelector('[aria-label="Buy chosen ticket"]').click())
  expect(container.textContent).toContain('This number is sold out')
  expect(state.cart).toHaveLength(0)
  expect(mutations()).toHaveLength(0)
  expect(window.location.pathname).toBe('/buy-lottery')
})

test('guests can click Add to cart or Buy ticket and are asked to sign in without saving anything', async () => {
  state.user = null
  await mount('/buy-lottery')
  expect(button('Add to cart').disabled).toBe(false)
  await click('Add to cart')
  expect(container.querySelector('.ticket-message').textContent).toContain('Please sign in')
  expect(container.querySelector('.ticket-message a').getAttribute('href')).toBe('/login')
  await act(async () => container.querySelector('[aria-label="Buy quick pick ticket"]').click())
  expect(container.querySelector('.ticket-message').textContent).toContain('Please sign in')
  expect(state.cart).toHaveLength(0)
  expect(mutations()).toHaveLength(0)
  await mount('/checkout')
  expect(container.textContent).toContain('No active login session')
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/me/cart')).toBe(false)
})

test('Customer Buy ticket checks live stock even when the previously loaded draw was closed', async () => {
  state.draw.purchasable = false; state.draw.drawStatus = 'Closed'
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (url, options) => url === '/api/draws/1/numbers?ticketNumber=000001'
    ? success({ purchasable: true, items: [number] }) : original(url, options))
  await mount('/buy-lottery')
  await act(async () => container.querySelectorAll('.custom-pick__inputs input').forEach((input, i) => setValue(input, '000001'[i])))
  expect(container.querySelector('[aria-label="Buy chosen ticket"]').disabled).toBe(false)
  await act(async () => container.querySelector('[aria-label="Buy chosen ticket"]').click())
  expect(window.location.pathname).toBe('/checkout')
  expect(state.cart).toHaveLength(1)
  expect(button('Pay ฿100.00').disabled).toBe(false)
})

test.each([{ userId: 3, name: 'Admin', role: 'Admin' }, { userId: 4, name: 'Developer', role: 'Developer' }])('purchase controls require a Customer session (%j)', async user => {
  state.user = user
  await mount('/buy-lottery')
  expect(button('Add to cart').disabled).toBe(true)
  await mount('/checkout')
  expect(container.textContent).toContain(user ? 'Access restricted' : 'No active login session')
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/me/cart')).toBe(false)
  expect(mutations()).toHaveLength(0)
})

test('closed draws block buying and unavailable cart rows block payment while still allowing deletion', async () => {
  state.draw.purchasable = false; state.draw.drawStatus = 'Closed'
  await mount('/buy-lottery')
  expect(button('Add to cart').disabled).toBe(false)
  await click('Add to cart')
  expect(container.textContent).toContain('Sales are closed for this draw.')
  await act(async () => container.querySelector('[aria-label="Buy quick pick ticket"]').click())
  expect(mutations()).toHaveLength(0)
  state.cart = [{ ...savedItem(), available: false }]
  await mount('/checkout')
  expect(button('Pay ฿200.00').disabled).toBe(true)
  await act(async () => container.querySelector('[aria-label="Remove 000001"]').click())
  expect(mutations().at(-1)[1].method).toBe('DELETE')
  expect(container.textContent).toContain('Your cart is empty')
  expect(checkoutMock).not.toHaveBeenCalled()
})

test('quantity controls PATCH the saved selection and DELETE removes it without purchasing', async () => {
  state.cart = [savedItem()]
  await mount('/checkout')
  await act(async () => container.querySelector('[aria-label="Increase 000001 quantity"]').click())
  expect(state.cart[0].quantity).toBe(3)
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ quantity: 3 })
  expect(mutations()[0][1].method).toBe('PATCH')
  expect(container.textContent).not.toContain('Quantity updated.')
  await act(async () => container.querySelector('[aria-label="Remove 000001"]').click())
  expect(mutations().at(-1)[1].method).toBe('DELETE')
  expect(container.textContent).not.toContain('Selection removed.')
  expect(checkoutMock).not.toHaveBeenCalled()
})

test('Pay blocks double clicks and cart edits until the payment response arrives', async () => {
  state.cart = [savedItem()]
  let finish
  checkoutMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount('/checkout')
  const pay = button('Pay ฿200.00')
  await act(async () => { pay.click(); pay.click() })
  expect(checkoutMock).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[aria-label="Remove 000001"]').disabled).toBe(true)
  await act(async () => { state.cart = []; finish(response(201, { data: receipt })) })
  expect(container.textContent).toContain('Purchase complete')
})

test('an interrupted payment requires receipt review and never automatically retries checkout', async () => {
  state.cart = [savedItem()]
  checkoutMock.mockRejectedValue(new TypeError('Connection interrupted'))
  await mount('/checkout'); await click('Pay ฿200.00')
  expect(container.textContent).toContain('purchase may have succeeded')
  expect(button('Pay ฿200.00').disabled).toBe(true)
  expect(checkoutMock).toHaveBeenCalledTimes(1)
  await click('Review recent receipts')
  expect(container.textContent).toContain('No receipts found')
  expect(checkoutMock).toHaveBeenCalledTimes(1)
  await click('I reviewed my receipts; reload cart')
  expect(button('Pay ฿200.00').disabled).toBe(false)
})

test('stock errors are visible, refresh availability and do not display a fabricated receipt', async () => {
  state.cart = [savedItem()]
  checkoutMock.mockImplementation(async () => { state.cart[0].available = false; return response(409, { error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough copies are available.' } }) })
  await mount('/checkout'); await click('Pay ฿200.00')
  expect(container.textContent).toContain('Not enough copies are available')
  expect(container.querySelector('.receipt')).toBeNull()
  expect(button('Pay ฿200.00').disabled).toBe(true)
})

test('an unexpected payment server error also requires receipt review before another payment', async () => {
  state.cart = [savedItem()]
  checkoutMock.mockResolvedValue(response(500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }))
  await mount('/checkout'); await click('Pay ฿200.00')
  expect(container.textContent).toContain('Check your receipts before paying again')
  expect(button('Pay ฿200.00').disabled).toBe(true)
  expect(checkoutMock).toHaveBeenCalledTimes(1)
})

test('profile saves only editable fields and refreshes the displayed account name', async () => {
  await mount('/profile')
  const form = container.querySelector('.feature-form')
  form.elements.name.value = ' Updated Customer '; form.elements.phone.value = ' 0899999999 '
  await act(async () => submit(form))
  const [path, options] = mutations()[0]
  expect(path).toBe('/api/me/profile'); expect(options.method).toBe('PATCH')
  expect(JSON.parse(options.body)).toEqual({ name: 'Updated Customer', phone: '0899999999' })
  expect(container.textContent).toContain('Signed in as Updated Customer')
  expect(container.querySelector('input[type=email]').readOnly).toBe(true)
})

test('ticket results distinguish pending, loss and per-copy winnings; receipts load from the server', async () => {
  state.tickets = receipt.tickets; state.payments = [payment]
  await mount('/cart')
  expect(container.querySelectorAll('.cart-accordion .cart-ticket')).toHaveLength(2)
  await click('Check ticket #501')
  expect(container.textContent).toContain('Pending publication')
  expect(container.textContent).not.toContain('No prize')
  state.result = { status: 'win', prizeType: '4th', prizeAmount: '2000.00' }
  await click('Check ticket #501')
  expect(container.textContent).toContain('Win · 4th Prize · ฿2,000.00')
  state.result = { status: 'loss', prizeType: null, prizeAmount: '0.00' }
  await click('Check ticket #502'); expect(container.textContent).toContain('No prize')
  await click('Receipts'); await click('View receipt #81')
  expect(container.textContent).toContain('Receipt #81')
  expect(container.textContent).toContain('Ticket #502')
})

test('public results show pending honestly and check the selected number against its draw', async () => {
  state.user = null
  await mount('/results')
  expect(container.querySelector('.results-hero__person')).not.toBeNull()
  expect(container.querySelector('.results-hero__trophy')).not.toBeNull()
  expect(container.textContent).toContain('Results are pending')
  await act(async () => setValue(container.querySelector('[aria-label="Lottery Number"]'), '000001'))
  await act(async () => submit(container.querySelector('form')))
  expect(container.textContent).toContain('Pending publication')
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/draws/1/check?ticketNumber=000001')).toBe(true)
  expect(mutations()).toHaveLength(0)
})

test.each(['Customer', 'Developer'])('Admin screens reject %s before fetching private customer/report data', async role => {
  state.user.role = role
  await mount('/admin')
  expect(container.textContent).toContain('Access restricted')
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/admin/'))).toBe(false)
})

test('Admin can close and publish automatically created draws without manual setup controls', async () => {
  state.user.role = 'Admin'
  await mount('/admin')
  expect(container.querySelectorAll('.admin-metric')).toHaveLength(4)
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'New Draw')).toBe(false)
  expect(container.textContent).not.toContain('Initialize #1')
  expect(container.textContent).not.toContain('Open sales #1')
  expect(container.textContent).not.toContain('Initialize may take a minute')
  expect(container.querySelector('.admin-status').textContent).toBe('pending')
  await click('Close Draw'); expect(state.draw.drawStatus).toBe('Open')
  await click('Confirm close'); expect(state.draw.drawStatus).toBe('Closed')
  await act(async () => [...container.querySelectorAll('a')].find(a => a.textContent === 'Run Draw').click())
  expect(button('Roll').disabled).toBe(false)
  expect(container.querySelector('.draw-run-details')).toBeNull()
  expect(container.querySelector('.confirmation')).toBeNull()
  await click('Roll')
  expect(mutations().at(-1)[0]).toBe('/api/admin/draws/1/generate')
  expect(JSON.parse(mutations().at(-1)[1].body)).toEqual({})
  expect(container.textContent).not.toContain('Publish final results for this draw')
  expect(container.textContent).not.toContain('Scheduled:')
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Roll')).toBe(false)
  expect(container.querySelectorAll('.winning-admin__table tbody tr')).toHaveLength(13)
  expect(container.textContent).toContain('No purchased tickets won')
})

test('Admin must wait for the scheduled draw time before publishing', async () => {
  state.user.role = 'Admin'; state.draw.drawStatus = 'Closed'
  await mount('/admin/draw?drawId=1')
  expect(button('Roll').disabled).toBe(true)
  expect(container.querySelector('.confirmation')).toBeNull()
  expect(mutations()).toHaveLength(0)
})

test('Admin dashboard restores completed and Results wording for published draws', async () => {
  state.user.role = 'Admin'; state.draw.drawStatus = 'Closed'; state.draw.published = true
  await mount('/admin')
  expect(container.querySelector('.admin-status').textContent).toBe('completed')
  expect(container.querySelector('td a').textContent).toBe('Results')
  expect(container.textContent).not.toContain('Results / draw #')
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Close Draw')).toBe(false)
})

test('Admin draw numbering follows the chronological number while links keep the database ID', async () => {
  state.user.role = 'Admin'; state.draw.drawId = 5003; state.draw.drawNumber = 13
  state.draw.drawStatus = 'Closed'; state.draw.published = true
  await mount('/admin')
  expect(container.querySelector('tbody tr td').textContent).toBe('13')
  expect(container.querySelector('td a').getAttribute('href')).toBe('/admin/draw?drawId=5003')
})

test('Admin deactivation requires confirmation and updates the Customer status without deleting records', async () => {
  state.user.role = 'Admin'
  await mount('/admin'); await click('Deactivate customer #17')
  expect(mutations()).toHaveLength(0)
  await click('Confirm deactivation')
  expect(mutations()[0][0]).toBe('/api/admin/customers/17/deactivate')
  expect(JSON.parse(mutations()[0][1].body)).toEqual({})
  expect(state.customers).toHaveLength(1)
  expect(container.textContent).toContain('Deactivated')
  expect(button('Deactivate customer #17').disabled).toBe(true)
})

test('expired sessions clear private content and restore a sign-in prompt', async () => {
  state.cart = [savedItem()]
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (path, options) => path === '/api/me/cart' ? response(401, { error: { code: 'LOGIN_REQUIRED', message: 'Sign in again.' } }) : original(path, options))
  await mount('/checkout')
  expect(container.textContent).toContain('No active login session')
  expect(container.textContent).not.toContain('Pay ฿200.00')
})

test('API outages show errors and never claim empty purchase history or successful payment', async () => {
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (path, options) => path.startsWith('/api/me/') ? Promise.reject(new TypeError('Offline')) : original(path, options))
  await mount('/cart')
  expect(container.querySelector('[role=alert]')).not.toBeNull()
  expect(container.textContent).not.toContain('No purchases yet')
  expect(checkoutMock).not.toHaveBeenCalled()
})

test('countdown uses numeric days, hours and minutes from the SQL timestamp', async () => {
  expect(countdownParts('2026-10-31T11:00:00Z', Date.parse('2026-10-29T08:30:00Z'))).toEqual([2, 2, 30])
  expect(countdownParts('invalid', Date.now())).toBeNull()
  await mount('/buy-lottery')
  const values = [...container.querySelectorAll('.countdown__unit strong')].map(el => el.textContent)
  expect(values).toHaveLength(3)
  expect(values.every(value => /^\d+$/.test(value))).toBe(true)
  expect(container.textContent).not.toContain('NaN')
})

test('customer date selection uses actual SQL draw options instead of a future date calendar', async () => {
  await mount('/results')
  expect(container.querySelector('input[type="date"]')).toBeNull()
  expect(container.querySelector('input[type="month"]')).toBeNull()
  expect([...container.querySelectorAll('select[aria-label="Draw month"] option')].filter(o => o.value)).toHaveLength(1)
  await mount('/buy-lottery')
  expect(container.querySelector('select[aria-label="Select draw month"]')).toBeNull()
  expect(container.querySelector('input[type="date"]')).toBeNull()
})

test('result selectors show month and year, with Pending only for an unpublished draw', async () => {
  state.draw.drawDate = '2026-10-31'
  const previous = { ...state.draw, drawId: 2, drawDate: '2026-09-30', published: true, isCurrent: false }
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (url, options) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/draws') return list([state.draw, previous], parsed.searchParams)
    if (parsed.pathname === '/api/draws/2') return success(previous)
    if (parsed.pathname === '/api/draws/2/results') return success({ drawId: 2, status: 'published', items: makePrizes() })
    return original(url, options)
  })
  await mount('/results')
  for (const label of ['Draw month', 'Select draw month']) {
    const options = [...container.querySelector(`[aria-label="${label}"]`).options].filter(o => o.value)
    expect(options.map(o => o.textContent)).toEqual(['October 2026 · Pending', 'September 2026'])
  }
  expect(container.querySelector('[aria-label="Select draw month"] option[value=""]').textContent).toBe('Draw Month')
  expect(drawMonth('2026-10-31')).toBe('October 2026')
})

test('customer dates exclude future draws and published results older than twelve months', () => {
  const current = { ...state.draw, drawDate: '2026-10-31', isCurrent: true }
  const rows = [current,
    { ...current, drawId: 2, drawDate: '2026-11-30', isCurrent: false, published: false },
    { ...current, drawId: 3, drawDate: '2026-09-30', isCurrent: false, published: true },
    { ...current, drawId: 4, drawDate: '2025-10-31', isCurrent: false, published: true },
    { ...current, drawId: 5, drawDate: '2025-09-30', isCurrent: false, published: true },
  ]
  expect(customerDrawChoices(rows).map(d => d.drawId)).toEqual([1, 3, 4])
})

test('prize displays keep the ZIP wording without added history notices or currency suffix changes', async () => {
  state.draw.published = true; state.prizes = makePrizes()
  await mount('/results')
  expect([...container.querySelectorAll('.winning-card p')].map(p => p.textContent)).toEqual([
    '6,000,000 baht', '200,000 baht', '80,000 baht', '2,000 baht per prize',
  ])
  expect(container.textContent).not.toContain('fictional')
  expect(container.textContent).not.toContain('Past tickets')
  expect(container.textContent).not.toContain('per winning copy')
  await mount('/')
  expect(container.querySelector('.prize p').textContent).toBe('6,000,000 baht prize')
  expect(container.textContent).toContain('Till the next draw!')
  expect(container.querySelector('.demo-history-note')).toBeNull()
})
