-- LOTTO ticket protections. Only sp_checkout deducts inventory.
-- Drop/recreate triggers only; do not drop the database here.
USE lotto;
DELIMITER $$
DROP TRIGGER IF EXISTS trg_ticket_before_insert$$
CREATE TRIGGER trg_ticket_before_insert BEFORE INSERT ON LotteryTicket
FOR EACH ROW
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_ready VARCHAR(20);
    DECLARE v_cutoff DATETIME(6);
    DECLARE v_published DATETIME(6);
    DECLARE v_buyer INT DEFAULT NULL;
    DECLARE v_draw_id INT;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;
    -- A locking read coordinates direct inserts with sp_close_draw too.
    SELECT d.DrawStatus, d.InitializationStatus, d.SalesCloseAt, d.ResultsPublishedAt, d.DrawID
    INTO v_status, v_ready, v_cutoff, v_published, v_draw_id
    FROM LotteryDraw d JOIN LotteryNumber n ON n.DrawID = d.DrawID
    WHERE n.LotteryNumberID = NEW.LotteryNumberID FOR SHARE;
    IF v_status IS NULL OR v_status <> 'Open' OR v_ready <> 'Ready'
       OR v_published IS NOT NULL OR
       DATE_ADD(UTC_TIMESTAMP(6), INTERVAL TIMESTAMPDIFF(MICROSECOND, NOW(6), SYSDATE(6)) MICROSECOND) >= v_cutoff THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_CLOSED';
    END IF;
    IF v_draw_id <> COALESCE((SELECT current_draw.DrawID FROM LotteryDraw current_draw
        WHERE current_draw.DrawDate = LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 HOUR)))
        LIMIT 1), 0) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DRAW_NOT_CURRENT';
    END IF;
    SELECT UserID INTO v_buyer FROM Payment WHERE PaymentID = NEW.PaymentID FOR SHARE;
    IF v_buyer IS NULL OR v_buyer <> NEW.UserID THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_OWNER_MISMATCH';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_ticket_before_delete$$
CREATE TRIGGER trg_ticket_before_delete BEFORE DELETE ON LotteryTicket
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PURCHASED_TICKET_DELETE_BLOCKED';
END$$
DELIMITER ;
