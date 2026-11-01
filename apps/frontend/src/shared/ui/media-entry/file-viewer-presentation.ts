export function formatFileTypeLabel(file: { originalName: string; mimeType: string }): string {
  const extension = file.originalName.split('.').pop()?.trim();
  if (extension && extension.length <= 8 && extension !== file.originalName) return extension.toUpperCase();

  const labels: Record<string, string> = {
    'application/pdf': 'PDF',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
    'application/json': 'JSON',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
  };
  return labels[file.mimeType] ?? 'Файл';
}
