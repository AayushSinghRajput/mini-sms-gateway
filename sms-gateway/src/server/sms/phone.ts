/**
 * Normalise a Nepali mobile number to its 10-digit form, or return null if invalid.
 * Valid: 10 digits starting with 97 or 98, optionally prefixed with +977 or 977.
 */
export function normalizeNepaliMobile(input: string): string | null {
  const s = input.trim().replace(/[\s-]/g, "");
  let ten: string;
  if (s.startsWith("+")) {
    if (!/^\+977\d{10}$/.test(s)) return null;
    ten = s.slice(-10);
  } else if (/^977\d{10}$/.test(s)) {
    ten = s.slice(-10); // 13 digits: strip the country code
  } else if (/^\d{10}$/.test(s)) {
    ten = s; // note: 9771234567 is a valid 10-digit number and must NOT be stripped
  } else {
    return null;
  }
  return /^9[78]\d{8}$/.test(ten) ? ten : null;
}
