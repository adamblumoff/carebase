CREATE TYPE "public"."care_recipient_timezone_source" AS ENUM('unset', 'owner_device', 'explicit');--> statement-breakpoint
ALTER TABLE "care_recipients" ADD COLUMN "timezone_source" "care_recipient_timezone_source" DEFAULT 'unset' NOT NULL;--> statement-breakpoint
CREATE INDEX "push_tokens_caregiver_disabled_at_idx" ON "push_tokens" USING btree ("caregiver_id","disabled_at");--> statement-breakpoint
CREATE INDEX "task_assignments_caregiver_id_idx" ON "task_assignments" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "tasks_care_recipient_created_at_idx" ON "tasks" USING btree ("care_recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_care_recipient_review_state_idx" ON "tasks" USING btree ("care_recipient_id","review_state");--> statement-breakpoint
CREATE INDEX "tasks_care_recipient_status_updated_at_idx" ON "tasks" USING btree ("care_recipient_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_care_recipient_start_at_idx" ON "tasks" USING btree ("care_recipient_id","start_at");--> statement-breakpoint
CREATE INDEX "tasks_care_recipient_due_at_idx" ON "tasks" USING btree ("care_recipient_id","due_at");