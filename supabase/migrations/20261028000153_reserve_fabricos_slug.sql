-- /fabricos (FabricOS marketing landing) is a top-level public route; a school
-- slugged "fabricos" would shadow it. Same list as 0127 plus 'fabricos'.
-- not valid: existing rows are not re-checked (no school uses this slug).
alter table public.institutions drop constraint institutions_slug_not_reserved;
alter table public.institutions
  add constraint institutions_slug_not_reserved
  check (slug <> all (array[
    'api', 's', 'login', 'logout', 'auth', 'admin', 'app', 'www', 'static', 'public', 'demo', 'invite', 'onboarding',
    'portal', 'sw', 'select', 'product', 'modules', 'ai', 'security', 'pricing', 'how-it-works', 'faq', 'contact',
    'roles', 'legal', 'offline', 'icon', 'apple-icon', 'opengraph-image', 'sitemap', 'robots', 'manifest', 'llms', 'for-agents',
    'platform', 'start', 'tour', 'fabricos'
  ])) not valid;
