-- Add QR code image for banking payment to properties table
ALTER TABLE properties
  ADD COLUMN bank_qr_code TEXT;
