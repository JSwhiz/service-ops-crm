interface NativeValidationControl {
  isConnected: boolean;
  willValidate: boolean;
  validity: { valid: boolean };
}

export interface NativeValidationIssue {
  control: NativeValidationControl;
  message: string;
}

/** Applies only to a tracked native field error, never to an API error. */
export function isNativeValidationIssueResolved(control: NativeValidationControl): boolean {
  return !control.isConnected || !control.willValidate || control.validity.valid;
}
