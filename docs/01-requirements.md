# 01 - LOTTO project: overview and requirements

LOTTO is the CSS326 Group 8 database project. Customers choose lottery numbers,
buy copies with simulated payment and check their results. Admins manage draws,
customer status, purchases and sales information.

**Current stage: planning. The application and SQL are not implemented yet.**
Use this document as the reference for confirmed rules and the project build order.

## Confirmed decisions

**These rules are confirmed. They are not open questions.**

| Topic | Confirmed rule |
| --- | --- |
| Draw schedule | One draw per month, last calendar day at 18:00 Asia/Bangkok (Thailand, UTC+7) |
| Sales cutoff | 17:00 on draw day; no new purchases at or after cutoff |
| Closing method | Automatic at cutoff, plus Admin emergency early closure |
| Prize calculation | Prize amount × copies of the winning number purchased |
| Prize tiers | Four finalized tiers, 13 distinct winning numbers (1/1/1/10); no 5th prize or placeholder amounts |
| Unsold numbers | All one million numbers can win, including numbers with no buyers |
| Inventory storage | One LotteryNumber row per number/draw, AvailableQuantity starts at 5; no TotalQuantity |
| Ticket storage | One LotteryTicket row per successfully purchased copy; no pre-created ticket records |
| Checkout | One draw, max 100 copies total, no stock reservation while browsing |
| Duplicate submissions | Same checkout key returns the same receipt without another payment, ticket insertion or stock deduction |
| Profile editing | Name and phone; email changes disabled for the demo, no role edits |
| Account deletion | Deactivate instead; retain tickets/payments; anonymize personal data only under an agreed retention policy |
| Result corrections | Keep original/corrected values, timestamp, reason and the Admin who made the change |
| Passwords | At least 8 characters, bcrypt cost 10; reject input over 72 UTF-8 bytes |
| Sessions | Server-side MySQL sessions with a 30-minute inactivity timeout |
| Prize configuration | Sales stay closed until every prize amount is entered and validated |
| Draw verification | Optional if time permits; documented algorithm and independent public random source before claiming verifiable fairness |
| Pull requests to main | I am the only approver for my teammates' frontend/backend PRs |

## Contents

1. [Project and tools](#1-project-and-tools)
2. [Users and features](#2-users-and-features)
3. [How the website works](#3-how-the-website-works)
4. [Lottery rules and prizes](#4-lottery-rules-and-prizes)
5. [Schedule and closing](#5-schedule-and-closing)
6. [Checkout and payment](#6-checkout-and-payment)
7. [Accounts and result corrections](#7-accounts-and-result-corrections)
8. [Database](#8-database)
9. [Responsibilities and build order](#9-responsibilities-and-build-order)
10. [Optional work and implementation details](#10-optional-work-and-implementation-details)

## 1. Project and tools

The main goal is to connect a simple website to a reliable MySQL database. The
demo should show login, inventory, purchases, results and Admin actions working
together, including failed requests and simultaneous purchases.

| Part | Tool or approach | Purpose |
| --- | --- | --- |
| Frontend | HTML, CSS, JavaScript | Pages, styling, selections and API requests |
| Backend | Node.js and Express | Sessions, validation, APIs and database calls |
| Database | MySQL 8 | Tables, relationships, procedures and triggers |
| Database library | mysql2/promise | Shared pool and parameterized SQL using ? |
| Passwords | bcrypt, cost 10 | Password hashes instead of plaintext |
| Sessions | Server-side, stored in MySQL | Login state with 30-minute idle expiry |
| Payment | Simulated | A purchase demo without a real gateway or withdrawal system |
| Collaboration | Git and GitHub | Feature branches and PRs that I approve |

Use one Express server for the frontend files and `/api` routes, following the
labs' route/controller/middleware pattern. Follow the [folder guide](02-architecture.md)
and [API notes](03-api-contract.md) for the planned files and interfaces.

## 2. Users and features

| Role | Features |
| --- | --- |
| Visitor | Browse draws, number availability, prizes/results and register or log in |
| Customer | Buy copies, view own tickets/payments, check winnings and edit name/phone |
| Admin | Create/close draws, view sales/customers/purchases, deactivate customers and publish/correct results |
| Developer | Technical maintenance; an optional read-only status view can come later, with no automatic Admin access |

Public registration creates Customer accounts only. Seed Admin and Developer
accounts separately with hashed passwords. Customers cannot choose a privileged
role at signup or change their role through a profile edit.

Developer maintenance means reviewed code, SQL and configuration work. Website
tools that run SQL or expose secrets are not needed. Extra Developer website permissions
are optional, not required for the core demo. Website roles do not depend on which
teammate writes the code.

The frontend features include signup/login, draw/number browsing, selection review,
My Tickets/history, results, profile and Admin views. Split this work between the
two frontend teammates and choose the layout and task breakdown together.

## 3. How the website works

### Customer flow

1. Browse available draws and prize information.
2. Register or log in with an active Customer account.
3. Choose a draw, search for six-digit numbers and select copy quantities.
4. Review selections and total; browsing does not reserve stock.
5. Confirm simulated payment. The backend checks the draw, cutoff, stock and checkout key.
6. Receive one receipt covering all purchased lines.
7. View tickets/history. Results remain **pending** until publication.
8. Check win/loss and winnings after results are published.
9. Edit name/phone if needed, or log out.

The cart contains unpurchased selections. Create one LotteryTicket record per
copy only inside a successful checkout, never while seeding or browsing. A customer
can access only their own private records.

### Admin flow

1. Log in with a separately seeded Admin account.
2. Create the monthly draw, full inventory and 13 prize slots.
3. Open sales only after inventory and prize amounts are ready and validated.
4. View sales, purchases, customers and draw status.
5. Let sales close automatically at 17:00, or close early for an emergency.
6. Publish results at or after the scheduled 18:00 draw through the documented drawing process.
7. View winners and append a correction with its reason/history when necessary.
8. Deactivate customer accounts when appropriate, retaining purchases/payments.

## 4. Lottery rules and prizes

| Rule | Behavior |
| --- | --- |
| Offered numbers | All 1,000,000 numbers, 000000–999999, every month |
| Number format | Six-digit strings, preserving leading zeros |
| Copies per number | Five, following the proposal |
| Initial inventory | 1,000,000 LotteryNumber rows with AvailableQuantity = 5, representing 5,000,000 available copies |
| Purchased-ticket rows at setup | Zero; do not pre-create five million LotteryTicket records |
| Price | ฿100 per copy |
| Eligible winners | Any number, including unsold numbers |
| Winner uniqueness | 13 different numbers; no repeat within or across tiers |

Initialize number records in batches. Partial initialization never allows
purchases, and rerunning seeds must not reset already-sold stock. Small datasets
are only for separate test fixtures.

LotteryNumber stores DrawID, Number and AvailableQuantity, with a unique
constraint on **(DrawID, Number)**. Keep Number as a six-digit string and
AvailableQuantity between 0 and 5. Remove TotalQuantity because every number
starts with exactly five copies under the current rules.

| Prize tier | Winning numbers | Amount per winning number |
| --- | --- | --- |
| 1st | 1 | ฿6,000,000 |
| 2nd | 1 | ฿200,000 |
| 3rd | 1 | ฿80,000 |
| 4th | 10 | ฿2,000 |
| Total | 13 unique numbers | |

There is no 5th prize. Winnings are **tier amount × purchased copies**. Two copies
of a 4th-prize number receive **2 × ฿2,000 = ฿4,000**. An unsold winning number has
no customer tickets to award. Store money as DECIMAL and return two-decimal strings.

## 5. Schedule and closing

The business timezone is **Asia/Bangkok, Thailand (UTC+7)**.

| Event | Rule |
| --- | --- |
| Monthly draw | Last calendar day at 18:00 |
| Sales cutoff | Same day at 17:00 |
| Normal closure | Automatic |
| Emergency closure | Admin can close earlier; the scheduled draw time does not change |
| Opening sales | Only after full inventory and all validated prize amounts are ready |

For November 2026, the draw is **30 November, 18:00**, with sales stopping at **17:00**.
Calculate each month's actual last day, including February/leap years. Store
full UTC timestamps and display Thailand times.

The closing check catches up after restart. Checkout also checks the actual time
inside its transaction, so a late timer cannot allow purchases at/after 17:00.
Closing early does not permit drawing or publishing results before 18:00. Closed
sales and published results are different: tickets stay pending until publication.

## 6. Checkout and payment

| Rule | Behavior |
| --- | --- |
| Draws per checkout | One |
| Maximum copies | 100 total across all selected numbers |
| Reservation | None while browsing; backend rechecks live stock |
| Payment | One record for the successful checkout |
| Tickets | One individual row per purchased copy; no Quantity column is needed on LotteryTicket |
| Total | Backend calculates copies × ฿100; client prices are not trusted |
| Repeat submission | Same checkout returns its original receipt, not another purchase |
| Failure | Payment, tickets and inventory all roll back together |

### Example

| Number | Copies | Cost |
| --- | --- | --- |
| 000001 | 2 | ฿200 |
| 123456 | 1 | ฿100 |
| Total | 3 | ฿300 |

This checkout saves one Payment of ฿300 and **three LotteryTicket rows** linked to
it: two separate tickets for 000001 and one for 123456. Each ticket has its own TicketID.
Stock drops by two for 000001 and one for 123456. If either selected number fails,
no part of the purchase remains.

`sp_checkout` performs these steps in one transaction on one connection:

1. Lock the draw and check Open status, the sales cutoff and setup/prize readiness.
2. Lock selected LotteryNumber rows in a consistent order; check positive requested
   quantities against AvailableQuantity and the 100-copy total limit.
3. Calculate total copies × ฿100 using trusted server/database values.
4. Create one simulated Payment for the checkout.
5. Insert one LotteryTicket per purchased copy, all linked to that Payment and buyer.
6. Decrease AvailableQuantity once by each selected number's purchased quantity.
7. Commit everything together, or roll back all changes if any step fails.

`sp_close_draw` uses the same draw lock. Only the checkout procedure decreases
inventory; neither Node nor a trigger subtracts it again.

The browser creates one checkout key and reuses it for double clicks/retries.
Store a unique key per user with the Payment and compare the requested items. A
completed matching retry returns the original receipt even after sales close;
the same key with different items conflicts. A disabled button alone is insufficient.

## 7. Accounts and result corrections

### Account rules

- Passwords require at least 8 characters and at most 72 UTF-8 bytes, hashed using
  bcrypt cost 10. Reject overlong passwords instead of silently truncating them.
- MySQL sessions expire after 30 idle minutes, refreshed on activity and enforced
  server-side. Login creates a fresh session; logout invalidates it.
- Customers edit name/phone. Email is fixed for the demo; profile edits cannot change roles.
- Deactivate accounts instead of permanently deleting tickets or payments.
  Deactivated accounts cannot log in or keep using an existing session.
- Anonymize personal information only under an agreed retention policy.

Check roles/ownership on the backend, use ? SQL parameters and CSRF protection,
and return safe errors. Passwords/hashes, session IDs and private draw secrets never
appear in responses/logs. Use the [checklist](security-and-tests.md) to check the main cases.

### Results and corrections

A ticket represents one copy. It shows pending until publication, win with one
tier amount, or loss with zero winnings. A customer's total is the sum of their
individual winning tickets: two 4th-prize tickets give ฿4,000 together. Pending
winnings are unknown, not a losing value.

Never silently overwrite a published result. Retain the original plus every
correction's before/after values, timestamp, reason and Admin ID. The corrected
result still needs 13 unique numbers in the 1/1/1/10 split. The website shows when
a correction happened and keeps the original history.

## 8. Database

| Main table | Stores | Relationships |
| --- | --- | --- |
| User | Name, phone, email, password hash, role, active status | One user has many payments/tickets |
| LotteryDraw | Date/time, cutoff and sales status | One draw has many numbers/prizes |
| LotteryNumber | LotteryNumberID, DrawID, Number, AvailableQuantity (initially 5); no TotalQuantity | Unique (DrawID, Number); one number/draw can have many purchased ticket copies |
| LotteryTicket | TicketID, UserID, LotteryNumberID, PaymentID, purchase time; one row per copy, no Quantity | Belongs to one user, number and payment |
| Prize | Draw, tier, winning number and amount; 13 slots | Belongs to one draw; number is unset before results |
| Payment | Buyer, amount, time, checkout retry key | Covers all individual ticket copies in one checkout |

Keep the same buyer on payment and tickets. Multiple tickets can have the same
PaymentID and LotteryNumberID because a customer can buy several copies of one number.
Do not add a unique constraint on that pair. Foreign keys must not cascade
account/payment deletion into purchased tickets. Small additions support persistent
sessions and result-correction history; an administration platform is not needed.

| Required procedure | Purpose |
| --- | --- |
| sp_register_user | Create a Customer using a bcrypt hash supplied by Node |
| sp_checkout | Save the payment/ticket/stock transaction |
| sp_close_draw | Close sales using checkout's draw lock |
| sp_check_ticket | Join ticket, number, draw and prizes to check a ticket |
| sp_admin_dashboard_summary | Return users, ticket copies and sales without multiplying payments in joins |

- `trg_ticket_before_insert` rejects closed/cutoff purchases.
- `trg_ticket_before_delete` protects purchased tickets from deletion.

Only sp_checkout decreases inventory; neither Node nor triggers subtract again.
The API checks ticket ownership before a ticket-specific procedure call.

The proposal repeats Payment creation and has duplicated Payment text in its Prize
CRUD row. The confirmed rules are one Payment per checkout and the four prize tiers
above. See the [database notes](../database/README.md) for planned SQL files and
the [task split](backend-allocation.md#stored-procedures-and-triggers) for authors.

## 9. Responsibilities and build order

| Person | Main responsibility |
| --- | --- |
| Me | Express, authentication, checkout, profiles/reporting, API notes and GitHub coordination |
| Backend teammate | MySQL, seeds, draws/inventory, tickets/history, results and shared testing |
| Frontend teammates | Split frontend tasks and connect pages to the APIs |

Each author includes SQL, validation and checks for their features and fixes their
own bugs. **I am the only approver for my teammates' PRs into main**, including
frontend work. Teammates can test/comment, but their reviews do not replace my
approval. I follow the [README rule](../README.md#working-together) for my own PRs,
since GitHub cannot record my self-approval. Coordination does not make me the
author of all backend work.

1. Discuss fields/API format and prepare Express/MySQL in parallel.
2. I build authentication. Backend teammate: prepare seeds in parallel.
3. Backend teammate: build draws, inventory, closing and prize APIs.
4. I finish checkout. Backend teammate: add history/results.
5. I add profiles/dashboard. Run failure/race checks together.
6. Integrate the frontend and rehearse the full demo from a clean local DB.
7. Add optional verification only after the core works.

The [backend checklist](backend-allocation.md) has the exact split. Use feature
branches and discuss changes before editing shared files at the same time.
Follow the [team GitHub guide](04-github-guide.md) for step-by-step commands covering
cloning, commits, pushes, PRs and requesting my approval.

## 10. Optional work and implementation details

Verification is already agreed as **optional if time permits**, not a core blocker.
Read the [verification note](draw-transparency.md) for commitments, secret reveal,
independent public randomness and reproducible generation. Hashing or a livestream
alone does not establish fairness. Document the drawing algorithm even if the
optional verification extension is deferred.

The remaining implementation details do not reopen the confirmed decisions:

- The personal-data retention period/anonymization process is not specified yet.
  Deactivation and retaining tickets/payments are settled.
- Extra profile fields and a Developer status page are optional later work.
- Define the exact drawing algorithm and, if added, the simulated-decline
  response/correction display details. Prize amounts, per-copy winnings and history retention are settled.
- If verification is added, select its public source, future round, encoding,
  proof check and outage policy before generating results.

The proposal lists consultation on 31 October and demonstration on 6 November
2026. Confirm those course dates before treating them as deadlines.
