import { describe, expect, it } from "vitest";
import { classWise, eligibleGrades, highestLevel, sortTeachers, type QualTeacher } from "@/modules/people/qualifications";

const grades = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"].map((code, i) => ({ id: `g${code}`, code, sortKey: i + 1 }));
const t = (name: string, level: QualTeacher["level"], extra: Partial<QualTeacher> = {}): QualTeacher => ({
  staffId: name.toLowerCase(),
  name,
  level,
  gradeIds: [],
  experienceYears: 0,
  ...extra,
});

describe("highestLevel", () => {
  it("picks the highest level among the degrees, and null when none are given", () => {
    expect(highestLevel([{ level: "bachelors" }, { level: "masters" }, { level: "diploma" }])).toBe("masters");
    expect(highestLevel([])).toBeNull();
  });
});

describe("eligibleGrades", () => {
  it("defaults: a Bachelor's up to class X, a Master's up to XII, a diploma up to V", () => {
    expect(eligibleGrades("bachelors", {}, grades).map((g) => g.code).at(-1)).toBe("X");
    expect(eligibleGrades("masters", {}, grades)).toHaveLength(12);
    expect(eligibleGrades("diploma", {}, grades).map((g) => g.code).at(-1)).toBe("V");
  });

  it("follows the school's rule (owner's example: a BA teaches classes I to III)", () => {
    expect(eligibleGrades("bachelors", { bachelors: "III" }, grades).map((g) => g.code)).toEqual(["I", "II", "III"]);
  });

  it("no qualification on file means no class yet; a rule naming a class the school does not have sets no limit", () => {
    expect(eligibleGrades(null, {}, grades)).toEqual([]);
    expect(eligibleGrades("diploma", { diploma: "UKG" }, grades)).toHaveLength(12);
  });
});

describe("sortTeachers", () => {
  it("puts the highest qualification first, then more experience, then name; profiles not filled in go last", () => {
    const list = sortTeachers([t("Zoya", "bachelors", { experienceYears: 2 }), t("Asha", "bachelors", { experienceYears: 9 }), t("Nitin", null), t("Veronica", "masters")]);
    expect(list.map((x) => x.name)).toEqual(["Veronica", "Asha", "Zoya", "Nitin"]);
  });
});

describe("classWise", () => {
  const rules = { bachelors: "III" } as const;
  const veronica = t("Veronica", "masters", { gradeIds: ["gX", "gXI"] });
  const bina = t("Bina", "bachelors", { gradeIds: ["gI", "gII"] });
  const ravi = t("Ravi", "bachelors");
  const rows = classWise([ravi, bina, veronica], grades, rules);

  it("for each class: who is qualified and asked for it, then who is qualified but did not ask", () => {
    const one = rows.find((r) => r.grade.code === "I");
    expect(one?.preferred.map((x) => x.name)).toEqual(["Bina"]);
    expect(one?.alsoQualified.map((x) => x.name)).toEqual(["Veronica", "Ravi"]);
  });

  it("a class above a teacher's limit never lists them, even if they asked for it", () => {
    const ten = rows.find((r) => r.grade.code === "X");
    expect(ten?.preferred.map((x) => x.name)).toEqual(["Veronica"]);
    expect(ten?.alsoQualified).toEqual([]);
    const withAsk = classWise([t("Bina", "bachelors", { gradeIds: ["gX"] })], grades, rules).find((r) => r.grade.code === "X");
    expect(withAsk?.preferred).toEqual([]);
  });
});
