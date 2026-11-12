# Backend responsibilities

## My responsibilities

| Area | Files | Responsibility |
| --- | --- | --- |
| Express | `backend/app.js`, middleware/error-handler.js | I maintain startup, route mounts, static serving and safe errors |
| Authentication | routes/auth.js, controllers/auth-controller.js, middleware/auth.js/session.js/csrf.js, utils/password.js/registration.js/login.js | I maintain registration, login/logout, CSRF, RAM sessions and role checks |
| Inventory/draws | controllers/draw-controller.js, utils/draw.js/monthly-draw.js/close-sales.js | I maintain current/monthly selection, initialization, closure and public results |
| Private history | controllers/history-controller.js | I maintain own ticket/payment/receipt/winnings and ownership checks |
| Final results | controllers/admin-controller.js draw handlers | I maintain scheduled one-time generation and publication |
| Developer report | routes/developer.js, controllers/developer-controller.js | I maintain read-only inventory reporting and its role boundary |
| Stored procedures and triggers | database/procedures.sql, database/triggers.sql | I write and maintain all stored procedures and triggers, including checkout and dashboard SQL |
| Integration and review | database/api-test.cjs and guides | I verify shared rules, rehearse the demo and review teammates' changes |

## Backend teammate responsibilities

The backend teammate created `database/schema.sql` and `database/seed.sql`.
Feature ownership includes implementation review, maintenance and fixes in these
areas, even where shared integration code touches the same files.

### Profile

| File | Output |
| --- | --- |
| `backend/routes/profile.js` | GET/PATCH handlers mounted through routes/me.js |
| `backend/controllers/profile-controller.js` | Own Customer profile read/update |
| `backend/test/profile.test.js` | Validation, own-account access, CSRF and safe-error checks |

GET returns userId/name/phone/email. PATCH accepts name and/or phone, trimmed,
1–100/1–20 characters. Email, role, status and userId fields are rejected. The
WHERE user comes from the session. The UI uses `/profile` and refreshes the name
in navigation after saving.

### Admin customers

| File | Output |
| --- | --- |
| `backend/routes/admin.js` | Customer listing and deactivation endpoints |
| `backend/controllers/admin-controller.js` | Paginated Customer reads and repeatable AccountStatus update |
| `backend/test/admin.test.js` | Admin permissions, validation and retained-record checks |

Lists contain Customers only and no password hashes. Deactivation updates status,
retains tickets/payments and blocks the next protected session request. Missing/
non-Customer targets return 404. There is no destructive delete or reactivation.

### Account seeding

| File | Output |
| --- | --- |
| `backend/scripts/seed-accounts.js` | Missing Admin/Developer website accounts |
| `backend/package.json` | `npm run seed:accounts` command |
| `.env.example` | Placeholder SEED_ADMIN_* and SEED_DEVELOPER_* configuration |
| `backend/test/seed-accounts.test.js` | Creation, bcrypt, validation, conflicts and safe reruns |

The script reads root settings, reuses db.js/password.js and stores bcrypt cost-10
hashes with the correct role/Active status. Existing accounts are skipped or
reported as conflicting/deactivated without changing credentials/roles/status.
It prints no passwords/hashes and closes the pool. This ownership stays with
the backend teammate; configuration values alone do not create accounts.

### Checkout and cart

| File | Output |
| --- | --- |
| `backend/routes/checkout.js`, `controllers/checkout-controller.js` | Session Customer checkout and trusted receipt |
| `backend/utils/checkout.js` | Allowed request fields and copy limits |
| `backend/routes/me.js`, `controllers/cart-controller.js` | Owned saved-cart CRUD |
| `backend/test/features.test.js`, `database/api-test.cjs` | Validation, ownership, rollback, stock races and cart cleanup checks |

CartItem quantity is 1–5, one current draw and max 100 copies overall. Saving,
editing or deleting never reserves stock. Derive DrawID through LotteryNumber.
The teammate's checkout controller calls my sp_checkout procedure. I own its SQL
transaction and stock rules. Checkout rejects supplied prices/user IDs, locks Customer → draw → inventory,
creates one Payment and one ticket per copy, then deducts stock/cleans purchased
cart rows in the same transaction. Each accepted request is a new purchase;
there is no receipt replay. The UI blocks pending clicks and requires receipt
review after an uncertain response.

### Reporting

| File | Output |
| --- | --- |
| `backend/routes/admin.js`, `controllers/admin-controller.js` | Dashboard summary procedure call and Admin guard |
| `backend/controllers/history-controller.js` | Paginated Admin ticket/payment lists and filters |
| `database/api-test.cjs` | Real HTTP/MySQL reporting and permission checks |

The teammate's dashboard controller calls my sp_admin_dashboard_summary procedure.
I own its SQL calculations. A payment contributes to sales once, regardless of its ticket count. Customer
count includes deactivated Customers; draw filtering changes tickets/sales only.
Empty purchases give zero tickets and 0.00 sales. Return money as decimal strings.

## My stored procedures and triggers

I write and maintain all stored procedures and triggers. The backend teammate's
routes and controllers call them where needed; this does not transfer SQL ownership.

| Routine | Purpose |
| --- | --- |
| sp_register_user | Customer registration |
| sp_initialize_draw | Full inventory/prize initialization |
| sp_close_draw | Early/automatic closure |
| sp_check_ticket | Ticket results; the API checks Customer ownership before calling |
| sp_checkout | Payment, tickets, stock and purchased-cart transaction |
| sp_admin_dashboard_summary | Customer, ticket-copy and sales totals |
| trg_ticket_before_insert | Closed/cutoff/current-draw protection |
| trg_ticket_before_delete | Purchased-ticket retention |

Coordinate edits to shared controllers, app.js, dependencies and SQL. Keep routes
after their guards and before API 404 handling. Frontend teammates maintain page
layout and call the same contract. The [security guide](security-and-tests.md)
identifies automated coverage; the [walkthrough](../demonstration/02-demo-walkthrough.md)
contains live acceptance cases without assigning presentation sections to members.
