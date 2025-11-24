CREATE TYPE "public"."theme_preference" AS ENUM('light', 'dark');
--> statement-breakpoint
ALTER TABLE "caregivers" ADD COLUMN "theme_preference" "theme_preference" DEFAULT 'light' NOT NULL;
