ALTER TABLE "sources" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;

WITH ranked AS (
  SELECT
    s.id,
    row_number() OVER (
      PARTITION BY m.care_recipient_id
      ORDER BY s.created_at ASC
    ) AS rn
  FROM "sources" s
  INNER JOIN "care_recipient_memberships" m ON m.caregiver_id = s.caregiver_id
  WHERE s.provider = 'gmail'
    AND s.status != 'disconnected'
)
UPDATE "sources"
SET is_primary = true
FROM ranked
WHERE "sources".id = ranked.id
  AND ranked.rn = 1;
