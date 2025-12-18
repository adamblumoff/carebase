CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "care_profile_basics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"dob" date,
	"notes" text,
	"updated_by_caregiver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_profile_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text,
	"email" varchar(255),
	"address" text,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"updated_by_caregiver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"uploaded_by_caregiver_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"page_count" integer,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_profile_basics" ADD CONSTRAINT "care_profile_basics_care_recipient_id_care_recipients_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_profile_basics" ADD CONSTRAINT "care_profile_basics_updated_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("updated_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_profile_contacts" ADD CONSTRAINT "care_profile_contacts_care_recipient_id_care_recipients_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_profile_contacts" ADD CONSTRAINT "care_profile_contacts_updated_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("updated_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_care_recipient_id_care_recipients_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("uploaded_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "care_profile_basics_care_recipient_uidx" ON "care_profile_basics" USING btree ("care_recipient_id");--> statement-breakpoint
CREATE INDEX "care_profile_contacts_care_recipient_idx" ON "care_profile_contacts" USING btree ("care_recipient_id");--> statement-breakpoint
CREATE INDEX "documents_care_recipient_idx" ON "documents" USING btree ("care_recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key_uidx" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_tasks_document_task_uidx" ON "document_tasks" USING btree ("document_id","task_id");--> statement-breakpoint
CREATE INDEX "document_tasks_document_idx" ON "document_tasks" USING btree ("document_id");
