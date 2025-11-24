CREATE TYPE "public"."review_state" AS ENUM('pending', 'approved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."source_provider" AS ENUM('gmail');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'errored', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('appointment', 'bill', 'medication', 'general');--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'scheduled' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'snoozed' BEFORE 'done';--> statement-breakpoint
CREATE TABLE "ingestion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"provider" "source_provider" NOT NULL,
	"ingestion_id" text,
	"history_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"provider" "source_provider" NOT NULL,
	"account_email" varchar(255) NOT NULL,
	"refresh_token" text NOT NULL,
	"scopes" text[],
	"history_id" text,
	"cursor" text,
	"last_sync_at" timestamp with time zone,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" "task_type" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_state" "review_state" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "provider" "source_provider";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_link" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sender" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "raw_snippet" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ingestion_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "organizer" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "attendees" text[];--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "currency" varchar(8);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reference_number" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "statement_period" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "medication_name" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "dosage" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "frequency" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "next_dose_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "prescribing_provider" text;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;