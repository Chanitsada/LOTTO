# 03 - API contract

Express exposes JSON routes under `/api`. Authentication uses a session cookie;
private handlers take identity from the session, never a supplied userId. The
frontend API module sends cookies and obtains a current CSRF token for mutations.

## Format

Success uses `{data: ...}`. Lists use `{data: {items: [...]}, meta: {page,
pageSize, totalItems}}`. Failures use `{error: {code, message}}`. Field names are
camelCase, IDs are positive integers and lottery numbers are six-digit strings.
Money is a two-decimal string. Dates use YYYY-MM-DD; timestamps use ISO UTC.
All API responses use Cache-Control: no-store.

```json
{"data":{"status":"ok"}}
```

GET `/api/health` returns that body with 200 independently of MySQL. Unknown
routes return JSON 404; malformed JSON returns 400; oversized bodies return 413;
unexpected errors return generic 500 without SQL, secrets or stack traces.

## Registration and login

| Method | Path | Input/result |
| --- | --- | --- |
| GET | /api/auth/csrf | Creates/reuses anonymous session; returns data.csrfToken |
| POST | /api/auth/register | name, phone, email, password → 201 userId/name/role=Customer |
| POST | /api/auth/login | email/password → 200 userId/name/role; replaces session/token |
| GET | /api/auth/me | Current userId/name/role; 401 without login |
| POST | /api/auth/logout | Destroys login/cookie; returns data.message |

Registration/login/logout require X-CSRF-Token and the same session cookie.
Fetch a fresh token after login, because the session/token rotates. Registration
does not log in automatically. Only Customer can be created through public signup.

| Field | Validation |
| --- | --- |
| name | Required string, trimmed, 1–100 Unicode characters |
| phone | Required string, trimmed, 1–20 characters |
| email | Required string, trimmed, at most 254 characters, basic email syntax; case preserved |
| password | Required string, unchanged, 8+ Unicode code points and at most 72 UTF-8 bytes |

Reject extra fields, including role and userId. Signup hashes with bcrypt cost 10
and calls sp_register_user with parameters. Duplicate email returns 409. Login
looks up by parameterized email and uses bcrypt.compare; wrong/unknown credentials
share 401 INVALID_CREDENTIALS. A disabled account returns 403 ACCOUNT_DISABLED.
Ten failed logins per IP in 15 minutes trigger 429. Email ownership verification
is not implemented. Passwords and hashes are never returned.

Sessions are in backend RAM for 30 idle minutes. Cookies are HttpOnly,
SameSite=Lax and Secure in production. Page changes/refreshes retain login;
backend restart clears it. Protected requests reread current status/role.
Missing/placeholder/short SESSION_SECRET returns 503 AUTH_NOT_CONFIGURED.

## Lottery routes

The following paths are relative to `/api`. “Own” means session-owned records.
All listed routes have handlers; access still depends on role, data and schedule.

| Method | Route | Access | Input / returned data |
| --- | --- | --- | --- |
| GET | /pricing | Anyone | unitPrice="100.00", maxCopiesPerCheckout=100 |
| GET | /draws/current | Anyone | Unique current Thailand monthly draw, or 404 if absent |
| GET | /draws | Anyone | Current SQL draw plus the previous 12 months of published results; optional month/page/pageSize |
| GET | /draws/:drawId | Anyone | Public current/history draw only; future/older dates return 404 |
| GET | /draws/:drawId/numbers | Anyone | Current SQL draw only; optional ticketNumber/page/pageSize → numbers and stock |
| GET | /draws/:drawId/prizes | Anyone | Four tiers, counts 1/1/1/10; amounts 6000000.00 / 200000.00 / 80000.00 / 2000.00 as strings |
| GET | /draws/:drawId/results | Anyone | Pending/published status and winning numbers by tier |
| GET | /draws/:drawId/check | Anyone | ticketNumber → pending/win/loss and matching tier |
| POST | /checkout | Customer | drawId, items [{lotteryNumberId, quantity}], max 100 copies → one receipt |
| GET | /me/profile | Customer | Own userId, name, phone and email; no password |
| PATCH | /me/profile | Customer | name and/or phone; email, userId, role and status changes rejected; updated profile returned |
| GET | /me/cart | Customer | Own saved selections with joined number/draw details, including drawDate (YYYY-MM-DD); may show stale selections as unavailable |
| POST | /me/cart | Customer | lotteryNumberId, quantity (1-5); add only a number from the current eligible draw |
| PATCH | /me/cart/:cartItemId | Customer, own | quantity (1-5); keep one draw and max 100 total copies |
| DELETE | /me/cart/:cartItemId | Customer, own | Delete an unpurchased selection; 200 with a JSON success message |
| GET | /me/tickets | Customer | Optional drawId/page/pageSize → own tickets, one record per purchased copy |
| GET | /me/tickets/:ticketId/result | Customer, own | Pending/win/loss and known prize information |
| GET | /me/winnings | Customer | Sum of published prize amounts per owned ticket and winningCopies |
| GET | /me/payments | Customer | Optional page/pageSize → own purchase history |
| GET | /me/payments/:paymentId | Customer, own | One receipt and all its individual purchased tickets; drawDate comes from the purchased draw |
| GET | /developer/inventory | Developer | Current draw summary and number rows; ticketNumber, inconsistentOnly=true/false, page/pageSize (max 100) |
| GET | /admin/draws | Admin | Paginated eligible draws through the current month; chronological drawNumber; no future dates |
| GET | /admin/draws/:drawId | Admin | Protected eligible draw details; future dates return 404 |
| GET | /admin/draws/:drawId/results | Admin | Protected pending/published results |
| POST | /admin/draws/:drawId/initialize | Admin | Empty object; initialize all 1,000,000 numbers and 13 prize slots; 200 when complete |
| POST | /admin/draws/:drawId/generate | Admin | Empty object; generate and publish 13 unique winners once; 201 |
| GET | /admin/draws/:drawId/initialization | Admin | Pending/ready/failed and initialized number count |
| POST | /admin/draws/:drawId/close | Admin | Empty body → close sales |
| GET | /admin/customers | Admin | page/pageSize → Customer accounts with public details and accountStatus |
| POST | /admin/customers/:customerId/deactivate | Admin | Empty object → userId/accountStatus; deactivate account, keep tickets/payments and invalidate access |
| GET | /admin/dashboard | Admin | Optional drawId → users, ticket copies and sales total |
| GET | /admin/tickets | Admin | Optional drawId/customerId/page/pageSize → purchased tickets |
| GET | /admin/payments | Admin | Optional drawId/customerId/page/pageSize → payments |
| GET | /admin/draws/:drawId/winners | Admin | Winner/ticket information; keep customer details private |


## Cart and checkout

Cart mutations accept only lotteryNumberId/quantity on POST and quantity on
PATCH. Each number has 1–5 requested copies; a cart covers one current eligible
draw and at most 100 copies. Duplicate selections return 409; edit with PATCH.
Owned stale selections can be deleted after closure. Cart operations do not
reserve stock. Bodies cannot supply userId, drawId or a price for cart ownership.

Checkout accepts only drawId and distinct items. For example, using actual IDs:

```json
{"drawId":13,"items":[{"lotteryNumberId":124,"quantity":2}]}
```

The controller binds session user, draw and JSON items in
`CALL sp_checkout(?, ?, ?)`. SQL rechecks current month, Open/Ready status,
cutoff, validated prizes, saved quantities and stock under locks. One transaction
creates one Payment, one LotteryTicket per copy, decrements stock and removes
purchased saved selections. A failure rolls everything back. Direct checkout
also works when a selected number has no saved cart row.

A successful response is 201 with paymentId, drawId, amount, paymentDate and
tickets. Two copies cost "200.00" and produce two ticket IDs. The saved receipt
GET includes the real drawDate for month/year presentation. Client prices/user IDs
are rejected. Each accepted request creates a new purchase; no Idempotency-Key
or same-receipt replay exists. Inspect recent receipts after an uncertain response.

## Profile and reports

Profile GET/PATCH returns userId/name/phone/email. PATCH requires at least one
of name/phone, with the same trim/length rules as signup. Email/role/status/userId
changes are rejected. Admin Customer lists exclude privileged accounts and hashes.
Deactivation requires `{}`, returns userId/accountStatus and is repeatable.
It retains User, tickets and payments and blocks the next protected request.

Dashboard totalUsers counts Customers, including deactivated ones. A draw filter
affects sales/tickets, not that account count. Each Payment contributes once,
regardless of its joined ticket count. Lists default to page=1/pageSize=20;
maximum pageSize is 100.

Developer inventory chooses the current SQL month, not a supplied drawId. It
returns draw, summary and items with standard meta pagination. Summary fields
include expectedNumbers=1000000, numberCount, missingNumbers, purchasedCopies,
availableCopies, inconsistentNumbers and consistent. Each item contains
lotteryNumberId, ticketNumber, purchasedCopies, availableQuantity and consistent.
A number is consistent when purchasedCopies + availableQuantity = 5. Summary
always covers the whole draw, even with row filters. Counts are numbers and flags
are booleans. A read-only consistent snapshot prevents mixed checkout states.
There are no customer/payment details or Developer mutation handlers.

## Draw lifecycle and results

The current draw is the SQL month-end row for the current Thailand month. Public
reads contain it and up to 12 previous months of published results. Previous and
future numbers cannot be bought; future draw rows are hidden from Admin too.
Admin unfinished rows also wait for the preceding publication. drawNumber is a
chronological display label, never a substitute for drawId in URLs or foreign keys.

Startup/every 30 seconds, the backend closes expired sales and creates the current
month only after its first day and the preceding published result. Initial seed
and monthly automation call sp_initialize_draw. SalesStarted prevents reopening
an emergency closure. There is no POST /api/admin/draws or New Draw UI; initialize
is a technical retry for an existing row.

Sales close at 17:00 Thailand on month-end. Publication requires 18:00 or later,
Closed/Ready state and no prior result. The backend samples 13 distinct numbers
with crypto.randomInt and updates all prize slots/publication in one transaction.
There is no result edit, correction or reroll API. No commitment/proof endpoint
exists; the UI key is display-only.

Pending results have no winners and are not losses. Published results use four
tiers (1/1/1/10) and the fixed amounts. All numbers can win, including unsold ones.
Each purchased winning copy receives one tier amount. Private ticket checks
require ownership before sp_check_ticket; another customer's record returns 404.

## Errors and access

| Status | Meaning |
| --- | --- |
| 200 | Successful read/update/login/logout |
| 201 | Account/cart/purchase creation or first result publication |
| 400 | Invalid fields, JSON, ID, number, quantity or unexpected keys |
| 401 | Login required or invalid credentials |
| 403 | Wrong role, disabled account or invalid CSRF |
| 404 | Missing/unavailable record, including another user's private record |
| 409 | Duplicate email/selection, closed/unready draw, stock/cart/publication conflict |
| 413 | JSON body too large |
| 429 | Too many failed logins |
| 500 | Unexpected internal error with generic message |
| 503 | Authentication not configured |

Customer guards protect /me and /checkout; Admin protects /admin; Developer
protects /developer. Developer does not inherit Admin permissions. Changes to
these interfaces belong in the same PR as the frontend/controller updates.
See [security](security-and-tests.md) and [backend ownership](backend-allocation.md).
