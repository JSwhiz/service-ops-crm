export const EMPLOYEE_PHONE_ERROR = 'Проверьте телефон: в заполненном номере должно быть не меньше 3 цифр.';
export const EMPLOYEE_INVALID_PHONE_SELECTOR = '#employee-create-form fieldset[data-section="contacts"] input[type="tel"][aria-invalid="true"]';

/** Called after React has committed the section change, not while its fieldset is hidden. */
export function focusEmployeePhoneIssue(
  activeSection: string,
  find: (selector: string) => { focus: () => void } | null,
): boolean {
  if (activeSection !== 'contacts') return false;
  const input = find(EMPLOYEE_INVALID_PHONE_SELECTOR);
  input?.focus();
  return Boolean(input);
}
