DROP INDEX "tasks_created_by_source_uidx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_care_recipient_provider_external_uidx" ON "tasks" USING btree ("care_recipient_id","provider","external_id");