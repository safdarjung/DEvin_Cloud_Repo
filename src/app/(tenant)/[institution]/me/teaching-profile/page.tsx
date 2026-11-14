import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { TeachingProfileForm } from "@/modules/people/components/TeachingProfileForm";
import { getMyTeacherProfile, listClassesAndSubjects } from "@/modules/people/queries";

export const metadata: Metadata = { title: "My teaching profile" };

// 0155: the form a teacher fills on first sign-in (the layout's banner points here until it is saved).
export default async function TeachingProfilePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "leave.request");
  const [profile, { grades, subjects }] = await Promise.all([getMyTeacherProfile(ctx), listClassesAndSubjects(ctx)]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="My teaching profile"
        description={
          profile?.onboardedAt
            ? "Your qualifications and what you can teach. Keep it up to date; the office uses it to share classes out."
            : "Welcome. Tell the school your qualifications and what you can teach. It takes about two minutes."
        }
      />
      {profile ? (
        <TeachingProfileForm institutionSlug={institutionSlug} profile={profile} grades={grades} subjects={subjects} />
      ) : (
        <EmptyState title="No staff record" description="Your sign-in is not linked to a staff record at this school, so there is no teaching profile to fill in. Ask the office to link it." />
      )}
    </div>
  );
}
