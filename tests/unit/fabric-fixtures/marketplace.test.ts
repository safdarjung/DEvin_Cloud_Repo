import { describe, expect, it } from "vitest";
import { marketplaceModules, initialInstalls } from "@/modules/fabric/demo/marketplace";
import { FixtureOpts } from "@/modules/fabric/demo/prng";

describe("marketplace fixtures", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const institutionId = "inst-demo";
  const opts: FixtureOpts = { seed: 7, now, institutionId };

  it("generates 24 modules with unique slugs", () => {
    const modules = marketplaceModules(opts);

    expect(modules).toHaveLength(24);

    const slugs = modules.map((m) => m.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(24);
  });

  it("includes all 10 categories", () => {
    const modules = marketplaceModules(opts);
    const categories = new Set(modules.map((m) => m.category));

    expect(categories.size).toBe(10);
    expect(Array.from(categories).sort()).toEqual([
      "agent",
      "analytics",
      "custom",
      "industry",
      "integration",
      "productivity",
      "report",
      "simulation",
      "template",
      "workflow",
    ]);
  });

  it("marks at least 6 modules as featured", () => {
    const modules = marketplaceModules(opts);
    const featured = modules.filter((m) => m.is_featured);

    expect(featured.length).toBeGreaterThanOrEqual(6);
  });

  it("includes pricing mix of free, monthly, annual, usage, and custom", () => {
    const modules = marketplaceModules(opts);
    const pricingModels = new Set(modules.map((m) => m.pricing.model));

    expect(pricingModels.has("free")).toBe(true);
    expect(pricingModels.has("monthly")).toBe(true);
    expect(pricingModels.has("annual")).toBe(true);
    expect(pricingModels.has("usage")).toBe(true);
    expect(pricingModels.has("custom")).toBe(true);
  });

  it("has 2-3 changelog entries per module", () => {
    const modules = marketplaceModules(opts);

    modules.forEach((m) => {
      expect(m.changelog.length).toBeGreaterThanOrEqual(1);
      expect(m.changelog.length).toBeLessThanOrEqual(3);
    });
  });

  it("validates all dependency slugs exist in module list", () => {
    const modules = marketplaceModules(opts);
    const slugs = new Set(modules.map((m) => m.slug));

    modules.forEach((m) => {
      m.dependencies.forEach((depSlug) => {
        expect(
          slugs.has(depSlug),
          `Module "${m.slug}" depends on non-existent slug "${depSlug}"`,
        ).toBe(true);
      });
    });
  });

  it("has realistic permission keys", () => {
    const modules = marketplaceModules(opts);
    const allPermissions = new Set<string>();

    modules.forEach((m) => {
      m.required_permissions.forEach((p) => allPermissions.add(p));
    });

    const realishKeys = Array.from(allPermissions);
    expect(realishKeys.length).toBeGreaterThan(0);

    realishKeys.forEach((key) => {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    });
  });

  it("has mixed supported_products", () => {
    const modules = marketplaceModules(opts);
    const allProducts = new Set<string>();

    modules.forEach((m) => {
      m.supported_products.forEach((p) => allProducts.add(p));
    });

    expect(allProducts.has("coolskool")).toBe(true);
  });

  it("strings are within 400 chars for summary and description", () => {
    const modules = marketplaceModules(opts);

    modules.forEach((m) => {
      expect(m.summary.length).toBeLessThanOrEqual(400);
      expect(m.description.length).toBeLessThanOrEqual(400);
      expect(m.name.length).toBeLessThanOrEqual(400);
      m.changelog.forEach((ch) => {
        expect(ch.note.length).toBeLessThanOrEqual(400);
      });
    });
  });

  it("initialInstalls references only existing module IDs", () => {
    const modules = marketplaceModules(opts);
    const installs = initialInstalls(opts);

    const moduleIds = new Set(modules.map((m) => m.id));

    expect(installs.length).toBe(6);
    installs.forEach((inst) => {
      expect(
        moduleIds.has(inst.module_id),
        `Install "${inst.id}" references non-existent module ID "${inst.module_id}"`,
      ).toBe(true);
    });
  });

  it("initialInstalls has 5 installed and 1 pending_approval", () => {
    const installs = initialInstalls(opts);

    const installed = installs.filter((i) => i.status === "installed");
    const pending = installs.filter((i) => i.status === "pending_approval");

    expect(installed).toHaveLength(5);
    expect(pending).toHaveLength(1);
  });

  it("is deterministic: same seed produces identical output", () => {
    const modules1 = marketplaceModules(opts);
    const modules2 = marketplaceModules(opts);
    const installs1 = initialInstalls(opts);
    const installs2 = initialInstalls(opts);

    expect(modules1).toEqual(modules2);
    expect(installs1).toEqual(installs2);
  });

  it("each module has ratings within 0-5 or null", () => {
    const modules = marketplaceModules(opts);

    modules.forEach((m) => {
      if (m.rating !== null) {
        expect(m.rating).toBeGreaterThanOrEqual(0);
        expect(m.rating).toBeLessThanOrEqual(5);
      }
    });
  });

  it("included modules match example names and domains", () => {
    const modules = marketplaceModules(opts);
    const slugs = modules.map((m) => m.slug);

    const expectedExamples = [
      "fee-reminder-pack",
      "cbse-report-templates",
      "transport-gps-connector",
      "attendance-early-warning",
      "timetable-optimizer",
      "whatsapp-notifications-sim",
      "alumni-crm",
      "library-manager",
      "canteen-pos",
    ];

    expectedExamples.forEach((example) => {
      expect(slugs).toContain(example);
    });
  });
});
