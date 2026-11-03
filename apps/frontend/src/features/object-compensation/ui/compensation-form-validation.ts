/** Native controls keep browser validation; custom pickers receive focus through Field. */
export function focusCompensationField(form: HTMLFormElement, field: string): void {
  const named = form.elements.namedItem(field);
  if (named instanceof HTMLElement) { named.focus(); return; }
  const wrapper = form.querySelector<HTMLElement>(`[data-compensation-field="${field}"]`);
  const control = wrapper?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button');
  control?.focus();
}

export function reportCompensationControl(form: HTMLFormElement, name: string): boolean {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.reportValidity() : true;
}
