-- Add master utility tariff rates to properties table
ALTER TABLE properties
  ADD COLUMN electricity_rate NUMERIC(14,2) NOT NULL DEFAULT 3500.00,
  ADD COLUMN water_rate       NUMERIC(14,2) NOT NULL DEFAULT 25000.00,
  ADD COLUMN internet_rate    NUMERIC(14,2) NOT NULL DEFAULT 100000.00,
  ADD COLUMN cleaning_rate    NUMERIC(14,2) NOT NULL DEFAULT 50000.00,
  ADD COLUMN parking_rate     NUMERIC(14,2) NOT NULL DEFAULT 100000.00;
