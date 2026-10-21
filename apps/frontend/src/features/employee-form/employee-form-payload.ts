import type { EmployeeDetail, EmployeeMutationPayload } from '@/entities/employee/model/employee.types';

import { phoneDraftValues, phoneDrafts } from '@/shared/ui/phone-list-field/phone-list-field';

import type { EmployeeFormValue } from './employee-form-fields';

/** Single mapping from form state to the existing create/update payload. */
export function toEmployeeMutationPayload(form: EmployeeFormValue): EmployeeMutationPayload {
  return {
    passportReceived: form.passportReceived,
    contractReceived: form.contractReceived,
    fullName: form.fullName.trim(),
    phones: phoneDraftValues(form.phones),
    position: form.position.trim() || null,
    birthDate: form.birthDate || null,
    residenceAddress: form.residenceAddress.trim() || null,
    shiftPreferences: form.shiftPreferences.trim() || null,
    baseDailyRate: form.baseDailyRate.trim() ? Number(form.baseDailyRate) : null,
    employmentStatus: form.employmentStatus,
    employeeType: form.employeeType,
    workScheduleCode: form.workScheduleCode || null,
    workScheduleCustom: form.workScheduleCustom.trim() || null,
    workTimeText: form.workTimeText.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function toEmployeeFormValue(employee: EmployeeDetail): EmployeeFormValue {
  return {
    passportReceived: employee.passportReceived,
    contractReceived: employee.contractReceived,
    fullName: employee.fullName,
    phones: phoneDrafts(employee.phones.length ? employee.phones : employee.phone ? [employee.phone] : []),
    position: employee.position ?? '',
    birthDate: employee.birthDate ?? '',
    residenceAddress: employee.residenceAddress ?? '',
    shiftPreferences: employee.shiftPreferences ?? '',
    baseDailyRate: typeof employee.baseDailyRate === 'number' ? String(employee.baseDailyRate) : '',
    employmentStatus: employee.employmentStatus,
    employeeType: employee.employeeType,
    workScheduleCode: employee.workScheduleCode ?? '',
    workScheduleCustom: employee.workScheduleCustom ?? '',
    workTimeText: employee.workTimeText ?? '',
    notes: employee.notes ?? '',
  };
}
