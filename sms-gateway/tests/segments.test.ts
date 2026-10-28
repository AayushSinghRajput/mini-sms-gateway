import { describe, expect, it } from "vitest";
import { countSegments } from "@/server/sms/segments";
import { ValidationError } from "@/server/errors";

const en = (n: number) => "a".repeat(n);
const ne = (n: number) => "न".repeat(n); // Devanagari -> Unicode

describe("countSegments: GSM-7", () => {
  it("160 chars = 1 part, 161 = 2, 306 = 2, 307 = 3", () => {
    expect(countSegments(en(160)).parts).toBe(1);
    expect(countSegments(en(161)).parts).toBe(2);
    expect(countSegments(en(306)).parts).toBe(2);
    expect(countSegments(en(307)).parts).toBe(3);
  });
  it("200 English chars = 2 parts (153 + 47), GSM7", () => {
    const r = countSegments(en(200));
    expect(r.encoding).toBe("GSM7");
    expect(r.parts).toBe(2);
    expect(r.perPart).toBe(153);
  });
  it("extension characters count as 2 (160 chars incl. one € = length 161 = 2 parts)", () => {
    const msg = en(159) + "€";
    const r = countSegments(msg);
    expect(r.encoding).toBe("GSM7");
    expect(r.length).toBe(161);
    expect(r.parts).toBe(2);
  });
});

describe("countSegments: Unicode", () => {
  it("70 Nepali chars = 1 part, 71 = 2, 134 = 2, 135 = 3", () => {
    expect(countSegments(ne(70)).parts).toBe(1);
    expect(countSegments(ne(71)).parts).toBe(2);
    expect(countSegments(ne(134)).parts).toBe(2);
    expect(countSegments(ne(135)).parts).toBe(3);
  });
  it("100 Nepali chars = 2 parts (67 + 33), UNICODE", () => {
    const r = countSegments(ne(100));
    expect(r.encoding).toBe("UNICODE");
    expect(r.parts).toBe(2);
    expect(r.perPart).toBe(67);
  });
  it("one emoji makes the whole English message Unicode", () => {
    const r = countSegments("Hello 😀");
    expect(r.encoding).toBe("UNICODE");
    expect(r.length).toBe("Hello 😀".length); // emoji = 2 UTF-16 units
  });
  it("a 70-char message with an emoji fits one part only if <= 70 UTF-16 units", () => {
    expect(countSegments(en(68) + "😀").parts).toBe(1); // 68 + 2 = 70
    expect(countSegments(en(69) + "😀").parts).toBe(2); // 71
  });
});

describe("countSegments: validation", () => {
  it("rejects empty and whitespace-only messages", () => {
    expect(() => countSegments("")).toThrow(ValidationError);
    expect(() => countSegments("   \n ")).toThrow(ValidationError);
  });
  it("rejects messages above the max parts", () => {
    expect(() => countSegments(en(153 * 10 + 1), 10)).toThrow(ValidationError);
    expect(countSegments(en(153 * 10), 10).parts).toBe(10);
  });
});
