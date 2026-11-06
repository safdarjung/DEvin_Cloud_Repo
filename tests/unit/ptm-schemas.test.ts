import { describe, it, expect } from "vitest";
import {
  PTM_SLOT_MINUTES,
  SURVEY_QUESTION_TYPES,
  SURVEY_MAX_QUESTIONS,
  SURVEY_MIN_ANON_RESPONSES,
  PtmEventCreateSchema,
  PtmEventPublishSchema,
  PtmSlotsAddSchema,
  PtmSlotRemoveSchema,
  PtmBookSchema,
  PtmCancelSchema,
  PtmEventsQuerySchema,
  PtmScheduleSchema,
  PtmForStudentSchema,
  SurveyQuestionSchema,
  SurveyCreateSchema,
  SurveyCloseSchema,
  SurveyRespondSchema,
  SurveyResultsSchema,
  SurveyListSchema,
  MySurveysSchema,
} from "../../src/modules/ptm/schemas.ts";

describe("PTM constants", () => {
  it("exports PTM_SLOT_MINUTES", () => {
    expect(PTM_SLOT_MINUTES).toEqual([5, 10, 15, 20, 30]);
  });

  it("exports SURVEY_QUESTION_TYPES", () => {
    expect(SURVEY_QUESTION_TYPES).toBeDefined();
    expect(Array.isArray(SURVEY_QUESTION_TYPES)).toBe(true);
  });

  it("exports SURVEY_MAX_QUESTIONS = 10", () => {
    expect(SURVEY_MAX_QUESTIONS).toBe(10);
  });

  it("exports SURVEY_MIN_ANON_RESPONSES = 3", () => {
    expect(SURVEY_MIN_ANON_RESPONSES).toBe(3);
  });
});

describe("PtmEventCreateSchema", () => {
  it("parses valid event create input", () => {
    const data = {
      title: "Term 2 PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    const result = PtmEventCreateSchema.parse(data);
    expect(result.title).toBe("Term 2 PTM");
    expect(result.eventDate).toBe("2026-11-21");
  });

  it("rejects slotMinutes not in [5,10,15,20,30]", () => {
    const data = {
      title: "PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 7,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    expect(() => PtmEventCreateSchema.parse(data)).toThrow();
  });

  it("rejects bookingClosesAt after event start", () => {
    const data = {
      title: "PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-21T10:00:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    expect(() => PtmEventCreateSchema.parse(data)).toThrow();
  });

  it("rejects dayEndsAt <= dayStartsAt", () => {
    const data = {
      title: "PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "13:00",
      dayEndsAt: "09:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    expect(() => PtmEventCreateSchema.parse(data)).toThrow();
  });

  it("rejects slot count > 60", () => {
    const data = {
      title: "PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 1,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    expect(() => PtmEventCreateSchema.parse(data)).toThrow();
  });

  it("rejects unknown keys", () => {
    const data = {
      title: "PTM",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-20T18:00+05:30",
      classSectionIds: ["550e8400-e29b-41d4-a716-446655440000"],
      unknownField: "value",
    };
    expect(() => PtmEventCreateSchema.parse(data)).toThrow();
  });
});

describe("PtmEventPublishSchema", () => {
  it("parses valid publish input", () => {
    const data = { eventId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = PtmEventPublishSchema.parse(data);
    expect(result.eventId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("PtmSlotsAddSchema", () => {
  it("parses valid slots add input with staffId", () => {
    const data = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      staffId: "660e8400-e29b-41d4-a716-446655440000",
      from: "10:00",
      to: "10:30",
    };
    const result = PtmSlotsAddSchema.parse(data);
    expect(result.from).toBe("10:00");
    expect(result.staffId).toBe("660e8400-e29b-41d4-a716-446655440000");
  });

  it("parses valid slots add input without staffId", () => {
    const data = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      from: "10:00",
      to: "10:30",
    };
    const result = PtmSlotsAddSchema.parse(data);
    expect(result.staffId).toBeUndefined();
  });

  it("rejects from >= to", () => {
    const data = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      from: "10:30",
      to: "10:00",
    };
    expect(() => PtmSlotsAddSchema.parse(data)).toThrow();
  });
});

describe("PtmSlotRemoveSchema", () => {
  it("parses valid slot remove input", () => {
    const data = { slotId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = PtmSlotRemoveSchema.parse(data);
    expect(result.slotId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("PtmBookSchema", () => {
  it("parses valid book input", () => {
    const data = {
      slotId: "550e8400-e29b-41d4-a716-446655440000",
      studentId: "660e8400-e29b-41d4-a716-446655440000",
    };
    const result = PtmBookSchema.parse(data);
    expect(result.slotId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("PtmCancelSchema", () => {
  it("parses valid cancel input", () => {
    const data = { bookingId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = PtmCancelSchema.parse(data);
    expect(result.bookingId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("PtmEventsQuerySchema", () => {
  it("parses empty query", () => {
    const result = PtmEventsQuerySchema.parse({});
    expect(result.includePast).toBeUndefined();
  });

  it("parses with includePast true", () => {
    const result = PtmEventsQuerySchema.parse({ includePast: true });
    expect(result.includePast).toBe(true);
  });
});

describe("PtmScheduleSchema", () => {
  it("parses with staffId", () => {
    const data = {
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      staffId: "660e8400-e29b-41d4-a716-446655440000",
    };
    const result = PtmScheduleSchema.parse(data);
    expect(result.staffId).toBe("660e8400-e29b-41d4-a716-446655440000");
  });

  it("parses without staffId", () => {
    const data = { eventId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = PtmScheduleSchema.parse(data);
    expect(result.staffId).toBeUndefined();
  });
});

describe("PtmForStudentSchema", () => {
  it("parses with studentId only", () => {
    const data = { studentId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = PtmForStudentSchema.parse(data);
    expect(result.studentId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("parses with eventId optional", () => {
    const data = {
      studentId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: "660e8400-e29b-41d4-a716-446655440000",
    };
    const result = PtmForStudentSchema.parse(data);
    expect(result.eventId).toBe("660e8400-e29b-41d4-a716-446655440000");
  });
});

describe("SurveyQuestionSchema", () => {
  it("parses single-choice question", () => {
    const data = {
      type: "single",
      prompt: "How satisfied?",
      options: ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied"],
    };
    const result = SurveyQuestionSchema.parse(data);
    expect(result.type).toBe("single");
  });

  it("parses multi-choice question", () => {
    const data = {
      type: "multi",
      prompt: "Select all",
      options: ["Option 1", "Option 2", "Option 3"],
    };
    const result = SurveyQuestionSchema.parse(data);
    expect(result.type).toBe("multi");
  });

  it("parses text question", () => {
    const data = {
      type: "text",
      prompt: "Any suggestions?",
    };
    const result = SurveyQuestionSchema.parse(data);
    expect(result.type).toBe("text");
    if (result.type === "text") {
      expect("options" in result).toBe(false);
    }
  });

  it("rejects single with 1 option", () => {
    const data = {
      type: "single",
      prompt: "Question",
      options: ["Only one"],
    };
    expect(() => SurveyQuestionSchema.parse(data)).toThrow();
  });

  it("rejects multi with 1 option", () => {
    const data = {
      type: "multi",
      prompt: "Question",
      options: ["Only one"],
    };
    expect(() => SurveyQuestionSchema.parse(data)).toThrow();
  });

  it("rejects options with > 6", () => {
    const data = {
      type: "single",
      prompt: "Question",
      options: ["1", "2", "3", "4", "5", "6", "7"],
    };
    expect(() => SurveyQuestionSchema.parse(data)).toThrow();
  });

  it("rejects option > 80 chars", () => {
    const data = {
      type: "single",
      prompt: "Question",
      options: ["Very long option that exceeds eighty characters and should be rejected"],
    };
    expect(() => SurveyQuestionSchema.parse(data)).toThrow();
  });

  it("rejects text without options", () => {
    const data = {
      type: "text",
      prompt: "Question",
      options: ["Should not be here"],
    };
    expect(() => SurveyQuestionSchema.parse(data)).toThrow();
  });
});

describe("SurveyCreateSchema", () => {
  it("parses valid survey create", () => {
    const data = {
      title: "Parent feedback",
      description: "Help us improve",
      isAnonymous: true,
      closesAt: "2026-11-30T23:59:00+05:30",
      questions: [
        {
          type: "single",
          prompt: "Satisfied?",
          options: ["Yes", "No"],
        },
      ],
      audiences: [
        {
          type: "school",
        },
      ],
    };
    const result = SurveyCreateSchema.parse(data);
    expect(result.title).toBe("Parent feedback");
  });

  it("rejects 11 questions", () => {
    const questions = Array.from({ length: 11 }, (_, i) => ({
      type: "text" as const,
      prompt: `Question ${i + 1}`,
    }));
    const data = {
      title: "Survey",
      closesAt: "2026-11-30T23:59:00+05:30",
      questions,
      audiences: [{ type: "school" as const }],
    };
    expect(() => SurveyCreateSchema.parse(data)).toThrow();
  });

  it("rejects audience role student", () => {
    const data = {
      title: "Survey",
      closesAt: "2026-11-30T23:59:00+05:30",
      questions: [{ type: "text" as const, prompt: "Q" }],
      audiences: [
        {
          type: "role",
          role: "student",
        },
      ],
    };
    expect(() => SurveyCreateSchema.parse(data)).toThrow();
  });

  it("requires option for role audience", () => {
    const data = {
      title: "Survey",
      closesAt: "2026-11-30T23:59:00+05:30",
      questions: [{ type: "text" as const, prompt: "Q" }],
      audiences: [
        {
          type: "role",
        },
      ],
    };
    expect(() => SurveyCreateSchema.parse(data)).toThrow();
  });
});

describe("SurveyCloseSchema", () => {
  it("parses valid close input", () => {
    const data = { surveyId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = SurveyCloseSchema.parse(data);
    expect(result.surveyId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("SurveyRespondSchema", () => {
  it("parses single-choice response", () => {
    const data = {
      surveyId: "550e8400-e29b-41d4-a716-446655440000",
      answers: [0, 1, "text answer"],
    };
    const result = SurveyRespondSchema.parse(data);
    expect(result.answers).toHaveLength(3);
  });

  it("rejects answer text > 500 chars", () => {
    const longText = "a".repeat(501);
    const data = {
      surveyId: "550e8400-e29b-41d4-a716-446655440000",
      answers: [longText],
    };
    expect(() => SurveyRespondSchema.parse(data)).toThrow();
  });

  it("rejects > 10 answers", () => {
    const data = {
      surveyId: "550e8400-e29b-41d4-a716-446655440000",
      answers: Array(11).fill("text"),
    };
    expect(() => SurveyRespondSchema.parse(data)).toThrow();
  });

  it("rejects empty answers", () => {
    const data = {
      surveyId: "550e8400-e29b-41d4-a716-446655440000",
      answers: [],
    };
    expect(() => SurveyRespondSchema.parse(data)).toThrow();
  });
});

describe("SurveyResultsSchema", () => {
  it("parses valid results request", () => {
    const data = { surveyId: "550e8400-e29b-41d4-a716-446655440000" };
    const result = SurveyResultsSchema.parse(data);
    expect(result.surveyId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("SurveyListSchema", () => {
  it("parses empty list request", () => {
    const result = SurveyListSchema.parse({});
    expect(result).toEqual({});
  });

  it("parses with status filter", () => {
    const result = SurveyListSchema.parse({ status: "open" });
    expect(result.status).toBe("open");
  });
});

describe("MySurveysSchema", () => {
  it("parses empty input", () => {
    const result = MySurveysSchema.parse({});
    expect(result).toEqual({});
  });
});
