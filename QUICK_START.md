# CoolSkool Quick Start Guide
## 20-Day MVP Development

---

## Project Overview

**CoolSkool** is an AI-native school operating system targeting budget private schools in India. This guide provides everything needed to start development immediately.

---

## Day 1 Tasks (Today)

### 1. Initialize Project
```bash
# Create Next.js project
npx create-next-app@latest coolskool --typescript --tailwind --eslint --app --src-dir

# Navigate to project
cd coolskool

# Install core dependencies
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
npm install zustand react-hook-form @hookform/resolvers zod
npm install recharts date-fns
npm install lucide-react clsx tailwind-merge

# Install shadcn/ui
npx shadcn@latest init

# Add essential shadcn components
npx shadcn@latest add button card input label select dialog table tabs
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key
3. Run the database schema from `TECHNICAL_SPECIFICATION.md`
4. Enable Row Level Security

### 3. Environment Variables
Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI Provider (choose one)
ANTHROPIC_API_KEY=your_claude_api_key
# OPENAI_API_KEY=your_openai_api_key

# App Config
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Project Structure
```
coolskool/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/
│   │   │   ├── admin/
│   │   │   ├── teacher/
│   │   │   ├── student/
│   │   │   └── layout.tsx
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── ai/
│   │   │   ├── schools/
│   │   │   └── ...
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── forms/
│   │   └── charts/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── ai/
│   │   ├── utils/
│   │   └── validations/
│   ├── hooks/
│   ├── types/
│   └── styles/
├── public/
├── tests/
└── package.json
```

---

## Key Files to Create Today

### 1. Supabase Client (`src/lib/supabase/client.ts`)
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### 2. Auth Hook (`src/hooks/useAuth.ts`)
```typescript
import { create } from 'zustand'
import { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  profile: any | null
  currentSchool: any | null
  loading: boolean
  setUser: (user: User | null) => void
  setProfile: (profile: any | null) => void
  setCurrentSchool: (school: any | null) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  profile: null,
  currentSchool: null,
  loading: true,
  setUser: (user) => set({ user, loading: false }),
  setProfile: (profile) => set({ profile }),
  setCurrentSchool: (school) => set({ currentSchool: school })
}))
```

### 3. Landing Page (`src/app/page.tsx`)
```typescript
export default function LandingPage() {
  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="container py-20">
        <h1 className="text-5xl font-bold">
          The AI-Powered School Operating System
        </h1>
        <p className="mt-6 text-xl text-muted-foreground">
          Transform your school with intelligent administration, personalized learning, and seamless operations.
        </p>
        <div className="mt-8 flex gap-4">
          <Button size="lg">Get Started Free</Button>
          <Button size="lg" variant="outline">Watch Demo</Button>
        </div>
      </section>
      
      {/* Features, Pricing, CTA sections */}
    </main>
  )
}
```

---

## Database Setup

Run this SQL in Supabase SQL Editor:
```sql
-- Core tables (from TECHNICAL_SPECIFICATION.md)
-- Schools
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  -- ... (see full schema in TECHNICAL_SPECIFICATION.md)
);

-- Enable RLS
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- Add policies
-- (See full RLS policies in TECHNICAL_SPECIFICATION.md)
```

---

## Development Workflow

### Daily Process
1. **Morning:** Review day's tasks from timeline
2. **Development:** Focus on one feature at a time
3. **Testing:** Write tests as you build
4. **Evening:** Commit progress, plan next day

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/authentication

# Commit frequently
git add .
git commit -m "feat: add login page with email verification"

# Push daily
git push origin feature/authentication
```

---

## Success Criteria by Day

| Day | What Must Work |
|-----|----------------|
| 2 | Landing page live, auth setup complete |
| 4 | Users can sign up, login, see dashboard |
| 6 | Schools can be created, teachers invited |
| 8 | Students can be added (individual + CSV) |
| 10 | Attendance working with offline support |
| 12 | Curriculum topics created and managed |
| 14 | AI generating notes with teacher review |
| 16 | Quizzes generated, students taking quizzes |
| 18 | Analytics showing progress, demo ready |
| 20 | Full E2E flow working, polished demo |

---

## Resources

### Documentation
- [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md) - Complete technical details
- [COOLSKOOL_DEVELOPMENT_PLAN.md](./COOLSKOOL_DEVELOPMENT_PLAN.md) - Overview and strategy

### Tech Stack Docs
- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com)

### External APIs
- [Anthropic API](https://docs.anthropic.com) - Claude AI
- [OpenAI API](https://platform.openai.com/docs) - GPT-4 fallback
- [Razorpay](https://razorpay.com/docs) - Payments (future)

---

## Support

If stuck during development:
1. Check TECHNICAL_SPECIFICATION.md for detailed guidance
2. Review similar features in the spec
3. Test with real user scenarios
4. Keep it simple - focus on MVP scope

**Remember:** The goal is a working product in 20 days, not a perfect one. Ship early, iterate based on feedback.

---

**Let's build CoolSkool! 🚀**
