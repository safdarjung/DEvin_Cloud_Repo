import { describe, it, expect } from "vitest";
import {
  renderSeatingChartHtml,
  renderAdmitCardsHtml,
} from "../../src/modules/exam-seating/html";
import type { SeatingChart, AdmitCard } from "../../src/modules/exam-seating/schemas";

const XSS = "<script>alert(1)</script>";

function chart(overrides: Partial<SeatingChart> = {}): SeatingChart {
  return {
    planId: "plan-1",
    institutionName: "Sunrise Public School",
    examName: "Half Yearly 2026",
    slotStart: "2026-11-16T04:00:00.000Z",
    localDate: "2026-11-16",
    localTime: "09:30",
    versionNo: 2,
    isCurrent: true,
    rooms: [
      {
        room: { id: "r1", name: "Hall A" },
        seats: [
          {
            seatNo: 1,
            studentId: "s1",
            studentName: XSS,
            admissionNo: "ADM-001",
            rollNo: 7,
            sectionLabel: "6-A",
          },
          {
            seatNo: 2,
            studentId: "s2",
            studentName: "Priya Sharma",
            admissionNo: "ADM-002",
            rollNo: null,
            sectionLabel: "7-A",
          },
        ],
      },
      {
        room: { id: "r2", name: "Room 12" },
        seats: [
          {
            seatNo: 1,
            studentId: "s3",
            studentName: "Arjun Mehta",
            admissionNo: "ADM-003",
            rollNo: 1,
            sectionLabel: "8-A",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function card(overrides: Partial<AdmitCard> = {}): AdmitCard {
  return {
    institutionName: "Sunrise Public School",
    examName: "Half Yearly 2026",
    studentName: XSS,
    admissionNo: "ADM-001",
    rollNo: null,
    sectionLabel: "6-A",
    papers: [
      {
        subject: "Mathematics",
        date: "2026-11-16",
        weekday: "Mon",
        start: "09:30",
        end: "12:30",
        room: "Hall A",
        seatNo: 14,
      },
      {
        subject: "Science",
        date: "2026-11-17",
        weekday: "Tue",
        start: "09:30",
        end: "12:30",
        room: null,
        seatNo: null,
      },
    ],
    ...overrides,
  };
}

const countPages = (html: string) => (html.match(/class="page"/g) ?? []).length;

function expectSafeDocument(html: string) {
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("<title>");
  expect(html).toContain("@page");
  expect(html).toContain("size: A4");
  expect(html).toContain("break-after: page");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("http");
}

describe("renderSeatingChartHtml", () => {
  it("escapes student names and emits a safe A4 document", () => {
    const html = renderSeatingChartHtml(chart());
    expectSafeDocument(html);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders one page per room with header fields and seats", () => {
    const html = renderSeatingChartHtml(chart());
    expect(countPages(html)).toBe(2);
    expect(html).toContain("Sunrise Public School");
    expect(html).toContain("Half Yearly 2026");
    expect(html).toContain("2026-11-16");
    expect(html).toContain("09:30");
    expect(html).toContain("Hall A");
    expect(html).toContain("Room 12");
    expect(html).toContain("Version 2");
    expect(html).toContain("ADM-002");
    expect(html).toContain("7-A");
  });

  it("prints — for a null rollNo", () => {
    const html = renderSeatingChartHtml(chart());
    expect(html).toContain("<td>—</td>");
  });

  it("skips rooms without seats", () => {
    const c = chart();
    c.rooms.push({ room: { id: "r3", name: "Empty Room" }, seats: [] });
    const html = renderSeatingChartHtml(c);
    expect(countPages(html)).toBe(2);
    expect(html).not.toContain("Empty Room");
  });

  it("shows the Superseded banner only when the plan is not current", () => {
    expect(renderSeatingChartHtml(chart())).not.toContain("Superseded");
    expect(renderSeatingChartHtml(chart({ isCurrent: false }))).toContain(
      "Superseded — do not use"
    );
  });
});

describe("renderAdmitCardsHtml", () => {
  it("escapes student names and emits a safe A4 document", () => {
    const html = renderAdmitCardsHtml([card()]);
    expectSafeDocument(html);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders one page per card", () => {
    const html = renderAdmitCardsHtml([card(), card({ studentName: "Priya Sharma" })]);
    expect(countPages(html)).toBe(2);
    expect(html).toContain("Priya Sharma");
  });

  it("renders papers, seat, 'To be announced' for a null room, and — for a null rollNo", () => {
    const html = renderAdmitCardsHtml([card()]);
    expect(html).toContain("Admit Card");
    expect(html).toContain("2026-11-16 (Mon)");
    expect(html).toContain("09:30–12:30");
    expect(html).toContain("Mathematics");
    expect(html).toContain("Hall A");
    expect(html).toContain("Seat 14");
    expect(html).toContain("To be announced");
    expect(html).toContain("—");
  });

  it("prints the fixed instructions and signature lines", () => {
    const html = renderAdmitCardsHtml([card()]);
    expect(html).toContain("Bring this card to every paper.");
    expect(html).toContain("Reach the exam room 15 minutes before the start.");
    expect(html).toContain("Mobile phones and smart watches are not allowed.");
    expect(html).toContain("Class Teacher");
    expect(html).toContain("Principal");
  });
});
