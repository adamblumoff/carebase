ALTER TABLE "ingestion_events" ADD COLUMN "type" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "watch_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "watch_expiration" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "calendar_channel_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "calendar_resource_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "calendar_sync_token" text;