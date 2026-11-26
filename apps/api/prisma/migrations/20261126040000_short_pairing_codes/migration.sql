-- Pairing codes are 6 characters now, so the same code can come round again over time.
-- DropIndex
DROP INDEX "pairing_codes_codeHash_key";

-- CreateIndex
CREATE INDEX "pairing_codes_codeHash_idx" ON "pairing_codes"("codeHash");
