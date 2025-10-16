import type { UploadPhotoResponse } from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config';

export interface UploadBillPhotoParams {
  uri: string;
  fileName?: string;
  contentType?: string;
}

export async function uploadBillPhoto({
  uri,
  fileName,
  contentType,
}: UploadBillPhotoParams): Promise<UploadPhotoResponse> {
  const resolvedName = fileName ?? uri.split('/').pop() ?? 'photo.jpg';
  const type =
    contentType ??
    (() => {
      const match = /\.(\w+)$/.exec(resolvedName);
      return match ? `image/${match[1]}` : 'image/jpeg';
    })();

  const formData = new FormData();
  formData.append('photo', {
    uri,
    name: resolvedName,
    type,
  } as any);

  const response = await apiClient.post<UploadPhotoResponse>(API_ENDPOINTS.uploadPhoto, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
}
