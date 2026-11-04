// M12-T3 Zod schemas: VoidPaymentSchema, SendFeeRemindersSchema,
// CreatePaymentIntentSchema, CollectionReportSchema
import { describe, it, expect } from "vitest";
import {
  VoidPaymentSchema,
  SendFeeRemindersSchema,
  CreatePaymentIntentSchema,
  CollectionReportSchema,
} from "@/modules/finance/schemas";

describe("VoidPaymentSchema", () => {
  it("parses valid void payment", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "void" as const,
      reason: "Duplicate entry",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    const result = VoidPaymentSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses valid refund", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "refund" as const,
      reason: "Student left school",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    const result = VoidPaymentSchema.parse(input);
    expect(result.kind).toBe("refund");
  });

  it("parses valid cheque_bounce", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "cheque_bounce" as const,
      reason: "Insufficient funds",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    const result = VoidPaymentSchema.parse(input);
    expect(result.kind).toBe("cheque_bounce");
  });

  it("rejects reason < 5 chars", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "void" as const,
      reason: "Bad",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => VoidPaymentSchema.parse(input)).toThrow();
  });

  it("rejects reason > 500 chars", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "void" as const,
      reason: "x".repeat(501),
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => VoidPaymentSchema.parse(input)).toThrow();
  });

  it("rejects invalid kind", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "chargeback",
      reason: "Invalid kind",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => VoidPaymentSchema.parse(input)).toThrow();
  });

  it("rejects invalid UUID for paymentId", () => {
    const input = {
      paymentId: "not-a-uuid",
      kind: "void" as const,
      reason: "Invalid UUID",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => VoidPaymentSchema.parse(input)).toThrow();
  });

  it("rejects unknown keys", () => {
    const input = {
      paymentId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "void" as const,
      reason: "Valid reason",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
      extraField: "should be rejected",
    };
    expect(() => VoidPaymentSchema.parse(input)).toThrow();
  });
});

describe("SendFeeRemindersSchema", () => {
  it("parses valid term ID", () => {
    const input = {
      termId: "550e8400-e29b-41d4-a716-446655440000",
    };
    const result = SendFeeRemindersSchema.parse(input);
    expect(result.termId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects invalid UUID", () => {
    const input = {
      termId: "not-a-uuid",
    };
    expect(() => SendFeeRemindersSchema.parse(input)).toThrow();
  });

  it("rejects unknown keys", () => {
    const input = {
      termId: "550e8400-e29b-41d4-a716-446655440000",
      extraField: "should be rejected",
    };
    expect(() => SendFeeRemindersSchema.parse(input)).toThrow();
  });
});

describe("CreatePaymentIntentSchema", () => {
  it("parses valid payment intent", () => {
    const input = {
      invoiceId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 100.5,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    const result = CreatePaymentIntentSchema.parse(input);
    expect(result.amount).toBe(100.5);
  });

  it("rejects amount < 1", () => {
    const input = {
      invoiceId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 0.5,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => CreatePaymentIntentSchema.parse(input)).toThrow();
  });

  it("accepts 10,000,000 and rejects anything above it", () => {
    const base = { invoiceId: "550e8400-e29b-41d4-a716-446655440000", idempotencyKey: "550e8400-e29b-41d4-a716-446655440001" };
    expect(CreatePaymentIntentSchema.safeParse({ ...base, amount: 10_000_000 }).success).toBe(true);
    expect(CreatePaymentIntentSchema.safeParse({ ...base, amount: 10_000_000.01 }).success).toBe(false);
  });

  it("rejects amount with > 2 decimal places", () => {
    const input = {
      invoiceId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 10.005,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => CreatePaymentIntentSchema.parse(input)).toThrow();
  });

  it("rejects invalid invoiceId", () => {
    const input = {
      invoiceId: "not-a-uuid",
      amount: 100.5,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    };
    expect(() => CreatePaymentIntentSchema.parse(input)).toThrow();
  });

  it("rejects unknown keys", () => {
    const input = {
      invoiceId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 100.5,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
      extraField: "should be rejected",
    };
    expect(() => CreatePaymentIntentSchema.parse(input)).toThrow();
  });
});

describe("CollectionReportSchema", () => {
  it("parses valid report with groupBy=term", () => {
    const input = {
      groupBy: "term" as const,
      academicYearId: "550e8400-e29b-41d4-a716-446655440000",
      termId: "550e8400-e29b-41d4-a716-446655440001",
    };
    const result = CollectionReportSchema.parse(input);
    expect(result.groupBy).toBe("term");
  });

  it("parses valid report with groupBy=grade", () => {
    const input = {
      groupBy: "grade" as const,
      academicYearId: "550e8400-e29b-41d4-a716-446655440000",
    };
    const result = CollectionReportSchema.parse(input);
    expect(result.groupBy).toBe("grade");
  });

  it("parses valid report with groupBy=mode", () => {
    const input = {
      groupBy: "mode" as const,
      academicYearId: "550e8400-e29b-41d4-a716-446655440000",
    };
    const result = CollectionReportSchema.parse(input);
    expect(result.groupBy).toBe("mode");
  });

  it("accepts optional academicYearId", () => {
    const input = {
      groupBy: "term" as const,
    };
    const result = CollectionReportSchema.parse(input);
    expect(result.groupBy).toBe("term");
    expect(result.academicYearId).toBeUndefined();
  });

  it("rejects invalid groupBy value", () => {
    const input = {
      groupBy: "student",
      academicYearId: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(() => CollectionReportSchema.parse(input)).toThrow();
  });

  it("rejects invalid academicYearId", () => {
    const input = {
      groupBy: "term" as const,
      academicYearId: "not-a-uuid",
    };
    expect(() => CollectionReportSchema.parse(input)).toThrow();
  });

  it("rejects unknown keys", () => {
    const input = {
      groupBy: "term" as const,
      academicYearId: "550e8400-e29b-41d4-a716-446655440000",
      extraField: "should be rejected",
    };
    expect(() => CollectionReportSchema.parse(input)).toThrow();
  });
});
