"use client";
import React, { useContext, useEffect, useRef, useState } from "react";
import { AccessSnapshotBoundary, AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { ApiError } from '@/shared/api/fetcher';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import {
  deleteObjectContact,
  listObjectContacts,
  saveObjectContact,
  type ObjectContact,
} from "@/entities/object/api/object-planning-client";
import {
  Alert,
  Button,
  EmptyState,
  LoadingState,
  Stack,
  Surface,
} from "@/shared/ui/foundation";
import { useConfirm } from "@/shared/ui/overlays";
import {
  phoneDrafts,
  phoneDraftValues,
  type PhoneDraft,
} from "@/shared/ui/phone-list-field/phone-list-field";
import { getErrorMessage } from "@/shared/lib/error-message";
import styles from "@/features/object-shared-ui/object-surfaces.module.css";
import { ContactEditor } from './contact-editor';

const readError = (error: unknown, fallback: string): string => error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)
  ? 'Нет доступа к контактам объекта.' : getErrorMessage(error, fallback);

export function ObjectContactsPanel({
  objectId,
  canEdit,
  captureWrite,
}: {
  objectId: string;
  canEdit: boolean;
  captureWrite?: () => { current: () => boolean; acknowledge: () => void };
}): React.JSX.Element {
  const [items, setItems] = useState<ObjectContact[]>([]);
  const [loadedObjectId, setLoadedObjectId] = useState<string | null>(null);
  const [loadedSession, setLoadedSession] = useState<number | null>(null);
  const [readStale, setReadStale] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<{ objectId: string; session: number } | null>(null);
  const session = getAccessSessionGeneration();
  const acknowledged = acknowledgement?.objectId === objectId && acknowledgement.session === session;
  const draftScope = useRef({ objectId, session });
  const draftCurrent = draftScope.current.objectId === objectId && draftScope.current.session === session;
  const visibleItems = loadedObjectId === objectId && loadedSession === session && !readStale ? items : [];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ObjectContact | "new" | null>(null);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [phones, setPhones] = useState<PhoneDraft[]>(phoneDrafts([]));
  const [emails, setEmails] = useState("");
  const [links, setLinks] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, dialog] = useConfirm();
  const [removeTarget, setRemoveTarget] = useState<{ generation: number; objectId: string; contactId: string; version: number } | null>(null);
  const blocked = useContext(AccessSnapshotBlockedContext);
  const current = useRef({ objectId, loadedObjectId, canEdit, blocked, items, editing, acknowledged, readStale });
  current.current = { objectId, loadedObjectId, canEdit, blocked, items, editing, acknowledged, readStale };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => mounted.current && current.current.objectId === targetId);
    draftScope.current = { objectId, session };
    setLoading(true);
    setItems([]);
    setLoadedObjectId(null);
    setLoadedSession(null);
    setError(null);
    setReadStale(false);
    setAcknowledgement(null);
    setEditing(null);
    void listObjectContacts(targetId)
      .then((rows) => {
        if (!active || !fence.current() || current.current.blocked) {
          if (active && fence.sameTarget()) setReadStale(true);
          return;
        }
        if (!rows.every((row) => row.objectId === targetId)) {
          setReadStale(true);
          return;
        }
        setItems(rows); setLoadedObjectId(targetId); setLoadedSession(session);
      })
      .catch((error: unknown) => {
        if (active && fence.current()) setError(readError(error, 'Не удалось загрузить контакты.'));
        else if (active && fence.sameTarget()) setReadStale(true);
      })
      .finally(() => { if (active && fence.sameTarget()) setLoading(false); });
    return () => { active = false; };
  }, [objectId, session]);
  const reloadContacts = async (): Promise<void> => {
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => mounted.current && current.current.objectId === targetId);
    if (pending || current.current.blocked) return;
    setLoading(true);
    try {
      const rows = await listObjectContacts(targetId);
      if (!fence.current() || current.current.blocked || !rows.every((row) => row.objectId === targetId)) return;
      setItems(rows); setLoadedObjectId(targetId); setLoadedSession(session);
      setError(null); setReadStale(false); setAcknowledgement(null);
    } catch (error: unknown) {
      if (fence.current()) setError(readError(error, 'Не удалось обновить контакты.'));
    } finally { if (fence.sameTarget()) setLoading(false); }
  };
  const begin = (contact: ObjectContact | "new") => {
    if (pending || blocked || !canEdit || acknowledged || readStale) return;
    draftScope.current = { objectId, session };
    setEditing(contact);
    const row = contact === "new" ? null : contact;
    setName(row?.name ?? "");
    setPosition(row?.position ?? "");
    setPhones(phoneDrafts(row?.phones ?? []));
    setEmails(row?.emails.join("\n") ?? "");
    setLinks(row?.links.join("\n") ?? "");
    setNotes(row?.notes ?? "");
    setError(null);
  };
  const lines = (value: string) => [
    ...new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetId = objectId;
    const draft = editing;
    const operation = captureWrite?.();
    const fence = captureObjectWriteFence(() => mounted.current && current.current.objectId === targetId);
    const allowed = () => fence.current() && (!operation || operation.current()) && !current.current.blocked &&
      !current.current.acknowledged && !current.current.readStale && current.current.canEdit && current.current.loadedObjectId === targetId && current.current.editing === draft;
    const acknowledge = () => {
      operation?.acknowledge();
      if (fence.sameTarget()) { setAcknowledgement({ objectId: targetId, session }); setEditing(null); }
    };
    if (pending || !draft || !allowed()) return;
    setPending(true);
    setError(null);
    try {
      const saved = await saveObjectContact(
        targetId,
        draft === "new" ? null : draft.id,
        {
          name,
          position,
          phones: phoneDraftValues(phones),
          emails: lines(emails),
          links: lines(links),
          notes,
          expectedVersion: draft === "new" ? undefined : draft.version,
        },
      );
      if (isSavedWithoutAccess(saved) || !allowed() || saved.objectId !== targetId) { acknowledge(); return; }
      setItems((rows) =>
        [...rows.filter((row) => row.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name, "ru"),
        ),
      );
      setEditing(null);
    } catch (e) {
      if (fence.sameTarget()) setError(readError(e, "Не удалось сохранить контакт."));
    } finally {
      if (fence.sameTarget()) setPending(false);
    }
  };
  const remove = async (contact: ObjectContact) => {
    const generation = getAccessGeneration();
    const targetId = objectId;
    const operation = captureWrite?.();
    const fence = captureObjectWriteFence(() => mounted.current && current.current.objectId === targetId);
    const allowed = () => fence.current() && (!operation || operation.current()) && !current.current.blocked &&
      !current.current.acknowledged && !current.current.readStale && current.current.canEdit && current.current.loadedObjectId === targetId &&
      current.current.items.some(row => row.id === contact.id && row.version === contact.version);
    const acknowledge = () => {
      operation?.acknowledge();
      if (fence.sameTarget()) { setAcknowledgement({ objectId: targetId, session }); setEditing(null); }
    };
    if (pending || !allowed()) return;
    setRemoveTarget({ generation, objectId: targetId, contactId: contact.id, version: contact.version });
    if (
      !(await confirm({
        title: "Удалить контакт?",
        consequence: contact.name,
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    )
      return;
    if (!allowed()) return;
    setPending(true);
    setError(null);
    try {
      const result = await deleteObjectContact(targetId, contact);
      if (isSavedWithoutAccess(result) || !allowed()) { acknowledge(); return; }
      setItems((rows) => rows.filter((row) => row.id !== contact.id));
    } catch (e) {
      if (fence.sameTarget()) setError(readError(e, "Не удалось удалить контакт."));
    } finally {
      if (fence.sameTarget()) { setPending(false); setRemoveTarget(null); }
    }
  };
  return (
    <Stack>
      <AccessSnapshotBoundary blocked={!canEdit || acknowledged || readStale || (!!removeTarget && (!isAccessGenerationCurrent(removeTarget.generation) || objectId !== removeTarget.objectId || loadedObjectId !== objectId || !items.some(row => row.id === removeTarget.contactId && row.version === removeTarget.version)))}>{dialog}</AccessSnapshotBoundary>
      <div className="ui-section-header">
        <h3 className="ui-section-title">Контакты объекта</h3>
        {canEdit && !editing ? (
          <Button disabled={acknowledged || readStale} onClick={() => begin("new")}>Добавить контакт</Button>
        ) : null}
      </div>
      {error ? (
        <Alert tone="danger">
          {error}
          <Button
            variant="ghost"
            onClick={() => { void reloadContacts(); }}
          >
            Обновить данные
          </Button>
        </Alert>
      ) : null}
      {acknowledged ? <Alert tone="success" role="status">Изменение контакта сохранено. Подробности сейчас недоступны; повторная запись не отправлялась.
        <Button disabled={loading || pending || blocked} onClick={() => { void reloadContacts(); }}>Показать сохранённые контакты</Button>
      </Alert> : null}
      {editing && draftCurrent && !canEdit ? <Alert tone="warning" role="status">Право на изменение контактов отозвано. Черновик сохранён.</Alert> : null}
      {readStale ? <Alert tone="warning" role="status">Права изменились. Проверьте доступ к контактам.
        <Button disabled={loading || pending || blocked} onClick={() => { void reloadContacts(); }}>Проверить доступ</Button>
      </Alert> : null}
      {loading ? <LoadingState label="Загрузка контактов" /> : null}
      {editing && draftCurrent ? (<AccessSnapshotBoundary blocked={!canEdit || blocked || readStale || loadedObjectId !== objectId}>
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className={styles.formGrid}
        >
          <div className={styles.fullWidth}>
            <ContactEditor value={{ key: editing === 'new' ? 'new' : editing.id, name, position, phones, emails, links, notes }} disabled={pending || acknowledged || !canEdit || blocked || readStale || loadedObjectId !== objectId} onChange={(next) => {
              setName(next.name); setPosition(next.position); setPhones(next.phones); setEmails(next.emails); setLinks(next.links); setNotes(next.notes);
            }} />
          </div>
          <div className={`ui-inline ${styles.fullWidth}`}>
            <Button type="submit" variant="primary" pending={pending} disabled={pending || acknowledged || !canEdit || blocked || readStale || loadedObjectId !== objectId}>
              Сохранить контакт
            </Button>
            <Button disabled={pending} onClick={() => setEditing(null)}>
              Отмена
            </Button>
          </div>
        </form></AccessSnapshotBoundary>
      ) : visibleItems.length ? (
        visibleItems.map((contact) => (
          <Surface padding="md" as="article" key={contact.id}>
            <div className="ui-section-header">
              <div>
                <strong>{contact.name}</strong>
                {contact.position ? (
                  <div className="ui-text-muted">{contact.position}</div>
                ) : null}
              </div>
              {canEdit ? (
                <div className="ui-inline">
                  <Button
                    size="sm"
                    disabled={pending || acknowledged || readStale}
                    onClick={() => begin(contact)}
                  >
                    Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || acknowledged || readStale}
                    onClick={() => {
                      void remove(contact);
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              ) : null}
            </div>
            {contact.phones.map((phone) => (
              <div key={phone}>
                <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a>
              </div>
            ))}
            {contact.emails.map((email) => (
              <div key={email}>
                <a href={`mailto:${email}`}>{email}</a>
              </div>
            ))}
            {contact.links.map((link) => (
              <div key={link}>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link}
                >
                  {link.replace(/^https?:\/\//, "").split("/")[0]}
                </a>
              </div>
            ))}
            {contact.notes ? <p>{contact.notes}</p> : null}
          </Surface>
        ))
      ) : !loading ? (
        <EmptyState title="Контакты пока не добавлены" />
      ) : null}
    </Stack>
  );
}
