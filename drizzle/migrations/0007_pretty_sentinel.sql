CREATE TABLE "sender_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"provider" "source_provider" NOT NULL,
	"sender_domain" varchar(255) NOT NULL,
	"ignore_count" integer DEFAULT 0 NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"last_ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_source_uidx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sender_domain" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ingestion_debug" jsonb;--> statement-breakpoint
ALTER TABLE "sender_suppressions" ADD CONSTRAINT "sender_suppressions_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sender_suppressions_caregiver_provider_domain_uidx" ON "sender_suppressions" USING btree ("caregiver_id","provider","sender_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_created_by_source_uidx" ON "tasks" USING btree ("created_by_id","source_id");