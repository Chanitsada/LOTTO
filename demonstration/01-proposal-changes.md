# Changes from the proposal

This report compares the implemented LOTTO model with
`CSS326_Sec8_Group8_Proposal.docx.pdf` (Group 8). Page references below use the
printed page numbers, not the PDF viewer's cover-inclusive page count.
The comparison records current design decisions, not a chronological update log.

## Purpose and retained design

The project remains a lottery database website with Customer, Admin and Developer
roles. The original six entities remain: User, LotteryDraw, LotteryNumber,
LotteryTicket, Payment and Prize. Their original foreign-key relationships remain.
The backend is Node/Express with MySQL, mysql2 parameters and bcrypt cost 10.
Payments are simulated.

The five proposed procedures remain: sp_register_user, sp_checkout,
sp_close_draw, sp_check_ticket and sp_admin_dashboard_summary. Both proposed
triggers remain: trg_ticket_before_insert and trg_ticket_before_delete.
Five starting copies per number also appear in the proposal's CRUD plan (p.14);
that is a retained rule, not a new requirement.

## Schema differences — D1

| Proposal | Implemented model | Reason and effect |
| --- | --- | --- |
| Six entities (pp.10–13); “Cart/Ticket Viewing” reads purchased tickets (p.7) | Seventh table CartItem with CartItemID, UserID, LotteryNumberID, Quantity | Stores unpurchased selections separately; page-level DELETE removes a selection without deleting a purchase |
| LotteryNumber.TotalQuantity and AvailableQuantity | AvailableQuantity only; original capacity is always five | Avoids storing a constant twice; report compares available + purchased copies against five |
| LotteryTicket.Quantity groups purchased copies | One LotteryTicket row per copy, no Quantity | Each copy has its own TicketID, shared PaymentID and per-copy prize |
| User.Email varchar(100) (p.12) | varchar(254) | Matches backend email limit |
| User has no account-status column | AccountStatus Active/Deactivated | Stops account access while retaining purchases |
| LotteryDraw has DrawID/DrawDate/DrawStatus | Adds SalesCloseAt, DrawAt, SalesStarted, InitializationStatus, ResultsPublishedAt | Separates setup, first opening, cutoff, publication and emergency closure |
| Basic keys/FKs in pp.12–13 | Additional CHECKs/unique keys for formats, quantities, roles, amounts, month-end times and unique winners | Rejects invalid stored values and duplicate identities/numbers |

CartItem references User and LotteryNumber. DrawID is derived through
LotteryNumber rather than duplicated. The original six foreign-key links plus
the two CartItem links give eight FK relationships. All use RESTRICT rather than
cascading deletion of financial records.

TicketNumber retains the proposal's name and six-digit string format. MySQL
AUTO_INCREMENT assigns surrogate IDs; business numbers such as `000123` are
not IDs. DrawID remains stable; Admin drawNumber is a separate chronological label.

The schema inherits MySQL defaults rather than specifying ENGINE/charset/collation
on each table. The deployment requires InnoDB, utf8mb4 and an appropriate
case-insensitive email collation; the demo SQL checks the actual settings.

## Page and business differences — D2/D3/D6

| Proposal reference | Current behavior | Reason |
| --- | --- | --- |
| Admin New Draw creates draw/inventory (pp.8–9,14) | Normal draws are automatic after the new month begins and the preceding result is published | One current month; future draw selection and manual creation are unavailable |
| Close Draw updates status (pp.8,14–15) | Automatic 17:00 Thailand cutoff plus Admin emergency close | Checkout enforces the cutoff even if the timer is late; SalesStarted preserves early closure |
| No exact monthly day/time specified in the text | Last day at 18:00 Thailand; sales cutoff 17:00 | Finalized project schedule, stored as UTC timestamps |
| Draw selection in user flow (p.3) | Only current eligible draw can be bought; results show current and previous 12 months | Prevents purchases from previous/future periods |
| Cart page reads purchased LotteryTicket (p.7) | `/checkout` holds CartItem selections; `/cart` remains purchased My Tickets/receipts | Separates unfinished selection from completed purchase |
| User/account deletion in CRUD plan (p.14) | Admin deactivates Customers; actual page DELETE applies to unpurchased CartItem | Retains account/purchase references and protects financial records |
| Admin can add/update winning numbers (pp.1–2,8,14) | Backend generates 13 unique winners once, at/after schedule; published results have no edit/reroll route | Browser/Admin input cannot choose replacement winners through the app |
| Developer maintenance/security responsibility is broad (p.1) | Developer-only read-only inventory report | Concrete database Read using JOIN/COUNT/SUM without stock/PII editing |
| HTML/CSS/JavaScript frontend (p.16) | React/TypeScript/Vite/Tailwind frontend served as a build | Uses the supplied team's UI while retaining Express and the API contract |

The finalized rules specify one million numbers, ฿100 per copy, max 100 copies per
checkout, no discounts, and four prize tiers with 1/1/1/10 distinct winners.
Amounts are ฿6,000,000 / ฿200,000 / ฿80,000 / ฿2,000 per winning copy. Unsold numbers
are eligible. These details clarify the broad purchase/prize design; the proposal
does not state this complete tier/count/amount schedule. There is no fifth prize.

The buying-page text repeats Payment creation (p.6), and the Prize CRUD row has
Payment wording (p.14). The relationship model and checkout description (pp.11,15)
support one Payment covering a checkout's tickets; the implementation uses exactly
one, not a second payment or a Payment row per item.

## Procedures and triggers — D4

| Object | Relationship to proposal |
| --- | --- |
| sp_register_user | Retained; Node supplies a salted bcrypt hash and SQL creates Customer only |
| sp_checkout | Retained; explicit DrawID + JSON items, stock locks, per-copy tickets and transactional cart cleanup |
| sp_close_draw | Retained; same draw lock as checkout, supports emergency/automatic closure |
| sp_check_ticket | Retained; API checks ownership first, returns pending/win/loss |
| sp_admin_dashboard_summary | Retained; counts copies and sums each payment once |
| sp_initialize_draw | Additional reusable initializer for one million numbers and 13 prize slots; avoids restocking/reopening on rerun |
| trg_ticket_before_insert | Retained; additionally checks current month, cutoff, setup/publication and matching payment buyer |
| trg_ticket_before_delete | Retained; prevents purchased-ticket deletion |

The short-lived sp_update_draw_schema helper in procedures.sql supports older
SalesStarted schemas and removes itself. Six application procedures remain after
installation. The new cart DELETE does not weaken the purchased-ticket trigger.

## Security and implementation limits — D5/D6

bcrypt cost 10 and session role checks match the proposal (p.16). The app adds
CSRF tokens, ownership predicates, account-status checks, safe error messages and
login failure limiting. Password verification uses bcrypt.compare in Node, not
plaintext comparison or a SQL hash equality test.

Server sessions use RAM with a 30-minute idle limit. Navigation/refresh keeps
login; backend restart loses it. No MySQL sessions table is required. Admin and
Developer are website roles seeded through a script, not separate MySQL accounts.

CheckoutRequest and ResultCorrection are not proposal entities and are absent
from the seven-table design. The simplified checkout has no server retry-key
protection: each accepted request creates another purchase. Published results
have no correction feature. These are current scope limits, not claims that SQL
transactions prevent duplicate HTTP submissions.

The UI Verification key is a static placeholder. Commitment/reveal, external
randomness and independent winner replay are not implemented and are not
presentation evidence. Historical seed winners are fictional result fixtures.
The stream image is not a video feed. These limitations are separate from the
working database CRUD/security features.

## Demonstration references

Use the [10-minute walkthrough](02-demo-walkthrough.md) and
[numbered SQL checks](03-demo-checks.sql). D1 shows the seven tables/eight FKs;
D2/D3 uses saved-cart DELETE; D4 shows checkout/closure procedures and both ticket
protections; D5/D6 shows real hashing and server-enforced role differences.
