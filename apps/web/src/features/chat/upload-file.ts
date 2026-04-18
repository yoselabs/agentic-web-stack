import { apiClient } from "#/shared/api-client";

export type UploadResult = {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
};

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.fetch("/files", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

export function fileDownloadUrl(fileId: string): string {
  return `${apiClient.baseUrl}/files/${fileId}`;
}
