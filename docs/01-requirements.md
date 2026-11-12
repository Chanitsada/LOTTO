# 01 - Project requirements

LOTTO is a university database application for lottery purchases with simulated
payment. Customers choose numbers and view their own tickets. Admin controls
sales closure, publication and customer status. Developer inspects inventory.

## Scope and tools

The application includes registration/login/logout, profile editing, number
browsing, saved-cart CRUD, checkout, receipts, ticket results, winnings, Admin
reports/customer deactivation and Developer inventory reads.

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite and Tailwind |
| Backend | Node.js 24+, Express 5 and CommonJS |
| Database | MySQL 8.0.21+, InnoDB tables and mysql2/promise |
| Authentication | bcrypt cost 10, server-side RAM sessions and CSRF tokens |
| Payment | Simulated database transaction; no real gateway |

Express serves the built frontend and `/api`. Vite supplies automatic frontend
updates during development. The [architecture](02-architecture.md) describes
request flow and the [API contract](03-api-contract.md) describes interfaces.

## Confirmed decisions

| Topic | Requirement |
| --- | --- |
| Schedule | One draw on the last calendar day of each month at 18:00 Thailand (UTC+7) |
| Cutoff | No purchases at/after 17:00 on draw day; automatic closure and Admin emergency early closure |
| Monthly creation | Current month only, on/after its first day and after the preceding result is published; no manual Admin creation |
| Available numbers | All 1,000,000 six-digit strings, 000000–999999, five copies each |
| Inventory | One LotteryNumber row per number/draw, AvailableQuantity initially 5; no TotalQuantity |
| Purchased copies | One LotteryTicket row per successful copy; no pre-created ticket records |
| Price | ฿100 per copy; no discount |
| Cart/checkout | Current eligible draw only, 1–5 copies per number, max 100 copies total; no browsing reservation |
| Payment | One Payment per checkout; stock/tickets/cart cleanup commit together |
| Repeat requests | Every accepted request is a separate purchase; UI blocks pending clicks; no server retry-key deduplication |
| Prizes | Four finalized tiers with 13 distinct winning numbers; no fifth tier |
| Unsold numbers | Eligible to win |
| Winnings | Tier amount for each purchased winning copy |
| Profile | Customer edits own name/phone; email and role stay fixed |
| Account removal | Admin deactivation retains accounts/tickets/payments; no destructive account-delete route |
| Results | Pending until publication; final afterwards, with no edit/reroll API |
| Passwords | At least 8 Unicode code points, at most 72 UTF-8 bytes; bcrypt cost 10 |
| Sessions | Server-side RAM, 30 idle minutes; backend restart clears login |
| History | Public current draw plus previous 12 months of published results; no future selection |
| Verification | Optional, not implemented; the displayed key is a placeholder |
| PR approval | I am the only approver for teammates' PRs into main |

## Users and CRUD

| Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| Visitor | Customer registration | Public draws, stock, prize information and results | — | — |
| Customer | Saved selections and successful purchases | Own profile, cart, tickets, receipts and winnings; public results | Own name/phone and cart quantity | Own unpurchased CartItem |
| Admin | —  | Eligible draws, customers, sales, purchases and winners | Close sales, publish existing prize slots, deactivate Customers | — |
| Developer | — | Current inventory totals, search, missing stock and inconsistencies | — | — |
| System | Monthly draw, numbers and prize slots | Preceding result/setup state | First opening and automatic closure | Purchased cart selections during checkout |

A POST route is not automatically a database Create operation. Closing a draw,
deactivating a Customer and setting winners update existing rows. Each role needs
appropriate operations, not all four. Website roles are separate from MySQL logins.

Public registration creates Active Customers only. Admin/Developer accounts use
the local account-seeding command. Server role checks apply even if someone calls
an API without using its page. Private records always use session ownership.

## Lottery rules

| Prize | Winning numbers | Amount per winning copy |
| --- | --- | --- |
| 1st | 1 | ฿6,000,000 |
| 2nd | 1 | ฿200,000 |
| 3rd | 1 | ฿80,000 |
| 4th | 10 | ฿2,000 |
| Total | 13 distinct numbers | |

A number cannot win two slots/tiers in the same draw. Every number can win even
with no buyers. Two copies of a fourth-prize number earn ฿4,000 together. Pending
results never count as losses. Money uses DECIMAL and API two-decimal strings.

Inventory is unique by `(DrawID, TicketNumber)`. Leading zeros remain visible.
Five million initial copies are inventory capacity, not five million ticket rows.
Batch initialization must finish and validate all prize slots before sales open.
Reruns preserve sold stock, published results and intentional emergency closures.

## Customer flow

1. Register, then log in as Customer.
2. Browse the current draw and select available numbers.
3. Save selections in CartItem, edit copies or remove a selection.
4. Pay for one draw with at most 100 copies.
5. View the returned receipt and individual tickets in My Tickets.
6. Check published results and total winnings; pending remains pending.
7. Edit name/phone or log out.

Saving/editing/removing selections does not reserve inventory. New customers
have empty carts. Previous/future draws cannot be bought. Closed/expired selections
can be removed but cannot be purchased.

`sp_checkout` serializes the Customer's cart/purchases, locks the draw and selected
inventory, validates role/account/current month/cutoff/stock/cart quantities, then:

1. Calculates copies × ฿100.
2. Creates one Payment.
3. Creates one LotteryTicket per purchased copy.
4. Decreases AvailableQuantity once.
5. Removes purchased saved selections and commits.

Every failure rolls back all five effects. Neither Node nor a trigger deducts
stock again. Repeated accepted requests are independent purchases, so inspect
receipts after an uncertain network response rather than automatically retrying.

## Draw lifecycle

The initial seed supplies the current month and fictional result-only history.
Normal draws are automatic after the next month begins and the preceding result
is published. Express checks on startup/every 30 seconds. SalesStarted records
first opening, so these checks cannot reopen an emergency closure.

DrawDate is the Thailand month-end date. Cutoff/draw/publication timestamps are
UTC, displayed in Thailand time. Closing early does not permit early publication.
Checkout tests the cutoff independently of the background timer. Admin publishes
all 13 winners once at/after the scheduled draw time with sales closed.

The result algorithm uses backend crypto.randomInt with duplicate rejection.
Public-key/commitment verification, independent public randomness and replay
proof are absent. A key displayed in the UI is not evidence of fairness.

## Database and security

The seven tables are User, LotteryDraw, LotteryNumber, CartItem, Payment,
LotteryTicket and Prize. CartItem derives DrawID through LotteryNumber. A ticket
links its buyer, number and Payment. Foreign keys preserve financial history.

Six procedures cover registration, checkout, closure, ticket checks, dashboard
summary and full inventory initialization. Two triggers guard ticket insertion
and prevent purchased-ticket deletion. See the [database guide](../database/README.md)
and [proposal comparison](../demonstration/01-proposal-changes.md).

Passwords use salted bcrypt hashes. SQL request values use `?` parameters; dynamic
identifiers/clauses are code-defined. Sessions, CSRF, current roles/account status,
ownership and safe errors apply on the backend. Personal-data anonymization has
no agreed retention policy or route; deactivation preserves records.

## Responsibilities and limits

I own authentication, draws/inventory, closure, private history/results, all stored
procedures and triggers, and PR coordination. The backend teammate owns
checkout/cart/reporting routes and controllers, profiles,
Admin customers and privileged-account seeding, including the original schema/seed.
The teammate's controllers call my stored procedures for checkout and dashboard
totals. Frontend teammates own layout and page behavior. See [allocation](backend-allocation.md).

Google sign-in, Remember me, password reset, real payments, video streaming and
cryptographic verification are outside the implemented scope. Use
[security tests](security-and-tests.md) and the
[D1–D7 walkthrough](../demonstration/02-demo-walkthrough.md) for evidence and checks.
