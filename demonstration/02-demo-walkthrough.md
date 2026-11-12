# LOTTO demo walkthrough

Use this guide for a ten-minute presentation. All four members should speak;
choose the speaking turns together. The step numbers match
[03-demo-checks.sql](03-demo-checks.sql).

## Before the presentation

### 1. Install and build

From the LOTTO folder:

```bash
cd frontend
npm ci
npm run build
cd ../backend
npm ci
```

### 2. Reset and seed in MySQL Workbench

Stop an existing backend with Ctrl+C before resetting. Run these files in order:

1. `database/schema.sql` — resets lotto and creates the tables.
2. `database/procedures.sql` — creates the stored procedures.
3. `database/triggers.sql` — creates the ticket triggers.
4. `database/seed.sql` — creates the current draw, inventory and past results.
5. [database/demo-data.sql](../database/demo-data.sql) — creates three sample
   Customers and their purchases.

**Run the reset before the turn, not during the presentation.** It deletes the
previous accounts and purchases. Stop if a file reports an error.

The sample data uses the normal registration and checkout procedures. It creates
three Active Customers, three payments and six ticket copies for the current draw:

| Customer | Email | Password | Purchased numbers | Paid |
| --- | --- | --- | --- | --- |
| Nicha Demo | nicha@lotto.test | test1234 | 111111 × 2 | ฿200 |
| Arun Demo | arun@lotto.test | test1234 | 222222 × 1, 333333 × 2 | ฿300 |
| Mali Demo | mali@lotto.test | test1234 | 444444 × 1 | ฿100 |
| Total | | | 6 copies | ฿600 |

Passwords are stored as salted bcrypt hashes. Log in as one of these Customers
before the turn to check My Tickets and receipts. These are current-draw purchases,
so results stay pending until publication.

The sample file leaves **000123** at five copies and does not create
**demo.customer@lotto.test**. That account is reserved for live registration.
If any sample email already exists, the file skips all sample creation without
changing existing accounts or adding another purchase.

### 3. Create privileged accounts and start

Configure the root .env, including the Admin/Developer credentials. Then, from
backend:

```bash
npm run db:check
npm run seed:accounts
npm start
```

Open http://localhost:3000, or the configured PORT. Keep .env off screen.
Leave the server running; restarting clears login sessions. A reset deletes
privileged accounts too, so run seed:accounts again after each reset.

Purchasing and sample purchases require an open current draw before its sales
cutoff: 17:00 Thailand on draw day. A reset does not bypass that time rule.

### 4. Open the presentation windows

Open 03-demo-checks.sql, the current ERD, schema.sql, procedures.sql and triggers.sql.
Use the same database for Express and Workbench. Start the live SQL at **Step 1**. Copy actual IDs into the SET lines where they appear.

Prepare Customer, Admin and Developer sessions with separate browser profiles,
or log out before changing roles. A private window can provide a second session.
Leave **demo.customer@lotto.test** unused until live registration.
Use the previous completed month for the results page.

### Test data

| Field | Enter |
| --- | --- |
| First Name / Last Name | Demo / Customer |
| Email | demo.customer@lotto.test |
| Password | test1234 |
| Phone | 0812345678 |
| Profile name after editing | Demo Customer Updated |
| Profile phone after editing | 0898765432 |
| Number | 000123 |
| Final purchase | Two copies, ฿200 |

These credentials are for local demonstration only. Admin/Developer use their
configured account credentials.

## How to use the SQL file

The SQL file has seven checks. **Steps 1–5** follow the page actions;
**Steps 6–7** demonstrate a stored procedure and a trigger in Workbench.
Run each check in order. Do not run the whole file at once.

Run the initial USE, time-zone and @draw_id lines once in the same Workbench
connection. Confirm @draw_id is the current draw. After registration, find
**demo.customer@lotto.test** in the returned User rows and set @user_id to that
Customer's actual ID. Account creation order can change IDs; do not assume the
Customer is UserID 4. Replace @number_id=0 with the number ID shown in Step 3.

The file currently lists all User rows, including their password hashes, in
Step 1. Point to the live Customer's row when explaining registration and login.
Expected values below assume a fresh reset, demo-data.sql and no extra purchases.

## Live demonstration: seven matching checks

Opening: “LOTTO connects Customers, purchases and lottery results in MySQL.
Admin manages sales and results; Developer checks inventory. Payment is simulated.”

### 1. Register and log in — SQL Step 1

At `/register`, enter the test data and click **Create**. Run **SQL Step 1**.
Find the row for **demo.customer@lotto.test** and copy its UserID into @user_id.

Expected: Name=Demo Customer, Role=Customer, AccountStatus=Active and a bcrypt
Password hash, normally starting `$2b$10$`.

At `/login`, try **wrong1234**: login should fail. Then use **test1234**:
login should succeed and open `/profile`. This demonstrates account Create and
password verification. Signup does not log in automatically.

Keep these files open for D5 inspection:

| File | Explain |
| --- | --- |
| backend/utils/password.js | bcrypt.hash uses cost 10 and a random salt; bcrypt.compare verifies login |
| backend/controllers/auth-controller.js | `WHERE Email = ?` and separate input values |
| backend/db.js | MySQL username/password come from environment settings |
| backend/middleware/error-handler.js | Unexpected errors hide database details |

Show `?` placeholders and argument arrays in other controllers if asked.
Workbench @ids choose rows to display; backend parameter binding is the security
evidence. Fixed queries with no supplied values need no placeholder.
Keep .env off screen.

### 2. Edit the profile — SQL Step 2

At `/profile`, save **Demo Customer Updated** and **0898765432**.
Run **SQL Step 2**.

Expected: the same Customer's row has the new name/phone; email and role stay
unchanged. Refresh the page to show the update was saved.

### 3. Add a saved selection — SQL Step 3

At `/buy-lottery`, expand **Available numbers**, search **000123**, select one
copy and click **Add to cart**. Open `/checkout`.

Run the first query in **SQL Step 3**. Copy LotteryNumberID into @number_id,
then run the remaining queries.

Expected: one CartItem with Quantity=1 for this Customer, and stock still five.
Point out the CartItemID and its UserID/LotteryNumberID references. Saving a
selection does not reserve or deduct inventory.

### 4. Remove the selection — SQL Step 4

Click the selection's remove icon. Run **SQL Step 4**.

Expected: no CartItem row for this Customer; stock is still five. This is a real
Delete of an unpurchased selection. Purchased tickets are retained.

### 5. Pay and show the receipt — SQL Step 5

Return to Available numbers and add **two** copies of 000123. Open `/checkout`.
Click **Pay ฿200.00** once, then run **SQL Step 5**.

Expected: one Payment of 200.00 for the live Customer and AvailableQuantity=3.
The successful page message is “Purchase complete. Your tickets are saved.”
Open `/cart` and its Receipts tab to show the same purchase and two ticket IDs.

The shortened SQL file checks Payment and stock here. To show the saved ticket
rows, open LotteryTicket in Workbench with **Select Rows** and locate the two
rows using the receipt's PaymentID and the live Customer's UserID. They have the
same LotteryNumberID. This fresh demonstration has only eight purchased copies
in total, including the six sample copies.

Show `CALL sp_checkout(?, ?, ?)` in checkout-controller.js and sp_checkout in
procedures.sql. Payment, tickets, stock and purchased-cart cleanup commit in one
transaction. Do not call sp_checkout again to demonstrate it: that buys more copies.
The Admin dashboard should now show **4 Customers, 8 copies and ฿800 sales**.

### 6. Run a stored procedure — SQL Step 6

Run **SQL Step 6** in Workbench:

```sql
CALL sp_admin_dashboard_summary(@draw_id);
```

Expected after the sample seed and live purchase: **4 Customers, 8 sold copies
and 800.00 sales**. Admin/Developer accounts are excluded from the Customer count.
Extra test purchases/accounts change these totals.

Open sp_admin_dashboard_summary in procedures.sql. Explain: “This stored
procedure calculates the dashboard's Customer count, ticket-copy count and
sales total from the database.” Each payment contributes to sales once.
This procedure is read-only. The Pay action in Step 5 already ran sp_checkout
to create the payment/tickets and decrease stock.

### 7. Demonstrate a trigger — SQL Step 7

Open trg_ticket_before_delete in triggers.sql. Run the first SELECT in
**SQL Step 7**: the Customer's two purchased tickets should appear. If no rows
appear, correct @user_id before testing.

Run the following statements **one at a time**:

1. START TRANSACTION.
2. DELETE — expect **PURCHASED_TICKET_DELETE_BLOCKED**.
3. ROLLBACK — select and run it separately after the error, even if DELETE succeeds.
4. Run the final SELECT — the same two ticket rows remain.

Explain: “The BEFORE DELETE trigger runs automatically when a purchased ticket
is deleted. It blocks the operation to preserve purchase history.” The expected
error demonstrates the protection working. Removing an unpurchased CartItem in
Step 4 remains allowed.

These two live steps cover **Advanced SQL Features: at least one relevant stored
procedure and one functional trigger**. Keep the returned totals, trigger error
and retained ticket rows visible for inspection.

## Other rubric checks

These checks use pages and source files. They do not
have numbered sections in the shortened SQL file.

### Schema — D1

Open the current ERD and schema.sql. Explain seven tables and their foreign keys:
User owns payments/tickets/cart items; a draw has numbers/prizes; each purchased
ticket references a Customer, a number and a Payment. CartItem derives its draw
through LotteryNumber.

Explain the added CartItem table and one purchased row per ticket copy. The
[proposal comparison](01-proposal-changes.md) lists the other differences.

### All three roles — D6

Use separate browser profiles, or log out before switching roles.

| Login | Open | Expected |
| --- | --- | --- |
| Customer | `/api/admin/dashboard` | HTTP 403; access denied |
| Admin | `/admin`, then `/api/admin/dashboard` | Dashboard works; API returns HTTP 200 |
| Admin | `/api/developer/inventory` | HTTP 403 |
| Developer | `/developer` | Inventory report works; 000123 has three available and two purchased copies |
| Developer | `/api/admin/dashboard` | HTTP 403 |

Enter API paths after http://localhost:3000. DevTools Network shows the status.
Show requireRole in app.js/middleware/auth.js. All three roles are required.

### Public results and emergency closure

At `/results`, select the previous completed month. Compare its winners with
Prize rows for that DrawID in Workbench. Historical seed winners are fictional.
Live Roll requires the last day at/after 18:00 Thailand with sales closed; do not
change dates to bypass this. The displayed verification key is a placeholder.

After all purchases, sign in as Admin and use **Close Draw → Confirm close**.
Show sp_close_draw in procedures.sql and DrawStatus=Closed in LotteryDraw.
There is no reopening button. This action has no numbered SQL section.

## Time and final checks

| Part | Target time |
| --- | --- |
| Opening and schema | 1 minute 15 seconds |
| Registration, security and profile | 2 minutes |
| Cart add/remove and payment | 2 minutes 30 seconds |
| Three roles | 1 minute |
| Procedure, trigger and emergency closure | 1 minute 30 seconds |
| Public results | 30 seconds |
| Questions/buffer | 1 minute 15 seconds |

Before the turn, rehearse the whole flow and check the layout. Include one quick
validation example, such as wrong-password login. Keep each table row visible
when asked. Every member should understand the code and take part in the demo.
I write all stored procedures and triggers; the teammate's controllers call them.

For automated checks before the presentation, run `npm test` and
`npm run test:integration` in backend; run `npm test` and `npm run build` in frontend.
Integration tests use a disposable database; manual page actions affect the demo
records. Never reset the database halfway through the presentation.
