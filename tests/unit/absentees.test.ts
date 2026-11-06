import { describe, expect, test } from "vitest";
import { absentStatusCodes, tallyRepeatedAbsentees } from "../../src/modules/attendance/absentees";

describe("absentStatusCodes", () => {
  test("keeps denominator statuses that are not present and not late", () => {
    const codes = absentStatusCodes([
      { code: "P", countsPresent: 1, inDenominator: true },
      { code: "A", countsPresent: 0, inDenominator: true },
      { code: "late", countsPresent: 0, inDenominator: true },
      { code: "H", countsPresent: 0, inDenominator: false },
    ]);
    expect(codes).toEqual(["A"]);
  });
});

describe("tallyRepeatedAbsentees", () => {
  const r = (studentId: string, name: string) => ({ studentId, name, classSection: "5-A" });
  test("returns students at or above the threshold, most absences first", () => {
    const out = tallyRepeatedAbsentees([r("1", "Asha"), r("2", "Ben"), r("1", "Asha"), r("1", "Asha"), r("2", "Ben")], 2, 5);
    expect(out.map((s) => [s.name, s.absences])).toEqual([
      ["Asha", 3],
      ["Ben", 2],
    ]);
  });
  test("excludes students under the threshold and respects the limit", () => {
    expect(tallyRepeatedAbsentees([r("1", "Asha")], 2, 5)).toEqual([]);
    const many = ["a", "b", "c"].flatMap((id) => [r(id, id), r(id, id)]);
    expect(tallyRepeatedAbsentees(many, 2, 2)).toHaveLength(2);
  });
});
