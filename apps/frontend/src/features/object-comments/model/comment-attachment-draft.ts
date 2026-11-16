/** Private mounted draft. IDs are learned only from a real response or explicit selection. */
export function createCommentAttachmentDraft(files: File[]) {
  let commentId: string | null = null;
  const completed = new Map<File, string>();
  return {
    files: [...files],
    getCommentId: () => commentId,
    bindComment: (id: string) => { if (commentId && commentId !== id) throw new Error('Комментарий для вложений уже выбран.'); commentId = id; },
    complete: (file: File, fileId: string) => { if (!files.includes(file) || !commentId) throw new Error('Неизвестный файл или комментарий.'); completed.set(file, fileId); },
    remaining: () => files.filter(file => !completed.has(file)),
    completedCount: () => completed.size,
  };
}
export type CommentAttachmentDraft = ReturnType<typeof createCommentAttachmentDraft>;
