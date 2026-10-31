# CoolSkool Technical Specification
## Comprehensive Development Guide with Market Research

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Market Analysis & Positioning](#market-analysis)
3. [System Architecture](#system-architecture)
4. [Database Schema](#database-schema)
5. [API Design](#api-design)
6. [Feature Specifications](#feature-specifications)
7. [Security & Compliance](#security-compliance)
8. [AI Integration](#ai-integration)
9. [Implementation Timeline](#implementation-timeline)
10. [Testing Strategy](#testing-strategy)
11. [Deployment & DevOps](#deployment)
12. [Go-to-Market Strategy](#go-to-market)

---

## 1. Executive Summary {#executive-summary}

**CoolSkool** is an AI-native school operating system targeting budget private schools in India. It integrates school administration, personalized AI-powered learning, and future smart-campus capabilities into a unified platform.

**Market Opportunity:**
- Indian EdTech market: $13B USD (2026), projected $29B+ by 2030
- 1.5M schools, 250M+ students addressable market
- Government investment: ₹3,200 crore for Student Information Systems
- Tier-2/3 cities represent 70% of market, growing 15-18% CAGR

**Competitive Positioning:**
- Market is fragmented (2,600+ vendors, no player >10% share)
- Top competitors: LEAD School (₹351cr revenue), Teachmint (₹17cr, +110% YoY)
- Differentiation: Integrated AI learning + school OS + curriculum alignment

**Target Pricing:** ₹10,000-50,000/month per school (₹200-400 per student/month)

---

## 2. Market Analysis & Positioning {#market-analysis}

### 2.1 Competitive Landscape

| Player | Revenue (FY24) | Growth | Positioning | Schools |
|--------|---------------|--------|-------------|---------|
| **LEAD School** | ₹351 crore | +28.6% | Budget/mid-tier, curriculum integration | Dominant |
| **Teachmint** | ₹17.1 crore | +110% | School OS, rapid scaling | 2M+ students |
| **Entab** | Established | Stable | Premium CBSE/ICSE | 2,300+ |
| **MyClassboard** | Regional | Stable | South India focus | Strong regional |
| **Next Education** | Large | Growing | Pan-India integrated ecosystem | Large |

### 2.2 Market Gaps & Opportunities

**Identified Pain Points:**
1. **Fragmented systems:** Schools use 3-5 different tools for admin, learning, communication
2. **No true AI integration:** Competitors add chatbots, not curriculum-integrated AI learning
3. **Poor offline support:** Tier-2/3 schools have unreliable connectivity
4. **Limited personalization:** One-size-fits-all content doesn't adapt to student needs
5. **High admin burden:** Manual attendance, report cards, fee collection

**CoolSkool Differentiators:**
1. **Unified platform:** Single source of truth for all school operations
2. **Curriculum-native AI:** Generate notes, quizzes, explanations aligned to syllabus
3. **Offline-first architecture:** Full functionality without constant connectivity
4. **Teacher-centric design:** Approval workflows, content review, not replacement
5. **Future-ready:** Built for smart campus integrations from day one

### 2.3 Target Customer Profile

**Primary Segment:** Budget private schools in Tier-2/3 cities
- Student population: 200-1,000 students
- Annual revenue: ₹50 lakh - ₹5 crore
- Technology budget: ₹1-5 lakh/year
- Current pain: Using WhatsApp + Excel + multiple disconnected tools
- Decision maker: School principal or trust administrator
- Purchase cycle: 3-6 months with pilot phase

**Secondary Segments (Future):**
- Mid-tier CBSE/ICSE schools (500-2,000 students)
- International schools (premium pricing)
- College/university administration (separate product line)

---

## 3. System Architecture {#system-architecture}

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
├──────────────┬──────────────┬──────────────┬───────────────┤
│   Web App    │  Mobile PWA  │  Admin Panel │  Demo Sandbox │
│  (Next.js)   │ (React Native)│   (Next.js)  │   (Isolated)  │
└──────────────┴──────────────┴──────────────┴───────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │
                    │  (Next.js API)    │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│   Supabase     │  │   AI Service    │  │  External APIs  │
│   PostgreSQL   │  │   (LLM Adapter) │  │  (Payment, SMS) │
│   + Auth       │  │                 │  │                 │
│   + Storage    │  │  - Notes Gen    │  │  - Razorpay     │
│   + RLS        │  │  - Quiz Gen     │  │  - WhatsApp     │
│                │  │  - Explanations │  │  - SMS Gateway  │
└────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 Technology Stack

**Frontend:**
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + shadcn/ui components
- **State Management:** Zustand (lightweight, performant)
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts (for analytics)
- **Offline:** IndexedDB via Dexie.js for local caching

**Backend:**
- **Database:** Supabase PostgreSQL 15+
- **Authentication:** Supabase Auth (JWT-based)
- **Storage:** Supabase Storage (CDN-backed)
- **API:** Next.js API Routes (serverless functions)
- **Real-time:** Supabase Realtime (WebSocket)
- **Caching:** Redis (for session, rate limiting)

**AI Layer:**
- **LLM Provider:** Claude 3.5 Sonnet (primary), GPT-4 (fallback)
- **Adapter Pattern:** Abstract LLM interface for provider switching
- **Content Safety:** OpenAI Moderation API + custom filters
- **Rate Limiting:** Token bucket algorithm, per-school quotas

**DevOps:**
- **Hosting:** Vercel (frontend + API), Supabase Cloud (DB)
- **CI/CD:** GitHub Actions
- **Monitoring:** Sentry (errors), PostHog (analytics)
- **Logging:** Axiom or Logflare
- **Testing:** Playwright (E2E), Vitest (unit), MSW (API mocking)

**Mobile:**
- **Phase 1:** Progressive Web App (PWA) with offline support
- **Phase 2:** React Native (iOS + Android native apps)

### 3.3 Offline-First Architecture

Critical for Tier-2/3 schools with unreliable connectivity:

**Sync Strategy:**
1. **Local-first writes:** All mutations save to IndexedDB immediately
2. **Background sync:** Queue pending changes, sync when online
3. **Conflict resolution:** Last-write-wins with server timestamp
4. **Read-heavy caching:** Cache student lists, curriculum, timetables locally
5. **Selective sync:** Only sync data relevant to logged-in user's role

**Offline Capabilities:**
- ✅ View student lists, timetables, curriculum
- ✅ Mark attendance (syncs later)
- ✅ View past quiz results
- ✅ Read announcements
- ❌ Generate new AI content (requires connectivity)
- ❌ Real-time chat/collaboration

---

## 4. Database Schema {#database-schema}

### 4.1 Core Schema (PostgreSQL + Row Level Security)

```sql
-- =====================================================
-- SCHOOLS & USER MANAGEMENT
-- =====================================================

CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- For branded URLs: coolskool.app/schools/{slug}
  logo_url TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  subscription_tier TEXT DEFAULT 'free', -- free, starter, growth, enterprise
  subscription_expires_at TIMESTAMPTZ,
  is_demo BOOLEAN DEFAULT false, -- Flag for sandbox schools
  settings JSONB DEFAULT '{}', -- School-specific configuration
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE school_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'admin', 'teacher', 'student', 'parent'
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, profile_id)
);

-- =====================================================
-- ACADEMIC STRUCTURE
-- =====================================================

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Class 5-A", "Grade 10-B"
  grade_level INTEGER NOT NULL, -- 1-12
  section TEXT, -- "A", "B", "C"
  academic_year TEXT NOT NULL, -- "2025-2026"
  class_teacher_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- "Mathematics", "Science", "English"
  code TEXT, -- "MATH-10", "SCI-8"
  grade_level INTEGER NOT NULL,
  board TEXT, -- "CBSE", "ICSE", "State Board"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE class_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES profiles(id),
  UNIQUE(class_id, subject_id)
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id), -- Links to user account if student has login
  class_id UUID REFERENCES classes(id),
  admission_number TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  gender TEXT, -- "male", "female", "other"
  parent_name TEXT,
  parent_phone TEXT,
  parent_email TEXT,
  address TEXT,
  admission_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CURRICULUM & LEARNING CONTENT
-- =====================================================

CREATE TABLE curriculum_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- "Quadratic Equations", "Photosynthesis"
  description TEXT,
  order_index INTEGER, -- For sequential curriculum
  parent_topic_id UUID REFERENCES curriculum_topics(id), -- For nested topics
  learning_outcomes TEXT[], -- Array of learning objectives
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, -- 'notes', 'explanation', 'quiz'
  content JSONB NOT NULL, -- Structured content (markdown, questions, etc.)
  generated_by_teacher_id UUID REFERENCES profiles(id),
  reviewed_by_teacher_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'draft', -- 'draft', 'under_review', 'approved', 'published'
  published_at TIMESTAMPTZ,
  ai_model TEXT, -- "claude-3-5-sonnet-20241022"
  generation_prompt TEXT, -- Store prompt for auditing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  difficulty_level TEXT, -- 'easy', 'medium', 'hard'
  time_limit_minutes INTEGER, -- NULL for untimed
  passing_score INTEGER, -- Percentage required to pass
  is_published BOOLEAN DEFAULT false,
  created_by_teacher_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT DEFAULT 'multiple_choice', -- 'multiple_choice', 'true_false', 'short_answer'
  options JSONB, -- [{"id": "a", "text": "Option A"}, ...]
  correct_answer JSONB, -- {"id": "c"} or {"text": "expected answer"}
  explanation TEXT, -- Shown after student answers
  points INTEGER DEFAULT 1,
  order_index INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  score INTEGER, -- Percentage or points
  time_taken_seconds INTEGER,
  answers JSONB, -- [{"question_id": "...", "selected_answer": "...", "is_correct": true}]
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'submitted', 'graded'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ATTENDANCE & TIMETABLES
-- =====================================================

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL, -- 'present', 'absent', 'late', 'excused'
  marked_by_teacher_id UUID REFERENCES profiles(id),
  notes TEXT,
  marked_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT false, -- For offline sync tracking
  UNIQUE(student_id, date)
);

CREATE TABLE timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES profiles(id),
  day_of_week INTEGER NOT NULL, -- 1=Monday, 7=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COMMUNICATION
-- =====================================================

CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES profiles(id),
  target_audience TEXT[], -- ['all', 'students', 'teachers', 'parents', 'class:5a']
  priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ANALYTICS & PROGRESS TRACKING
-- =====================================================

CREATE TABLE learning_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  mastery_level INTEGER DEFAULT 0, -- 0-100 percentage
  quiz_attempts_count INTEGER DEFAULT 0,
  average_score INTEGER,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, topic_id)
);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_progress ENABLE ROW LEVEL SECURITY;

-- Example RLS Policy: Users can only access schools they're members of
CREATE POLICY "Users see only their schools"
  ON schools FOR SELECT
  USING (
    id IN (
      SELECT school_id FROM school_memberships
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- Example: Teachers can view students in their school
CREATE POLICY "Teachers view school students"
  ON students FOR SELECT
  USING (
    school_id IN (
      SELECT school_id FROM school_memberships
      WHERE profile_id = auth.uid()
      AND role IN ('teacher', 'admin')
      AND is_active = true
    )
  );

-- Example: Students can only view their own quiz attempts
CREATE POLICY "Students view own quiz attempts"
  ON quiz_attempts FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM students
      WHERE profile_id = auth.uid()
    )
  );

-- (Additional RLS policies for INSERT, UPDATE, DELETE operations needed)
```

### 4.2 Indexes for Performance

```sql
-- School membership lookups (critical for auth)
CREATE INDEX idx_school_memberships_profile ON school_memberships(profile_id, is_active);
CREATE INDEX idx_school_memberships_school ON school_memberships(school_id, role);

-- Student queries
CREATE INDEX idx_students_school_class ON students(school_id, class_id, is_active);
CREATE INDEX idx_students_admission ON students(school_id, admission_number);

-- Attendance queries (heavy read/write)
CREATE INDEX idx_attendance_student_date ON attendance_records(student_id, date DESC);
CREATE INDEX idx_attendance_school_date ON attendance_records(school_id, date DESC);

-- Quiz attempts for analytics
CREATE INDEX idx_quiz_attempts_student ON quiz_attempts(student_id, submitted_at DESC);
CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id, status);

-- Curriculum navigation
CREATE INDEX idx_curriculum_topics_subject ON curriculum_topics(subject_id, order_index);
CREATE INDEX idx_ai_content_topic_status ON ai_content(topic_id, status, published_at);
```

---

## 5. API Design {#api-design}

### 5.1 REST API Endpoints

**Base URL:** `https://api.coolskool.app/v1`

#### Authentication
```
POST   /auth/signup              # Register new user
POST   /auth/login               # Login with email/password
POST   /auth/logout              # Logout current session
POST   /auth/refresh             # Refresh JWT token
POST   /auth/reset-password      # Request password reset
```

#### Schools
```
GET    /schools                  # List schools user has access to
POST   /schools                  # Create new school (admin only)
GET    /schools/:id              # Get school details
PATCH  /schools/:id              # Update school settings
DELETE /schools/:id              # Delete school (admin only)
```

#### Students
```
GET    /schools/:schoolId/students              # List students
POST   /schools/:schoolId/students              # Add new student
GET    /schools/:schoolId/students/:id          # Get student details
PATCH  /schools/:schoolId/students/:id          # Update student
DELETE /schools/:schoolId/students/:id          # Delete student
GET    /schools/:schoolId/students/:id/progress # Get learning progress
```

#### Classes
```
GET    /schools/:schoolId/classes               # List classes
POST   /schools/:schoolId/classes               # Create class
GET    /schools/:schoolId/classes/:id           # Get class details
PATCH  /schools/:schoolId/classes/:id           # Update class
DELETE /schools/:schoolId/classes/:id           # Delete class
GET    /schools/:schoolId/classes/:id/students  # List students in class
```

#### Attendance
```
GET    /schools/:schoolId/attendance            # Get attendance records
POST   /schools/:schoolId/attendance            # Mark attendance (bulk)
GET    /schools/:schoolId/attendance/reports    # Attendance reports
PATCH  /schools/:schoolId/attendance/:id        # Update attendance record
```

#### Curriculum & Topics
```
GET    /schools/:schoolId/subjects              # List subjects
POST   /schools/:schoolId/subjects              # Create subject
GET    /schools/:schoolId/subjects/:id/topics   # List curriculum topics
POST   /schools/:schoolId/subjects/:id/topics   # Create topic
```

#### AI Content Generation
```
POST   /ai/generate-notes        # Generate notes for topic
POST   /ai/generate-explanation  # Generate simplified explanation
POST   /ai/generate-quiz         # Generate quiz questions
POST   /ai/review-content        # Submit content for teacher review
```

#### Quizzes
```
GET    /schools/:schoolId/quizzes               # List quizzes
POST   /schools/:schoolId/quizzes               # Create quiz
GET    /schools/:schoolId/quizzes/:id           # Get quiz details
PATCH  /schools/:schoolId/quizzes/:id           # Update quiz
POST   /schools/:schoolId/quizzes/:id/publish   # Publish quiz
GET    /schools/:schoolId/quizzes/:id/attempts  # Get quiz attempts
POST   /schools/:schoolId/quizzes/:id/attempt   # Start quiz attempt
PATCH  /quiz-attempts/:id/submit                # Submit quiz answers
```

#### Announcements
```
GET    /schools/:schoolId/announcements         # List announcements
POST   /schools/:schoolId/announcements         # Create announcement
GET    /schools/:schoolId/announcements/:id     # Get announcement
PATCH  /schools/:schoolId/announcements/:id     # Update announcement
DELETE /schools/:schoolId/announcements/:id     # Delete announcement
```

#### Analytics
```
GET    /schools/:schoolId/analytics/overview    # School dashboard stats
GET    /schools/:schoolId/analytics/attendance  # Attendance analytics
GET    /schools/:schoolId/analytics/learning    # Learning progress analytics
GET    /students/:studentId/analytics           # Individual student analytics
```

### 5.2 API Response Format

**Success Response:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-10-28T06:00:00Z",
    "requestId": "req_abc123"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Student admission number already exists",
    "details": {
      "field": "admission_number",
      "value": "2025/001"
    }
  },
  "meta": {
    "timestamp": "2026-10-28T06:00:00Z",
    "requestId": "req_abc123"
  }
}
```

**Pagination:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "totalPages": 10,
    "totalRecords": 250,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

## 6. Feature Specifications {#feature-specifications}

### 6.1 School Setup & Onboarding

**User Journey:**
1. Admin visits CoolSkool landing page
2. Signs up with email/password
3. Completes school profile (name, location, contact)
4. Uploads logo (optional)
5. Invites teachers via email
6. Sets up classes and subjects
7. Bulk imports students (CSV upload)
8. Configures timetable

**Technical Requirements:**
- Email verification required before school creation
- Logo upload: max 2MB, PNG/JPG, auto-resize to 200x200px
- CSV import: validate format, detect errors, preview before import
- Duplicate detection: Check admission numbers, phone numbers
- Branded school URL: `coolskool.app/schools/{slug}`

### 6.2 Attendance Management

**Features:**
- **Daily marking:** Mark entire class at once with quick toggles
- **Individual updates:** Edit single student's attendance
- **Bulk import:** Upload CSV for retroactive attendance
- **Filters:** By class, date range, student, status
- **Reports:** Monthly attendance %, trend charts, defaulter list
- **Notifications:** Auto-notify parents of absence (WhatsApp/SMS)

**Offline Support:**
- Cache student list for each class
- Queue attendance marks locally
- Sync when connectivity restored
- Conflict resolution: Server timestamp wins

**UI Components:**
- Class roster grid with profile photos
- Quick action buttons: Present All, Absent All, Reset
- Calendar view for historical attendance
- Export to Excel for official records

### 6.3 AI-Powered Notes Generation

**Input:**
- Teacher selects curriculum topic
- Optionally uploads reference material (PDF/DOCX)
- Specifies target grade level
- Selects tone: "simple", "detailed", "exam-focused"

**Processing:**
1. Send topic + optional material to LLM
2. Prompt: "Generate comprehensive notes for {topic} suitable for {grade} students studying {board}"
3. LLM returns structured markdown notes
4. Parse into sections: Introduction, Key Concepts, Examples, Summary
5. Teacher reviews in side-by-side editor
6. Teacher can edit, regenerate sections, approve

**Output:**
- Structured notes in markdown format
- Saved to `ai_content` table with status='draft'
- Teacher can publish to make visible to students

**Safety:**
- Content moderation API check before showing to teacher
- Teacher approval required before student access
- Audit log of generation prompt and edits

### 6.4 AI-Powered Quiz Generation

**Input:**
- Teacher selects topic
- Specifies difficulty (easy/medium/hard)
- Number of questions (5, 10, 15, 20)
- Question types: MCQ, True/False, Short Answer

**Processing:**
1. Generate quiz questions using LLM
2. Prompt includes curriculum topic, grade, difficulty
3. LLM returns JSON array of questions with options
4. Validate format: Each question has 4 options, 1 correct answer
5. Teacher reviews each question
6. Teacher can edit text, change correct answer, delete questions
7. Teacher approves and publishes

**Quiz Attempt Flow:**
1. Student selects published quiz
2. Quiz opens in full-screen mode
3. Timer starts (if configured)
4. Student answers each question
5. On submit: Calculate score, show correct answers
6. Save attempt to `quiz_attempts` table
7. Update `learning_progress` with new mastery level

**Analytics:**
- Track average score per quiz
- Identify most-missed questions
- Show student's weakest topics
- Compare performance across students

### 6.5 Student Learning Dashboard

**Components:**
1. **Upcoming quizzes:** Cards showing available quizzes
2. **Recent scores:** Line chart of quiz performance over time
3. **Topic mastery:** Progress bars for each curriculum topic
4. **Recommended content:** AI suggests topics to revise based on weak areas
5. **Achievements:** Badges for milestones (10 quizzes completed, 100% score, etc.)

**Personalization:**
- Adaptive difficulty: Suggest easier/harder quizzes based on performance
- Spaced repetition: Resurface topics not practiced in 2+ weeks
- Peer comparison: "You're in top 25% for Mathematics"

### 6.6 Teacher Dashboard

**Components:**
1. **Class overview:** Student count, attendance today, pending reviews
2. **Quick actions:** Mark attendance, create announcement, generate quiz
3. **AI content queue:** List of AI-generated content awaiting review
4. **Recent activity:** Latest quiz attempts, student questions
5. **Analytics:** Class performance trends, weak topics, attendance patterns

**Workflow Optimization:**
- One-click attendance marking with defaults (all present)
- Bulk approve AI content (if confident in quality)
- Pre-filled quiz templates for common topics
- Automated report card generation (future)

---

## 7. Security & Compliance {#security-compliance}

### 7.1 Data Protection (DPDP Act 2023 Compliance)

**Requirements:**
1. **Parental Consent:** Explicit consent for children <18 years
2. **Data Minimization:** Collect only necessary information
3. **Retention Limits:** Auto-delete student data after graduation + 2 years
4. **Breach Notification:** 72-hour notification to Data Protection Board
5. **India Data Residency:** All data stored in India (AWS Mumbai/GCP India)

**Implementation:**
- Consent management system with audit trail
- Automated data retention policies (PostgreSQL scheduled jobs)
- Encryption at rest (AES-256) and in transit (TLS 1.3)
- Regular security audits (quarterly)
- Data Processing Agreement (DPA) with schools

### 7.2 Authentication & Authorization

**Authentication:**
- Email/password with bcrypt hashing (cost factor 12)
- JWT tokens: 15-minute access token, 7-day refresh token
- Multi-factor authentication (MFA) for admin accounts
- Password requirements: 8+ chars, uppercase, lowercase, number
- Account lockout after 5 failed login attempts

**Authorization:**
- Role-based access control (RBAC): admin, teacher, student, parent
- Row Level Security (RLS) enforced at database level
- API endpoint authorization checks
- Principle of least privilege

**School Data Isolation:**
- Every query filtered by `school_id`
- RLS policies prevent cross-school data access
- Demo schools have `is_demo=true` flag with restricted operations
- Audit logs for all data access

### 7.3 AI Safety & Content Moderation

**Challenges:**
- LLMs can generate inaccurate, biased, or inappropriate content
- Age-inappropriate language or concepts
- Copyright concerns with generated content

**Mitigation:**
1. **Teacher-in-the-loop:** All AI content requires teacher approval
2. **Content moderation:** Run generated text through OpenAI Moderation API
3. **Prompt engineering:** System prompts emphasize accuracy, age-appropriateness
4. **Fallback handling:** If moderation flags content, show warning to teacher
5. **Audit trail:** Store generation prompt, model version, timestamps
6. **Rate limiting:** Per-school quotas to prevent abuse (100 generations/day)
7. **Usage monitoring:** Alert on suspicious patterns (repetitive generations, prompt injection)

**Prompt Injection Prevention:**
- Sanitize user inputs before sending to LLM
- Use delimiters to separate instructions from user content
- Monitor for known injection patterns
- Limit LLM output length to prevent verbose exploits

---

## 8. AI Integration {#ai-integration}

### 8.1 LLM Adapter Architecture

**Design Pattern:**
```typescript
// Abstract interface for LLM providers
interface LLMProvider {
  generateNotes(params: NotesGenerationParams): Promise<GeneratedNotes>;
  generateQuiz(params: QuizGenerationParams): Promise<GeneratedQuiz>;
  generateExplanation(params: ExplanationParams): Promise<string>;
}

// Claude implementation
class ClaudeProvider implements LLMProvider {
  async generateNotes(params: NotesGenerationParams) {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: NOTES_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildNotesPrompt(params) }]
    });
    return parseNotesResponse(response);
  }
}

// OpenAI fallback
class OpenAIProvider implements LLMProvider {
  async generateNotes(params: NotesGenerationParams) {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      max_tokens: 4096,
      messages: [
        { role: "system", content: NOTES_SYSTEM_PROMPT },
        { role: "user", content: buildNotesPrompt(params) }
      ]
    });
    return parseNotesResponse(response);
  }
}

// Provider factory with fallback
class LLMService {
  private primaryProvider: LLMProvider;
  private fallbackProvider: LLMProvider;

  async generateNotes(params: NotesGenerationParams) {
    try {
      return await this.primaryProvider.generateNotes(params);
    } catch (error) {
      console.error("Primary LLM failed, using fallback", error);
      return await this.fallbackProvider.generateNotes(params);
    }
  }
}
```

### 8.2 Prompt Templates

**Notes Generation Prompt:**
```
You are an expert educator creating study notes for {grade} students studying {board} curriculum.

Topic: {topic_name}
Subject: {subject_name}
Grade Level: {grade}
Board: {board} (CBSE/ICSE/State Board)
Tone: {tone} (simple/detailed/exam-focused)

{optional_context}

Generate comprehensive, accurate, and age-appropriate notes covering:
1. Introduction to the topic
2. Key concepts and definitions
3. 2-3 worked examples
4. Common mistakes to avoid
5. Summary of key takeaways

Format the notes in markdown with clear headings. Use bullet points for lists.
Ensure all content is factually correct and aligned with the {board} curriculum.
Avoid advanced terminology unless necessary; explain complex terms in simple language.
```

**Quiz Generation Prompt:**
```
You are creating a {difficulty} quiz for {grade} students on the topic: {topic_name}.

Subject: {subject_name}
Grade Level: {grade}
Difficulty: {difficulty} (easy/medium/hard)
Number of Questions: {num_questions}
Question Types: {question_types} (multiple_choice, true_false)

Generate {num_questions} questions in valid JSON format:

[
  {
    "question_text": "What is photosynthesis?",
    "question_type": "multiple_choice",
    "options": [
      {"id": "a", "text": "Process of making food using sunlight"},
      {"id": "b", "text": "Process of breathing"},
      {"id": "c", "text": "Process of digestion"},
      {"id": "d", "text": "Process of excretion"}
    ],
    "correct_answer": {"id": "a"},
    "explanation": "Photosynthesis is the process by which plants make food using sunlight, water, and carbon dioxide."
  }
]

Requirements:
- Questions must be grade-appropriate and aligned with {board} curriculum
- Each MCQ must have exactly 4 options with only one correct answer
- Include brief explanations for each question
- Cover different aspects of the topic (definitions, applications, examples)
- Vary difficulty within the {difficulty} level
```

### 8.3 Rate Limiting & Cost Management

**Quota System:**
```typescript
interface SchoolQuota {
  school_id: string;
  tier: 'free' | 'starter' | 'growth' | 'enterprise';
  monthly_generations: number; // Max AI generations per month
  current_usage: number;
  resets_at: Date;
}

// Tier limits
const TIER_LIMITS = {
  free: { monthly_generations: 50, max_tokens_per_request: 2048 },
  starter: { monthly_generations: 500, max_tokens_per_request: 4096 },
  growth: { monthly_generations: 2000, max_tokens_per_request: 8192 },
  enterprise: { monthly_generations: -1, max_tokens_per_request: 16384 } // Unlimited
};

async function checkQuota(schoolId: string): Promise<boolean> {
  const quota = await getSchoolQuota(schoolId);
  if (quota.current_usage >= TIER_LIMITS[quota.tier].monthly_generations) {
    throw new Error('Monthly AI generation quota exceeded');
  }
  return true;
}

async function trackUsage(schoolId: string, tokensUsed: number) {
  await incrementQuotaUsage(schoolId, 1); // Increment generation count
  await logAIUsage({
    school_id: schoolId,
    tokens_used: tokensUsed,
    timestamp: new Date()
  });
}
```

**Cost Estimation:**
- Claude 3.5 Sonnet: $3/million input tokens, $15/million output tokens
- Average notes generation: ~500 input + 2000 output tokens = $0.036 per generation
- Average quiz generation: ~300 input + 1500 output tokens = $0.024 per generation
- Target: <₹5/generation after volume pricing

---

## 9. Implementation Timeline {#implementation-timeline}

### Day 1-2: Foundation & Planning
**Deliverables:**
- [x] Finalized database schema
- [x] API endpoint specifications
- [x] Component design system (Tailwind + shadcn/ui)
- [x] Security model documented
- [ ] Development environment setup

**Tasks:**
- Set up Next.js project with TypeScript
- Configure Supabase project (database, auth, storage)
- Initialize Tailwind CSS + shadcn/ui components
- Set up GitHub repo with CI/CD workflows
- Create database tables and RLS policies

### Day 3-4: Authentication & Landing Page
**Deliverables:**
- [ ] Branded landing page with hero, features, pricing
- [ ] Sign up / login flows
- [ ] Email verification
- [ ] Role-based dashboard routing

**Tasks:**
- Design landing page (hero, features, testimonials, CTA)
- Implement Supabase Auth integration
- Create login/signup forms with validation
- Build dashboard shells for each role (admin, teacher, student)

### Day 5-6: School Setup & Admin Dashboard
**Deliverables:**
- [ ] School profile creation and editing
- [ ] User invitation system
- [ ] Admin dashboard with stats overview

**Tasks:**
- School creation form with logo upload
- Invite teachers via email (send magic links)
- Admin dashboard showing school stats (students, classes, attendance)
- School settings page

### Day 7-8: Student & Class Management
**Deliverables:**
- [ ] Add/edit/delete students
- [ ] CSV bulk import for students
- [ ] Class creation and management
- [ ] Subject assignment to classes

**Tasks:**
- Student list with search, filters, pagination
- Student detail modal with edit capabilities
- CSV upload with validation and preview
- Class management interface
- Subject-teacher-class mapping

### Day 9-10: Attendance System
**Deliverables:**
- [ ] Daily attendance marking interface
- [ ] Attendance history and reports
- [ ] Offline-first attendance with sync
- [ ] Attendance analytics (monthly charts)

**Tasks:**
- Class roster with quick toggle UI
- Date-based attendance queries
- Offline queue system (IndexedDB)
- Background sync worker
- Attendance dashboard with charts (Recharts)

### Day 11-12: Curriculum & Topics
**Deliverables:**
- [ ] Curriculum topic tree structure
- [ ] Topic creation and management
- [ ] Subject-topic mapping

**Tasks:**
- Nested topic hierarchy UI
- Drag-and-drop reordering
- Topic detail pages
- Learning outcomes tagging

### Day 13-14: AI Notes Generation
**Deliverables:**
- [ ] AI notes generation interface
- [ ] Teacher review and editing workflow
- [ ] Content approval system
- [ ] Student notes viewing

**Tasks:**
- LLM adapter with Claude/OpenAI
- Notes generation form (topic, tone, grade)
- Side-by-side editor (generated vs edited)
- Markdown rendering for students
- Content moderation integration

### Day 15-16: AI Quiz Generation & Student Quizzes
**Deliverables:**
- [ ] AI quiz generator
- [ ] Teacher quiz review interface
- [ ] Student quiz attempt flow
- [ ] Quiz scoring and feedback

**Tasks:**
- Quiz generation form with parameters
- Question editor (add, edit, delete, reorder)
- Student quiz interface (timer, progress bar)
- Auto-scoring logic for MCQ/true-false
- Results page with explanations

### Day 17-18: Analytics & Progress Tracking
**Deliverables:**
- [ ] Learning progress tracking
- [ ] Student analytics dashboard
- [ ] Teacher analytics dashboard
- [ ] Common mistakes identification

**Tasks:**
- Calculate mastery level per topic
- Student progress charts
- Teacher insights: weak topics, quiz performance
- Class comparison analytics

### Day 19: Demo Sandbox
**Deliverables:**
- [ ] Fictional demo school with sample data
- [ ] Demo admin, teacher, student accounts
- [ ] Guided onboarding tour
- [ ] Reset mechanism

**Tasks:**
- Seed demo database with realistic data
- Mark demo school with `is_demo=true`
- Restrict AI quota for demo (10 generations)
- Reset script to restore initial state
- Onboarding tooltips/wizard

### Day 20: Testing, Polish & Launch Prep
**Deliverables:**
- [ ] End-to-end Playwright tests
- [ ] Mobile responsiveness fixes
- [ ] Error handling and loading states
- [ ] Performance optimization
- [ ] Launch checklist completed

**Tasks:**
- Write critical E2E tests (signup, attendance, quiz flow)
- Test on real mobile devices (Android, iOS)
- Fix UI bugs and polish animations
- Performance audit (Lighthouse score >90)
- Security audit checklist
- Prepare demo recording/pitch deck

---

## 10. Testing Strategy {#testing-strategy}

### 10.1 E2E Testing with Playwright

**Critical User Journeys:**
1. **School Admin Onboarding:**
   - Sign up → verify email → create school → invite teacher → add students
2. **Teacher Workflow:**
   - Login → mark attendance → generate quiz → review and publish
3. **Student Learning:**
   - Login → view quiz → attempt quiz → submit → view results
4. **Offline Sync:**
   - Mark attendance offline → go online → verify sync

**Playwright Test Example:**
```typescript
import { test, expect } from '@playwright/test';

test('teacher can generate and publish quiz', async ({ page }) => {
  // Login as teacher
  await page.goto('/login');
  await page.fill('[name="email"]', 'teacher@demo.com');
  await page.fill('[name="password"]', 'password123');
  await page.click('button:has-text("Login")');
  
  // Navigate to quiz generation
  await page.click('text=Generate Quiz');
  await page.selectOption('[name="topic"]', 'Quadratic Equations');
  await page.selectOption('[name="difficulty"]', 'medium');
  await page.fill('[name="numQuestions"]', '5');
  await page.click('button:has-text("Generate")');
  
  // Wait for AI generation
  await page.waitForSelector('text=Review Generated Quiz');
  
  // Review and publish
  await expect(page.locator('.question-card')).toHaveCount(5);
  await page.click('button:has-text("Publish Quiz")');
  
  // Verify success
  await expect(page.locator('text=Quiz published successfully')).toBeVisible();
});
```

### 10.2 Unit Testing

**Test Coverage Targets:**
- Utility functions: 100%
- API routes: 80%+
- React components: 70%+
- Database queries: 90%+

**Example Vitest Tests:**
```typescript
import { describe, it, expect } from 'vitest';
import { calculateQuizScore } from '@/lib/quiz-utils';

describe('calculateQuizScore', () => {
  it('calculates correct score for all correct answers', () => {
    const answers = [
      { questionId: '1', selectedAnswer: 'a', correctAnswer: 'a' },
      { questionId: '2', selectedAnswer: 'b', correctAnswer: 'b' }
    ];
    expect(calculateQuizScore(answers)).toBe(100);
  });

  it('calculates partial score correctly', () => {
    const answers = [
      { questionId: '1', selectedAnswer: 'a', correctAnswer: 'a' },
      { questionId: '2', selectedAnswer: 'b', correctAnswer: 'c' }
    ];
    expect(calculateQuizScore(answers)).toBe(50);
  });
});
```

### 10.3 Security Testing

**Checklist:**
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitize user inputs)
- [ ] CSRF protection (SameSite cookies)
- [ ] RLS policy validation (attempt cross-school access)
- [ ] Authentication bypass testing
- [ ] Rate limiting verification
- [ ] File upload security (size, type, malware scan)
- [ ] API authorization checks (try accessing other school's data)

---

## 11. Deployment & DevOps {#deployment}

### 11.1 Infrastructure

**Hosting:**
- **Frontend:** Vercel (auto-deploy from main branch)
- **Database:** Supabase Cloud (Mumbai region)
- **File Storage:** Supabase Storage (CDN-backed)
- **Cache:** Upstash Redis (for sessions, rate limiting)
- **Monitoring:** Sentry (errors), PostHog (analytics)

**Environments:**
- **Development:** Local (localhost:3000 + local Supabase)
- **Staging:** staging.coolskool.app (preview deployments)
- **Production:** coolskool.app (main branch)

### 11.2 CI/CD Pipeline

**GitHub Actions Workflow:**
```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run test:e2e
      
  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: vercel/action@v2
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

### 11.3 Monitoring & Alerting

**Key Metrics:**
- Uptime (target: 99.9%)
- API response time (target: <200ms p95)
- Error rate (target: <0.1%)
- AI generation success rate (target: >95%)
- Database query performance (<100ms p95)

**Alerts:**
- Error spike (>10 errors/minute)
- API latency spike (p95 >500ms)
- Database connection failures
- AI quota exceeded
- Security incidents (failed login attempts >100/hour)

---

## 12. Go-to-Market Strategy {#go-to-market}

### 12.1 Customer Acquisition

**Phase 1: Pilot Schools (Month 1-3)**
- Target: 10-20 schools in Tier-2 cities
- Offer: 3 months free + dedicated onboarding support
- Requirements: Commit to feedback sessions, testimonial if satisfied
- Goal: Validate product-market fit, gather case studies

**Phase 2: Organic Growth (Month 4-6)**
- Content marketing: SEO blog posts (school management tips, NEP 2020 explainers)
- Social media: LinkedIn posts targeting school principals, education groups
- Referral program: ₹5,000 credit for each referred school
- Webinars: "Modernizing School Operations with AI" (demo sessions)

**Phase 3: Sales-Led Growth (Month 7-12)**
- Inside sales team (2-3 SDRs)
- Partnerships with school associations (NISA, NCERT affiliates)
- Conferences: DIDAC India, Education World India School Rankings events
- Channel partners: Education consultants, school network operators

### 12.2 Pricing Strategy

| Tier | Price (per student/month) | Features | Target Segment |
|------|--------------------------|----------|----------------|
| **Free** | ₹0 | Up to 50 students, basic attendance, 50 AI generations/month | Small schools, trials |
| **Starter** | ₹30 | Up to 500 students, full features, 500 AI generations/month | Budget private schools |
| **Growth** | ₹50 | Up to 2,000 students, advanced analytics, 2,000 AI generations/month | Mid-tier schools |
| **Enterprise** | Custom | Unlimited students, dedicated support, unlimited AI, custom integrations | Large schools, chains |

**Annual Discount:** 15% off for annual payment (improve cash flow)

**Revenue Projections:**
- Month 6: 20 schools × ₹20,000/month = ₹4 lakh/month
- Month 12: 100 schools × ₹30,000/month = ₹30 lakh/month
- Month 24: 500 schools × ₹40,000/month = ₹2 crore/month

### 12.3 Success Metrics (First 12 Months)

| Metric | Target |
|--------|--------|
| Schools signed up | 100+ |
| Active monthly users | 20,000+ (students + teachers) |
| Monthly Recurring Revenue (MRR) | ₹30 lakh+ |
| Churn rate | <10% |
| Net Promoter Score (NPS) | >50 |
| AI generation success rate | >95% |
| Average quizzes per student/month | 5+ |

---

## Appendices

### A. Technology Stack Summary
- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Realtime)
- **AI:** Claude 3.5 Sonnet, GPT-4 (fallback)
- **Hosting:** Vercel (frontend), Supabase Cloud (backend)
- **Monitoring:** Sentry, PostHog
- **Testing:** Playwright (E2E), Vitest (unit)

### B. Key Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| Teacher resistance | User-friendly design, comprehensive training, ongoing support |
| Data privacy violations | DPDP compliance, security audits, encryption, consent management |
| Poor internet connectivity | Offline-first architecture, local caching, background sync |
| AI inaccuracy | Teacher approval required, content moderation, audit trails |
| High customer acquisition cost | Content marketing, referral program, partnerships |

### C. Next Steps After MVP
1. **Mobile app:** React Native iOS/Android apps
2. **Parent portal:** Attendance notifications, progress reports, fee payment
3. **Fee management:** UPI AutoPay, Razorpay integration, automated invoicing
4. **Report cards:** NEP 2020 competency-based, automated generation
5. **Learning community:** Educational feed, student videos, peer learning
6. **Smart campus:** RFID attendance, smartboard integration, classroom analytics
7. **Multi-language:** Hindi, Tamil, Telugu, Marathi interfaces
8. **WhatsApp integration:** Automated parent notifications, chatbot queries

---

**Document Version:** 1.0  
**Last Updated:** October 28, 2026  
**Status:** Ready for Development  
**Next Review:** Post-MVP (Day 20)
