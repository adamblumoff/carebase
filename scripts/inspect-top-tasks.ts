import { desc, ne } from 'drizzle-orm';

import { db } from '../api/db/client';
import { tasks } from '../api/db/schema';

const truncate = (value: string | null | undefined, max = 160) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const senderDomain = (sender: string | null | undefined) => {
  if (!sender) return null;
  const match = sender.match(/@([^>\s]+)/);
  return match?.[1]?.toLowerCase() ?? sender;
};

async function main() {
  const allRows = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      type: tasks.type,
      reviewState: tasks.reviewState,
      confidence: tasks.confidence,
      title: tasks.title,
      sender: tasks.sender,
      provider: tasks.provider,
      sourceId: tasks.sourceId,
      rawSnippet: tasks.rawSnippet,
    })
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(5);

  console.log('=== Top 5 by createdAt (all review states) ===');
  for (const row of allRows) {
    console.log(
      JSON.stringify(
        {
          id: row.id,
          createdAt: row.createdAt,
          type: row.type,
          reviewState: row.reviewState,
          confidence: row.confidence,
          title: truncate(row.title, 120),
          senderDomain: senderDomain(row.sender),
          provider: row.provider,
          sourceId: row.sourceId,
          snippet: truncate(row.rawSnippet, 200),
        },
        null,
        2
      )
    );
  }

  const visibleRows = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      type: tasks.type,
      reviewState: tasks.reviewState,
      confidence: tasks.confidence,
      title: tasks.title,
      sender: tasks.sender,
      provider: tasks.provider,
      sourceId: tasks.sourceId,
      rawSnippet: tasks.rawSnippet,
    })
    .from(tasks)
    .where(ne(tasks.reviewState, 'ignored'))
    .orderBy(desc(tasks.createdAt))
    .limit(5);

  console.log('=== Top 5 by createdAt (visible in app: reviewState != ignored) ===');
  for (const row of visibleRows) {
    console.log(
      JSON.stringify(
        {
          id: row.id,
          createdAt: row.createdAt,
          type: row.type,
          reviewState: row.reviewState,
          confidence: row.confidence,
          title: truncate(row.title, 120),
          senderDomain: senderDomain(row.sender),
          provider: row.provider,
          sourceId: row.sourceId,
          snippet: truncate(row.rawSnippet, 200),
        },
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
