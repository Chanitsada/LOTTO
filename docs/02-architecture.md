# 02 - Architecture and folder guide

One Express server serves the React build and `/api`. During development, Vite
on 5173 proxies API requests to Express using the root PORT setting.

## Request flow

```text
React page
  → api.ts (JSON, cookie, CSRF)
  → Express route
  → session, role and ownership checks
  → controller validation
  → shared MySQL pool / stored procedure
  → {data: ...} or {error: {code, message}}
```

Public draw reads need no login. Registration/login use anonymous CSRF sessions.
Private routes reload the current User role/status. The session stores identity
in server RAM, not localStorage. Logout, idle expiry and restart end the login.

## Backend

| Path | Responsibility |
| --- | --- |
| `backend/app.js` | Root .env, JSON parsing, guard/router order, static build, safe fallback and startup |
| `backend/db.js` | Shared lazy mysql2/promise pool, UTC conversion and db:check |
| `backend/routes/` | auth, draws, me, profile, checkout, admin and developer endpoints |
| `backend/controllers/` | Request validation, SQL/procedure calls and public JSON fields |
| `backend/middleware/` | Session cookie, login/role/CSRF checks and error handling |
| `backend/utils/api.js` | Allowed fields, IDs, pagination, known SQL errors and transaction helper |
| `backend/utils/password.js` | bcrypt hashing/comparison and password limits |
| `backend/utils/registration.js`, `login.js` | Account input rules |
| `backend/utils/draw.js` | Current/public draw SQL, prize validation and random generation |
| `backend/utils/monthly-draw.js` | Creates current month after preceding publication and calls initialization |
| `backend/utils/close-sales.js` | Startup/30-second close/monthly timer |
| `backend/scripts/seed-accounts.js` | Missing local privileged accounts |
| `backend/test/` | Unit and HTTP tests with fake database responses |

The app exports Express without opening a port when imported. Absolute paths make
startup independent of the terminal folder. Known page routes get the React HTML;
unknown APIs/assets remain 404. Health does not query MySQL.

## Frontend

| Path | Responsibility |
| --- | --- |
| `frontend/src/App.tsx` | Routes and authentication forms |
| `frontend/src/api.ts` | Cookies, CSRF, mutations, JSON errors and list metadata |
| `frontend/src/auth.tsx` | Session restoration, login/logout and current account |
| `frontend/src/layout.tsx` | Shared navigation/footer |
| `frontend/src/lottery-shared.tsx` | Data loading, pagination, dates, draw picker and role/result components |
| `frontend/src/lottery-pages.tsx` | Public and Customer screens |
| `frontend/src/admin-pages.tsx` | Admin draw/customer/report/result screens |
| `frontend/src/developer-page.tsx` | Read-only inventory report |
| `frontend/src/index.css` | Supplied design and responsive connected states |
| `frontend/public/` | Static images/icons |
| `frontend/test/` | UI tests and the optional real-API purchase test |
| `frontend/vite.config.ts` | React/Tailwind build and server-side API proxy |
| `frontend/dist/` | Generated build served by Express; ignored by Git |

Each app folder has its own package.json, lockfile and node_modules because its
dependencies differ. Commit package files; exclude node_modules and dist.
Root database credentials/session secrets are never defined in the client bundle.

## Database

| Path | Responsibility |
| --- | --- |
| `database/schema.sql` | Full reset and seven tables, foreign keys, unique keys and CHECK constraints |
| `database/procedures.sql` | SalesStarted compatibility setup and six permanent procedures |
| `database/triggers.sql` | Before-insert and before-delete ticket protections |
| `database/seed.sql` | Current monthly inventory and previous 12 fictional result-only draws |
| `database/test.sql` | Optional User inspection |
| `database/api-test.cjs` | Full-size real API/MySQL tests in a temporary database |
| `database/test.cjs` | Separate disposable Docker SQL tests |

CartItem references User and LotteryNumber; DrawID comes through the number.
LotteryTicket represents one purchased copy. Payment groups one checkout's copies.
Only sp_checkout changes stock during a purchase. It owns its transaction, so the
controller does not start an outer one. Cart mutations share its Customer lock.
Closure/publication serialize through the draw lock.

## Documentation

`docs/` contains requirements, this architecture, the API contract, GitHub guide,
backend allocation, security/testing and drawing details. `demonstration/` has
exactly three files: proposal differences, a timed page walkthrough and matching
SQL checks. Start/run commands are in the [main guide](../README.md#local-setup).
