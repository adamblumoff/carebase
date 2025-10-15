import apiClient from './client';
import { API_ENDPOINTS } from '../config';

export type CollaboratorResponse = {
  id: number;
  recipientId: number;
  userId: number | null;
  email: string;
  role: 'owner' | 'contributor';
  status: 'pending' | 'accepted';
  inviteToken: string;
  invitedBy: number;
  invitedAt: string;
  acceptedAt: string | null;
};

export async function fetchCollaborators(): Promise<CollaboratorResponse[]> {
  const response = await apiClient.get<{ collaborators: CollaboratorResponse[] }>(
    API_ENDPOINTS.collaborators.list,
  );
  return response.data.collaborators ?? [];
}

export async function inviteCollaborator(email: string, role: 'owner' | 'contributor' = 'contributor') {
  const response = await apiClient.post<{ collaborator: CollaboratorResponse }>(
    API_ENDPOINTS.collaborators.invite,
    { email, role },
  );
  return response.data.collaborator;
}

export async function acceptCollaboratorInvite(token: string) {
  const response = await apiClient.post<{ collaborator: CollaboratorResponse }>(
    API_ENDPOINTS.collaborators.accept,
    { token },
  );
  return response.data.collaborator;
}
