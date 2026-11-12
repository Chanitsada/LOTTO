-- LOTTO routines for registration, inventory, checkout, closure and reporting.
-- For a full database reset, run schema.sql first, then all setup files in order.
-- Reinstallation preserves business data; compatibility setup adds SalesStarted only if missing.

USE lotto;
SET SESSION time_zone = '+00:00';
DELIMITER $$

-- Temporary setup helper, removed immediately after use.
DROP PROCEDURE IF EXISTS sp_update_draw_schema$$
CREATE PROCEDURE sp_update_draw_schema()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'LotteryDraw'
          AND COLUMN_NAME = 'SalesStarted') THEN
        ALTER TABLE LotteryDraw ADD COLUMN SalesStarted BOOLEAN NOT NULL DEFAULT FALSE;
        -- Backfilled flags retain existing sales decisions; unopened future draws stay FALSE.
        UPDATE LotteryDraw SET SalesStarted = TRUE
        WHERE DrawStatus = 'Open' OR ResultsPublishedAt IS NOT NULL
           OR (DrawDate <= LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)))
               AND InitializationStatus = 'Ready');
    END IF;
END$$
CALL sp_update_draw_schema()$$
DROP PROCEDURE sp_update_draw_schema$$

DROP PROCEDURE IF EXISTS sp_register_user$$
CREATE PROCEDURE sp_register_user(IN p_Name TEXT, IN p_Phone TEXT, IN p_Email TEXT, IN p_Password TEXT)
BEGIN
    DECLARE EXIT HANDLER FOR 1062
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DUPLICATE_EMAIL';
    SET p_Name = TRIM(p_Name), p_Phone = TRIM(p_Phone), p_Email = TRIM(p_Email);
    IF p_Name IS NULL OR CHAR_LENGTH(p_Name) NOT BETWEEN 1 AND 100
       OR p_Phone IS NULL OR CHAR_LENGTH(p_Phone) NOT BETWEEN 1 AND 20
       OR p_Email IS NULL OR CHAR_LENGTH(p_Email) > 254
       OR NOT (p_Email REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
    END IF;
    IF p_Password IS NULL OR CHAR_LENGTH(p_Password) <> 60
       OR CAST(LEFT(p_Password, 7) AS BINARY) NOT IN ('$2a$10$', '$2b$10$')
       OR NOT (SUBSTRING(p_Password, 8) REGEXP '^[./A-Za-z0-9]{53}$') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PASSWORD_HASH';
    END IF;
    INSERT INTO `User` (Name, Phone, Email, Password, Role)
    VALUES (p_Name, p_Phone, p_Email, p_Password, 'Customer');
    SELECT LAST_INSERT_ID() AS userId, p_Name AS name, 'Customer' AS role;
END$$

DROP PROCEDURE IF EXISTS sp_checkout$$
CREATE PROCEDURE sp_checkout(
    IN p_UserID INT, IN p_DrawID INT, IN p_Items JSON
)
checkout: BEGIN
    DECLARE v_index INT DEFAULT 0;
    DECLARE v_count INT;
    DECLARE v_total INT DEFAULT 0;
    DECLARE v_id INT;
    DECLARE v_quantity INT;
    DECLARE v_copy INT;
    DECLARE v_available INT;
    DECLARE v_number_draw INT;
    DECLARE v_user_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_role VARCHAR(20);
    DECLARE v_draw_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_initialization VARCHAR(20);
    DECLARE v_cutoff DATETIME(6);
    DECLARE v_published DATETIME(6);
    DECLARE v_item JSON;
    DECLARE v_id_json JSON;
    DECLARE v_quantity_json JSON;
    DECLARE v_payment INT DEFAULT NULL;
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_prizes_valid BOOLEAN;
    DECLARE selected_numbers CURSOR FOR
        SELECT j.number_id, j.quantity
        FROM JSON_TABLE(p_Items, '$[*]' COLUMNS (
            number_id INT PATH '$.lotteryNumberId', quantity INT PATH '$.quantity'
        )) AS j ORDER BY j.number_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_UserID IS NULL OR p_UserID < 1 OR p_DrawID IS NULL OR p_DrawID < 1
       OR p_Items IS NULL OR JSON_TYPE(p_Items) <> 'ARRAY' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
    END IF;
    SET v_count = JSON_LENGTH(p_Items);
    IF v_count NOT BETWEEN 1 AND 100 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
    END IF;
    -- JSON type checks precede JSON_TABLE coercion of strings or fractional values.
    WHILE v_index < v_count DO
        SET v_item = JSON_EXTRACT(p_Items, CONCAT('$[', v_index, ']'));
        SET v_id_json = JSON_EXTRACT(v_item, '$.lotteryNumberId');
        SET v_quantity_json = JSON_EXTRACT(v_item, '$.quantity');
        IF JSON_TYPE(v_item) <> 'OBJECT' OR JSON_LENGTH(v_item) <> 2
           OR COALESCE(JSON_TYPE(v_id_json), '') <> 'INTEGER'
           OR COALESCE(JSON_TYPE(v_quantity_json), '') <> 'INTEGER' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
        END IF;
        IF v_id_json < 1 OR v_id_json > 2147483647
           OR v_quantity_json < 1 OR v_quantity_json > 5 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
        END IF;
        SET v_total = v_total + CAST(v_quantity_json AS UNSIGNED);
        SET v_index = v_index + 1;
    END WHILE;
    IF v_total > 100 OR (
        SELECT COUNT(DISTINCT j.number_id)
        FROM JSON_TABLE(p_Items, '$[*]' COLUMNS (number_id INT PATH '$.lotteryNumberId')) AS j
    ) <> v_count THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT';
    END IF;

    START TRANSACTION;
    -- The Customer lock serializes cart changes and purchases.
    SELECT AccountStatus, Role INTO v_user_status, v_role
    FROM `User` WHERE UserID = p_UserID FOR UPDATE;
    IF v_user_status IS NULL OR v_role <> 'Customer' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN';
    END IF;
    IF v_user_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACCOUNT_DISABLED';
    END IF;
    SELECT DrawStatus, InitializationStatus, SalesCloseAt, ResultsPublishedAt
    INTO v_draw_status, v_initialization, v_cutoff, v_published
    FROM LotteryDraw WHERE DrawID = p_DrawID FOR UPDATE;
    IF v_draw_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_FOUND';
    END IF;
    -- NOW/UTC_TIMESTAMP remain fixed for a CALL. Add elapsed wall-clock time
    -- so waiting for a lock cannot let a purchase cross the real cutoff.
    IF v_draw_status <> 'Open' OR v_published IS NOT NULL OR
       DATE_ADD(UTC_TIMESTAMP(6), INTERVAL TIMESTAMPDIFF(MICROSECOND, NOW(6), SYSDATE(6)) MICROSECOND) >= v_cutoff THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_CLOSED';
    END IF;
    -- Purchases require the actual SQL row for the current Thailand month.
    IF p_DrawID <> COALESCE((SELECT current_draw.DrawID FROM LotteryDraw current_draw
        WHERE current_draw.DrawDate = LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 HOUR)))
        LIMIT 1), 0) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_CURRENT';
    END IF;
    IF EXISTS (SELECT 1 FROM CartItem c JOIN LotteryNumber n
               ON n.LotteryNumberID = c.LotteryNumberID
               WHERE c.UserID = p_UserID AND n.DrawID <> p_DrawID) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CART_DRAW_CONFLICT';
    END IF;
    IF EXISTS (SELECT 1 FROM CartItem c JOIN JSON_TABLE(p_Items, '$[*]' COLUMNS (
                   number_id INT PATH '$.lotteryNumberId', quantity INT PATH '$.quantity'
               )) AS j ON j.number_id = c.LotteryNumberID
               WHERE c.UserID = p_UserID AND c.Quantity <> j.quantity) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CART_CHANGED';
    END IF;
    SELECT COUNT(*) = 13
       AND SUM(PrizeType = '1st') = 1 AND SUM(PrizeType = '2nd') = 1
       AND SUM(PrizeType = '3rd') = 1 AND SUM(PrizeType = '4th') = 10
       AND SUM(WinningNumber IS NOT NULL) = 0
    INTO v_prizes_valid FROM Prize WHERE DrawID = p_DrawID;
    IF v_initialization <> 'Ready' OR NOT COALESCE(v_prizes_valid, FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_READY';
    END IF;

    -- The draw lock precedes inventory locks in a consistent ID order.
    SET v_done = FALSE;
    OPEN selected_numbers;
    stock_loop: LOOP
        FETCH selected_numbers INTO v_id, v_quantity;
        IF v_done THEN LEAVE stock_loop; END IF;
        SET v_available = NULL;
        SELECT AvailableQuantity, DrawID INTO v_available, v_number_draw
        FROM LotteryNumber WHERE LotteryNumberID = v_id FOR UPDATE;
        IF v_available IS NULL OR v_number_draw <> p_DrawID THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_NUMBER';
        END IF;
        IF v_available < v_quantity THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INSUFFICIENT_STOCK';
        END IF;
    END LOOP;
    CLOSE selected_numbers;

    INSERT INTO Payment (UserID, Amount) VALUES (p_UserID, v_total * 100.00);
    SET v_payment = LAST_INSERT_ID();
    SET v_done = FALSE;
    OPEN selected_numbers;
    purchase_loop: LOOP
        FETCH selected_numbers INTO v_id, v_quantity;
        IF v_done THEN LEAVE purchase_loop; END IF;
        SET v_copy = 0;
        WHILE v_copy < v_quantity DO
            INSERT INTO LotteryTicket (UserID, LotteryNumberID, PaymentID)
            VALUES (p_UserID, v_id, v_payment);
            SET v_copy = v_copy + 1;
        END WHILE;
        UPDATE LotteryNumber SET AvailableQuantity = AvailableQuantity - v_quantity
        WHERE LotteryNumberID = v_id AND AvailableQuantity >= v_quantity;
        IF ROW_COUNT() <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INSUFFICIENT_STOCK';
        END IF;
    END LOOP;
    CLOSE selected_numbers;
    -- Purchased saved selections are removed inside the same transaction.
    DELETE c FROM CartItem c JOIN JSON_TABLE(p_Items, '$[*]' COLUMNS (
        number_id INT PATH '$.lotteryNumberId'
    )) AS j ON j.number_id = c.LotteryNumberID WHERE c.UserID = p_UserID;
    COMMIT;
    SELECT PaymentID AS paymentId, p_DrawID AS drawId, Amount AS amount,
           PaymentDate AS paymentDate
    FROM Payment WHERE PaymentID = v_payment;
    SELECT t.TicketID AS ticketId, n.LotteryNumberID AS lotteryNumberId, n.TicketNumber AS ticketNumber
    FROM LotteryTicket t JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    WHERE t.PaymentID = v_payment ORDER BY t.TicketID;
END$$

DROP PROCEDURE IF EXISTS sp_close_draw$$
CREATE PROCEDURE sp_close_draw(IN p_DrawID INT)
BEGIN
    DECLARE v_id INT DEFAULT NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_id = NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT DrawID INTO v_id FROM LotteryDraw WHERE DrawID = p_DrawID FOR UPDATE;
    IF v_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_FOUND';
    END IF;
    UPDATE LotteryDraw SET SalesStarted = (SalesStarted OR DrawStatus = 'Open'), DrawStatus = 'Closed'
    WHERE DrawID = p_DrawID;
    COMMIT;
    SELECT p_DrawID AS drawId, 'Closed' AS drawStatus;
END$$

DROP PROCEDURE IF EXISTS sp_check_ticket$$
CREATE PROCEDURE sp_check_ticket(IN p_TicketID INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM LotteryTicket WHERE TicketID = p_TicketID) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TICKET_NOT_FOUND';
    END IF;
    SELECT t.TicketID AS ticketId, n.TicketNumber AS ticketNumber, n.DrawID AS drawId,
        CASE WHEN d.ResultsPublishedAt IS NULL OR d.ResultsPublishedAt > UTC_TIMESTAMP(6)
             OR d.DrawAt > UTC_TIMESTAMP(6) THEN 'pending'
             WHEN p.PrizeID IS NULL THEN 'loss' ELSE 'win' END AS status,
        CASE WHEN d.ResultsPublishedAt IS NULL OR d.ResultsPublishedAt > UTC_TIMESTAMP(6)
             OR d.DrawAt > UTC_TIMESTAMP(6) THEN NULL ELSE p.PrizeType END AS prizeType,
        CASE WHEN d.ResultsPublishedAt IS NULL OR d.ResultsPublishedAt > UTC_TIMESTAMP(6)
             OR d.DrawAt > UTC_TIMESTAMP(6) THEN NULL ELSE COALESCE(p.PrizeAmount, 0.00) END AS prizeAmount
    FROM LotteryTicket t
    JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    JOIN LotteryDraw d ON d.DrawID = n.DrawID
    LEFT JOIN Prize p ON p.DrawID = n.DrawID AND p.WinningNumber = n.TicketNumber
    WHERE t.TicketID = p_TicketID;
END$$

DROP PROCEDURE IF EXISTS sp_admin_dashboard_summary$$
CREATE PROCEDURE sp_admin_dashboard_summary(IN p_DrawID INT)
BEGIN
    IF p_DrawID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawID = p_DrawID) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_FOUND';
    END IF;
    SELECT
        (SELECT COUNT(*) FROM `User` WHERE Role = 'Customer') AS totalUsers,
        (SELECT COUNT(*) FROM LotteryTicket t
         JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
         WHERE p_DrawID IS NULL OR n.DrawID = p_DrawID) AS totalTicketsSold,
        (SELECT COALESCE(SUM(p.Amount), 0.00) FROM Payment p
         WHERE p_DrawID IS NULL OR EXISTS (
             SELECT 1 FROM LotteryTicket t JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
             WHERE t.PaymentID = p.PaymentID AND n.DrawID = p_DrawID
         )) AS totalSales;
END$$
-- Reusable inventory initialization; no users, purchases or stock are reset.
DROP PROCEDURE IF EXISTS sp_initialize_draw$$
CREATE PROCEDURE sp_initialize_draw(IN p_DrawID INT)
BEGIN
    DECLARE v_draw INT;
    DECLARE v_start INT DEFAULT 0;
    DECLARE v_initialization VARCHAR(20);
    DECLARE v_sales_started BOOLEAN;
    DECLARE v_count INT;
    DECLARE v_valid BOOLEAN;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT DrawID, InitializationStatus, SalesStarted INTO v_draw, v_initialization, v_sales_started
    FROM LotteryDraw WHERE DrawID = p_DrawID FOR UPDATE;
    IF v_draw IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_FOUND';
    END IF;

    IF v_initialization <> 'Ready' AND (
        EXISTS (SELECT 1 FROM Prize WHERE DrawID = v_draw AND WinningNumber IS NOT NULL)
        OR EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawID = v_draw AND ResultsPublishedAt IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_RESULT_EXISTS';
    END IF;

    SELECT COUNT(*) INTO v_count FROM Prize WHERE DrawID = v_draw;
    IF v_count = 0 AND v_initialization <> 'Ready' THEN
        INSERT INTO Prize (DrawID, PrizeType, PrizeAmount)
        VALUES (v_draw, '1st', 6000000.00), (v_draw, '2nd', 200000.00), (v_draw, '3rd', 80000.00);
        INSERT INTO Prize (DrawID, PrizeType, PrizeAmount)
        SELECT v_draw, '4th', 2000.00 FROM (
            SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
        ) AS slots;
    END IF;
    SELECT COUNT(*) = 13 AND SUM(PrizeType = '1st') = 1 AND SUM(PrizeType = '2nd') = 1
        AND SUM(PrizeType = '3rd') = 1 AND SUM(PrizeType = '4th') = 10
    INTO v_valid FROM Prize WHERE DrawID = v_draw;
    IF NOT COALESCE(v_valid, FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_PRIZES_INVALID';
    END IF;

    IF v_initialization <> 'Ready' THEN
        IF EXISTS (SELECT 1 FROM LotteryTicket t JOIN LotteryNumber n
                   ON n.LotteryNumberID = t.LotteryNumberID WHERE n.DrawID = v_draw) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_PURCHASES_EXIST';
        END IF;
        UPDATE LotteryDraw SET DrawStatus = 'Closed', InitializationStatus = 'Pending' WHERE DrawID = v_draw;
        -- Four digit sets produce 10,000 rows per batch; the offset covers 100 batches.
        WHILE v_start < 1000000 DO
            INSERT INTO LotteryNumber (DrawID, TicketNumber, AvailableQuantity)
            SELECT v_draw, LPAD(v_start + d3.n * 1000 + d2.n * 100 + d1.n * 10 + d0.n, 6, '0'), 5
            FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d3
            CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d2
            CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d1
            CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d0
            WHERE NOT EXISTS (
                SELECT 1 FROM LotteryNumber existing WHERE existing.DrawID = v_draw
                AND existing.TicketNumber = LPAD(v_start + d3.n * 1000 + d2.n * 100 + d1.n * 10 + d0.n, 6, '0')
            );
            SET v_start = v_start + 10000;
        END WHILE;
        IF (SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE DrawID = v_draw) <> 5000000 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_STOCK_INVALID';
        END IF;
    END IF;
    IF (SELECT COUNT(*) FROM LotteryNumber WHERE DrawID = v_draw) <> 1000000 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_INVENTORY_INCOMPLETE';
    END IF;
    UPDATE LotteryDraw SET InitializationStatus = 'Ready' WHERE DrawID = v_draw;
    -- Sales open once. A prepared draw can open when its month arrives;
    -- SalesStarted keeps every later rerun from undoing an emergency closure.
    IF NOT v_sales_started AND EXISTS (
        SELECT 1 FROM LotteryDraw WHERE DrawID = v_draw
          AND DrawDate = LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 HOUR)))
          AND SalesCloseAt > UTC_TIMESTAMP(6) AND ResultsPublishedAt IS NULL
    ) THEN
        IF EXISTS (SELECT 1 FROM Prize WHERE DrawID = v_draw AND WinningNumber IS NOT NULL) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_RESULT_EXISTS';
        END IF;
        IF EXISTS (SELECT 1 FROM LotteryTicket t JOIN LotteryNumber n
                   ON n.LotteryNumberID = t.LotteryNumberID WHERE n.DrawID = v_draw) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_PURCHASES_EXIST';
        END IF;
        IF (SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE DrawID = v_draw) <> 5000000 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEED_STOCK_INVALID';
        END IF;
        UPDATE LotteryDraw SET DrawStatus = 'Open', SalesStarted = TRUE
        WHERE DrawID = v_draw
            AND DrawDate = LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 HOUR)))
            AND SalesCloseAt > UTC_TIMESTAMP(6)
            AND ResultsPublishedAt IS NULL;
    END IF;
    COMMIT;
    SELECT v_draw AS drawId, DrawStatus AS drawStatus, InitializationStatus AS initializationStatus,
        (SELECT COUNT(*) FROM LotteryNumber WHERE DrawID = v_draw) AS numbers,
        (SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE DrawID = v_draw) AS copiesAvailable,
        (SELECT COUNT(*) FROM Prize WHERE DrawID = v_draw) AS prizeSlots
    FROM LotteryDraw WHERE DrawID = v_draw;
END$$
DELIMITER ;
