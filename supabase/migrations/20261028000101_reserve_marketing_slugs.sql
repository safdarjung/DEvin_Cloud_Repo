-- School slugs must not shadow public marketing paths (src/lib/marketing/routes.ts).
-- NOT VALID: enforced for new/updated rows without failing on any existing
-- slug; check hosted `institutions` for collisions, then VALIDATE in a later
-- migration. Keep this list in sync with MARKETING_SEGMENTS.
alter table public.institutions
  add constraint institutions_slug_not_reserved
  check (slug <> all (array[
    'api', 's', 'login', 'logout', 'auth', 'admin', 'app', 'www', 'static', 'public', 'demo', 'invite', 'onboarding',
    'portal', 'sw', 'select', 'product', 'modules', 'ai', 'security', 'pricing', 'how-it-works', 'faq', 'contact',
    'roles', 'legal', 'offline', 'icon', 'apple-icon', 'opengraph-image', 'sitemap', 'robots', 'manifest', 'llms', 'for-agents'
  ])) not valid;
