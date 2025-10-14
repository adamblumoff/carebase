import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { API_ROUTE_METADATA, ROUTER_METADATA } from '../src/routes/registry.metadata.js';

const header = `# API Route Registry\n\nGenerated ${new Date().toISOString()}\n\n`;

const registrationsTable = ['| Base Path | Scope | Description |', '| --- | --- | --- |'];
for (const { basePath, scope, description } of ROUTER_METADATA) {
  registrationsTable.push(`| ${basePath} | ${scope} | ${description} |`);
}

const routesTable = ['| Method | Path | Description |', '| --- | --- | --- |'];
for (const { method, path, description } of API_ROUTE_METADATA) {
  routesTable.push(`| ${method} | ${path} | ${description} |`);
}

const body = `${header}## Routers\n\n${registrationsTable.join('\n')}\n\n## Endpoints\n\n${routesTable.join('\n')}\n`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = join(__dirname, '..', '..', 'docs', 'api-routes.md');
writeFileSync(outputPath, body, 'utf-8');
console.log(`Wrote ${outputPath}`);
