# Database

Use MySQL 8 and MySQL Workbench. This document describes the database plan;
SQL scripts and a live database do not exist yet.

## 1. Lottery number inventory

- Store all 1,000,000 six-digit numbers (`000000`–`999999`) for each monthly draw.
- Each number starts with AvailableQuantity = 5, giving capacity for 5,000,000 copies.
- Do not pre-create those five million LotteryTicket records.

## 2. Database changes

| Table | Planned fields |
| --- | --- |
| LotteryNumber | LotteryNumberID, DrawID, Number and AvailableQuantity, initially 5 |
| LotteryTicket | TicketID, UserID, LotteryNumberID, PaymentID and PurchaseDate; one purchased copy per row |
| Payment | One simulated payment per checkout, linked to all tickets bought in it |

Remove TotalQuantity because the initial quantity is always five. Also remove
LotteryTicket.Quantity: each ticket already means one copy. Quantities still appear
in checkout requests; the backend expands them into individual purchased tickets.
Number is a six-digit string, so 000001 keeps its leading zeros.

## 3. Checkout procedure (sp_checkout)

Perform all purchase writes in one transaction on one connection:

1. Lock the draw; check Open status, the 17:00 cutoff and inventory/prize readiness.
2. Lock selected number rows in a consistent order and validate quantities against
   AvailableQuantity. Enforce one draw and at most 100 copies per checkout.
3. Calculate the total at ฿100 per copy.
4. Create one simulated Payment.
5. Create one LotteryTicket per purchased copy, all with the same PaymentID and buyer.
6. Decrease each number's AvailableQuantity by the copies purchased, once.
7. Commit together, or roll back every change if any step fails.

Keep retry-key protection so repeated requests return the same receipt, without
inserting tickets or deducting inventory again. For quantities 2 and 1, checkout
creates one Payment of ฿300 and three tickets, not two grouped ticket rows.

Each ticket wins at most one tier amount. Two winning copies are two winning ticket
records; their awards are summed. Dashboard copy counts use ticket-row counts.

## 4. Drawing rules

The confirmed rules have **four tiers and 13 distinct winning numbers**: 1st, 2nd
and 3rd each have one winner; 4th has ten. There is no 5th prize.
Amounts remain finalized: ฿6,000,000 / ฿200,000 / ฿80,000 / ฿2,000 respectively.
All one million numbers remain eligible, including unsold numbers. Use
the [requirements](../docs/01-requirements.md#4-lottery-rules-and-prizes) as the
reference for these rules; prize amounts are not placeholders.

## 5. Important constraints

- Unique **(DrawID, Number)** prevents duplicate inventory numbers within a draw.
- AvailableQuantity stays between 0 and 5. Number must contain exactly six digits.
- Multiple tickets may share PaymentID and LotteryNumberID: these are separate copies.
- For each number, available copies + purchased-ticket row count = 5.
- The required insert/delete triggers guard closed/cutoff purchases and retained tickets.
- Account deactivation never deletes payment or purchased-ticket history.

Keep the other main tables (User, LotteryDraw and Prize), plus the agreed MySQL
session, account-status, retry-key and result-correction support. Keep the five
required procedures and both triggers; only sp_checkout reduces stock.

The planned SQL files are schema.sql, procedures.sql, triggers.sql and seed.sql.
Run them in that order once implemented. Backend teammate: seed privileged accounts
with a separate Node/bcrypt script. Keep passwords out of SQL/Git and do not
reset a database containing purchases. The
[task split](../docs/backend-allocation.md#stored-procedures-and-triggers) lists authors.
