import { ValidationError } from "../errors";

export type Encoding = "GSM7" | "UNICODE";
export interface SegmentInfo { encoding: Encoding; length: number; parts: number; perPart: number }

// GSM 03.38 basic character set (the ESC control char is excluded; it is not user-visible).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// Extension table: each of these costs 2 characters in GSM-7 (escape + character).
const GSM_EXTENSION = new Set("^{}\\[~]|€");

/**
 * Pure SMS segment counter.
 *  GSM-7  : 160 chars in one SMS, parts of 153 when longer.
 *  UNICODE: 70 chars in one SMS, parts of 67 when longer. Length is UTF-16 code units (emoji = 2).
 */
export function countSegments(message: string, maxParts = 10): SegmentInfo {
  if (message.trim().length === 0) throw new ValidationError("message must not be empty");

  let gsmLength = 0;
  let isGsm = true;
  for (const ch of message) {
    if (GSM_BASIC.has(ch)) gsmLength += 1;
    else if (GSM_EXTENSION.has(ch)) gsmLength += 2;
    else { isGsm = false; break; }
  }

  const encoding: Encoding = isGsm ? "GSM7" : "UNICODE";
  const length = isGsm ? gsmLength : message.length;
  const single = isGsm ? 160 : 70;
  const perPart = isGsm ? 153 : 67;
  const parts = length <= single ? 1 : Math.ceil(length / perPart);

  if (parts > maxParts) {
    throw new ValidationError(`message is too long: ${parts} parts (maximum ${maxParts})`, { parts, maxParts, encoding, length });
  }
  return { encoding, length, parts, perPart: parts === 1 ? single : perPart };
}
