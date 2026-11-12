# LOTTO

LOTTO is the CSS326 Section 8, Group 8 database project. Customers register,
choose six-digit lottery numbers, pay through a simulated checkout and view their
purchased tickets. Admin manages sales closure, results and customer accounts.
Developer has a read-only inventory report.

## Project rules

- One draw per month, on the last day at 18:00 Thailand time (UTC+7).
- Sales close at 17:00 on draw day. Admin can close them early for an emergency.
- Each current draw has 1,000,000 numbers (`000000`–`999999`), five copies each.
- Each copy costs ฿100. One checkout covers one draw and at most 100 copies.
- Saving a cart selection leaves stock unchanged. Successful payment creates one
  Payment, one LotteryTicket per copy and decreases stock in one transaction.
- Four prize tiers have 1/1/1/10 unique winners: ฿6,000,000 / ฿200,000 / ฿80,000 /
  ฿2,000 per winning copy. Unsold numbers can win. There is no fifth prize.
- Normal monthly draws are automatic: the current calendar month begins only
  after the preceding month's results are published. Future draws are hidden.
- Published results are final through the app. The verification key displayed in
  the UI is a placeholder; it provides no cryptographic verification.

## Tools and folders

Use Node.js 24+, npm and MySQL 8.0.21+ with InnoDB as the default table engine.
The frontend uses React, TypeScript, Vite and Tailwind. The backend uses Express,
mysql2, bcrypt and server-side sessions. A Python virtual environment is not needed.

| Folder | Purpose |
| --- | --- |
| [frontend](frontend/README.md) | Pages, styles, assets and frontend tests |
| [backend](backend/README.md) | Express routes, controllers, guards and backend tests |
| [database](database/README.md) | Seven tables, six procedures, two triggers and seed data |
| [docs](docs/01-requirements.md) | Requirements, architecture, API, teamwork and security |
| [demonstration](demonstration/02-demo-walkthrough.md) | Proposal comparison, 10-minute walkthrough and matching SQL evidence |

## Local setup

Use our existing [LOTTO repository](https://github.com/Chanitsada/LOTTO).
Cloning copies the files, not another teammate's MySQL accounts or data.

1. Use a local MySQL server and database named `lotto`. Follow the
   [database setup](database/README.md#setup) for the SQL run order.
   **schema.sql drops the whole lotto database.** Use it only for an intentional
   fresh setup/reset. Routine installation does not require a reset.
2. Copy `.env.example` to `.env` in the LOTTO root only if `.env` does not exist.
   Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME=lotto`.
3. Set `SESSION_SECRET` to a private random value of at least 32 characters.
   Generate a value with:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. From the LOTTO root, install, build and start:

   ```bash
   cd frontend
   npm ci
   npm run build
   cd ../backend
   npm ci
   npm run db:check
   npm start
   ```

Open http://localhost:3000, or the configured `PORT`. Stop with Ctrl+C in the
server terminal. If port 3000 is occupied, stop the existing LOTTO server or set
another `PORT` before starting. From the LOTTO root use `cd backend`; `cd
../backend` applies when the terminal is inside `frontend`.

The health endpoint http://localhost:3000/api/health returns:

```json
{"data":{"status":"ok"}}
```

Health and static pages work without MySQL; account and lottery data require it.
Without a frontend build, `/` displays the backend running message.

For automatic backend restarts, use `npm run dev` in `backend/`. For frontend
editing, also run `npm run dev` in `frontend/` and open http://127.0.0.1:5173.
Vite proxies `/api` to Express. Use the same hostname throughout a login test.
For Express-served pages, rebuild after frontend edits and restart after backend
edits or `.env` changes.

## Accounts and pages

Register a Customer at `/register` before logging in at `/login`. Teammates must
create the test account in their own local database; the repository contains no
pre-existing Customer account.

| Field | Local test value |
| --- | --- |
| First Name | Test |
| Last Name | Customer |
| Phone | 0812345678 |
| Email | `test@lotto.test` |
| Password | `test1234` |

The form combines first/last names into `User.Name`. Signup stores a bcrypt hash
and creates an Active Customer; it does not log in automatically. If this email
already exists, reuse it for login. These credentials are for local testing only.

Admin and Developer accounts come from root `SEED_ADMIN_*` and
`SEED_DEVELOPER_*` settings. Run `npm run seed:accounts` in `backend/`; the command
hashes the configured passwords and preserves existing accounts on reruns.
Settings alone do not create accounts. See [account seeding](backend/README.md#account-seeding).

| Page | Behavior |
| --- | --- |
| `/`, `/results` | Current/past results and number checking; pending is distinct from loss |
| `/profile` | Session account details; Customer name/phone editing |
| `/buy-lottery` | Quick Pick, custom digits and live number search |
| `/checkout` | Saved selections, quantity changes, Remove and Pay |
| `/cart` | My Tickets, individual results and receipts |
| `/admin` | Draw status, emergency Close Draw, customers and purchase reports |
| `/admin/draw` | Scheduled, final publication of 13 backend-generated winners |
| `/admin/live-draw` | Result board and stream illustration; no actual video feed |
| `/developer` | Inventory totals, number search and consistency checks |

Login survives page changes/refreshes for 30 idle minutes. Sessions are in backend
RAM; a backend restart logs everyone out without deleting accounts or purchases.
Admin and Developer cannot purchase tickets. Private history uses session ownership.

## Checks

Run commands inside the specified folder:

| Folder | Command | Purpose |
| --- | --- | --- |
| `backend` | `npm test` | Validation, passwords, HTTP authentication, permissions and feature unit tests |
| `backend` | `npm run db:check` | Read-only local database connection check |
| `backend` | `npm run test:integration` | Real API/MySQL checks in a disposable `lotto_test_*` database, including a React purchase flow |
| `backend` | `npm run test:sql` | Separate Docker-only SQL suite; requires Docker and a cached MySQL 8 image |
| `frontend` | `npm test` | UI behavior with simulated APIs; the live purchase check runs under backend integration |
| `frontend` | `npm run build` | TypeScript checking and production build |

Install dependencies in both folders before integration tests. The integration
runner requires CREATE/DROP DATABASE privileges and the current month's sales
window. It initializes full-size inventory and removes only its temporary database.
Manual purchases through the website affect the selected local database.
See [security and testing](docs/security-and-tests.md) for coverage and limitations.

## Documentation and demonstration

For a freshly reset presentation database, optional
[database/demo-data.sql](database/demo-data.sql) supplies three Customers with
six purchased copies and ฿600 of sales. The
[walkthrough](demonstration/02-demo-walkthrough.md) gives the reset/seed order and
sample login details. The live registration account and number 000123 remain unused.

- [Requirements](docs/01-requirements.md): confirmed rules and role permissions.
- [Architecture](docs/02-architecture.md): request flow and file responsibilities.
- [API contract](docs/03-api-contract.md): routes, fields and responses.
- [GitHub guide](docs/04-github-guide.md): clone, branch, commit, push and PR steps.
- [Backend responsibilities](docs/backend-allocation.md): ownership and file outputs.
- [Drawing and verification](docs/draw-transparency.md): actual algorithm and limits.
- [Changes from the proposal](demonstration/01-proposal-changes.md).
- [D1–D7 demonstration walkthrough](demonstration/02-demo-walkthrough.md).
- [Matching Workbench SQL checks](demonstration/03-demo-checks.sql).

## Team workflow

I own Express/authentication, draw/inventory/history/result integration, all stored
procedures and triggers, and PR coordination. The backend teammate created
`schema.sql` and `seed.sql` and owns checkout/cart/reporting application code,
profiles, Admin customers and account seeding. Those controllers call my SQL
procedures. Frontend
teammates own presentation, page behavior and visual review.

Use feature branches and request my review. **I am the only approver for
teammates' PRs into main**, for frontend and backend. Teammates can test and
comment; their reviews do not replace my approval. Keep `.env`, credentials,
`node_modules` and generated builds out of Git.

The app uses simulated payments, RAM sessions and ordinary non-deduplicated
checkout. Block repeat clicks while waiting; after an uncertain payment response,
check receipts before paying again. Google sign-in, Remember me, password reset,
real payment processing, video streaming and cryptographic draw verification are
outside the implemented scope.
