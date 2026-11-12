# Database

MySQL stores seven business tables in `lotto`. The backend teammate created the
original schema and seed. I write and maintain all stored procedures and triggers.
The model retains the proposal's six entities and adds
CartItem for unpurchased selections. Sessions use backend RAM, not a SQL table.

## Setup

Use MySQL 8.0.21+ with InnoDB as the default engine. The schema inherits server
defaults for engine, character set and collation. Check the server before setup:

```sql
SHOW VARIABLES WHERE Variable_name IN
('default_storage_engine', 'character_set_server', 'collation_server');
```

InnoDB is required for transactions, row locks and foreign keys. Use utf8mb4 for
Thai/Unicode text and a case-insensitive collation for the intended email
uniqueness. Omitting explicit options works only when those defaults are suitable.

For a fresh database or an intentional full reset, run in MySQL Workbench:

1. `schema.sql` — drops/recreates `lotto` and creates the tables.
2. `procedures.sql` — installs routines.
3. `triggers.sql` — installs ticket protections.
4. `seed.sql` — supplies initial draw data.

**schema.sql deletes all lotto data, including accounts and purchases.** Stop on
any SQL error. Configure root `.env` with `DB_NAME=lotto` and local MySQL
credentials, then run `npm run db:check` from `backend/`.

For an existing compatible database, stop the backend and reinstall procedures
and triggers without running schema.sql. The procedure file adds `SalesStarted`
only if missing and preserves its values on later runs. Restart the backend
and log in again. `CREATE TABLE IF NOT EXISTS` does not repair an incompatible
older table; compare definitions before applying an ALTER. If CartItem alone is
missing, run only its CREATE TABLE block with `lotto` selected.

Legacy CheckoutRequest, ResultCorrection and sessions tables are unused by the
current app. They are not part of the seven-table design. Their old records need
no migration for this demo; removing them is a separate deliberate database action.

## Presentation sample data

After a fresh reset and the four setup files above, run
[demo-data.sql](demo-data.sql) in Workbench. It creates Nicha, Arun and Mali as
Active Customers with the local test password `test1234`, stored as three
separately salted bcrypt hashes. Their normal checkout transactions create
three payments totalling ฿600 and six individual tickets for the current draw.

The sample file is optional; ordinary seed.sql still supplies draws/results only.
It requires the current draw to be open before cutoff. If any of its three sample
emails already exists, it skips all sample creation, preserving accounts and
purchases. It leaves number 000123 and the live-registration email unused.
Its temporary helper removes itself after a successful run, leaving the six
application procedures. If execution fails, stop and inspect the error; the file
does not promise one transaction across all three Customers' purchases.

Use the [walkthrough](../demonstration/02-demo-walkthrough.md) for accounts, numbers
and the reset/run order. Run npm run seed:accounts again after a reset to restore
local Admin/Developer accounts. No reset is needed for normal application use.

## Tables and relationships

| Table | Stores | Relationships and important constraints |
| --- | --- | --- |
| `User` | Name, phone, unique email, bcrypt hash, role and AccountStatus | One user owns many carts, payments and tickets; roles Customer/Admin/Developer |
| `LotteryDraw` | Month-end date, cutoff/draw timestamps, status, initialization, SalesStarted and publication | Unique DrawDate; one draw has many numbers and prizes |
| `LotteryNumber` | TicketNumber string and AvailableQuantity | FK DrawID; unique (DrawID, TicketNumber); quantity 0–5 |
| `CartItem` | Unpurchased Quantity, default 1 and range 1–5 | FKs UserID/ LotteryNumberID; unique user/number |
| `Payment` | Amount and payment time | FK UserID; one payment covers many purchased copies |
| `LotteryTicket` | One purchased copy and purchase time | FKs UserID, LotteryNumberID, PaymentID; no Quantity |
| `Prize` | Tier, fixed amount and nullable winning number | FK DrawID; unique (DrawID, WinningNumber) after assignment |

DrawID in a cart/ticket is derived through LotteryNumber. It is not stored again.
AUTO_INCREMENT assigns IDs when INSERT supplies other fields. DrawID is a stable
key; the Admin `drawNumber` is a separate chronological display label. Never
renumber referenced keys. Foreign keys use RESTRICT, preserving purchase history.

Cart APIs enforce one current draw, max 100 copies, role and ownership. These
cross-row rules are not enforced by the CartItem CHECK alone. Payment ownership
must match the ticket buyer; the insert trigger also checks that relationship.

## Inventory and seed data

- Every current draw has 1,000,000 six-digit numbers, `000000`–`999999`.
- Each number starts with five copies; TotalQuantity is redundant and absent.
- LotteryTicket rows exist only after successful purchases, one per copy.
- Each draw has 13 prize slots: 1st/2nd/3rd each one and 4th ten. WinningNumber
  stays NULL until publication. Amounts are 6000000.00/200000.00/80000.00/2000.00.

`seed.sql` uses the actual current Thailand month. It supplies missing, fictional
result-only fixtures for the previous 12 months, oldest first, then initializes
the current month. Historical fixtures have no ticket inventory or buyers.
Existing draws/results/accounts/purchases are preserved. An existing unfinished
preceding month causes PREVIOUS_DRAW_PENDING rather than invented publication.

`sp_initialize_draw` inserts missing inventory in 100 batches of 10,000 inside
one transaction and validates the prize configuration. It opens the current draw
before cutoff on its first successful setup and sets SalesStarted. Reruns never
restore sold copies or reopen an emergency closure.

Normal monthly creation runs from Express on startup and every 30 seconds, after
the month begins and the preceding result is published. The seed is a bootstrap,
not a monthly manual requirement. Future rows are hidden from page/API selectors.
If the preceding result remains pending, automatic creation waits.

## Time and publication

DrawDate is the Thailand month-end date. DATETIME values use UTC:
SalesCloseAt is 10:00 UTC (17:00 Thailand) and DrawAt is 11:00 UTC (18:00 Thailand).
Checkout tests the cutoff inside its transaction even if the closing timer is late.
MySQL's normal SYSDATE wall clock is required; do not enable `--sysdate-is-now`.

ResultsPublishedAt separates pending results from published ones. Backend
publication writes all 13 unique winners and that timestamp in one transaction.
Published results have no edit/reroll API. Direct database-owner SQL access is
outside website-role restrictions. Past seed winners are fixtures, not evidence
of a live cryptographic draw.

## Procedures

| Procedure | Inputs | Effect or result |
| --- | --- | --- |
| `sp_register_user` | Name, phone, email, bcrypt hash | Creates Active Customer; returns public account fields |
| `sp_checkout` | UserID, DrawID, JSON items | One Payment, one ticket per copy, stock deduction and purchased-cart cleanup |
| `sp_close_draw` | DrawID | Closed status while coordinating with checkout's draw lock |
| `sp_check_ticket` | TicketID | Pending/win/loss and prize information |
| `sp_admin_dashboard_summary` | DrawID or NULL | Customer count, purchased copies and sales; each payment counted once |
| `sp_initialize_draw` | Existing DrawID | Reusable number/prize initialization and first opening |

The procedure file briefly creates/calls/removes `sp_update_draw_schema` to
support SalesStarted on older databases. It leaves six persistent procedures.

Checkout locks Customer → draw → inventory, validates current month/cutoff/stock/
cart quantities, calculates copies × ฿100 and commits all changes together.
Failures roll back Payment, tickets, stock and cleanup. Node/triggers do not
subtract stock again. Each accepted request is a new purchase; there is no saved
retry key or receipt replay. Inspect receipts after an uncertain response.

`sp_check_ticket` is called after API ownership checks. Pending winnings are
unknown; a winning ticket gets one tier amount; a losing ticket gets 0.00.
Two winning copies earn twice the tier amount. Dashboard Customer counts include
deactivated Customers; a draw filter affects tickets/sales, not that account count.

## Triggers

| Trigger | Event | Protection |
| --- | --- | --- |
| `trg_ticket_before_insert` | BEFORE INSERT on LotteryTicket | Requires current, Open/Ready, unpublished draw before cutoff and matching payment owner |
| `trg_ticket_before_delete` | BEFORE DELETE on LotteryTicket | Signals PURCHASED_TICKET_DELETE_BLOCKED |

The first trigger does not deduct stock. The second protects purchased records;
it does not prevent removing an unpurchased CartItem.

## Checking data

| File or command | Purpose |
| --- | --- |
| `npm run db:check` in backend | Connection/database-name check without writes |
| `npm run test:integration` in backend | Full-size HTTP/MySQL tests in a disposable database |
| `test.cjs` / `npm run test:sql` | Additional Docker-only constraints/trigger/transaction tests |


Integration tests require local CREATE/DROP DATABASE privileges, dependencies in
both app folders and the current month's sales window. They isolate all fixture
writes in `lotto_test_*` and remove that database. The Docker suite needs Docker
and a cached MySQL 8 image. Neither runner imports fixtures into the project lotto.

Admin/Developer accounts come from `backend/scripts/seed-accounts.js`, with bcrypt
hashes and safe reruns. Public registration creates Customers only. See
[account seeding](../backend/README.md#account-seeding) and the
[proposal comparison](../demonstration/01-proposal-changes.md).
