import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, apiGet, apiList, apiPost, apiPatch, apiDelete } from './api'
import { useAuth } from './auth'
import {
  Access, Page, Countdown, DrawPicker, ResultCards, ResultStatus, ErrorNote, Pager,
  useResource, useAction, money, drawDate, drawMonth, dateTime, drawSchedule, customerDrawChoices,
  type Draw, type List, type Results, type Ticket, type TicketResult, type Payment,
  type Receipt, type Cart,
} from './lottery-shared'

export function HomePage() {
  return <Page how>
    <section className="hero"><div className="hero__inner"><div className="hero__copy"><h1>Could you be our <span>next winner?</span></h1><Link className="button" to="/buy-lottery">Buy now</Link></div><div className="hero__visual" aria-hidden="true"><img className="hero__ellipse" src="/assets/3ebc8.svg" alt="" /><img className="hero__art" src="/assets/6d2d0.png" alt="" /></div></div></section>
    <Countdown /><ResultsBrowser home />
  </Page>
}

export function ResultsPage() {
  return <Page className="results-page" how><ResultsBrowser /></Page>
}

function ResultsBrowser({ home = false }: { home?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [number, setNumber] = useState('')
  const choices = useResource<List<Draw>>('/api/draws?page=1&pageSize=20', true)
  const allowedDraws = customerDrawChoices(choices.data?.items ?? [])
  const [checked, setChecked] = useState<TicketResult & { drawId: number; ticketNumber: string } | null>(null)
  const draw = useResource<Draw>(selected ? '/api/draws/' + selected : null)
  const result = useResource<Results>(selected ? '/api/draws/' + selected + '/results' : null, false, 15000)
  const action = useAction()
  useEffect(() => { setChecked(null) }, [selected, result.data?.status])
  async function check(event: FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(number)) return
    setChecked(null)
    await action.run(async () => {
      if (!selected) throw new ApiError('Select a published draw first.', 400, 'VALIDATION_ERROR')
      setChecked(await apiGet('/api/draws/' + selected + '/check?ticketNumber=' + number))
    })
  }
  const lookup = <form className={'lookup-form' + (home ? '' : ' lookup-form--compact')} onSubmit={check} aria-busy={action.pending}>
    <label><span>Enter Your Number</span><input aria-label="Lottery Number" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="Lottery Number" value={number} onChange={e => { setNumber(e.target.value.replace(/\D/g, '')); setChecked(null) }} required /></label>
    <label><span>Draw Month</span><span className="date-field"><select aria-label="Draw month" value={selected ?? ""} onChange={e => { setSelected(Number(e.target.value)); setChecked(null) }} required><option value="" disabled>Draw Month</option>{allowedDraws.map(d => <option key={d.drawId} value={d.drawId}>{drawMonth(d.drawDate)}{d.published ? "" : " · Pending"}</option>)}</select></span></label>
    <div className="lookup-form__action"><button className="button" type="submit" disabled={action.pending || !selected || number.length !== 6}>{action.pending ? 'Checking…' : 'Check Lottery'}</button></div>
    <div className="lookup-message" aria-live="polite"><ErrorNote error={action.error} />{checked && checked.drawId === selected && checked.ticketNumber === number && <span>{checked.ticketNumber}: <ResultStatus result={checked} /></span>}</div>
  </form>
  const picker = <DrawPicker value={selected} onChange={id => { setSelected(id); setChecked(null) }} preferPublished />
  if (home) return <section className="results" id="results">
    <div className="section-heading"><h2>Latest Draw Results</h2><p>{draw.data ? 'Draw Month: ' + drawMonth(draw.data.drawDate) : drawSchedule}</p></div>
    {lookup}
    <div className="home-draw-selection" hidden>{picker}</div>
    <ErrorNote error={draw.error || result.error} retry={result.reload} />
    {result.loading && <p role="status">Loading results…</p>}
    {result.data?.status === 'pending' && <p className="draw-status-message">Results are pending. Winning numbers will appear after publication.</p>}
    {result.data?.status === 'published' && <><div className="prizes">{result.data.items.filter(p => p.prizeType !== '4th').map((prize, index) => <article className="prize" key={prize.prizeId}>{index > 0 && <img className="prize__divider" src="/assets/df010.svg" alt="" />}<strong>{prize.winningNumber}</strong><h3>{prize.prizeType} Prize</h3><p>{Number(prize.prizeAmount).toLocaleString("en-US")} baht prize</p></article>)}</div></>}
    <Link className="button" to="/results">See more</Link>
  </section>
  return <>
    <section className="results-hero"><div className="results-hero__inner"><h1>Lottery Results</h1><h2>Check Yours Now!</h2>{lookup}<div className="results-hero__visual" aria-hidden="true"><img className="results-hero__ellipse" src="/assets/3ebc8.svg" alt="" /><div className="results-hero__artwork"><img className="results-hero__person" src="/assets/6d2d0.png" alt="" /><img className="results-hero__trophy" src="/assets/6567c.png" alt="" /></div></div></div></section>
    <Countdown /><section className="draw-results" id="results"><div className="draw-results__top"><div className="section-heading"><h2>Draw Results</h2><p>{draw.data ? 'Draw Month: ' + drawMonth(draw.data.drawDate) : drawSchedule}</p></div>{picker}</div><ErrorNote error={draw.error || result.error} retry={result.reload} />{result.loading && <p role="status">Loading results…</p>}{result.data && <><ResultCards result={result.data} drawLabel={draw.data ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(draw.data.drawDate + "T00:00:00Z")) : undefined} /></>}</section>
  </>
}

export function ProfilePage() {
  const auth = useAuth()
  return <Page className="profile-page" how><section className="cart-history"><div className="section-heading"><h2>Your Profile</h2><p>Ticket Winnings &amp; Account Details</p></div><div className="cart-history__panel profile-container"><Access>
    <div className="feature-panel"><h2>Signed in as {auth.user?.name || 'Customer'}</h2><p>Account role: {auth.user?.role}</p></div>
    {auth.user?.role === 'Customer' ? <CustomerProfile /> : <div className="feature-panel feature-toolbar">{auth.user?.role === 'Admin' && <Link className="button" to="/admin">Open Admin dashboard</Link>}<Link to="/results">View public results</Link></div>}
  </Access></div></section></Page>
}

type Profile = { userId: number; name: string; phone: string; email: string }
function CustomerProfile() {
  const auth = useAuth()
  const profile = useResource<Profile>('/api/me/profile')
  const winnings = useResource<{ totalWinnings: string; winningCopies: number }>('/api/me/winnings')
  const [saved, setSaved] = useState(false)
  const action = useAction()
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setSaved(false)
    await action.run(async () => {
      await apiPatch('/api/me/profile', { name: String(fields.get('name')).trim(), phone: String(fields.get('phone')).trim() })
      setSaved(true); profile.reload(); await auth.refresh()
    })
  }
  return <>

    <section className="feature-panel"><h2>Your Ticket Winnings</h2>{winnings.loading && <p>Loading winnings…</p>}<ErrorNote error={winnings.error} retry={winnings.reload} />{winnings.data && <p>{money(winnings.data.totalWinnings)} from {winnings.data.winningCopies} winning ticket copies. Pending results are not included.</p>}<Link className="button" to="/cart">My Tickets and receipts</Link>{winnings.data?.winningCopies === 0 && <div className="winnings-empty"><h3>No published winnings yet.</h3><p>Pending ticket results are excluded until the draw is published.</p><Link className="button" to="/buy-lottery">Buy Lottery Tickets</Link></div>}</section>
    <ErrorNote error={profile.error} retry={profile.reload} />
    {profile.loading && <p role="status">Loading profile…</p>}
    {profile.data && <form className="feature-panel feature-form" onSubmit={save} aria-busy={action.pending} key={`${profile.data.name}:${profile.data.phone}`}>
      <h2>Account details</h2>
      <label>Name<input name="name" defaultValue={profile.data.name ?? ''} maxLength={100} required disabled={action.pending} /></label>
      <label>Phone<input name="phone" type="tel" defaultValue={profile.data.phone ?? ''} maxLength={20} required disabled={action.pending} /></label>
      <label>Email<input type="email" value={profile.data.email} readOnly /></label>
      <button className="button" type="submit" disabled={action.pending}>{action.pending ? 'Saving…' : 'Save profile'}</button>
    </form>}
    <ErrorNote error={action.error} />{saved && <p className="api-message" role="status">Profile saved.</p>}

  </>
}

type NumberRow = { lotteryNumberId: number; ticketNumber: string; availableQuantity: number }
type Numbers = List<NumberRow> & { drawId: number; purchasable: boolean }
export function BuyLotteryPage() {
  return <Page className="buy-page" how><section className="buy-hero"><div className="hero__inner"><h1>Get a chance to win 6 Million Bahts!</h1><div className="hero__visual" aria-hidden="true"><img className="hero__ellipse" src="/assets/3ebc8.svg" alt="" /><img className="hero__art" src="/assets/6d2d0.png" alt="" /></div></div></section><Countdown /><section className="buy-tickets"><div className="section-heading"><h2>Buy Tickets</h2><p>{drawSchedule}</p></div><NumberBrowser /></section></Page>
}

function NumberBrowser() {
  const auth = useAuth()
  const navigate = useNavigate()
  const current = useResource<Draw>('/api/draws/current', false, 60000)
  const [quickNumbers, setQuickNumbers] = useState(() => randomNumber().split(''))
  const [customNumbers, setCustomNumbers] = useState(['', '', '', '', '', ''])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [message, setMessage] = useState('')
  const numbers = useResource<Numbers>(current.data ? `/api/draws/${current.data.drawId}/numbers?page=${page}&pageSize=20${search ? `&ticketNumber=${search}` : ''}` : null, true)
  const action = useAction()
  const [loginRequired, setLoginRequired] = useState(false)
  function requireCustomer() {
    if (!auth.user) {
      setMessage('Please sign in to add tickets to your cart.'); setLoginRequired(true)
      return false
    }
    setLoginRequired(false)
    return auth.user.role === 'Customer'
  }
  async function buyTicket(kind: 'quick' | 'custom') {
    if (!requireCustomer()) return
    const ticketNumber = (kind === 'quick' ? quickNumbers : customNumbers).join('')
    if (!/^\d{6}$/.test(ticketNumber)) { setMessage('Choose all six digits before buying a ticket.'); return }
    setMessage('')
    await action.run(async () => {
      if (!current.data) throw new ApiError('The current draw is unavailable.', 409, 'DRAW_NOT_FOUND')
      const stock = await apiGet<{ purchasable: boolean; items: NumberRow[] }>(`/api/draws/${current.data!.drawId}/numbers?ticketNumber=${ticketNumber}`)
      if (!stock.purchasable) throw new ApiError('Sales are closed for this draw.', 409, 'DRAW_CLOSED')
      if (!stock.items.length || stock.items[0].availableQuantity < 1) {
        throw new ApiError('This number is sold out. Choose another number.', 409, 'INSUFFICIENT_STOCK')
      }
      await apiPost('/api/me/cart', { lotteryNumberId: stock.items[0].lotteryNumberId, quantity: 1 })
      navigate('/checkout')
    })
  }
  function find(event: FormEvent) { event.preventDefault(); if (input && !/^\d{6}$/.test(input)) return; setPage(1); setSearch(input); numbers.reload() }
  function quickPick() {
    const limit = Math.floor(0x100000000 / 1000000) * 1000000
    let value: number
    do { value = crypto.getRandomValues(new Uint32Array(1))[0] } while (value >= limit)
    const number = String(value % 1000000).padStart(6, '0')
    setInput(number); setSearch(number); setPage(1); setMessage(''); setLoginRequired(false); numbers.reload()
  }
  async function add(item: NumberRow) {
    if (!requireCustomer()) return
    setMessage('')
    await action.run(async () => {
      if (!current.data?.purchasable || !numbers.data?.purchasable) throw new ApiError('Sales are closed for this draw.', 409, 'DRAW_CLOSED')
      await apiPost('/api/me/cart', { lotteryNumberId: item.lotteryNumberId, quantity: quantities[item.lotteryNumberId] ?? 1 })
    })
  }
  const purchaseDisabled = action.pending || auth.loading || Boolean(auth.user && auth.user.role !== 'Customer')
  return <div className="buy-tickets__panel restored-buy-panel">
    <div className="pick-methods"><article className="pick-method"><span className="pick-method__shuffle" aria-hidden="true">⇄</span><h3>Quick Pick</h3><p>Generate a random six-digit number for your ticket.</p></article><article className="pick-method"><img src="/assets/79c26.svg" alt="" /><h3>Choose your own number</h3><p>Pick six digits from 0 to 9. Keep your lucky numbers together.</p></article></div>
    <div className="ticket-options">
      <article className="ticket-card"><div className="ticket-card__heading"><h3>Buy a ticket</h3><p>{current.data ? drawDate(current.data.drawDate) + ' draw' : 'Monthly draw'} · closes 17:00 Thailand · {current.data ? money(current.data.unitPrice) : '฿100.00'} per copy</p></div><div className="ticket-tabs"><span className="ticket-tabs__active">Quick pick</span><span>Choose my own</span></div><div className="quick-pick"><div className="quick-pick__numbers">{quickNumbers.map((digit, i) => <span key={i}>{digit}</span>)}</div><div className="ticket-selection-meta"><span>Randomly generated for you</span><button type="button" disabled={action.pending} onClick={() => setQuickNumbers(randomNumber().split(''))}>Randomize again</button></div></div><div className="ticket-card__total"><div><small>Total</small><strong>{current.data ? money(current.data.unitPrice) : '฿100.00'}</strong></div><button type="button" aria-label="Buy quick pick ticket" disabled={purchaseDisabled} onClick={() => buyTicket('quick')}>Buy ticket</button></div></article>
      <article className="ticket-card"><div className="ticket-card__heading"><h3>Buy a ticket</h3><p>{current.data ? drawDate(current.data.drawDate) + ' draw' : 'Monthly draw'} · closes 17:00 Thailand · {current.data ? money(current.data.unitPrice) : '฿100.00'} per copy</p></div><div className="ticket-tabs"><span>Quick pick</span><span className="ticket-tabs__active">Choose my own</span></div><div className="custom-pick"><div className="custom-pick__inputs">{customNumbers.map((digit, i) => <span className="custom-pick__input-wrap" key={i}>{i > 0 && <i>-</i>}<input aria-label={`Lottery digit ${i + 1}`} inputMode="numeric" maxLength={1} value={digit} disabled={action.pending} onChange={e => setCustomNumbers(previous => previous.map((v, index) => index === i ? e.target.value.replace(/\D/g, '').slice(-1) : v))} /></span>)}</div><div className="ticket-selection-meta"><span>{customNumbers.filter(Boolean).length} of 6 chosen</span><button type="button" disabled={action.pending} onClick={() => { setCustomNumbers(['', '', '', '', '', '']); setMessage(''); setLoginRequired(false) }}>Clear</button></div></div><div className="ticket-card__total"><div><small>Total</small><strong>{current.data ? money(current.data.unitPrice) : '฿100.00'}</strong></div><button type="button" aria-label="Buy chosen ticket" disabled={purchaseDisabled || customNumbers.some(d => !d)} onClick={() => buyTicket('custom')}>Buy ticket</button></div></article>
    </div>
    <div className="number-browser-section">
    <p className="ticket-message" aria-live="polite">{message} {loginRequired && <Link to="/login">Sign in</Link>}</p>
    <ErrorNote error={action.error} />
    {current.loading && <p>Loading current draw…</p>}
    <ErrorNote error={current.error} retry={current.reload} />
    <details className="number-browser-extra"><summary>Available numbers</summary>
    <form className="feature-toolbar" onSubmit={find}><label>Six-digit number<input aria-label="Search lottery number" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={input} onChange={e => setInput(e.target.value.replace(/\D/g, ''))} /></label><button className="button" type="submit" disabled={!current.data || numbers.loading}>Search</button><button type="button" onClick={quickPick} disabled={!current.data || numbers.loading}>Quick Pick</button><button type="button" onClick={() => { setInput(''); setSearch(''); setPage(1); numbers.reload() }}>Show all numbers</button></form>
    <ErrorNote error={numbers.error} retry={numbers.reload} />
    <div className="feature-panel">{numbers.loading && <p role="status">Loading number availability…</p>}
      {numbers.data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Number</th><th>Available copies</th><th>Copies to buy</th><th>Selection</th></tr></thead><tbody>{numbers.data.items.map(item => <tr key={item.lotteryNumberId}><td><strong className="lottery-number">{item.ticketNumber}</strong></td><td>{item.availableQuantity}</td><td><select aria-label={`Copies of ${item.ticketNumber}`} value={quantities[item.lotteryNumberId] ?? 1} onChange={e => setQuantities(q => ({ ...q, [item.lotteryNumberId]: Number(e.target.value) }))} disabled={action.pending || item.availableQuantity === 0}>{Array.from({ length: Math.max(1, item.availableQuantity) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></td><td><button type="button" onClick={() => add(item)} disabled={purchaseDisabled || item.availableQuantity < (quantities[item.lotteryNumberId] ?? 1)}>{item.availableQuantity === 0 ? 'Sold out' : 'Add to cart'}</button></td></tr>)}</tbody></table></div>{numbers.data.items.length === 0 && <p>No numbers found. The draw may still need initialization.</p>}<Pager meta={numbers.data.meta} onPage={setPage} disabled={action.pending} /></>}
    </div>
    </details>
    </div>
  </div>
}

function randomNumber() {
  const limit = Math.floor(0x100000000 / 1000000) * 1000000
  let value: number
  do { value = crypto.getRandomValues(new Uint32Array(1))[0] } while (value >= limit)
  return String(value % 1000000).padStart(6, '0')
}

export function CheckoutPage() {
  return <Page className="checkout-page" how><Countdown showBuy={false} /><section className="checkout-cart"><div className="section-heading"><h2>Your Cart</h2><p>Saved selections · stock is not reserved</p></div><div className="checkout-cart__panel"><Access role="Customer"><CustomerCheckout /></Access></div></section></Page>
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  const date = receipt.drawDate ?? receipt.tickets[0]?.drawDate
  return <section className="feature-panel receipt" aria-label="Payment receipt"><h2>Receipt #{receipt.paymentId}</h2><p>{money(receipt.amount)} · {receipt.tickets.length} {receipt.tickets.length === 1 ? 'ticket copy' : 'ticket copies'} · Draw: {date ? drawMonth(date) : '—'}</p>{receipt.paymentDate && <p>{dateTime(receipt.paymentDate)}</p>}<ul>{receipt.tickets.map(ticket => <li key={ticket.ticketId}>Ticket #{ticket.ticketId} · <strong className="lottery-number">{ticket.ticketNumber}</strong></li>)}</ul></section>
}

function CustomerCheckout() {
  const cart = useResource<Cart>('/api/me/cart')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [history, setHistory] = useState<List<Payment> | null>(null)
  const [receiptError, setReceiptError] = useState<unknown>(null)
  const action = useAction()
  const [message, setMessage] = useState('')
  async function edit(id: number, quantity: number | null) {
    await action.run(async () => {
      if (quantity === null) await apiDelete(`/api/me/cart/${id}`)
      else await apiPatch(`/api/me/cart/${id}`, { quantity })
      setMessage(''); cart.reload()
    })
  }
  async function pay() {
    if (!cart.data?.items.length || uncertain) return
    const selected = cart.data
    setMessage(''); setReceipt(null)
    await action.run(async () => {
      try {
        const result = await apiPost<Receipt>('/api/checkout', { drawId: selected.items[0].drawId, items: selected.items.map(item => ({ lotteryNumberId: item.lotteryNumberId, quantity: item.quantity })) })
        if (result.status !== 201 || !result.data?.paymentId || !Array.isArray(result.data.tickets)) throw new Error('Payment could not be confirmed.')
        setReceipt({ ...result.data, drawDate: result.data.drawDate ?? selected.items[0].drawDate }); setMessage('Purchase complete. Your tickets are saved.'); cart.reload()
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.status >= 500) { setUncertain(true); setHistory(null); setReviewed(false) }
        cart.reload()
        throw failure
      }
    })
  }
  async function review() {
    await action.run(async () => { setHistory(await apiList<Payment>('/api/me/payments?page=1&pageSize=20')); setReviewed(true) })
  }
  async function viewReceipt(paymentId: number) {
    setReceiptError(null)
    try { setReceipt(await apiGet(`/api/me/payments/${paymentId}`)) } catch (error) { setReceiptError(error) }
  }
  const data = cart.data
  const total = data?.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0) ?? 0
  const canPay = Boolean(data?.items.length && data.totalCopies <= 100 && data.items.every(item => item.available && item.drawId === data.items[0].drawId))
  return <>
    <ErrorNote error={cart.error} retry={cart.reload} /><ErrorNote error={action.error} />
    {message && <p className="api-message" role="status">{message}</p>}
    {cart.loading && <p role="status">Loading saved selections…</p>}
    {data && <div className="checkout-grid"><div className="checkout-items">
      {data.items.length === 0 ? <p>Your cart is empty. <Link to="/buy-lottery">Choose lottery numbers</Link></p> : data.items.map(item => <article className="checkout-item" key={item.cartItemId}>
        <div className="checkout-item__image"><img src="/assets/checkout-6305f.png" alt="Lottery ticket" /></div>
        <div className="checkout-item__details"><div><h3 className="lottery-number">{item.ticketNumber}</h3><p>Draw: {item.drawDate ? drawMonth(item.drawDate) : '—'}</p></div><strong>{money(Number(item.unitPrice) * item.quantity)}</strong><small>{item.available ? item.availableQuantity + " copies available" : "Unavailable: sales closed or insufficient stock."}</small></div>
        <div className="checkout-item__actions"><button className="checkout-item__remove" type="button" aria-label={`Remove ${item.ticketNumber}`} disabled={action.pending} onClick={() => edit(item.cartItemId, null)}><img src="/assets/checkout-d8a74.svg" alt="" /></button><div className="quantity-control"><button type="button" aria-label={`Decrease ${item.ticketNumber} quantity`} disabled={action.pending || item.quantity <= 1} onClick={() => edit(item.cartItemId, item.quantity - 1)}><img src="/assets/checkout-af48a.svg" alt="" /></button><span>{item.quantity}</span><button type="button" aria-label={`Increase ${item.ticketNumber} quantity`} disabled={action.pending || item.quantity >= Math.min(5, item.availableQuantity) || data.totalCopies >= 100 || !item.available} onClick={() => edit(item.cartItemId, item.quantity + 1)}><img src="/assets/checkout-acf6e.svg" alt="" /></button></div></div>
      </article>)}
    </div><aside className="order-summary"><h2>Order Summary</h2><div className="order-summary__rows"><p><span>Subtotal</span><strong>{money(total)}</strong></p><img src="/assets/checkout-c34bd.svg" alt="" /><p className="order-summary__total"><span>Total</span><strong>{money(total)}</strong></p></div><button className="checkout-submit" type="button" disabled={action.pending || cart.loading || Boolean(cart.error) || !canPay || uncertain} onClick={pay}>{action.pending ? 'Please wait…' : `Pay ${money(total)}`}</button><Link to="/buy-lottery">Add more numbers</Link><button type="button" disabled={action.pending} onClick={cart.reload}>Refresh availability</button></aside></div>}
    {uncertain && <section className="feature-panel" role="status"><h2>Check your receipts before paying again</h2><p>The payment response was interrupted. The purchase may have succeeded. Payment stays disabled while the outcome is uncertain.</p><button type="button" disabled={action.pending} onClick={review}>Review recent receipts</button>{history && <><ul>{history.items.map(p => <li key={p.paymentId}><button type="button" onClick={() => viewReceipt(p.paymentId)}>Receipt #{p.paymentId}: {money(p.amount)} · {dateTime(p.paymentDate)}</button></li>)}</ul>{history.items.length === 0 && <p>No receipts found.</p>}</>}{reviewed && <button type="button" disabled={action.pending} onClick={() => { setUncertain(false); setReviewed(false); cart.reload() }}>I reviewed my receipts; reload cart</button>}</section>}
    <ErrorNote error={receiptError} />{receipt && <ReceiptDetails receipt={receipt} />}
  </>
}

export function CartPage() {
  return <Page className="cart-page" how><Countdown showBuy={false} /><section className="cart-history"><div className="section-heading"><h2>My Tickets</h2><p>Results &amp; History</p></div><div className="cart-history__panel"><Access role="Customer"><CustomerHistory /></Access></div></section></Page>
}

function CustomerHistory() {
  const [tab, setTab] = useState<'tickets' | 'payments'>('tickets')
  const [page, setPage] = useState(1)
  const history = useResource<List<Ticket | Payment>>(`/api/me/${tab}?page=${page}&pageSize=20`, true)
  const winnings = useResource<{ totalWinnings: string; winningCopies: number }>('/api/me/winnings')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [result, setResult] = useState<(TicketResult & { ticketId: number }) | null>(null)
  const [closedMonths, setClosedMonths] = useState<Set<string>>(new Set())
  const groups: Record<string, Ticket[]> = {}
  for (const item of history.data?.items ?? []) {
    if ("ticketId" in item) { const month = item.drawDate?.slice(0, 7) ?? "Draw #" + item.drawId; (groups[month] ??= []).push(item) }
  }
  const action = useAction()
  return <>
    <section className="feature-panel"><h2>My winnings</h2><ErrorNote error={winnings.error} retry={winnings.reload} />{winnings.data && <p>{money(winnings.data.totalWinnings)} · {winnings.data.winningCopies} winning copies. Pending results are excluded.</p>}<Link to="/checkout">Open saved cart</Link></section>
    <div className="feature-toolbar" role="group" aria-label="History type"><button type="button" aria-pressed={tab === 'tickets'} onClick={() => { setTab('tickets'); setPage(1); setResult(null) }}>Tickets</button><button type="button" aria-pressed={tab === 'payments'} onClick={() => { setTab('payments'); setPage(1); setResult(null) }}>Receipts</button><button type="button" onClick={() => { history.reload(); winnings.reload() }}>Refresh history</button></div>
    <ErrorNote error={history.error} retry={history.reload} /><ErrorNote error={action.error} />
    {history.loading && <p role="status">Loading purchase history…</p>}
    {history.data && <>
      {tab === 'tickets' ? <div className="cart-accordion">{Object.entries(groups).map(([month, tickets]) => {
        const open = !closedMonths.has(month)
        const title = /^\d{4}-\d{2}$/.test(month) ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(month + '-01T00:00:00Z')) : month
        return <section className="cart-month" key={month}>
          <button className="cart-month__toggle" type="button" aria-expanded={open} onClick={() => setClosedMonths(previous => { const next = new Set(previous); if (next.has(month)) next.delete(month); else next.add(month); return next })}><span>Draw Month: {title}</span><img src={open ? '/assets/cart-169c7.svg' : '/assets/cart-02071.svg'} alt="" /></button>
          {open && <div className="cart-month__content"><div className="cart-month__tickets">{tickets.map(item => <article className="cart-ticket" key={item.ticketId}>
            <div><h3>{item.ticketNumber}</h3><p>Ticket #{item.ticketId} · Receipt #{item.paymentId} · Draw {item.drawDate ? drawDate(item.drawDate) : '#' + item.drawId}</p></div>
            <img className="cart-ticket__divider" src="/assets/cart-e0c8e.svg" alt="" />
            <button className="cart-ticket__status" type="button" disabled={action.pending} onClick={() => action.run(async () => setResult({ ...await apiGet<TicketResult>('/api/me/tickets/' + item.ticketId + '/result'), ticketId: item.ticketId }))}>Check ticket #{item.ticketId}</button>
          </article>)}</div></div>}
          <img className="cart-month__line" src="/assets/cart-3ffd1.svg" alt="" />
        </section>
      })}</div> : <div className="cart-month__tickets">{history.data.items.filter((item): item is Payment => !('ticketId' in item)).map(item => <article className="cart-ticket receipt-ticket" key={item.paymentId}><div><h3>Receipt #{item.paymentId}</h3><p>{money(item.amount)} · {dateTime(item.paymentDate)}</p></div><img className="cart-ticket__divider" src="/assets/cart-e0c8e.svg" alt="" /><button className="cart-ticket__status" type="button" disabled={action.pending} onClick={() => action.run(async () => setReceipt(await apiGet('/api/me/payments/' + item.paymentId)))}>View receipt #{item.paymentId}</button></article>)}</div>}
      {history.data.items.length === 0 && <p className="history-empty">No purchases yet. <Link to="/buy-lottery">Buy tickets</Link></p>}
      <Pager meta={history.data.meta} onPage={setPage} disabled={action.pending} />
    </>}
    {result && <p className="api-message" role="status">Ticket #{result.ticketId}: <ResultStatus result={result} /></p>}{receipt && <ReceiptDetails receipt={receipt} />}
  </>
}
