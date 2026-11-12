-- Optional Customer accounts and purchases for the presentation.
-- Run after schema.sql -> procedures.sql -> triggers.sql -> seed.sql.
-- Login password for all three fictional Customers: test1234.
-- These bcrypt cost-10 hashes have different library-generated salts.
-- Existing sample emails cause the whole sample seed to be skipped.
-- The live-registration email and number 000123 remain unused.
USE lotto;
SET SESSION time_zone = '+00:00';
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_seed_sample_customers$$
CREATE PROCEDURE sp_seed_sample_customers()
samples: BEGIN
    DECLARE v_draw INT;
    DECLARE v_user INT;
    DECLARE v_number INT;
    DECLARE v_second_number INT;

    IF EXISTS (SELECT 1 FROM `User` WHERE Email IN
        ('nicha@lotto.test', 'arun@lotto.test', 'mali@lotto.test')) THEN
        SELECT 'Sample accounts already exist. No sample data was changed.' AS Message;
        LEAVE samples;
    END IF;

    SET v_draw = (SELECT DrawID FROM LotteryDraw
        WHERE DrawDate = LAST_DAY(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)));
    IF v_draw IS NULL OR NOT EXISTS (SELECT 1 FROM LotteryDraw
        WHERE DrawID = v_draw AND DrawStatus = 'Open' AND InitializationStatus = 'Ready'
          AND ResultsPublishedAt IS NULL AND UTC_TIMESTAMP(6) < SalesCloseAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMO_REQUIRES_CURRENT_OPEN_DRAW';
    END IF;

    -- Nicha: two copies of 111111, one payment of 200.00.
    CALL sp_register_user('Nicha Demo', '0811111111', 'nicha@lotto.test',
        '$2b$10$eHrq8H200Y31wALNv7.EZ.zZbgoFVZF03RuiF0E1b.Yp/UF.8D6R2');
    SET v_user = (SELECT UserID FROM `User` WHERE Email = 'nicha@lotto.test');
    SET v_number = (SELECT LotteryNumberID FROM LotteryNumber
        WHERE DrawID = v_draw AND TicketNumber = '111111');
    CALL sp_checkout(v_user, v_draw,
        JSON_ARRAY(JSON_OBJECT('lotteryNumberId', v_number, 'quantity', 2)));

    -- Arun: one copy of 222222 and two of 333333, one payment of 300.00.
    CALL sp_register_user('Arun Demo', '0822222222', 'arun@lotto.test',
        '$2b$10$JsXPcd8nAlmmi/RdlIZSxO9kv9xzO3JH9rLBM1rKsaAO4drxPR3Bq');
    SET v_user = (SELECT UserID FROM `User` WHERE Email = 'arun@lotto.test');
    SET v_number = (SELECT LotteryNumberID FROM LotteryNumber
        WHERE DrawID = v_draw AND TicketNumber = '222222');
    SET v_second_number = (SELECT LotteryNumberID FROM LotteryNumber
        WHERE DrawID = v_draw AND TicketNumber = '333333');
    CALL sp_checkout(v_user, v_draw, JSON_ARRAY(
        JSON_OBJECT('lotteryNumberId', v_number, 'quantity', 1),
        JSON_OBJECT('lotteryNumberId', v_second_number, 'quantity', 2)));

    -- Mali: one copy of 444444, one payment of 100.00.
    CALL sp_register_user('Mali Demo', '0833333333', 'mali@lotto.test',
        '$2b$10$lMh7HCEpdPJogMkfINmhwuBVWx8Q9d3nez95p9vfIXZKVxf.Y13zS');
    SET v_user = (SELECT UserID FROM `User` WHERE Email = 'mali@lotto.test');
    SET v_number = (SELECT LotteryNumberID FROM LotteryNumber
        WHERE DrawID = v_draw AND TicketNumber = '444444');
    CALL sp_checkout(v_user, v_draw,
        JSON_ARRAY(JSON_OBJECT('lotteryNumberId', v_number, 'quantity', 1)));
END$$
CALL sp_seed_sample_customers()$$
DROP PROCEDURE sp_seed_sample_customers$$
DELIMITER ;
