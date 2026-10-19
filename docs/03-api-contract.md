# 03 - API notes

These are planned frontend/backend routes. They are not working endpoints
yet. Use `/api` as the common prefix. The
[confirmed business rules](01-requirements.md#confirmed-decisions) already apply;
this document explains their API behavior.

Use the same Express server for the frontend and API. Authentication uses a
session cookie, not a token saved in localStorage. Get a CSRF token
from `GET /api/auth/csrf` in the frontend, send it as `X-CSRF-Token` on POST/PATCH/DELETE requests,
and refresh it after login. Use JSON bodies and server-side role/ownership checks.
Sessions are stored in MySQL and expire after 30 minutes without activity. Logout
or account deactivation invalidates access; enforce idle expiry on the server.

## Core routes

Paths below are relative to `/api`. "Own" means the logged-in user's records;
the backend never accepts a client-supplied userId to choose a customer identity.

| Method | Route | Access | Input / returned data |
| --- | --- | --- | --- |
| GET | /auth/csrf | Anyone | Return csrfToken |
| POST | /auth/register | Anyone | name, phone, email, password (8+ characters, max 72 UTF-8 bytes) → Customer; reject role |
| POST | /auth/login | Anyone | email, password → userId, name, role; set session |
| POST | /auth/logout | Logged in | Empty body → end session |
| GET | /auth/me | Logged in | Return current userId, name, role |
| GET | /draws | Anyone | Optional month/page/pageSize → draw list |
| GET | /draws/:drawId | Anyone | Draw date, status, price and whether purchases are allowed |
| GET | /draws/:drawId/numbers | Anyone | Optional ticketNumber/page/pageSize → numbers and available copies |
| GET | /draws/:drawId/prizes | Anyone | Four tiers, counts 1/1/1/10; amounts 6000000.00 / 200000.00 / 80000.00 / 2000.00 as strings |
| GET | /draws/:drawId/results | Anyone | Pending/published status and winning numbers by tier |
| GET | /draws/:drawId/check | Anyone | ticketNumber → pending/win/loss and matching tier |
| POST | /checkout | Customer | Idempotency-Key header; drawId, items [{lotteryNumberId, quantity}], max 100 copies → one receipt |
| GET | /me/profile | Customer | Own name, phone and email |
| PATCH | /me/profile | Customer | name and/or phone; email and role changes rejected |
| GET | /me/tickets | Customer | Optional drawId/page/pageSize → own tickets, one record per purchased copy |
| GET | /me/tickets/:ticketId/result | Customer, own | Pending/win/loss and known prize information |
| GET | /me/payments | Customer | Optional page/pageSize → own purchase history |
| GET | /me/payments/:paymentId | Customer, own | One receipt and all its individual purchased tickets |
| POST | /admin/draws | Admin | drawDate (must be month's last day) → draw ID; compute 17:00 cutoff/18:00 draw in Thailand time |
| GET | /admin/draws/:drawId/initialization | Admin | Pending/ready/failed and initialized number count |
| POST | /admin/draws/:drawId/close | Admin | Empty body → close sales |
| GET | /admin/customers | Admin | Paginated customer list with active status |
| POST | /admin/customers/:customerId/deactivate | Admin | Empty body → deactivate account, keep tickets/payments and invalidate access |
| POST | /admin/draws/:drawId/corrections | Admin | reason, changes [{prizeId, winningNumber}] → append correction, preserve original |
| GET | /admin/draws/:drawId/result-history | Admin | Original result and corrections with before/after values, timestamp, reason and Admin ID |
| GET | /admin/dashboard | Admin | Optional drawId → users, ticket copies and sales total |
| GET | /admin/tickets | Admin | Optional drawId/customerId/page/pageSize → purchased tickets |
| GET | /admin/payments | Admin | Optional drawId/customerId/page/pageSize → payments |
| GET | /admin/draws/:drawId/winners | Admin | Winner/ticket information; keep customer details private |

Profile edits accept only name (up to 100 characters) and phone (up to 20 characters);
require at least one field. Email changes are disabled for the demo. Account
deactivation never deletes ticket/payment history. Personal-data anonymization
waits for an agreed retention policy; do not add a destructive account delete route.

Admin result publication is required; commitment-and-reveal verification is optional
if time permits. Document the chosen drawing algorithm before implementing generation.
Initial results cannot publish before the scheduled 18:00 draw
or while sales are open. Corrections use the separate append-only route, with a
required reason and Admin identity from the session. Validate the full corrected
13-number result for tier counts and uniqueness. Public results indicate corrections;
the Admin history retains original/before/after data. Never silently overwrite or reroll.

Developer can log in and use public data. An optional system-status view can come
later; no separate technical management API is needed for the first version.
Verification routes are added only if that optional feature is implemented.

## Common format

Use camelCase field names, positive integer IDs and six-digit number **strings**.
The SQL inventory column is LotteryNumber.Number; the API keeps ticketNumber as
its display field. Inventory responses use availableQuantity, with no totalQuantity.
Request items still use quantity to select copies. Each returned purchased ticket
represents one copy and has its own ticketId; it does not store a quantity field.
Money is a two-decimal string, such as "100.00". Prize amounts are "6000000.00",
"200000.00", "80000.00" and "2000.00" for 1st through 4th; there is no 5th tier.
Dates use YYYY-MM-DD; timestamps use ISO 8601 UTC. Schedule one draw per month:
last calendar day at 18:00 Asia/Bangkok (UTC+7), sales cutoff that day at 17:00.
Automatically close sales, allow Admin emergency early closure, and enforce the
cutoff inside checkout even if the closing check has not run. Initialize full
inventory and validate all four prize amounts before sales open.
Start list pagination at page=1/pageSize=20, with a proposed maximum pageSize=100.

Success:

```json
{"data":{"drawId":1,"drawDate":"2026-11-30","drawAt":"2026-11-30T11:00:00Z","salesCloseAt":"2026-11-30T10:00:00Z","drawStatus":"Open","purchasable":true,"unitPrice":"100.00"}}
```

Failure:

```json
{"error":{"code":"INSUFFICIENT_STOCK","message":"Not enough copies are available."}}
```

Lists use data.items and meta with page, pageSize and totalItems. Do not return
raw database errors, passwords/hashes, session IDs or unrevealed draw secrets.
The example is the November schedule: 10:00 UTC is the 17:00 Thailand cutoff;
11:00 UTC is the 18:00 Thailand draw. purchasable is true only before cutoff,
with Open status, ready inventory and validated prizes.

| Status | Meaning |
| --- | --- |
| 200 | Successful read/update/login/logout or replay of an existing checkout receipt |
| 201 | Account or checkout created |
| 202 | Draw accepted; inventory is still being prepared |
| 400 | Invalid JSON/fields/IDs/number/quantity; reject unexpected fields |
| 401 | Login required or invalid credentials |
| 403 | Wrong role, deactivated account or invalid CSRF token |
| 404 | Not found; also use for someone else's private ticket/payment |
| 409 | State conflict: duplicate email, closed/not-ready draw, insufficient stock or reused checkout key with a different request |
| 500 | Unexpected server error; return a safe message |

## Checkout example

Request for one draw. Create a random Idempotency-Key once for this checkout;
reuse the same key on double clicks/retries, rather than creating a new key per request.

```json
{"drawId":1,"items":[{"lotteryNumberId":101,"quantity":2},{"lotteryNumberId":102,"quantity":1}]}
```

Success, assuming the draw is ready and has enough stock:

```json
{"data":{"paymentId":81,"amount":"300.00","tickets":[{"ticketId":501,"ticketNumber":"000001"},{"ticketId":502,"ticketNumber":"000001"},{"ticketId":503,"ticketNumber":"123456"}]}}
```

Backend calculates 3 × ฿100. Reject client price/amount/userId, nonpositive quantities,
duplicate number IDs, wrong-draw numbers, closed/unready draws and insufficient
stock. The sum of quantities must be at most 100; this counts copies, not lines.
Browsing does not reserve stock. Lock and check stock, time and prize readiness
inside sp_checkout; all writes roll back on failure.
This example creates three LotteryTicket rows, not two grouped rows. Each shares
PaymentID 81. Two tickets can refer to the same LotteryNumber because they are
separate copies. A grouped frontend display may count them for convenience, but
that count is computed from ticket records, not stored as LotteryTicket.Quantity.

For an inventory response, an example number after buying two copies is:

```json
{"data":{"items":[{"lotteryNumberId":101,"ticketNumber":"000001","availableQuantity":3}]},"meta":{"page":1,"pageSize":20,"totalItems":1}}
```

This example uses an exact-number search. The SQL row is unique by (DrawID, Number).

Save the key, authenticated user and a fingerprint of validated draw/items with the
Payment; enforce a unique (UserID, CheckoutKey) in MySQL. A matching completed retry
returns the same receipt (200), even if sales have since closed. A new purchase
returns 201; a key reused for different items/draw conflicts (409). Concurrent same-key
requests must also create only one payment. Failed attempts leave no partial purchase.
Disabling a button alone is not enough. Only the optional simulated-decline behavior
needs a detailed response design; checkout limits and retry protection are settled.
No real payment gateway is involved.

A pending result is not a loss. Final results contain exactly 13 distinct numbers
across four tiers, with counts 1/1/1/10. Any number can win, including unsold numbers.
Each owned winning ticket receives one tier amount. Two tickets for the same
4th-prize number receive "2000.00" each, or "4000.00" together. A losing ticket
has "0.00"; pending winnings remain null.
Frontend teammates: use these responses as mock data and discuss missing fields
with the backend team. Update this file together when an interface changes.
