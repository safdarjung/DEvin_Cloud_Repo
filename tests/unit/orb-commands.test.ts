import { describe, expect, it } from "vitest";
import { ORB_COMMANDS, parseOrbCommand } from "@/modules/ai/explain/commands";

describe("parseOrbCommand", () => {
  it("reads /anatomy with its subject", () => {
    expect(parseOrbCommand("/anatomy heart")).toEqual({ command: "anatomy", arg: "heart" });
  });

  it("reads /teardown with a multi-word subject", () => {
    expect(parseOrbCommand("/teardown a ceiling fan")).toEqual({ command: "teardown", arg: "a ceiling fan" });
  });

  it("reads /infographic", () => {
    expect(parseOrbCommand("/infographic water cycle")).toEqual({ command: "infographic", arg: "water cycle" });
  });

  it("is case-insensitive and trims surrounding space", () => {
    expect(parseOrbCommand("  /ANATOMY   Human Eye  ")).toEqual({ command: "anatomy", arg: "Human Eye" });
  });

  it("keeps a command with no subject, so a photo can be the subject", () => {
    expect(parseOrbCommand("/teardown")).toEqual({ command: "teardown", arg: "" });
  });

  it("returns null for an unknown slash word so normal chat is untouched", () => {
    expect(parseOrbCommand("/help me")).toBeNull();
    expect(parseOrbCommand("/anatomyx heart")).toBeNull();
  });

  it("returns null for plain chat and for a slash that is not at the start", () => {
    expect(parseOrbCommand("what is the anatomy of a heart")).toBeNull();
    expect(parseOrbCommand("explain /anatomy heart")).toBeNull();
    expect(parseOrbCommand("/ anatomy heart")).toBeNull();
    expect(parseOrbCommand("")).toBeNull();
  });
});

describe("ORB_COMMANDS", () => {
  it("lists every parsed command once with usage and help", () => {
    expect(ORB_COMMANDS.map((c) => c.name)).toEqual(["anatomy", "teardown", "infographic", "mindmap", "diagram", "flashcards", "lessonplan", "image"]);
    for (const c of ORB_COMMANDS) {
      expect(c.usage.startsWith(`/${c.name} `)).toBe(true);
      expect(c.help.length).toBeGreaterThan(10);
      expect(parseOrbCommand(`/${c.name} x`)?.command).toBe(c.name);
    }
  });
});
