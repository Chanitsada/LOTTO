-- LOTTO starting data: schema.sql -> procedures.sql -> triggers.sql -> seed.sql
-- The seed requires existing tables/routines and preserves business records.
-- Initial demo: the current Thailand month and 12 past result-only draws.
-- Normal monthly creation runs in the backend after the previous result is published.
-- Each new current draw has one million numbers and five copies per number.
-- Its first successful initialization opens sales only before the 17:00 Thailand cutoff.
-- Past winning numbers are FICTIONAL DEMO DATA; past tickets cannot be purchased.
-- Reruns preserve sales closures, inventory, accounts, purchases and published results.
USE lotto;
SET SESSION time_zone = '+00:00';
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_seed_demo$$
CREATE PROCEDURE sp_seed_demo()
BEGIN
    DECLARE v_draw INT;
    DECLARE v_current DATE;
    DECLARE v_date DATE;
    DECLARE v_month INT DEFAULT 12;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    SET v_current = LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)));
    -- Missing historical months receive fixtures; existing draws/results stay intact.
    WHILE v_month > 0 DO
        SET v_date = LAST_DAY(DATE_SUB(v_current, INTERVAL v_month MONTH));
        IF NOT EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawDate = v_date) THEN
            START TRANSACTION;
            INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt, DrawStatus, ResultsPublishedAt)
            VALUES (v_date, TIMESTAMP(v_date, '10:00:00'), TIMESTAMP(v_date, '11:00:00'),
                'Closed', TIMESTAMP(v_date, '11:00:00'));
            SET v_draw = LAST_INSERT_ID();
            INSERT INTO Prize (DrawID, PrizeType, PrizeAmount, WinningNumber)
            SELECT v_draw,
                CASE slot WHEN 0 THEN '1st' WHEN 1 THEN '2nd' WHEN 2 THEN '3rd' ELSE '4th' END,
                CASE slot WHEN 0 THEN 6000000.00 WHEN 1 THEN 200000.00 WHEN 2 THEN 80000.00 ELSE 2000.00 END,
                LPAD(MOD((YEAR(v_date) * 12 + MONTH(v_date)) * 7919 + slot * 104729, 1000000), 6, '0')
            FROM (SELECT 0 slot UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
                UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
                UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11
                UNION ALL SELECT 12) AS demo_slots;
            COMMIT;
        END IF;
        SET v_month = v_month - 1;
    END WHILE;

    -- Oldest-first history insertion gives fresh data chronological DrawIDs.
    -- An existing unfinished preceding result blocks bootstrap of the current month.
    IF NOT EXISTS (SELECT 1 FROM LotteryDraw
        WHERE DrawDate = LAST_DAY(DATE_SUB(v_current, INTERVAL 1 MONTH))
          AND DrawStatus = 'Closed' AND ResultsPublishedAt IS NOT NULL
          AND ResultsPublishedAt <= UTC_TIMESTAMP(6)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PREVIOUS_DRAW_PENDING';
    END IF;
    SET v_date = v_current;
    INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
    SELECT v_date, TIMESTAMP(v_date, '10:00:00'), TIMESTAMP(v_date, '11:00:00')
    WHERE NOT EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawDate = v_date);
    SELECT DrawID INTO v_draw FROM LotteryDraw WHERE DrawDate = v_date;
    CALL sp_initialize_draw(v_draw);

END$$
CALL sp_seed_demo()$$
DROP PROCEDURE sp_seed_demo$$
DELIMITER ;
