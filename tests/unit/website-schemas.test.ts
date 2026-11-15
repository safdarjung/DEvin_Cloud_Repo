import { describe, expect, it } from "vitest";
import {
  CreatePageSchema,
  PublishPageSchema,
  SavePageVersionSchema,
  SetWebsiteLiveSchema,
  UpsertEventSchema,
  UpsertNoticeSchema,
} from "@/modules/website/schemas";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

describe("CreatePageSchema", () => {
  it("accepts a valid slug and title", () => {
    expect(CreatePageSchema.safeParse({ slug: "gallery", title: "Gallery" }).success).toBe(true);
  });

  it("rejects an uppercase or spaced slug", () => {
    expect(CreatePageSchema.safeParse({ slug: "My Page", title: "T" }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(CreatePageSchema.safeParse({ slug: "gallery", title: "" }).success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    expect(CreatePageSchema.safeParse({ slug: "gallery", title: "Gallery", extra: 1 }).success).toBe(false);
  });
});

describe("SavePageVersionSchema", () => {
  it("accepts an empty block list", () => {
    expect(SavePageVersionSchema.safeParse({ pageId: PAGE_ID, blocks: [] }).success).toBe(true);
  });

  it("accepts a valid hero block", () => {
    const result = SavePageVersionSchema.safeParse({
      pageId: PAGE_ID,
      blocks: [{ type: "hero", heading: "Welcome" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a hero block with a missing heading (acceptance criterion 4)", () => {
    const result = SavePageVersionSchema.safeParse({
      pageId: PAGE_ID,
      blocks: [{ type: "hero", heading: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsafe block URL (javascript: scheme)", () => {
    const result = SavePageVersionSchema.safeParse({
      pageId: PAGE_ID,
      blocks: [{ type: "image", url: "javascript:alert(1)", alt: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid pageId", () => {
    expect(SavePageVersionSchema.safeParse({ pageId: "nope", blocks: [] }).success).toBe(false);
  });
});

describe("PublishPageSchema", () => {
  it("requires pageId and versionId", () => {
    expect(PublishPageSchema.safeParse({}).success).toBe(false);
    expect(PublishPageSchema.safeParse({ pageId: PAGE_ID }).success).toBe(false);
  });

  it("accepts both uuids", () => {
    expect(PublishPageSchema.safeParse({ pageId: PAGE_ID, versionId: VERSION_ID }).success).toBe(true);
  });
});

describe("SetWebsiteLiveSchema", () => {
  it("requires a boolean isLive", () => {
    expect(SetWebsiteLiveSchema.safeParse({ isLive: true }).success).toBe(true);
    expect(SetWebsiteLiveSchema.safeParse({ isLive: "true" }).success).toBe(false);
    expect(SetWebsiteLiveSchema.safeParse({}).success).toBe(false);
  });
});

describe("UpsertNoticeSchema", () => {
  const base = {
    title: "Term 2 begins",
    body: "Classes resume Monday.",
    publishAt: new Date("2026-10-01T00:00:00Z").toISOString(),
    isPublic: true,
  };

  it("accepts the minimal required fields", () => {
    expect(UpsertNoticeSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an id for editing an existing notice", () => {
    expect(UpsertNoticeSchema.safeParse({ ...base, id: PAGE_ID }).success).toBe(true);
  });

  it("accepts an India-time offset, as the Orb drafts it", () => {
    expect(UpsertNoticeSchema.safeParse({ ...base, publishAt: "2026-12-01T09:00:00+05:30", expiresAt: "2026-12-08T09:00:00+05:30" }).success).toBe(true);
  });

  it("rejects a non-ISO publishAt", () => {
    expect(UpsertNoticeSchema.safeParse({ ...base, publishAt: "tomorrow" }).success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    expect(UpsertNoticeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("UpsertEventSchema", () => {
  const base = {
    title: "Annual Sports Day",
    startsAt: new Date("2026-11-28T08:00:00Z").toISOString(),
    isPublic: true,
  };

  it("accepts the minimal required fields", () => {
    expect(UpsertEventSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an India-time offset, as the Orb drafts it", () => {
    expect(UpsertEventSchema.safeParse({ ...base, startsAt: "2026-12-05T14:30:00+05:30", endsAt: "2026-12-05T22:30:00+05:30" }).success).toBe(true);
  });

  it("rejects a non-ISO startsAt", () => {
    expect(UpsertEventSchema.safeParse({ ...base, startsAt: "soon" }).success).toBe(false);
  });
});
