-- Away mode is on by default: permission requests and questions of sessions started on the PC
-- come to the app unless the user turns it off. Existing devices never chose (the old default
-- applied), so they get the new default too.
ALTER TABLE "devices" ALTER COLUMN "awayMode" SET DEFAULT true;
UPDATE "devices" SET "awayMode" = true WHERE "awayMode" = false;
