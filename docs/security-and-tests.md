# Security and testing

This guide describes protections, automated coverage and manual checks for LOTTO.
Test output is execution evidence for that run; this document is not a test log.

## Security controls

| Control | Implementation | Evidence |
| --- | --- | --- |
| Salted password hashing | bcrypt.hash at cost 10; bcrypt.compare on login | utils/password.js, auth-controller.js, User.Password |
| Password limits | 8 Unicode characters minimum, 72 UTF-8 bytes maximum | password.js and password tests |
| SQL parameters | Request/session values use `?`; dynamic clauses use code-defined fragments | Controllers, middleware/auth.js, scripts/seed-accounts.js |
| Current identity | Server-side session and account-status/role reread | middleware/session.js/auth.js |
| Session lifetime | 30 idle minutes; logout destroys session; restart empties RAM store | Login/session tests |
| Cookie protection | HttpOnly, SameSite=Lax; Secure in production | middleware/session.js |
| CSRF | Session token on mutations, rotated at login | middleware/csrf.js, frontend/src/api.ts |
| Role boundaries | Customer, Admin and Developer guards on backend prefixes | app.js and permission tests |
| Ownership | Session user in cart/profile/ticket/payment predicates | Private controllers and ownership tests |
| Login failures | Shared unknown/wrong response and failure rate limit | routes/auth.js and login tests |
| Safe errors | Known error codes only; generic unexpected errors | error-handler.js and utils/api.js |
| Secrets | Root .env ignored; static serving limited to frontend/dist | .gitignore, app.js, vite.config.ts |

Constant queries such as health/database metadata or a fixed cutoff UPDATE have
no external values and need no placeholder. Profile column names and optional
report predicates are selected from source-code allowlists; values remain bound.
Hashes are absent from API responses. For D5, inspect only the disposable test
Customer's stored hash in Workbench, as the rubric requests.

## Commands and isolation

| Location | Command | Database behavior |
| --- | --- | --- |
| backend | `npm test` | Fake pool/accounts; real HTTP/session middleware; no personal database |
| frontend | `npm test` | Simulated APIs; ordinary run skips the real-API purchase case |
| frontend | `npm run typecheck` | Static TypeScript check |
| frontend | `npm run build` | TypeScript and production build |
| backend | `npm run db:check` | SELECT database name on configured local database |
| backend | `npm run test:integration` | New temporary lotto_test_* database with real SQL/API/React checks; cleanup drops only it |
| backend | `npm run test:sql` | Separate Docker MySQL container with SQL constraint/trigger tests |

Install dependencies in both folders before integration. The MySQL integration
user needs CREATE/DROP DATABASE privileges. Full-size fixtures allocate one
million numbers per initialized draw and can take time. Purchase cases require
the current month before its last-day 17:00 Thailand cutoff. Fixed test RNG output
makes winnings reproducible only in the test; production sampling has separate
unit coverage. Test session-clock/date fixtures do not change the MySQL server
clock or project database.

The Docker-only suite needs Docker and a cached MySQL 8 image; it is not recorded
as executed locally. DOM tests are not a substitute for desktop/mobile visual
review. Manual demonstration actions affect the selected demo database.

## Coverage

| Area | Automated cases |
| --- | --- |
| Server | Import without listening; startup/ports; health; JSON 400/404/413/500; no-store; frontend/static boundaries |
| Accounts | Allowed fields, trim/length/byte limits, salted bcrypt, duplicates, Customer-only signup |
| Login | Correct/wrong/unknown credentials, CSRF, ID rotation, refresh, logout, idle expiry, empty RAM store, failure limiting |
| Roles/profile | Customer/Admin/Developer permissions, own profile updates, forbidden fields and disabled accounts |
| Account seed | Correct roles/hashes, invalid settings, unchanged reruns, conflicts and deactivated accounts |
| Inventory | One million numbers/five copies, leading zeros, 13 prize slots, safe reruns and missing/copy-mismatch detection |
| Monthly lifecycle | Previous result/month boundary, concurrent setup, first opening and preserved emergency closure |
| Cart | Ownership, actual DELETE, duplicate selection, one draw, 1–5 copies, 100-copy races and no stock deduction |
| Checkout | One payment/per-copy tickets, trusted pricing, stock locks, concurrent buyers, rollback and cart cleanup |
| History/reporting | Private ticket/receipt access, correct payment totals and deactivation retention |
| Results | Scheduled one-time publication, uniqueness/amounts, pending/win/loss and per-copy winnings |
| Frontend | Auth, stock/cart/payment, receipts, results, Admin controls, Developer report and stale/error states |

## Manual acceptance checks

- Start the server/build before the presentation and use one hostname for cookies.
- Test desktop/mobile navigation, long month labels, digit inputs and messages for overlap.
- Run Customer page CRUD and show each affected table row in Workbench.
- Confirm add/edit/delete leaves stock unchanged; Pay commits payment/tickets/stock together.
- Show a stored bcrypt hash and a login that verifies it; open parameterized query code.
- Compare at least Customer/Admin access using server 403/200 responses.
- Execute procedure/trigger evidence and confirm protected ticket rows survive.
- Run purchases before emergency closure; there is no reopening page.
- Keep all four members involved and complete the demonstration within ten minutes.

The prepared cases and SQL sections are in the
[D1–D7 walkthrough](../demonstration/02-demo-walkthrough.md). Anything shown only
by screenshot/video receives at most half of that criterion under the supplied
rubric. Scheduled publication cannot be demonstrated live before draw time;
use live checkout/closure for procedure evidence and identify publication backup
recordings accurately.

## Scope limits

RAM sessions clear on backend restart and are unsuitable for multiple server
processes. Checkout has no retry-key deduplication: each accepted request is a new
purchase. After an uncertain payment response, inspect receipts before retrying.
Payments are simulated. Results cannot be edited through the app, but a database
owner can change rows directly. Public cryptographic verification is unavailable;
the displayed key is not proof. Retention/anonymization, password reset, external
identity providers and video streaming are outside the implemented demo.

## Checks before merging

Run checks relevant to the affected feature, inspect staged files for secrets and
keep generated dependencies/builds excluded. Coordinate shared API/schema changes.
I review teammates' PRs into main; their reviews do not replace my approval.
