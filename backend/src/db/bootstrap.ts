import { ensureCollaboratorSchema } from './queries/collaborators.js';
import { ensureGoogleIntegrationSchema } from './queries/google.js';

export async function bootstrapDatabase(): Promise<void> {
  await Promise.all([
    ensureCollaboratorSchema(),
    ensureGoogleIntegrationSchema()
  ]);
}
