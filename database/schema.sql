-- LOTTO full database reset and schema.
-- WARNING: Running this file deletes all lotto data and accounts.
-- Run: schema.sql -> procedures.sql -> triggers.sql -> seed.sql.

DROP DATABASE IF EXISTS lotto;
CREATE DATABASE IF NOT EXISTS lotto;
USE lotto;
SET SESSION time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `User` (
    UserID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NULL,
    Phone VARCHAR(20) NULL,
    Email VARCHAR(254) NOT NULL,
    Password VARCHAR(255) NOT NULL COMMENT 'bcrypt hash, never plaintext',
    Role VARCHAR(20) NOT NULL DEFAULT 'Customer',
    AccountStatus VARCHAR(20) NOT NULL DEFAULT 'Active',
    CONSTRAINT uq_user_email UNIQUE (Email),
    CONSTRAINT chk_user_role CHECK (Role IN ('Customer', 'Admin', 'Developer')),
    CONSTRAINT chk_user_status CHECK (AccountStatus IN ('Active', 'Deactivated')),
    CONSTRAINT chk_user_hash CHECK (
        CHAR_LENGTH(Password) = 60 AND CAST(LEFT(Password, 7) AS BINARY) IN ('$2a$10$', '$2b$10$')
        AND SUBSTRING(Password, 8) REGEXP '^[./A-Za-z0-9]{53}$'
    )
);

-- DATETIME values below are UTC; DrawDate is the Thailand calendar date.
CREATE TABLE IF NOT EXISTS LotteryDraw (
    DrawID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    DrawDate DATE NOT NULL,
    SalesCloseAt DATETIME(6) NOT NULL,
    DrawAt DATETIME(6) NOT NULL,
    DrawStatus VARCHAR(20) NOT NULL DEFAULT 'Closed',
    SalesStarted BOOLEAN NOT NULL DEFAULT FALSE,
    InitializationStatus VARCHAR(20) NOT NULL DEFAULT 'Pending',
    ResultsPublishedAt DATETIME(6) NULL,
    CONSTRAINT uq_draw_date UNIQUE (DrawDate),
    CONSTRAINT chk_draw_month_end CHECK (DrawDate = LAST_DAY(DrawDate)),
    CONSTRAINT chk_draw_times CHECK (
        SalesCloseAt = TIMESTAMP(DrawDate, '10:00:00')
        AND DrawAt = TIMESTAMP(DrawDate, '11:00:00')
    ),
    CONSTRAINT chk_draw_status CHECK (DrawStatus IN ('Open', 'Closed')),
    CONSTRAINT chk_draw_initialization CHECK (InitializationStatus IN ('Pending', 'Ready', 'Failed')),
    CONSTRAINT chk_draw_publication CHECK (
        ResultsPublishedAt IS NULL OR (ResultsPublishedAt >= DrawAt AND DrawStatus = 'Closed')
    )
);

CREATE TABLE IF NOT EXISTS LotteryNumber (
    LotteryNumberID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    DrawID INT NOT NULL,
    TicketNumber VARCHAR(6) NOT NULL,
    AvailableQuantity INT NOT NULL DEFAULT 5,
    CONSTRAINT uq_lotterynumber_draw_number UNIQUE (DrawID, TicketNumber),
    CONSTRAINT fk_lotterynumber_draw FOREIGN KEY (DrawID) REFERENCES LotteryDraw (DrawID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_lotterynumber_number CHECK (TicketNumber REGEXP '^[0-9]{6}$'),
    CONSTRAINT chk_lotterynumber_available CHECK (AvailableQuantity BETWEEN 0 AND 5)
);

-- Saved, unpurchased selections only. Cart APIs enforce one current draw and
-- the 100-copy cart limit; saving/removing selections never reserves stock.
CREATE TABLE IF NOT EXISTS CartItem (
    CartItemID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    UserID INT NOT NULL,
    LotteryNumberID INT NOT NULL,
    Quantity INT NOT NULL DEFAULT 1,
    CONSTRAINT uq_cartitem_user_number UNIQUE (UserID, LotteryNumberID),
    CONSTRAINT fk_cartitem_user FOREIGN KEY (UserID) REFERENCES `User` (UserID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_cartitem_number FOREIGN KEY (LotteryNumberID) REFERENCES LotteryNumber (LotteryNumberID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_cartitem_quantity CHECK (Quantity BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS Payment (
    PaymentID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    UserID INT NOT NULL,
    Amount DECIMAL(10,2) NOT NULL,
    PaymentDate DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT fk_payment_user FOREIGN KEY (UserID) REFERENCES `User` (UserID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_payment_amount CHECK (Amount > 0)
);

CREATE TABLE IF NOT EXISTS LotteryTicket (
    TicketID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    UserID INT NOT NULL,
    LotteryNumberID INT NOT NULL,
    PaymentID INT NOT NULL,
    PurchaseDate DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT fk_ticket_user FOREIGN KEY (UserID) REFERENCES `User` (UserID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_ticket_number FOREIGN KEY (LotteryNumberID) REFERENCES LotteryNumber (LotteryNumberID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_ticket_payment FOREIGN KEY (PaymentID) REFERENCES Payment (PaymentID)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS Prize (
    PrizeID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    DrawID INT NOT NULL,
    PrizeType VARCHAR(20) NOT NULL,
    WinningNumber VARCHAR(6) NULL,
    PrizeAmount DECIMAL(10,2) NOT NULL,
    CONSTRAINT uq_prize_draw_winning UNIQUE (DrawID, WinningNumber),
    CONSTRAINT fk_prize_draw FOREIGN KEY (DrawID) REFERENCES LotteryDraw (DrawID)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_prize_type CHECK (PrizeType IN ('1st', '2nd', '3rd', '4th')),
    CONSTRAINT chk_prize_number CHECK (WinningNumber IS NULL OR WinningNumber REGEXP '^[0-9]{6}$'),
    CONSTRAINT chk_prize_amount CHECK (
        (PrizeType = '1st' AND PrizeAmount = 6000000.00)
        OR (PrizeType = '2nd' AND PrizeAmount = 200000.00)
        OR (PrizeType = '3rd' AND PrizeAmount = 80000.00)
        OR (PrizeType = '4th' AND PrizeAmount = 2000.00)
    )
);
