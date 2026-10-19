# 02 - Folder guide

Use one Express server for both the frontend files and `/api` routes. This keeps
local setup and session cookies straightforward.

These are **planned files**, not code that already exists:

```text
frontend/
  ...                      Frontend teammates choose their own layout
backend/
  app.js                   Set up Express and start the server
  db.js                    MySQL connection pool using mysql2/promise
  package.json             Dependencies and start/test commands
  routes/                  auth.js, draws.js, checkout.js, tickets.js, admin.js
  controllers/             Matching request handlers and feature logic
  middleware/              Login checks, role checks, validation and errors
database/
  schema.sql               Six tables, keys and constraints
  procedures.sql           Five required stored procedures
  triggers.sql             Two required ticket triggers
  seed.sql                 Fake draw/prize data
```

Add a small separate Node seed script for Admin and Developer accounts so their
passwords are hashed with bcrypt. Keep SQL in the database folder for Workbench.
The schema also needs persistent sessions, an account active flag, unique checkout
retry keys and result-correction history. Keep these alongside the core SQL.
LotteryNumber stores one row per number/draw, Number and AvailableQuantity = 5,
with unique (DrawID, Number) and no TotalQuantity. Create LotteryTicket rows
only on purchase, one row per copy with no Quantity column. Five million available
copies are inventory capacity, not five million pre-created ticket records.

Start a small automatic-close check from app.js, including a catch-up on startup;
no separate scheduling service is needed for the demo. The checkout procedure and
ticket insert guard must also check the actual cutoff, so a late timer cannot allow sales.
Use Asia/Bangkok for monthly dates and store full UTC timestamps for comparisons.

A request goes through **route → login/role checks → controller → database**.
For checkout the controller calls `sp_checkout`; the procedure owns the purchase
transaction. No service layer, migration framework or separate configuration
folders are needed to start. Extract helpers only when there is a clear use.

Use one shared `db.js`, not a new connection setup in every controller, and
discuss changes to shared `app.js`, dependencies and table columns before merging.
Add automated tests alongside features where they protect important rules,
especially checkout races and rollback. Empty test folders are not needed now.
