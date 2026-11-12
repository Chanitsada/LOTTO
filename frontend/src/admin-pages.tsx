import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiPost } from './api'
import {
  Access, Page, ErrorNote, Pager, DrawPicker, useResource, useAction,
  money, drawDate, dateTime, drawSchedule,
  type Draw, type List, type Results, type Ticket, type Payment,
} from './lottery-shared'

type Summary = { totalUsers: number; totalTicketsSold: number; totalSales: string }
type Customer = { userId: number; name: string; phone: string; email: string; accountStatus: string }
type Winner = { ticketId: number; userId: number; name: string; ticketNumber: string; prizeType: string; prizeAmount: string }

export function AdminDashboardPage() {
  return <Page className="admin-page"><section className="admin-heading"><h1>Dashboard</h1><p>Welcome, admin!</p></section><Access role="Admin"><Dashboard /></Access></Page>
}

function Dashboard() {
  const [version, setVersion] = useState(0)
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)
  const draws = useResource<List<Draw>>(`/api/admin/draws?page=${page}&pageSize=20`, true, 30000)
  const summary = useResource<Summary>('/api/admin/dashboard', false, 30000)
  const action = useAction()
  async function close(draw: Draw) {
    setMessage('')
    await action.run(async () => {
      await apiPost(`/api/admin/draws/${draw.drawId}/close`, {})
      setMessage(`Draw #${draw.drawId}: sales closed.`)
      setConfirm(null); draws.reload(); summary.reload(); setVersion(v => v + 1)
    })
  }
  return <section className="admin-content">
    <AdminMetrics summary={summary.data} />
    <ErrorNote error={summary.error} retry={summary.reload} />
    <section className="manage-draws restored-manage"><div className="manage-draws__heading"><div><h2>Manage Draws</h2><p>Draw details</p></div></div>
      <ErrorNote error={action.error} />{message && <p className="api-message" role="status">{message}</p>}{action.pending && <p role="status">Processing…</p>}
      <ErrorNote error={draws.error} retry={draws.reload} />{draws.loading && <p>Loading draws…</p>}
      {draws.data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Draw</th><th>Closes</th><th>Tickets Sold</th><th>Status</th><th>Action</th></tr></thead><tbody>{draws.data.items.map((d, index) => {
        const status = d.published ? 'completed' : d.drawStatus === 'Open' ? 'pending' : 'closed'
        return <tr key={d.drawId}><td>{d.drawNumber ?? draws.data!.meta.totalItems - (page - 1) * 20 - index}</td><td>{drawDate(d.drawDate)}</td><td><DrawSold drawId={d.drawId} /></td><td className={'admin-status admin-status--' + status}>{status}</td><td>
          {d.drawStatus === 'Open' && !d.published ? <button className="admin-action admin-action--close" type="button" aria-label={`Close draw #${d.drawId}`} disabled={action.pending} onClick={() => setConfirm(d.drawId)}>Close Draw</button>
            : <Link className={'admin-action' + (d.published ? '' : ' admin-action--run-ready')} to={`/admin/draw?drawId=${d.drawId}`}>{d.published ? 'Results' : 'Run Draw'}</Link>}
          {confirm === d.drawId && <div className="api-message"><p>Close this draw now?</p><button type="button" disabled={action.pending} onClick={() => close(d)}>Confirm close</button><button type="button" disabled={action.pending} onClick={() => setConfirm(null)}>Cancel</button></div>}
        </td></tr>
      })}</tbody></table></div>{draws.data.items.length === 0 && <p>No draws created yet.</p>}<Pager meta={draws.data.meta} onPage={setPage} disabled={action.pending} /></>}

    </section>
    <details className="manage-draws admin-extra"><summary>Customer accounts</summary><CustomerManagement /></details>
    <details className="manage-draws admin-extra"><summary>Purchase reports</summary><PurchaseReports key={version} /></details>
  </section>
}

function CustomerManagement() {
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<Customer | null>(null)
  const [message, setMessage] = useState('')
  const customers = useResource<List<Customer>>(`/api/admin/customers?page=${page}&pageSize=20`, true)
  const action = useAction()
  async function deactivate(customer: Customer) {
    await action.run(async () => {
      await apiPost(`/api/admin/customers/${customer.userId}/deactivate`, {})
      setConfirm(null); setMessage(`Customer #${customer.userId} deactivated. Their tickets and payments are retained.`); customers.reload()
    })
  }
  return <section className="feature-panel"><h2>Customer accounts</h2><ErrorNote error={customers.error} retry={customers.reload} /><ErrorNote error={action.error} />{customers.loading && <p>Loading Customers…</p>}{message && <p className="api-message" role="status">{message}</p>}
    {customers.data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead><tbody>{customers.data.items.map(c => <tr key={c.userId}><td>#{c.userId} · {c.name}</td><td>{c.email}</td><td>{c.phone}</td><td>{c.accountStatus}</td><td><button type="button" disabled={action.pending || c.accountStatus !== 'Active'} onClick={() => setConfirm(c)}>Deactivate customer #{c.userId}</button></td></tr>)}</tbody></table></div>{customers.data.items.length === 0 && <p>No Customers found.</p>}<Pager meta={customers.data.meta} onPage={setPage} disabled={action.pending} /></>}
    {confirm && <div className="api-message" role="group" aria-label="Confirm account deactivation"><p>Deactivate {confirm.name || confirm.email} (#{confirm.userId})? This blocks login and existing sessions. Purchases remain saved. There is no reactivation button.</p><button type="button" disabled={action.pending} onClick={() => deactivate(confirm)}>Confirm deactivation</button><button type="button" disabled={action.pending} onClick={() => setConfirm(null)}>Cancel</button></div>}
  </section>
}

function PurchaseReports() {
  const [type, setType] = useState<'tickets' | 'payments'>('tickets')
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState({ drawId: '', customerId: '' })
  const [query, setQuery] = useState('')
  const reports = useResource<List<Ticket | Payment>>(`/api/admin/${type}?page=${page}&pageSize=20${query}`, true)
  const summary = useResource<Summary>(`/api/admin/dashboard${query.includes('drawId=') ? `?drawId=${new URLSearchParams(query.slice(1)).get('drawId')}` : ''}`)
  function apply(event: FormEvent) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (filter.drawId) params.set('drawId', filter.drawId)
    if (filter.customerId) params.set('customerId', filter.customerId)
    setQuery(params.size ? `&${params}` : ''); setPage(1); reports.reload(); summary.reload()
  }
  return <section className="feature-panel"><h2>Purchase reports</h2>
    <form className="feature-toolbar" onSubmit={apply}><label>Draw ID<input type="number" min="1" max="2147483647" step="1" value={filter.drawId} onChange={e => setFilter(f => ({ ...f, drawId: e.target.value }))} /></label><label>Customer ID<input type="number" min="1" max="2147483647" step="1" value={filter.customerId} onChange={e => setFilter(f => ({ ...f, customerId: e.target.value }))} /></label><button type="submit">Apply report filters</button></form>
    {summary.data && <p>Draw totals: {summary.data.totalTicketsSold} copies sold · {money(summary.data.totalSales)}. Customer ID filters the rows below; these totals cover the selected draw.</p>}<ErrorNote error={summary.error} retry={summary.reload} />
    <div className="feature-toolbar"><button type="button" aria-pressed={type === 'tickets'} onClick={() => { setType('tickets'); setPage(1) }}>Ticket report</button><button type="button" aria-pressed={type === 'payments'} onClick={() => { setType('payments'); setPage(1) }}>Payment report</button></div>
    <ErrorNote error={reports.error} retry={reports.reload} />{reports.loading && <p>Loading report…</p>}
    {reports.data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Record</th><th>Customer</th><th>{type === 'tickets' ? 'Number' : 'Amount'}</th><th>{type === 'tickets' ? 'Draw' : 'Payment date'}</th></tr></thead><tbody>{reports.data.items.map(item => 'ticketId' in item ? <tr key={item.ticketId}><td>Ticket #{item.ticketId}</td><td>#{item.userId}</td><td className="lottery-number">{item.ticketNumber}</td><td>{item.drawDate ? drawDate(item.drawDate) : `#${item.drawId}`}</td></tr> : <tr key={item.paymentId}><td>Payment #{item.paymentId}</td><td>#{item.userId}</td><td>{money(item.amount)}</td><td>{dateTime(item.paymentDate)}</td></tr>)}</tbody></table></div>{reports.data.items.length === 0 && <p>No purchases match these filters.</p>}<Pager meta={reports.data.meta} onPage={setPage} /></>}
  </section>
}

export function AdminDrawPage() {
  return <Page className="admin-draw-page"><section className="admin-heading"><h1>Ticket Draws</h1><p>{drawSchedule}</p></section><Access role="Admin"><DrawManagement /></Access></Page>
}

function DrawManagement() {
  const requested = Number(new URLSearchParams(window.location.search).get('drawId'))
  const [selected, setSelected] = useState<number | null>(Number.isInteger(requested) && requested > 0 && requested <= 2147483647 ? requested : null)
  const [message, setMessage] = useState('')
  const draw = useResource<Draw>(selected ? `/api/admin/draws/${selected}` : null, false, 15000)
  const result = useResource<Results>(selected ? `/api/admin/draws/${selected}/results` : null, false, 15000)
  const action = useAction()
  async function generate() {
    if (!selected || !canDraw) return
    await action.run(async () => {
      await apiPost(`/api/admin/draws/${selected}/generate`, {})
      setMessage(`Draw #${selected} published. Results are final.`); draw.reload(); result.reload()
    })
  }
  const canDraw = Boolean(draw.data && draw.data.initializationStatus === 'Ready' && draw.data.drawStatus === 'Closed' && !draw.data.published && Date.now() >= new Date(draw.data.drawAt).getTime())
  return <section className="admin-content"><AdminMetrics drawId={selected} /><DrawPicker admin value={selected} onChange={id => { if (!action.pending) { setSelected(id); setMessage('') } }} />
    <ErrorNote error={draw.error} retry={draw.reload} /><ErrorNote error={result.error} retry={result.reload} /><ErrorNote error={action.error} />
    {draw.data && <>
      <section className="number-chooser" aria-labelledby="chooser-title"><div className="number-chooser__glow" /><div className="number-chooser__inner">
        <header><p>Random Number</p><h2 id="chooser-title">Chooser</h2></header>
        <div className="number-chooser__number">{result.data?.status === 'published' ? result.data.items[0]?.winningNumber : '------'}</div>
        <div className="number-chooser__prizes"><label><span>CHOOSING FOR:</span><strong>All 13 winning numbers</strong></label><label><span>PRIZE TIERS:</span><strong>1st, 2nd, 3rd, 4th</strong></label></div>
        <div className="number-chooser__progress-label"><span>{draw.data.published ? 13 : 0}</span><span>13</span></div>
        <div className="number-chooser__progress" role="progressbar" aria-label="Published winning numbers" aria-valuenow={draw.data.published ? 13 : 0} aria-valuemin={0} aria-valuemax={13}><span style={{ width: draw.data.published ? '100%' : '0%' }} /></div>
        {!draw.data.published && <button type="button" disabled={action.pending || !canDraw} onClick={generate}>{action.pending ? 'Rolling…' : 'Roll'}</button>}
      </div></section>
    </>}
    {message && <p className="api-message" role="status">{message}</p>}
    {result.loading && <p>Loading results…</p>}{result.data && <PublishedTable result={result.data} />}
    {selected && result.data?.status === 'published' && <WinnerList key={selected} drawId={selected} />}
    <Link to="/admin">Back to Dashboard</Link>
  </section>
}

function WinnerList({ drawId }: { drawId: number }) {
  const [page, setPage] = useState(1)
  const winners = useResource<List<Winner>>(`/api/admin/draws/${drawId}/winners?page=${page}&pageSize=20`, true)
  return <section className="feature-panel"><h2>Winning purchased tickets</h2><ErrorNote error={winners.error} retry={winners.reload} />{winners.loading && <p>Loading winners…</p>}{winners.data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Ticket</th><th>Customer</th><th>Number</th><th>Prize</th><th>Amount per copy</th></tr></thead><tbody>{winners.data.items.map(w => <tr key={w.ticketId}><td>#{w.ticketId}</td><td>#{w.userId} · {w.name}</td><td className="lottery-number">{w.ticketNumber}</td><td>{w.prizeType}</td><td>{money(w.prizeAmount)}</td></tr>)}</tbody></table></div>{winners.data.items.length === 0 && <p>No purchased tickets won. Unsold numbers can win.</p>}<Pager meta={winners.data.meta} onPage={setPage} /></>}</section>
}

export function AdminLiveDrawPage() {
  return <Page className="admin-live-draw-page"><section className="admin-heading admin-live-heading"><div className="live-badge-wrap"><span className="live-badge"><span className="live-dot">•</span> RESULTS</span><h1>Live Ticket Draw</h1></div><p>Published results refresh every 15 seconds.</p></section><Access role="Admin"><DrawBoard /></Access></Page>
}

function DrawBoard() {
  const [selected, setSelected] = useState<number | null>(null)
  const results = useResource<Results>(selected ? '/api/admin/draws/' + selected + '/results' : null, false, 15000)
  return <section className="admin-content admin-live-content">
    <div className="live-stream-box"><img src="/assets/Stream.png" alt="Stream layout illustration — no live video is configured" className="live-stream-img" /><p className="stream-caption">Stream layout illustration. No live video broadcast is configured.</p></div>
    <section className="encryption-key-card"><div className="encryption-key-card__header"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg><h2>Draw Verification</h2></div>
      <p>Verification key</p>
      <code className="encryption-key-code">7f3a91c2b8d46e50a91c7f364d028b5e6a0f97d281e3c5468bfa720c9d65e114</code>
    </section>
    <DrawPicker value={selected} onChange={setSelected} preferPublished /><ErrorNote error={results.error} retry={results.reload} />{results.loading && <p>Loading results…</p>}{results.data && <PublishedTable result={results.data} />}<Link to="/admin/draw">Open draw controls</Link>
  </section>
}

function DrawSold({ drawId }: { drawId: number }) {
  const summary = useResource<Summary>('/api/admin/dashboard?drawId=' + drawId)
  return <span title={summary.error ? 'Sales total unavailable' : undefined}>{summary.data?.totalTicketsSold.toLocaleString() ?? '—'}</span>
}

function AdminMetrics({ summary: supplied, drawId }: { summary?: Summary | null; drawId?: number | null }) {
  const summary = useResource<Summary>(supplied ? null : '/api/admin/dashboard' + (drawId ? '?drawId=' + drawId : ''))
  const current = useResource<Draw>(drawId ? '/api/admin/draws/' + drawId : '/api/draws/current')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const remaining = current.data ? Math.max(0, new Date(current.data.drawAt).getTime() - now) : null
  const values = remaining === null ? ['—', '—', '—'] : [Math.floor(remaining / 86400000), Math.floor(remaining / 3600000) % 24, Math.floor(remaining / 60000) % 60]
  const data = supplied ?? summary.data
  const metrics = [
    { label: 'Total Users', value: data?.totalUsers.toLocaleString(), icon: 'admin-b5e7d.svg', note: 'Customer accounts' },
    { label: 'Total Tickets', value: data?.totalTicketsSold.toLocaleString(), icon: 'admin-8d550.svg', note: 'Purchased ticket copies' },
    { label: 'Total Sales', value: data ? money(data.totalSales) : undefined, icon: 'admin-f45fc.svg', note: 'Simulated payments' },
  ]
  return <div className="admin-metrics">{metrics.map(item => <article className="admin-metric" key={item.label}><p>{item.label}</p><strong>{item.value ?? '—'}</strong><img className="admin-metric__icon" src={'/assets/' + item.icon} alt="" /><div className="admin-metric__trend"><span>{item.note}</span></div></article>)}<article className="admin-metric admin-metric--time"><p>Time remaining</p><div className="admin-mini-countdown">{['Days', 'Hours', 'Minutes'].map((label, i) => <span className="admin-mini-countdown__wrap" key={label}>{i > 0 && <i>:</i>}<span className="admin-mini-countdown__unit"><b>{values[i]}</b><small>{label}</small></span></span>)}</div></article></div>
}

function PublishedTable({ result }: { result: Results }) {
  return <section className="winning-admin"><div className="winning-admin__heading"><h2>Winning Lottery Numbers</h2><p>{result.status === 'published' ? 'Published winning numbers · ' + dateTime(result.publishedAt) : 'Results are pending'}</p></div><div className="admin-table-wrap"><table className="admin-table winning-admin__table"><thead><tr><th>Prize</th><th>Ticket Number</th><th>Amount per winning copy</th></tr></thead><tbody>{result.status === 'published' ? result.items.map(p => <tr key={p.prizeId}><td>{p.prizeType} Prize</td><td className="lottery-number">{p.winningNumber}</td><td>{money(p.prizeAmount)}</td></tr>) : <tr><td colSpan={3}>Results are pending. Winning numbers appear after publication.</td></tr>}</tbody></table></div></section>
}
