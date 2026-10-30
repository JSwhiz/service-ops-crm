"use client";
import React, { useEffect, useState } from "react";
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

export function ObjectContactsPanel({
  objectId,
  canEdit,
}: {
  objectId: string;
  canEdit: boolean;
}): React.JSX.Element {
  const [items, setItems] = useState<ObjectContact[]>([]);
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setEditing(null);
    void listObjectContacts(objectId)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e: unknown) => {
        if (active)
          setError(getErrorMessage(e, "Не удалось загрузить контакты."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [objectId]);
  const begin = (contact: ObjectContact | "new") => {
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
    if (pending || !editing) return;
    setPending(true);
    setError(null);
    try {
      const saved = await saveObjectContact(
        objectId,
        editing === "new" ? null : editing.id,
        {
          name,
          position,
          phones: phoneDraftValues(phones),
          emails: lines(emails),
          links: lines(links),
          notes,
          expectedVersion: editing === "new" ? undefined : editing.version,
        },
      );
      setItems((rows) =>
        [...rows.filter((row) => row.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name, "ru"),
        ),
      );
      setEditing(null);
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось сохранить контакт."));
    } finally {
      setPending(false);
    }
  };
  const remove = async (contact: ObjectContact) => {
    if (
      pending ||
      !(await confirm({
        title: "Удалить контакт?",
        consequence: contact.name,
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    )
      return;
    setPending(true);
    setError(null);
    try {
      await deleteObjectContact(objectId, contact);
      setItems((rows) => rows.filter((row) => row.id !== contact.id));
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось удалить контакт."));
    } finally {
      setPending(false);
    }
  };
  return (
    <Stack>
      {dialog}
      <div className="ui-section-header">
        <h3 className="ui-section-title">Контакты объекта</h3>
        {canEdit && !editing ? (
          <Button onClick={() => begin("new")}>Добавить контакт</Button>
        ) : null}
      </div>
      {error ? (
        <Alert tone="danger">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              void listObjectContacts(objectId)
                .then(setItems)
                .then(() => setError(null))
                .catch((e: unknown) =>
                  setError(getErrorMessage(e, "Не удалось обновить контакты.")),
                );
            }}
          >
            Обновить данные
          </Button>
        </Alert>
      ) : null}
      {loading ? <LoadingState label="Загрузка контактов" /> : null}
      {editing ? (
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className={styles.formGrid}
        >
          <div className={styles.fullWidth}>
            <ContactEditor value={{ key: editing === 'new' ? 'new' : editing.id, name, position, phones, emails, links, notes }} disabled={pending} onChange={(next) => {
              setName(next.name); setPosition(next.position); setPhones(next.phones); setEmails(next.emails); setLinks(next.links); setNotes(next.notes);
            }} />
          </div>
          <div className={`ui-inline ${styles.fullWidth}`}>
            <Button type="submit" variant="primary" pending={pending}>
              Сохранить контакт
            </Button>
            <Button disabled={pending} onClick={() => setEditing(null)}>
              Отмена
            </Button>
          </div>
        </form>
      ) : items.length ? (
        items.map((contact) => (
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
                    disabled={pending}
                    onClick={() => begin(contact)}
                  >
                    Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
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
