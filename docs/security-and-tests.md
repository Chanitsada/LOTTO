# Checks before merging

Check each feature while building it. This checklist describes checks to run;
it does not report completed tests. Use fake users and a separate local/test database.

## Login and access

- [ ] Public signup always creates Customer; role=Admin/Developer is rejected.
- [ ] Passwords are bcrypt hashes with cost 10. Never store/return/log plaintext or hashes.
- [ ] Passwords under 8 characters are rejected; name/phone edits work and email/role edits fail.
- [ ] Reject passwords over bcrypt's 72-byte limit rather than silently truncating.
- [ ] Login starts a new session; logout invalidates it. Cookie is HttpOnly;
      use Secure with HTTPS, CSRF protection and a suitable SameSite setting.
- [ ] Sessions persist in MySQL, expire after 30 idle minutes and refresh on activity.
      Deactivated accounts cannot log in or use an existing session.
- [ ] Customer and Developer cannot call Admin routes. Users see only their own tickets/payments.
- [ ] SQL values use ? parameters; invalid IDs, numbers and quantities are rejected.
- [ ] Errors do not expose SQL, credentials, stack traces or private secrets.

## Buying tickets

- [ ] Buy two numbers, quantities 2 and 1: one Payment of 300.00, three individual ticket rows,
      and stock reduced once by the right amounts.
- [ ] If any selected number is sold out or an insert fails, no part of the purchase remains.
- [ ] Two simultaneous buyers of the last copy: only one succeeds; stock never goes negative.
- [ ] Closing a draw and buying at the same time cannot bypass closure. Purchases
      at/after 17:00 Thailand time fail even with a late timer or restarted server.
- [ ] An unfinished inventory setup cannot be purchased by guessing its draw ID.
- [ ] A one-draw checkout of 100 copies can succeed if stock allows; 101 copies or
      mixed-draw items fail. Browsing never reserves or reduces stock.
- [ ] Two requests with the same checkout key create one payment and stock deduction;
      a completed retry returns the same receipt, including after the cutoff.
      The same key with a different cart returns a conflict.

Use one transaction/connection inside sp_checkout. Lock the draw first, then number
rows in a consistent order; sp_close_draw locks the same draw row. Required triggers
are extra protection. Do not reduce inventory in both a procedure and trigger.
Use two actual database connections for the stock/closure race checks and add a
small repeatable automated test when checkout is implemented.

## Data and results

- [ ] A new draw has 1,000,000 LotteryNumber rows with AvailableQuantity = 5 and
      zero LotteryTicket rows before purchases; no five-million-ticket pre-seed exists.
- [ ] Unique (DrawID, Number) rejects duplicate inventory numbers in one draw but
      allows the same number in different draws. AvailableQuantity stays between 0 and 5.
- [ ] There is no TotalQuantity or LotteryTicket.Quantity column. Request quantities
      and grouped display counts do not become stored ticket quantities.
- [ ] Seeding again never resets sold stock. For each number, available copies plus
      its purchased-ticket row count equals 5. Small fixtures are for isolated tests only.
- [ ] Sales stay closed until inventory and all four validated prize amounts are ready.
- [ ] Monthly dates use the correct last day, including February/leap years. Automatic
      cutoff is 17:00 and drawing 18:00 Asia/Bangkok; manual early closure works.
- [ ] 000000 and 000001 keep their leading zeros.
- [ ] The insert trigger rejects tickets for closed draws; the delete trigger protects purchases.
- [ ] Exactly 13 different winning numbers have tier counts 1/1/1/10, with no 5th tier.
- [ ] Prize amounts are ฿6,000,000 / ฿200,000 / ฿80,000 / ฿2,000 for 1st through 4th.
- [ ] Pending results are shown as pending.
- [ ] Unsold numbers can win; two individual 4th-prize tickets receive 2000.00 each,
      or 4000.00 in total. History and dashboard ticket-copy counts use ticket rows.
- [ ] Results cannot publish early. Corrections retain original/before/after values,
      timestamp, reason and Admin ID; corrected winners still satisfy all tier rules.
- [ ] Dashboard totals do not multiply one Payment by the number of ticket records.
- [ ] Account deactivation preserves ticket/payment records. Personal details are
      anonymized only after agreeing the retention policy.
- [ ] Drawing/results cannot be changed through unauthorized requests.

## Final check together

Register → log in → choose numbers → checkout → view history → close draw →
publish agreed results → check tickets → log out. Also try sold-out, closed-draw
and wrong-role requests. Each author fixes their own feature bugs.

Keep .env, passwords, private draw secrets and node_modules out of Git. Advanced
draw verification has its own short [later-work note](draw-transparency.md).
