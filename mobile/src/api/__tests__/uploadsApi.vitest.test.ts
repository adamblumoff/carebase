import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadBillPhoto } from '../uploads';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

const postMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

class MockFormData {
  entries: Array<{ name: string; value: any }> = [];
  append(name: string, value: any) {
    this.entries.push({ name, value });
  }
}

describe('uploads API', () => {
  const originalFormData = globalThis.FormData;

  beforeEach(() => {
    postMock.mockReset();
    (globalThis as any).FormData = MockFormData as any;
  });

  afterEach(() => {
    (globalThis as any).FormData = originalFormData;
  });

  it('builds form data and posts to upload endpoint', async () => {
    const response = { data: { success: true } };
    postMock.mockResolvedValue(response);

    const result = await uploadBillPhoto({ uri: 'file:///path/photo.png' });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, formData, options] = postMock.mock.calls[0];
    expect(url).toBe(API_ENDPOINTS.uploadPhoto);
    expect(formData).toBeInstanceOf(MockFormData);
    const uploaded = (formData as MockFormData).entries[0]?.value;
    expect(uploaded.name).toBe('photo.png');
    expect(uploaded.type).toBe('image/png');
    expect(options).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
    expect(result).toBe(response.data);
  });

  it('respects provided file metadata', async () => {
    postMock.mockResolvedValue({ data: { success: true } });

    await uploadBillPhoto({
      uri: 'file:///custom/path/bill',
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
    });

    const [, formData] = postMock.mock.calls[0];
    const uploaded = (formData as MockFormData).entries[0]?.value;
    expect(uploaded.name).toBe('receipt.jpg');
    expect(uploaded.type).toBe('image/jpeg');
  });

});
