-- Add banking payment information to properties table
ALTER TABLE properties
  ADD COLUMN bank_name VARCHAR(100),
  ADD COLUMN bank_account_number VARCHAR(50),
  ADD COLUMN bank_account_name VARCHAR(200);
