export function reconcileRemovedAttachmentIds(removedIds: string[], currentAttachmentIds: string[]): string[] {
  const current = new Set(currentAttachmentIds);
  return removedIds.filter((id) => current.has(id));
}

export function createAttachmentCorrectionDraft<TMutation = unknown>(): {
  getReason: () => string | undefined;
  setReason: (reason: string | undefined) => void;
  stageFile: (file: File, stage: (requestId: string) => Promise<string>) => Promise<string>;
  getMutation: () => TMutation | undefined;
  setMutation: (payload: TMutation) => void;
  clearMutation: () => void;
  markConflict: () => void;
  needsReview: () => boolean;
  acknowledgeReview: () => void;
  reset: () => void;
} {
  let reason: string | undefined;
  let mutation: TMutation | undefined;
  let reviewRequired = false;
  let stagedFiles = new WeakMap<File, { requestId: string; fileId?: string }>();

  return {
    getReason: () => reason,
    setReason: (value) => { reason = value; },
    stageFile: async (file, stage) => {
      let entry = stagedFiles.get(file);
      if (!entry) {
        entry = { requestId: crypto.randomUUID() };
        stagedFiles.set(file, entry);
      }
      if (!entry.fileId) entry.fileId = await stage(entry.requestId);
      return entry.fileId;
    },
    getMutation: () => mutation,
    setMutation: (payload) => { mutation = payload; },
    clearMutation: () => { mutation = undefined; },
    markConflict: () => { mutation = undefined; reviewRequired = true; },
    needsReview: () => reviewRequired,
    acknowledgeReview: () => { reviewRequired = false; },
    reset: () => {
      reason = undefined;
      mutation = undefined;
      reviewRequired = false;
      stagedFiles = new WeakMap();
    },
  };
}
