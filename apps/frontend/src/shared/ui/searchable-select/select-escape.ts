interface SelectEscapeEvent {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** Consume only the open menu's Escape, including the native dialog default. */
export function handleSelectEscape(event: SelectEscapeEvent, open: boolean, close: () => void, returnFocus: () => void): void {
  if (!open || event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  close();
  returnFocus();
}
