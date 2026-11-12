import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, apiGet, apiList, type Pagination } from './api'
import { useAuth } from './auth'
import { Header, Footer, How } from './layout'

export type Draw = {
  drawId: number; drawDate: string; drawAt: string; salesCloseAt: string
  drawStatus: 'Open' | 'Closed'; initializationStatus: string
  published: boolean; isCurrent: boolean; purchasable: boolean; unitPrice: string; serverNow?: string; drawNumber?: number
}
export type List<T> = { items: T[]; meta: Pagination }
export type Prize = { prizeId: number; prizeType: string; prizeAmount: string; winningNumber: string }
export type Results = { drawId: number; status: 'pending' | 'published'; items: Prize[]; publishedAt?: string }
export type Ticket = { ticketId: number; ticketNumber: string; drawId: number; drawDate?: string; paymentId?: number; userId?: number }
export type Payment = { paymentId: number; amount: string; paymentDate?: string; userId?: number }
export type Receipt = Payment & { drawId?: number; drawDate?: string; tickets: { ticketId: number; ticketNumber: string; drawId?: number; drawDate?: string }[] }
export type TicketResult = { status: 'pending' | 'win' | 'loss'; prizeAmount: string | null; prizeType: string | null }
export type CartItem = { cartItemId: number; lotteryNumberId: number; ticketNumber: string; drawId: number; drawDate?: string; quantity: number; availableQuantity: number; available: boolean; unitPrice: string }
export type Cart = { items: CartItem[]; totalCopies: number }

export function customerDrawChoices(items: Draw[]) {
  const reference = items.find(d => d.isCurrent)?.drawDate ?? items.find(d => d.serverNow)?.serverNow?.slice(0, 10)
  const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7))
  return items.filter(d => {
    if (d.isCurrent) return true
    if (!d.published || !reference) return false
    const monthsAgo = monthIndex(reference) - monthIndex(d.drawDate)
    return monthsAgo >= 1 && monthsAgo <= 12
  })
}

export const drawSchedule = 'Last day of each month, 18:00 Thailand time (UTC+7). Sales close at 17:00.'
export const money = (value: string | number) => `฿${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const drawDate = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))
export const drawMonth = (value: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))
export const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) + ' Thailand' : '—'
export function monthEnd() {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Bangkok' }).formatToParts(new Date())
  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value)
  return `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`
}

export function useResource<T>(url: string | null, list = false, interval = 0) {
  const [loadedUrl, setLoadedUrl] = useState(url)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true, sequence = 0
    setLoadedUrl(url); setData(null); setError(null); setLoading(Boolean(url))
    async function load() {
      if (!url) return
      const request = ++sequence
      try {
        const result = list ? await apiList(url) : await apiGet(url)
        if (active && request === sequence) { setData(result as T); setError(null) }
      } catch (failure) { if (active && request === sequence) setError(failure) }
      finally { if (active && request === sequence) setLoading(false) }
    }
    void load()
    const timer = interval && url ? window.setInterval(load, interval) : undefined
    return () => { active = false; if (timer) clearInterval(timer) }
  }, [url, list, interval, version])
  return { data: loadedUrl === url ? data : null, error: loadedUrl === url ? error : null, loading: loadedUrl !== url || loading, reload: () => setVersion(value => value + 1) }
}

export function useAction() {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function run(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setPending(true); setError(null)
    try { await work() } catch (failure) { setError(failure) }
    finally { lock.current = false; setPending(false) }
  }
  return { pending, error, run }
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null
  return <div className="api-message api-message--error" role="alert">
    <p>{error instanceof ApiError ? error.message : 'Could not reach the server. Check the connection and try again.'}</p>
    {retry && <button type="button" onClick={retry}>Try again</button>}
  </div>
}

export function Pager({ meta, onPage, disabled = false }: { meta?: Pagination; onPage: (page: number) => void; disabled?: boolean }) {
  if (!meta) return null
  const last = Math.max(1, Math.ceil(meta.totalItems / meta.pageSize))
  return <nav className="pager" aria-label="Pagination">
    <button type="button" disabled={disabled || meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
    <span>Page {meta.page} of {last} · {meta.totalItems.toLocaleString()} records</span>
    <button type="button" disabled={disabled || meta.page >= last} onClick={() => onPage(meta.page + 1)}>Next</button>
  </nav>
}

export function Page({ children, className = '', how = false }: { children: ReactNode; className?: string; how?: boolean }) {
  const header = className && className !== 'results-page' ? `header buy-header${className === 'cart-page' || className === 'checkout-page' ? ' cart-header' : ''}` : 'header'
  return <div className={`site-shell ${className}`}><Header className={header} /><main>{children}{how && <How />}</main><Footer /></div>
}

export function Access({ role, children }: { role?: 'Customer' | 'Admin' | 'Developer'; children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return <div className="feature-panel" role="status">Checking login…</div>
  if (!auth.user) return <div className="feature-panel"><h2>Sign in to continue.</h2><p>No active login session.</p><a className="button" href="/login">Sign in</a></div>
  if (role && auth.user.role !== role) return <div className="feature-panel"><h2>Access restricted</h2><p>This page requires a {role} account. Signed in as {auth.user.role}.</p><a href="/profile">My account</a></div>
  return <>{children}</>
}

export function countdownParts(drawAt: string, now: number) {
  const end = Date.parse(drawAt);
  if (!Number.isFinite(end)) return null
  const remaining = Math.max(0, end - now)
  return [Math.floor(remaining / 86400000), Math.floor(remaining / 3600000) % 24, Math.floor(remaining / 60000) % 60]
}

export function Countdown({ showBuy = true, arrow = '86be9.svg' }: { showBuy?: boolean; arrow?: string }) {
  const current = useResource<Draw>('/api/draws/current', false, 60000)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const serverTime = current.data?.serverNow ? Date.parse(current.data.serverNow) : NaN
    if (Number.isFinite(serverTime)) setOffset(serverTime - Date.now())
  }, [current.data])
  const values = (current.data ? countdownParts(current.data.drawAt, now + offset) : null) ?? ['—', '—', '—']
  return <section className="countdown" aria-label="Countdown to the draw"><div className={`countdown__inner${showBuy ? '' : ' countdown__inner--compact'}`}>
    <div className="countdown__clock">{['Days', 'Hours', 'Minutes'].map((label, i) => <div className="countdown__unit-wrap" key={label}>{i > 0 && <span className="countdown__colon">:</span>}<div className="countdown__unit"><strong>{values[i]}</strong><small>{label}</small></div></div>)}</div>
    <p>Till the next draw!</p>
    {showBuy && <a className="countdown__link" href="/buy-lottery">Buy now <img src={`/assets/${arrow}`} alt="" /></a>}
  </div>{Boolean(current.error) && <div className="countdown-error"><ErrorNote error={current.error} retry={current.reload} /></div>}</section>
}

export function ResultCards({ result, drawLabel }: { result: Results; drawLabel?: string }) {
  if (result.status !== 'published') return <p className="api-message">Results are pending. Winning numbers will appear after publication.</p>
  return <div className="winning-panel"><h2>{drawLabel ? `Winning Numbers for ${drawLabel} Draw` : "Winning Numbers"}</h2>
    <div className="winning-panel__top-prizes">{result.items.filter(p => p.prizeType !== '4th').map(p => <article className="winning-card" key={p.prizeId}><h3>{p.prizeType} Prize</h3><p>{Number(p.prizeAmount).toLocaleString("en-US")} baht</p><strong>{p.winningNumber}</strong></article>)}</div>
    <article className="winning-card winning-card--fourth"><h3>4th Prize</h3><p>{result.items.find(p => p.prizeType === '4th') ? Number(result.items.find(p => p.prizeType === '4th')!.prizeAmount).toLocaleString('en-US') : '—'} baht per prize</p><div className="fourth-prize-grid">{result.items.filter(p => p.prizeType === '4th').map(p => <span key={p.prizeId}>{p.winningNumber}</span>)}</div></article>
  </div>
}

export function DrawPicker({ value, onChange, preferPublished = false, admin = false }: { value: number | null; onChange: (id: number | null) => void; preferPublished?: boolean; admin?: boolean }) {
  const [page, setPage] = useState(1)
  const [month, setMonth] = useState('')
  const draws = useResource<List<Draw>>(`/api/${admin ? 'admin/' : ''}draws?page=${page}&pageSize=20${month ? `&month=${month}` : ''}`, true)
  const items = admin ? draws.data?.items ?? [] : customerDrawChoices(draws.data?.items ?? [])
  useEffect(() => {
    if (!draws.loading && items.length && !value) onChange((preferPublished ? items.find(d => d.published) : null)?.drawId ?? items[0].drawId)
  }, [draws.data, draws.loading, value, onChange, preferPublished, admin])
  return <div className="month-picker connected-draw-picker">
    <label className="month-picker__label" htmlFor="draw-selection"><img src="/assets/7f5eb.svg" alt="" />Draw Month</label>
    <select id="draw-selection" className="month-picker__trigger" aria-label="Select draw month" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}>
      <option value="" disabled>{draws.loading ? 'Loading draws…' : 'Draw Month'}</option>
      {admin && value && !items.some(d => d.drawId === value) && <option value={value}>Draw #{value}</option>}
      {items.map(d => <option value={d.drawId} key={d.drawId}>{drawMonth(d.drawDate)}{d.published ? '' : ' · Pending'}</option>)}
    </select>
    {admin && <details className="draw-picker-more"><summary>Find another month</summary><label>Filter draw month<input type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); onChange(null) }} /></label><Pager meta={draws.data?.meta} onPage={setPage} /></details>}
    {!draws.loading && draws.data?.items.length === 0 && <p>No draws found for this filter.</p>}
    <ErrorNote error={draws.error} retry={draws.reload} />
  </div>
}

export function ResultStatus({ result }: { result: TicketResult }) {
  return <span className={`ticket-status ticket-status--${result.status}`}>{result.status === 'pending' ? 'Pending publication' : result.status === 'win' ? `Win · ${result.prizeType} Prize · ${money(result.prizeAmount!)}` : 'No prize'}</span>
}
