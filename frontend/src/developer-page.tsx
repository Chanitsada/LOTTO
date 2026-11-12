import { useState, type FormEvent } from 'react'
import { Access, Page, ErrorNote, Pager, useResource, drawDate, type List } from './lottery-shared'

type InventoryRow = {
  lotteryNumberId: number; ticketNumber: string; purchasedCopies: number
  availableQuantity: number; consistent: boolean
}
type Report = List<InventoryRow> & {
  draw: { drawId: number; drawDate: string; initializationStatus: string }
  summary: {
    expectedNumbers: number; numberCount: number; missingNumbers: number
    purchasedCopies: number; availableCopies: number; inconsistentNumbers: number; consistent: boolean
  }
}

export function DeveloperPage() {
  return <Page className="admin-page developer-page"><section className="admin-heading"><h1>Inventory report</h1></section><Access role="Developer"><InventoryReport /></Access></Page>
}

function InventoryReport() {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [inconsistentOnly, setInconsistentOnly] = useState(false)
  const [filter, setFilter] = useState('')
  const report = useResource<Report>(`/api/developer/inventory?page=${page}&pageSize=20${filter}`, true)
  function search(event: FormEvent) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (input) params.set('ticketNumber', input)
    if (inconsistentOnly) params.set('inconsistentOnly', 'true')
    setFilter(params.size ? `&${params}` : ''); setPage(1); report.reload()
  }
  const data = report.error ? null : report.data
  const metrics: [string, number][] = data ? [
    ['Numbers stored', data.summary.numberCount], ['Missing numbers', data.summary.missingNumbers],
    ['Purchased copies', data.summary.purchasedCopies], ['Available copies', data.summary.availableCopies],
    ['Inconsistent numbers', data.summary.inconsistentNumbers],
  ] : []
  return <section className="admin-content inventory-report">
    <ErrorNote error={report.error} retry={report.reload} />
    {report.loading && <p role="status">Loading inventory…</p>}
    {data && <section className="feature-panel">
      <h2>Draw: {drawDate(data.draw.drawDate)}</h2>
      <p>Setup: {data.draw.initializationStatus} · {data.summary.consistent ? 'Inventory is consistent.' : 'Inventory needs checking.'}</p>
      <div className="inventory-summary">
        {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></div>)}
      </div>
    </section>}
    <form className="feature-toolbar" onSubmit={search}>
      <label>Ticket number<input aria-label="Search inventory number" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={input} onChange={e => setInput(e.target.value.replace(/\D/g, ''))} /></label>
      <label className="confirmation"><input type="checkbox" checked={inconsistentOnly} onChange={e => setInconsistentOnly(e.target.checked)} /> Only inconsistent numbers</label>
      <button type="submit" disabled={report.loading}>Search</button>
      <button type="button" disabled={report.loading} onClick={() => report.reload()}>Refresh</button>
    </form>
    {data && <section className="feature-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr>
      <th>Ticket number</th><th>Purchased copies</th><th>Available copies</th><th>Check</th>
    </tr></thead><tbody>{data.items.map(row => <tr key={row.lotteryNumberId}>
      <td className="lottery-number">{row.ticketNumber}</td><td>{row.purchasedCopies}</td><td>{row.availableQuantity}</td><td>{row.consistent ? 'Correct' : 'Inconsistent'}</td>
    </tr>)}</tbody></table></div>
      {data.items.length === 0 && <p>No matching numbers.</p>}
      <Pager meta={data.meta} onPage={setPage} disabled={report.loading} />
    </section>}
  </section>
}
