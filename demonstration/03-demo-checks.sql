-- LOTTO demo: follow the same step numbers in 02-demo-walkthrough.md.
-- Run one section after its page action. Do not run the whole file.
-- Check every SET value against the actual IDs in the local database.
-- Keep one Workbench connection open so the @id values remain available.
-- Expected results are comments: compare them with the rows on screen.

USE lotto;
SET SESSION time_zone = '+00:00';

-- all draw
SELECT DrawID, DrawDate, DrawStatus
FROM LotteryDraw
ORDER BY DrawDate DESC;

SET @draw_id = 13; -- Replace with the current DrawID.

-- === Step 1: After registering the Customer ===
SELECT UserID, Name, Phone, Email, Role, AccountStatus, Password
FROM `User`;
-- Find Demo Customer by its email. Use that row's UserID below.
-- Password contains a bcrypt hash; it is not the entered password.

SET @user_id = 6; -- Replace with the new UserID above.

-- === Step 2: After saving the edited profile ===
SELECT UserID, Name, Phone, Email, Role
FROM `User` WHERE UserID = @user_id;

-- === Step 3: After adding one copy to the cart ===
SELECT c.CartItemID,
       c.UserID,
       c.LotteryNumberID,
       n.TicketNumber,
       d.DrawDate,
       c.Quantity,
       n.AvailableQuantity
FROM CartItem c
JOIN LotteryNumber n ON c.LotteryNumberID = n.LotteryNumberID
JOIN LotteryDraw d ON n.DrawID = d.DrawID
WHERE c.UserID = @user_id;
-- Adding to the cart does not deduct stock.

SET @number_id = 1219983; -- Replace with the LotteryNumberID above.

-- === Step 4: After removing the selection from the page ===
SELECT CartItemID, UserID, LotteryNumberID, Quantity
FROM CartItem WHERE UserID = @user_id;
-- Expected: no rows. The saved selection was actually deleted.

SELECT TicketNumber, AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID = @number_id;
-- Expected: stock is still 5.

-- === Step 5: AFTER clicking Pay once ===
SELECT PaymentID, UserID, Amount, PaymentDate
FROM Payment WHERE UserID = @user_id;

SELECT TicketNumber, AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID = @number_id;
-- Expected: It decreased after payment.

-- === Step 6: Show that a trigger protects purchased tickets ===
SELECT TicketID, UserID, LotteryNumberID, PaymentID
FROM LotteryTicket WHERE UserID = @user_id;
-- Expected: the live Customer's purchased ticket rows.

START TRANSACTION;

DELETE FROM LotteryTicket WHERE UserID = @user_id;
-- Expected error: PURCHASED_TICKET_DELETE_BLOCKED.
-- The BEFORE DELETE trigger rejects removal of purchased tickets.

ROLLBACK;

SELECT TicketID, UserID, LotteryNumberID, PaymentID
FROM LotteryTicket WHERE UserID = @user_id;
-- Expected: the same ticket rows remain.

-- === Step 7: Run a stored procedure ===
CALL sp_admin_dashboard_summary(@draw_id);
