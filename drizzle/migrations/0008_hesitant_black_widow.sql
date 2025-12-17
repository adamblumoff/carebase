CREATE TYPE "public"."care_recipient_role" AS ENUM('owner', 'viewer');--> statement-breakpoint
CREATE TABLE "care_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"invited_by_caregiver_id" uuid NOT NULL,
	"invited_email" varchar(255),
	"role" "care_recipient_role" NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_caregiver_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_recipient_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"role" "care_recipient_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_care_recipient_id_care_recipients_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_invited_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("invited_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_used_by_caregiver_id_caregivers_id_fk" FOREIGN KEY ("used_by_caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipient_memberships" ADD CONSTRAINT "care_recipient_memberships_care_recipient_id_care_recipients_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipient_memberships" ADD CONSTRAINT "care_recipient_memberships_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "care_invitations_token_uidx" ON "care_invitations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "care_recipient_memberships_caregiver_uidx" ON "care_recipient_memberships" USING btree ("caregiver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "care_recipient_memberships_care_recipient_caregiver_uidx" ON "care_recipient_memberships" USING btree ("care_recipient_id","caregiver_id");