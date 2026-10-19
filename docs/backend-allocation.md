# Backend task split

Each backend developer owns the assigned features, including their SQL,
validation and checks. **I am the only approver for my teammates' PRs into main.**
Teammates can test and comment, but their reviews do not replace my approval.
Coordinating GitHub does not make me responsible for all backend coding.

## My tasks

- [ ] **Express setup:** I create app.js, dependencies, environment settings and frontend serving.
- [ ] **Registration:** I require at least 8 characters/at most 72 UTF-8 bytes,
      hash passwords with bcrypt cost 10 and call sp_register_user.
- [ ] **Login and permissions:** I add MySQL sessions with a 30-minute idle timeout,
      logout, role checks, CSRF protection and ownership checks; I block deactivated accounts.
- [ ] **Checkout:** I accept number IDs/quantities, calculate the trusted total and call
      sp_checkout. I enforce one draw, max 100 copies, cutoff/readiness checks and a
      saved retry key so a double click or retry does not buy twice. One Payment
      covers one LotteryTicket row per purchased copy; only checkout reduces stock.
- [ ] **Profiles and reporting:** I add name/phone edits, fixed email for the demo,
      account deactivation, purchase/winner views and sp_admin_dashboard_summary.
      I preserve ticket/payment history.
- [ ] **API and GitHub coordination:** I maintain API notes, review and approve
      teammates' frontend/backend PRs, and help connect the frontend. Each author fixes their own bugs.
- [ ] **Final integration:** I document setup commands and run the demo with my teammates.

## Backend teammate tasks

- [ ] **MySQL setup:** Create the six main tables, keys/constraints and
      backend/db.js. Discuss session/retry/correction support together.
      LotteryNumber has Number and AvailableQuantity = 5, no TotalQuantity, and
      unique (DrawID, Number). LotteryTicket represents one copy and has no Quantity.
- [ ] **Seed data:** Prepare all one million numbers, five copies each,
      13 prize slots and separate Admin/Developer accounts with hashed passwords.
      Do not seed five million tickets; ticket rows are created only by purchases.
- [ ] **Draw APIs:** Add month-end draws at 18:00 Thailand time, automatic
      cutoff at 17:00, Admin emergency closure, public draw reads and setup status.
      Sales remain closed until full inventory and validated prizes are ready.
- [ ] **Number availability:** Add six-digit search, stock display and pagination.
- [ ] **Closure and triggers:** Write sp_close_draw and the two ticket
      guards, using checkout's draw lock. Closing catches up after restart, and
      purchases are rejected after cutoff even if the timer is late.
- [ ] **Tickets and results:** Add own-ticket/payment history, sp_check_ticket,
      per-copy prizes, 13 unique winners from all one million numbers, and publication
      no earlier than draw time. Corrections preserve before/after values, time, reason and Admin ID.
      History returns individual tickets; ticket-copy totals use COUNT, not SUM(Quantity).
- [ ] **Shared testing:** Lead SQL/stock-race/rollback checks and independently
      check authentication/checkout. Both backend developers test their own features while building them.

## Work order

| Step | My work | Backend teammate work |
| --- | --- | --- |
| 1 | I discuss the API with the team and set up Express | Discuss fields/tables together; create schema and db.js |
| 2 | I build registration, sessions and roles after db.js is ready | Add seeds and full inventory initialization |
| 3 | I prepare checkout inputs, routine and failure checks | Build draw, inventory, closure and prize APIs |
| 4 | I finish checkout after inventory/closure are ready | Build history and result publication alongside checkout |
| 5 | I add profiles/dashboard after their data is available | Run shared SQL/security checks and fix their modules |
| 6 | I connect the frontend, fix my modules and document setup | Help integration, fix their modules and run the demo |

Test throughout development. A teammate's task is ready to merge after it
works, its main failure cases are checked and I approve its PR. For my own PRs,
I follow the [README rule](../README.md#working-together); GitHub cannot record
my approval of my own PR. If a dependency blocks someone, help test/comment
or discuss a small task to hand over.

## Stored procedures and triggers

| SQL | Author |
| --- | --- |
| sp_register_user | Me; Node passes a bcrypt hash, never plaintext |
| sp_checkout | Me; owns the payment/ticket/stock transaction |
| sp_close_draw | Backend teammate |
| sp_check_ticket | Backend teammate; the API checks ticket ownership first |
| sp_admin_dashboard_summary | Me; I avoid counting a payment multiple times |
| trg_ticket_before_insert | Backend teammate; blocks closed/cutoff purchases |
| trg_ticket_before_delete | Backend teammate; protects purchased tickets |

Only sp_checkout decreases stock. Do not subtract it again in Node or a trigger.
Discuss schema changes together. I write the procedures assigned to me.

## Later, after the core works

For [transparent drawing](draw-transparency.md):

- **My tasks:** I handle secret storage, commitments and an independent replay checker.
- **Backend teammate:** Handle the public random source, deterministic generation
  and livestream/recording metadata.

Define the exact protocol together before implementing it.

Developer system status is optional. Migration/audit-log viewers and general
administration tools are not needed for the first demo. Frontend teammates: decide
the page breakdown together.
