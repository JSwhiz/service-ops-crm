'use client';

import React, { useEffect, useRef, useState } from 'react';
import { previewLegacyCandidateDenyRemoval, saveLegacyCandidateDenyRemoval } from '@/entities/user-access/api/user-access-client';
import type { LegacyCandidateDenyRemovalPreview, AccessSaveNoticeContext } from '@/entities/user-access/model/user-access.types';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { getAccessSessionGeneration } from '@/shared/auth/access-generation';
import { useAuth } from '@/shared/auth/use-auth';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { accessError, effectiveLabel } from './access-presentation';

export function LegacyCandidateDenyRemoval({ userId, version, disabled, onBusyChange, onDraftChange, onSaved, onSavedWithoutAccess }: {
  userId: string; version: number; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onDraftChange: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
  onSavedWithoutAccess: (context: AccessSaveNoticeContext) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<LegacyCandidateDenyRemovalPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const operation = useRef(false);
  const { user, refreshUser } = useAuth();
  const accessRevision = useAccessRevision();
  const scopeKey = `${accessRevision}:${version}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setPreview(null); }, [version, accessRevision]);
  useEffect(() => { onDraftChange(Boolean(reason.trim())); }, [reason, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => setPreview(null), Math.max(0, Date.parse(preview.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview]);
  const submit = async (save: boolean): Promise<void> => {
    if (disabled || operation.current) return;
    if (!reason.trim()) { setError('Укажите причину снятия прежнего запрета.'); return; }
    if (save && (!preview || preview.expectedVersion !== version || Date.parse(preview.expiresAt) <= Date.now())) {
      setPreview(null); setError('Повторите предварительный просмотр.'); return;
    }
    operation.current = true; setBusy(true); onBusyChange(true); setError('');
    const requestedScope = currentScope.current;
    const saveActorId = user?.id, saveSession = getAccessSessionGeneration();
    try {
      const payload = { expectedVersion: version, reason: reason.trim() };
      if (!save) {
        const result = await previewLegacyCandidateDenyRemoval(userId, payload);
        if (mounted.current && requestedScope === currentScope.current) setPreview(result);
      } else if (preview) {
        const result = await saveLegacyCandidateDenyRemoval(userId, payload, preview);
        if (saveSession !== getAccessSessionGeneration()) return;
        if (isSavedWithoutAccess(result)) {
          if (saveActorId) onSavedWithoutAccess({ actorId: saveActorId, sessionGeneration: saveSession });
          void refreshUser({ force: true }).catch(() => undefined);
          return;
        }
        if (!mounted.current) return;
        setPreview(null); setReason(''); onDraftChange(false);
        await onSaved();
      }
    } catch (cause) { if (mounted.current && requestedScope === currentScope.current) { setPreview(null); setError(accessError(cause)); } }
    finally { operation.current = false; onBusyChange(false); if (mounted.current) setBusy(false); }
  };
  return <section aria-label="Снятие прежнего персонального запрета кандидатов">
    <h3 className="ui-section-title">Прежний персональный запрет кандидатов</h3>
    <p>Учредитель может снять только этот персональный запрет. Разрешения ролей и остальные правила сохраняются.</p>
    <Field label="Причина снятия запрета" required>
      <textarea rows={3} maxLength={2000} value={reason} disabled={disabled || busy}
        onChange={(event) => { setReason(event.target.value); setPreview(null); setError(''); }} />
    </Field>
    {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    {preview ? <div role="status"><p>Снять прежний персональный запрет. Причина: {preview.reason}</p>
      {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <p>Просмотр кандидатов после снятия: {effectiveLabel(preview.effective.find((row) => row.actionCode === 'candidates.view'))}.</p>
      <Button disabled={disabled} pending={busy} onClick={() => void submit(true)}>Подтвердить снятие запрета</Button>
    </div> : <Button disabled={disabled} pending={busy} onClick={() => void submit(false)}>Проверить снятие запрета</Button>}
  </section>;
}
