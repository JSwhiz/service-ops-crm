// Russian numbers may be entered with +7, 8, or the ten-digit subscriber number.
// Search the subscriber portion so formatting never hides an additional phone.
export function candidatePhoneSearchDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits;
}
