# Frontend

React/TypeScript pages use the supplied LOTTO artwork, colors, navigation and
main card layouts. Page handlers connect to Express; MySQL is authoritative for
identity, inventory, prices, schedules and results. UI wording/design changes
require my approval.

## Running

Use Node.js 24+ and npm. From the LOTTO root:

```bash
cd frontend
npm ci
npm run build
cd ../backend
npm ci
npm start
```

Open http://localhost:3000, or the root `.env` PORT. Rebuild after frontend edits
when Express serves the pages. For automatic updates, run `npm run dev` in both
folders in separate terminals and open http://127.0.0.1:5173. Vite proxies `/api`
to the backend PORT. Restart Vite after changing PORT.

Database/session configuration stays in root `.env`; no browser secret or
frontend `.env` is needed. External font URLs have system-font fallbacks.
Backend restart clears RAM logins. See [setup](../README.md#local-setup).

## Pages

| Route | Purpose |
| --- | --- |
| `/` | SQL-based draw countdown, result selection and number check |
| `/results` | Month/year result selection and six-digit number check |
| `/register` | Customer registration; first/last names combine into Name |
| `/login` | Session login; eight-dot password placeholder |
| `/profile` | Account details, Customer name/phone edit and published winnings |
| `/buy-lottery` | Quick Pick/custom six-digit cards and expandable live-stock browser |
| `/checkout` | Saved cart, quantity controls, Remove, Pay and purchase receipt |
| `/cart` | My Tickets month groups, individual ticket results and receipts |
| `/admin` | Metrics, eligible draws, emergency Close Draw, customers and reports |
| `/admin/draw` | Scheduled Roll action, final results and purchased winners |
| `/admin/live-draw` | Result board, stream illustration and display-only verification key |
| `/developer` | Current inventory totals, search, mismatch filtering and pagination |

The result selectors use Month Year and append Pending only to unpublished
months. They contain the current SQL draw and the previous 12 months of published
results. Future draws are unavailable. The countdown uses drawAt/serverNow from
SQL, not a guessed next-month date.

Guests receive the sign-in prompt before Available numbers. Customer Buy ticket
checks availability, saves one copy and opens checkout. Admin/Developer purchase
controls are disabled, and backend role checks independently reject purchases.

Cart items show number, Draw: Month Year, amount and available copies. Saving,
editing and removing selections do not change stock. Pay invokes the purchase
transaction and displays “Purchase complete. Your tickets are saved.” Receipts
show amount/copies/draw month and individual ticket IDs/numbers. My Tickets uses
the existing navigation; the extra receipt-link button is absent.

Customer profile editing changes name/phone. Email remains read-only. Admin
customer deactivation retains purchase records. Draw dashboard labels are pending,
closed and completed: these correspond to Open, unpublished Closed and published
SQL states. Normal draw creation is automatic; there is no New Draw button.

## Files

| File | Purpose |
| --- | --- |
| `src/App.tsx` | Routes and signup/login forms |
| `src/layout.tsx` | Shared header, footer and How it works |
| `src/api.ts` | JSON requests, cookies, CSRF, error responses and list metadata |
| `src/auth.tsx` | Session restoration, login/logout, name refresh and expiry |
| `src/lottery-shared.tsx` | Loading, roles, pagination, Thailand dates and result cards |
| `src/lottery-pages.tsx` | Public/Customer pages, cart/payment and history |
| `src/admin-pages.tsx` | Admin draws, reports, customers and final result board |
| `src/developer-page.tsx` | Inventory report |
| `src/index.css` | Branding, page layout and responsive forms/cards/tables |
| `public/` | Images and SVG assets |
| `vite.config.ts` | React/Tailwind build and server-side API proxy configuration |

The API module fetches a current CSRF token for mutations. Identity is restored
through `/api/auth/me`, not localStorage. Loading, empty, pending and failure
states are distinct. Stale responses cannot replace a different selected draw.
Do not send client user IDs/prices/winners as authority.

## Integration decisions

These decisions explain the differences between the supplied frontend ZIP and
the project. They are separate from changes to the proposal.

| Supplied ZIP behavior | Project behavior and reason |
| --- | --- |
| Independent backend/SQL and destructive seed | Shared Express routes/controllers and database files preserve one schema and contract |
| 100 numbers, three copies, TotalQuantity | One million numbers, five copies and AvailableQuantity match agreed inventory |
| FirstName/LastName database fields and two roles | Name, three roles and AccountStatus; forms combine names |
| Grouped ticket quantity/payment per item | Individual purchased copies and one Payment per checkout |
| Discount/promo behavior | Fixed ฿100 per copy, calculated by backend |
| localStorage identity and supplied user IDs | RAM sessions, CSRF, ownership and server role checks |
| First-of-month dates and browser-generated winners | Month-end schedule and final backend-generated results |
| Different routes/fields/statuses | [Shared API contract](../docs/03-api-contract.md); pending/closed/completed remain display labels |
| Vite port 3001 proxy and Figma tooling | Root backend PORT, Vite 5173 and React/Tailwind configuration |
| Invented sales trends and verification claims | Database reports; verification key is display-only; stream image is an illustration |
| Seed references absent PaymentMethod column | Existing project Payment model; incoming seed is not imported |

The four prize amounts already match the agreed tiers. Expandable sections hold
stock search, customer management and purchase reports alongside the supplied
main layout. The later backend teammate package supplies profile/customer/account
seeding behavior through the same routes and guards. Dependencies, local settings
and Git metadata from either ZIP are not application source imports.

## Checks and limits

```bash
npm test
npm run typecheck
npm run build
```

UI tests use simulated APIs. The live purchase test is skipped in an ordinary
frontend run and executes under `npm run test:integration` in backend against a
disposable database. That flow exercises real React handlers, HTTP sessions,
payment and saved SQL rows. Desktop/mobile appearance still requires manual
browser review; DOM tests do not establish exact visual parity with the ZIP.

Pay stays disabled while requests are pending. After an interrupted payment
response, review recent receipts and explicitly reload the cart before retrying.
The backend does not deduplicate accepted requests.

Google sign-in, Remember me, password reset, a real payment gateway, actual video
streaming and cryptographic verification are unavailable. The 64-character
Verification key has no proof, source or verification endpoint. Previous-month
winning numbers from seed.sql are fictional fixtures. Neither the key nor those
fixtures demonstrate an independently verifiable draw.

Use the [live walkthrough](../demonstration/02-demo-walkthrough.md) for prepared
pages, input data and SQL evidence. Consult the [security checks](../docs/security-and-tests.md)
for ownership, permissions and transaction test coverage.
