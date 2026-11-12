# Backend

Express serves `/api` and the built React files in `frontend/dist`. Controllers
use the shared MySQL pool and the seven-table `lotto` schema. Sessions determine
identity; role and ownership checks protect private records.

## Running

Use Node.js 24+. From the LOTTO root:

```bash
cd backend
npm ci
npm run db:check
npm start
```

`npm run dev` uses Node watch mode. Stop with Ctrl+C. The root `.env` supplies
settings; existing terminal environment variables take priority. Build the
frontend separately to view React pages through Express. Health/static startup
requires no database connection or session secret.

| Setting | Purpose |
| --- | --- |
| `PORT` | HTTP port, default 3000; integer 1–65535 |
| `DB_HOST`, `DB_PORT` | MySQL address; defaults 127.0.0.1 and 3306 |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database credentials and name `lotto` |
| `SESSION_SECRET` | Private cookie-signing value, at least 32 characters |
| `SEED_ADMIN_*`, `SEED_DEVELOPER_*` | Privileged website-account credentials for the seeding command |

Quote `.env` passwords containing `#`. Keep `.env` in the root and out of Git.
Follow [local setup](../README.md#local-setup) and the
[database guide](../database/README.md#setup). `schema.sql` resets the database;
procedure/trigger installation preserves business rows.

## Files

| File or folder | Responsibility |
| --- | --- |
| `app.js` | Absolute paths, JSON parser, API mounts/guards, frontend serving and direct startup |
| `db.js` | Lazy mysql2/promise pool; read-only connection check when run directly |
| `routes/` | Route-to-controller mapping |
| `controllers/auth-controller.js` | Registration, bcrypt login, current account and logout |
| `controllers/draw-controller.js` | Public/Admin draw reads, stock, prizes and result checks |
| `controllers/cart-controller.js` | Owned CartItem create/read/update/delete |
| `controllers/checkout-controller.js` | Validates input and calls `sp_checkout(?, ?, ?)` |
| `controllers/history-controller.js` | Owned tickets, receipts, winnings and Admin purchase reports |
| `controllers/profile-controller.js` | Own Customer profile read/update |
| `controllers/admin-controller.js` | Initialization retry, close, final publication, reports and customers |
| `controllers/developer-controller.js` | Read-only current inventory snapshot and consistency report |
| `middleware/` | RAM sessions, current-user/role checks, CSRF and safe JSON errors |
| `utils/password.js` | Length/byte limits, bcrypt hashing and comparison at cost 10 |
| `utils/registration.js`, `utils/login.js` | Allowed fields and account input validation |
| `utils/api.js` | IDs, pagination, allowed fields, transaction helper and known SQL errors |
| `utils/draw.js` | Current-month SQL, public result window, prize validation and secure random sampling |
| `utils/monthly-draw.js` | Current-month creation after preceding publication; initializer call |
| `utils/close-sales.js` | Startup/30-second cutoff and monthly checks |
| `scripts/seed-accounts.js` | Missing Admin/Developer accounts from local settings |
| `test/` | Unit/HTTP checks with simulated database responses |

`app.js` exports the app without listening when imported. Known frontend routes
receive React HTML on refresh. Unknown APIs and missing assets retain 404s;
source files, root configuration and secrets are outside the served build.

## Authentication and security

1. `GET /api/auth/csrf` creates/reuses a session and returns `data.csrfToken`.
2. Registration sends name, phone, email and password with `X-CSRF-Token`.
   The controller validates, hashes and calls `sp_register_user` using parameters.
3. Login selects the account by email using `?` and verifies with `bcrypt.compare`.
   A successful login rotates the session ID and CSRF token.
4. Protected requests reload the role and AccountStatus from MySQL. Logout destroys
   the session. Deactivation blocks the next protected request.

Passwords require 8 Unicode code points and at most 72 UTF-8 bytes. Hashes have a
library-generated salt and cost 10. Passwords/hashes are never returned in API JSON.
Wrong/unknown credentials share a 401; ten failed requests per IP in 15 minutes
trigger 429. The limiter resets on restart.

Sessions use express-session MemoryStore, HttpOnly/SameSite=Lax cookies and a
30-minute idle limit. Refresh/navigation keeps login; backend restart clears it.
Production cookies require HTTPS. This RAM store is for the university demo.

`/api/me` and `/api/checkout` require Customer; `/api/admin` requires Admin;
`/api/developer` requires Developer. Developer has no inherited Admin privileges.
Mutations require CSRF, including registration/login/logout. Private queries bind
the session user ID. SQL request values are parameters; dynamic column/filter
fragments come only from code-defined choices. Constant queries need no placeholder.

## Purchases and drawing

Cart changes lock the Customer row and do not reserve stock. The checkout
controller calls `sp_checkout` without wrapping it in another Node transaction.
The procedure locks Customer → draw → inventory in ID order and commits Payment,
individual ticket copies, stock deduction and purchased-cart cleanup together.
Only this procedure deducts stock. A failure rolls back every purchase write.

Each accepted checkout request creates a new purchase. There is no retry-key
storage or receipt replay. Pending UI actions block repeated clicks; an uncertain
response requires receipt review before a retry.

The startup/30-second check closes expired sales and prepares the current month
only after the preceding result is published. `SalesStarted` prevents automatic
reopening after an emergency closure. There is no manual draw-creation endpoint.
`POST /api/admin/draws/:drawId/initialize` is a technical retry for an existing row.

Publication requires Closed/Ready sales and the scheduled 18:00 Thailand time.
Node `crypto.randomInt` selects 13 distinct numbers and the transaction saves them
with `ResultsPublishedAt`. Rerolls and result editing are unavailable. This basic
random draw has no commitment/reveal or independent public proof.

## Profile and customer management

`GET /api/me/profile` returns own userId/name/phone/email. PATCH accepts name
(1–100 characters) and/or phone (1–20), trimmed and nonempty. Extra fields,
including email, role, userId and status, are rejected.

`GET /api/admin/customers` paginates Customer accounts only. POST
`/api/admin/customers/:customerId/deactivate` with `{}` sets Deactivated without
removing purchases. Repetition is safe; missing/non-Customer targets return 404.
There is no reactivation or destructive account-delete route.

## Account seeding

Configure both account pairs in root `.env`:

- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.
- `SEED_DEVELOPER_EMAIL` and `SEED_DEVELOPER_PASSWORD`.

Use different valid emails and valid passwords of at least eight characters.
Plaintext passwords exist only in ignored local configuration; the command
hashes them through `utils/password.js` before storing them.

```bash
npm run seed:accounts
```

The command validates both configurations before writing. It reports created,
skipped, conflict or deactivated. Existing passwords/roles/status are preserved;
a conflicting Customer is never promoted. A conflict/deactivated account makes
the command exit with an error. No passwords or hashes are printed. These are
website accounts, not MySQL server logins.

## Checks

```bash
curl -i http://localhost:3000/api/health
curl -i http://localhost:3000/api/not-a-route
npm test
npm run db:check
npm run test:integration
```

Expect health 200 with `{"data":{"status":"ok"}}`, then a JSON 404. Health does
not check MySQL. `npm test` uses fake database responses and temporary HTTP ports.
Integration tests require dependencies in both folders, local MySQL CREATE/DROP
DATABASE privileges and an active monthly sales window. The runner uses and
cleans up only a new `lotto_test_*` database, with full-size inventory and real
HTTP/React flows. `npm run test:sql` is a separate Docker-only suite.

For manual page tests and row evidence, use the
[demonstration walkthrough](../demonstration/02-demo-walkthrough.md). API fields,
status codes and endpoint lists are in the [API contract](../docs/03-api-contract.md).
I write and maintain all stored procedures and triggers, including sp_checkout
and sp_admin_dashboard_summary. The backend teammate owns their checkout/reporting
routes and controllers, which call my SQL procedures. Ownership and my approval responsibility are in the
[backend allocation](../docs/backend-allocation.md).
