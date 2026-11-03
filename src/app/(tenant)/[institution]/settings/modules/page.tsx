import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { MODULES } from "@/lib/modules/catalog";
import { listModules } from "@/modules/core/queries";
import { FeatureToggle } from "@/modules/core/components/FeatureToggle";

export default async function ModulesPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "institution.settings.manage");

  const categories = listModules(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Modules"
        description="Enable or disable features and capabilities for your school."
      />

      {categories.map((cat) => (
        <div key={cat.category} className="space-y-4">
          <h2 className="text-lg font-semibold">{cat.category}</h2>
          <div className="grid gap-4">
            {cat.modules.map((mod) => (
              <Card key={mod.key}>
                <CardHeader>
                  <CardTitle className="text-base">{mod.label}</CardTitle>
                  <CardDescription>{mod.description}</CardDescription>
                  {mod.requires.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Needs:{" "}
                      {mod.requires.map((reqKey) => MODULES[reqKey].label).join(", ")}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {mod.core ? (
                    <p className="text-sm font-medium text-muted-foreground">
                      Always on
                    </p>
                  ) : (
                    <FeatureToggle
                      institutionSlug={institutionSlug}
                      featureKey={mod.key}
                      label={mod.label}
                      initialEnabled={mod.enabled}
                      kind="module"
                    />
                  )}

                  {mod.enabled && mod.options.length > 0 && (
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium mb-3">Features</h4>
                      <div className="space-y-2">
                        {mod.options.map((opt) => (
                          <FeatureToggle
                            key={opt.key}
                            institutionSlug={institutionSlug}
                            featureKey={opt.key}
                            label={opt.label}
                            initialEnabled={opt.enabled}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
