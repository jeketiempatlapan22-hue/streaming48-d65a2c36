import { describe, it, expect } from "vitest";
import { parseWIBDateTime } from "./timeFormat";

// WIB = UTC+7. parseWIBDateTime treats inputs as WIB wall-clock and returns UTC ms.
const wib = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, 0) - 7 * 60 * 60 * 1000;

describe("parseWIBDateTime", () => {
  it("parses Indonesian textual date '07 Mei 2026' with '19.00 WIB'", () => {
    expect(parseWIBDateTime("07 Mei 2026", "19.00 WIB")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("parses date with leading day-of-week 'Jumat,  1 Mei 2026'", () => {
    expect(parseWIBDateTime("Jumat,  1 Mei 2026", "19:00")).toBe(wib(2026, 5, 1, 19, 0));
  });

  it("parses 'Minggu, 3 Mei 2026' with time '14.00 WIB'", () => {
    expect(parseWIBDateTime("Minggu, 3 Mei 2026", "14.00 WIB")).toBe(wib(2026, 5, 3, 14, 0));
  });

  it("parses ISO date '2026-05-07'", () => {
    expect(parseWIBDateTime("2026-05-07", "19:00")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("parses slash format 'DD/MM/YYYY'", () => {
    expect(parseWIBDateTime("07/05/2026", "19:00")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("parses dash format 'DD-MM-YYYY'", () => {
    expect(parseWIBDateTime("07-05-2026", "19:00")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("parses 2-digit year '07/05/26'", () => {
    expect(parseWIBDateTime("07/05/26", "19:00")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("parses short month 'Mei' (3 letters)", () => {
    expect(parseWIBDateTime("7 Mei 2026", "")).toBe(wib(2026, 5, 7, 0, 0));
  });

  it("handles empty time → 00:00", () => {
    expect(parseWIBDateTime("7 Mei 2026", "")).toBe(wib(2026, 5, 7, 0, 0));
  });

  it("handles 12-hour with PM", () => {
    expect(parseWIBDateTime("7 Mei 2026", "7pm")).toBe(wib(2026, 5, 7, 19, 0));
  });

  it("returns null for invalid date", () => {
    expect(parseWIBDateTime("entah kapan", "19:00")).toBeNull();
    expect(parseWIBDateTime("", "19:00")).toBeNull();
  });

  it("returns null for invalid month name", () => {
    expect(parseWIBDateTime("7 Quartember 2026", "19:00")).toBeNull();
  });

  it("returns null for out-of-range values", () => {
    expect(parseWIBDateTime("32 Mei 2026", "19:00")).toBeNull();
    expect(parseWIBDateTime("7 Mei 2026", "25:00")).toBeNull();
  });
});
