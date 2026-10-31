export interface SectionValidationControl {
  willValidate: boolean;
  validity: { valid: boolean };
  validationMessage: string;
  closest: (selector: string) => { getAttribute: (name: string) => string | null } | null;
  focus: () => void;
  reportValidity: () => boolean;
}

export interface SectionValidationIssue {
  control: SectionValidationControl;
  sectionId: string | null;
  message: string;
}

/** Visibility must not exempt a control from its existing native constraints. */
export function findSectionValidationIssue(controls: ArrayLike<SectionValidationControl>): SectionValidationIssue | null {
  for (const control of Array.from(controls)) {
    if (control.willValidate && !control.validity.valid) {
      return {
        control,
        sectionId: control.closest('[data-create-section]')?.getAttribute('data-create-section') ?? null,
        message: control.validationMessage || 'Проверьте значение поля.',
      };
    }
  }
  return null;
}

/** Focus/report only after React has made the owning section visible. */
export function revealSectionValidationIssue(
  issue: SectionValidationIssue,
  reveal: (id: string) => void,
  schedule: (callback: () => void) => void,
): void {
  if (issue.sectionId) reveal(issue.sectionId);
  schedule(() => {
    issue.control.focus();
    issue.control.reportValidity();
  });
}
