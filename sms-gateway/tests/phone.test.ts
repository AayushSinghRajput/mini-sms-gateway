import { describe, expect, it } from "vitest";
import { normalizeNepaliMobile as norm } from "@/server/sms/phone";

describe("normalizeNepaliMobile", () => {
  it.each([
    ["9841234567", "9841234567"],
    ["+9779801122334", "9801122334"],
    ["9779761234567", "9761234567"],
    ["984 123 4567", "9841234567"],
    ["984-123-4567", "9841234567"],
    ["9771234567", "9771234567"], // 10 digits starting with 97 is valid as-is, must not be stripped
    [" 9801234567 ", "9801234567"],
  ])("%s -> %s", (input, expected) => {
    expect(norm(input)).toBe(expected);
  });

  it.each([
    ["9612345678"], // does not start with 97/98
    ["984123456"], // 9 digits
    ["98412345678"], // 11 digits
    ["+9841234567"], // + without 977
    ["+977961234567"], // 977 prefix but 12 digits total after +
    ["9776123456789"], // 977 + 6xxxxxxxxx
    ["abcdefghij"],
    [""],
  ])("%s is invalid", (input) => {
    expect(norm(input)).toBeNull();
  });
});
