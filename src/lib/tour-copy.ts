import type { Role } from "@/lib/auth/permissions";

// Text for the in-app guided tour (src/components/tenant/app-tour.tsx): one entry per sidebar href in src/lib/nav.ts.
export interface TourCopy {
  text: string;
  /** Wording for that role when the page means something different to them. */
  teacher?: string;
  student?: string;
  guardian?: string;
}

export const TOUR_COPY: Record<string, TourCopy> = {
  // Staff: Overview
  "/dashboard": { text: "A live summary of enrolment, attendance, fee collection and recent activity. Start with the numbers that matter to your role. In the demo school some widgets use sample data." },
  "/today": { text: "Your day in one place: the registers to mark and today's timetable. Open a section such as V-A and mark attendance." },
  "/assistant": { text: "Ask questions about your school's data in plain English, for example how many students were absent this week." },
  "/orb": { text: "A visual map of what the app can do, with a chat to ask or create things. Click a dot to jump to that feature." },
  "/portal": {
    text: "The family-facing home page: timetable, attendance and recent updates for a student. Open it to see what parents and students see.",
    student: "Your home page: today's timetable, attendance for the last 30 days and recent updates. Check today's timetable first.",
    guardian: "Your child's home page: today's timetable, attendance for the last 30 days and recent updates. Check today's timetable first.",
  },

  // Staff: Academics
  "/students": { text: "Search and open student records, and add or import students. Try the search box, then open a profile." },
  "/students/lifecycle": { text: "Year-end promotion, transfers and withdrawals, plus guardian links and each student's history. Review one grade's promotion list first." },
  "/attendance": {
    text: "Mark daily attendance by section. Pick a section such as V-A and mark absentees.",
    teacher: "Mark daily attendance for the sections you teach. Open a section such as V-A and mark absentees.",
  },
  "/assignments": { text: "Set homework and see who has submitted. Create an assignment for one section and subject." },
  "/exams": { text: "Plan exams, enter marks and publish results and report cards. Create or open an exam to enter marks." },
  "/exams/rechecks": { text: "Review recheck requests from guardians and students. Open the oldest pending request." },
  "/exams/seating": { text: "Pick an exam, generate a seating plan for each paper slot and print the room charts." },
  "/lesson-plans": { text: "Plan lessons for your sections and subjects. Open a section and add this week's plan." },
  "/learning-insights": { text: "Chapter and topic gaps, students who need revision and question-wise test results. Open the weakest topic first." },
  "/question-bank": { text: "Reusable questions for your subjects. Add a question or review ones waiting for approval." },
  "/question-papers": { text: "Build, review and print exam papers from your approved questions. Start a paper from a blueprint." },
  "/timetable": { text: "View and publish the weekly timetable for each class section. Open a section such as V-A to see its periods." },
  "/calendar": { text: "Holidays, exam weeks and events for the next 90 days. Check what is coming this month." },
  "/behaviour": { text: "Log merit and demerit incidents. Records are never deleted; a mistake is voided with a reason. Log one incident for a student." },
  "/health": { text: "Health profiles, infirmary visits and vaccinations. Confidential: only school leadership and each child's guardians can see them." },
  "/clubs": { text: "Clubs and their members, club events with sign-ups and the house points race. Open a club to see its members." },
  "/achievements": { text: "Awards and recognition recorded for each student. A manager marks entries as verified. Add an award to a student's portfolio." },
  "/resources": { text: "Study material shared with classes. Upload a file or link and share it with a section." },
  "/textbooks": { text: "Books for each grade and subject. NCERT books open on ncert.nic.in and are never copied here; upload your own files against units." },
  "/textbooks/search": { text: "Find a word or topic in the books your school has uploaded. Each result shows the page." },
  "/online-tests": { text: "Timed tests set from a published question paper. Objective answers are marked automatically; you mark written ones. Set a test for a class." },
  "/study-studio": { text: "Make study material such as flashcards and revision packs and share it with your class. Open a shared item to preview it." },

  // Staff: Operations
  "/admissions": { text: "Enquiries grouped by stage, from first call to admission. Change a card's stage from its dropdown." },
  "/finance": { text: "Fee structures, invoices and payments in ₹. Open an invoice to record a payment." },
  "/finance/ledger": { text: "Double-entry postings for a date range. Pick a range and check that debits match credits." },
  "/finance/fee-plans": { text: "Late-fee rules, instalment plans and a ledger export. Review the late-fee rule first." },
  "/finance/concessions": { text: "Scholarship and fee-concession rules, per-student awards with a two-person approval. Limited: awards are recorded but not applied to invoices automatically." },
  "/finance/expenses": { text: "Record school spending and track it against budget. Limited: a separate register, not posted to the ledger. Add one expense." },
  "/payroll": { text: "Salary structures, monthly payroll runs and payslips. Limited: no bank payout and no PF, ESI or TDS deductions. Open the latest run." },
  "/staff": {
    text: "Staff check-in, leave requests and substitute cover. Approve a pending leave request first.",
    teacher: "Check in, apply for leave and see substitute cover for your periods. Check in for today.",
  },
  "/me/teaching-profile": { text: "Your teaching profile: the subjects and classes you can teach. Check it is up to date." },
  "/staff/qualifications": { text: "Teacher qualifications on record. Open a teacher to see or add a degree." },
  "/library": { text: "Library catalogue, copies and loans. Search a book, then issue a copy to a student." },
  "/visitors": {
    text: "Front-desk visitor log, early-leave gate passes and authorised pickup people. Log a visitor at the gate.",
    teacher: "Raise early-leave gate passes for students in your class. Create a gate pass.",
  },
  "/certificates": { text: "Issue bonafide, character and transfer certificates and print class ID cards. Pick a student and issue a bonafide certificate." },
  "/transport": { text: "Routes, stops, vehicle capacity and who rides. Open a route to see its stops and riders." },
  "/hostel": { text: "Rooms, who sleeps where and the daily roll call. Open a room to see its occupants." },
  "/labs": { text: "Lab bookings, equipment, experiments and incidents. Book a lab for a class period." },
  "/canteen": { text: "Sell at the counter, record top-ups and keep the menu current. Top-ups are simulated: the app does not take real payments. Try a counter sale." },
  "/inventory": { text: "Consumables and supplies: stock, low-stock items and every movement. Check what is running low." },
  "/alumni": { text: "Directory of passed-out students and how to reach them. Search by name or batch." },
  "/safety": { text: "Send and track safety alerts. Guardians see active alerts and can acknowledge them. Check for any active alert." },
  "/compliance": { text: "Affiliation, safety and statutory renewals with due dates and history. Check what is due soon." },
  "/duties": { text: "Who is on gate, bus, lunch and other duties, and swap requests. Find your own duty this week." },
  "/website": { text: "Edit pages, preview drafts and publish. The public site changes only when you publish. Open the home page to edit it." },

  // Staff: Communication
  "/ai": { text: "Draft lesson material, notes and messages with AI. Always review the result before you use it. Try a draft for tomorrow's class." },
  "/notifications": { text: "Notifications addressed to you. Open the latest one." },
  "/messages": { text: "Message guardians and staff in one thread per student. Search a student by name or admission number to start." },
  "/diary": { text: "Post homework and notes to a class; parents see them on the portal. Pick a section and subject, then post today's entry." },
  "/ptm": {
    text: "Schedule parent-teacher meeting days and see bookings. Create a meeting day.",
    teacher: "Open your slots for parent-teacher meetings and see who booked. Open slots for the next meeting day.",
  },
  "/helpdesk": {
    text: "Tickets raised by staff and families, with response targets. Open the oldest unanswered ticket.",
    teacher: "Raise a ticket to the office and follow its replies. Raise one for a repair or request.",
  },
  "/forms": {
    text: "Create forms and collect responses from parents or staff. Create a form, or open one to see responses.",
    teacher: "Forms the school has asked you to fill. Open the first open form.",
  },

  // Staff: Admin
  "/ai/usage": { text: "AI requests and tokens over the last 30 days. The cost is an estimate, not a bill. Check which role uses it most." },
  "/documents": { text: "Student, staff and application files, stored privately. Download links expire after 60 seconds. Upload a file to a student." },
  "/jobs": { text: "Background jobs that failed at least once. Requeue a dead-lettered job once the cause is fixed." },
  "/setup": { text: "A checklist for getting the school running. Steps 1 and 3 get you going; the rest can wait. Do the first open step." },
  "/settings/school": { text: "Your school's name, logo and colour as people see them across the app. Upload your logo first." },
  "/settings/modules": { text: "Switch features on or off for your school. Turn on only what you will use." },
  "/settings/ai": { text: "Set what the AI can do for each role and its usage limit. Review the limit for teachers." },
  "/settings/control-centre": { text: "Switch features on and off for the school and for the orb in one place." },

  // Staff: Fabric
  "/fabric/learning": { text: "Curriculum pacing and exam scheduling from live records, with a mastery heatmap. Look for the weakest subject." },
  "/fabric/students": { text: "Roster, risk signals and intervention plans from live records. Open the student with the highest risk." },
  "/fabric/operations": { text: "Timetable health, cover, transport and facilities from live records. Check for timetable clashes." },
  "/fabric/finance-intel": { text: "Collections so far, forecast and outstanding fees from your own ledger, in ₹. See which month is lagging." },
  "/fabric/insights": { text: "Patterns found in your data. Rules compute the facts and AI only explains them. Open the top insight." },
  "/fabric/lab": { text: "Ask your own questions of the data and chart the answers. Needs the Insights module turned on." },
  "/fabric/workflows": { text: "Automations that check numbers, notify people, ask agents and wait for approval. Open one to see its steps." },
  "/fabric/simulator": { text: "Try what-if changes on students, staff, rooms and periods before committing. Change one number and compare." },
  "/fabric/twin": { text: "A live model of the school: people, rooms and periods. Open a room to see its load." },
  "/fabric/agents": { text: "AI helpers that draft work for you. They never act on anything risky without a person's approval. Review a pending proposal." },
  "/fabric/marketplace": { text: "Every module the app offers, with its monthly price in ₹ and whether it is on for your school. Filter by installed or included to see what you have." },
  "/fabric/studio": { text: "Request custom software or integrations. AI drafts a proposal and a principal or owner approves it before any build. Submit a request." },
  "/fabric/data": { text: "Imports, scheduled reports, background jobs and message channels. Start an import from here." },
  "/fabric/trust": { text: "Who did what, how AI is governed and who can do what. Check the audit trail for recent changes." },

  // Portal (guardian and student)
  "/portal/attendance": {
    text: "Day-by-day attendance for the term. Check the percentage and any absences.",
    student: "Your day-by-day attendance for the term. Check your percentage and any absences.",
    guardian: "Your child's day-by-day attendance for the term. Check the percentage and any absences.",
  },
  "/portal/results": {
    text: "Published exam results and report cards. Open the latest exam.",
    student: "Your published exam results. Open the latest exam to see subject scores.",
    guardian: "Your child's published exam results. Open the latest exam to see subject scores.",
  },
  "/portal/tests": {
    text: "Online test results once the school releases them.",
    student: "Online tests set for your class, and your results once released. Start a test if one is open.",
    guardian: "Online test results for your child, once the school releases them.",
  },
  "/portal/assignments": {
    text: "Homework and assignments with due dates.",
    student: "Your homework with due dates and your progress. Open the one due soonest.",
    guardian: "Your child's homework with due dates and progress. Check what is due soon.",
  },
  "/portal/timetable": {
    text: "The class timetable, once the school publishes it.",
    student: "Your weekly class timetable. Check tomorrow's periods.",
    guardian: "Your child's weekly class timetable. Check tomorrow's periods.",
  },
  "/portal/library": {
    text: "Books borrowed from the school library.",
    student: "Books you have borrowed and their due dates. Check what is due back.",
    guardian: "Books your child has borrowed and their due dates. Check what is due back.",
  },
  "/portal/exams": {
    text: "Upcoming papers in the next 60 days and published results.",
    student: "Your upcoming papers in the next 60 days, and published results. Check the next paper date.",
    guardian: "Your child's upcoming papers in the next 60 days, and published results. Check the next paper date.",
  },
  "/portal/study-progress": {
    text: "Questions asked to the study helper and the answers.",
    student: "Questions you asked the study helper and the answers you got.",
    guardian: "Study topics your child asked the study helper about, with the answers shown. Read the latest one.",
  },
  "/portal/updates": {
    text: "Class diary posts from teachers.",
    student: "Homework and notes your teachers post to the class diary. Read today's post.",
    guardian: "Homework and notes teachers post to your child's class diary. Read today's post.",
  },
  "/portal/transport": {
    text: "School bus route and stop.",
    student: "Your bus route and stop. If none shows, ask the school office.",
    guardian: "Your child's bus route and stop. If none shows, ask the school office.",
  },
  "/portal/calendar": {
    text: "Holidays and events for the next 90 days.",
    student: "Holidays and events for the next 90 days. Check the next holiday.",
    guardian: "School holidays and events for the next 90 days. Check the next holiday.",
  },
  "/portal/fees": {
    text: "Fee invoices, payments and receipts in ₹.",
    student: "Your fee invoices and receipts in ₹. Open an invoice to see what is due.",
    guardian: "Your child's fee invoices and receipts in ₹. Open an invoice to see what is due.",
  },
  "/portal/behaviour": {
    text: "Merit and demerit records.",
    student: "Merit and demerit records the school has logged for you.",
    guardian: "Merit and demerit records the school has logged for your child.",
  },
  "/portal/health": {
    text: "Health profile and infirmary visits.",
    student: "Your health profile and infirmary visits.",
    guardian: "Your child's health profile and infirmary visits. Only you and school leadership see this.",
  },
  "/portal/canteen": {
    text: "Canteen account statement. Top-ups are recorded by the school office; the app takes no payments.",
    student: "Your canteen balance and purchases. Top-ups are recorded by the school office; the app takes no payments.",
    guardian: "Your child's canteen balance and purchases. Top-ups are recorded by the school office; the app takes no payments.",
  },
  "/portal/clubs": {
    text: "Clubs, club events and house.",
    student: "Join clubs, sign up for club events and see your house. Join one club.",
    guardian: "Clubs and events your child can join, and their house. Check what they have joined.",
  },
  "/portal/achievements": {
    text: "Awards and recognition recorded by the school.",
    student: "Awards and recognition the school has recorded for you.",
    guardian: "Awards and recognition the school has recorded for your child.",
  },
  "/portal/resources": {
    text: "Study material shared by teachers.",
    student: "Study material your teachers share. Open the newest item.",
    guardian: "Study material teachers share with your child's class. Open the newest item.",
  },
  "/portal/safety": {
    text: "Active safety alerts from the school.",
    student: "Safety alerts from the school. Acknowledge one if it asks you to.",
    guardian: "Safety alerts from the school. Acknowledge one if it asks you to.",
  },
  "/portal/messages": {
    text: "Message your child's teachers.",
    student: "Message your teachers. Start a new thread with one of them.",
    guardian: "Message your child's teachers. Start a new thread with one of them.",
  },
  "/portal/meetings": {
    text: "Book a slot in parent-teacher meetings.",
    student: "Parent-teacher meeting slots. Your parent or guardian books these.",
    guardian: "Book a slot with a teacher when a parent-teacher meeting is open. Pick a slot.",
  },
  "/portal/assistant": {
    text: "Ask the AI about attendance, exams and assignments.",
    student: "Ask the AI about your attendance, exams and assignments. Try asking what exams are coming up.",
    guardian: "Ask the AI about your child's attendance, exams and assignments. Try asking how many days they were absent this month.",
  },
  "/portal/leave": {
    text: "Send leave requests for the student.",
    student: "Send leave requests and see their status. Your guardian can also do this.",
    guardian: "Send a leave request for your child and see its status. Use the form to send one.",
  },
  "/portal/surveys": {
    text: "Surveys from the school while they are open.",
    student: "Surveys from the school while they are open.",
    guardian: "Surveys from the school while they are open. Fill in any that are waiting.",
  },
  "/portal/forms": {
    text: "Forms from the school while they are open.",
    student: "Forms from the school while they are open. Fill in any that are waiting.",
    guardian: "Forms from the school while they are open. Fill in any that are waiting.",
  },
  "/portal/helpdesk": {
    text: "Raise a ticket and the school office replies here.",
    student: "Raise a ticket and the school office replies here.",
    guardian: "Raise a ticket and the school office replies here. Use it for any query to the office.",
  },
  "/portal/notifications": {
    text: "Notifications from the school.",
    student: "Notifications from the school. Open the latest one.",
    guardian: "Notifications from the school. Open the latest one.",
  },
  "/portal/subjects": { text: "Each subject's textbook and files your teachers share. Open a subject to see its chapters.", student: "Your subjects with textbooks and files your teachers share. Open one subject to see its chapters." },
  "/portal/study": { text: "Chat with the study helper about a topic. Ask about one chapter.", student: "Chat with the study helper about a topic from your books. Ask about one chapter." },
  "/portal/practice": { text: "Practice questions and weak topics by subject.", student: "Practise by subject and see your weak topics. Start a practice set on the weakest one." },
  "/portal/study/studio": { text: "Build a revision pack from weak topics, with flashcards and plans.", student: "Build a revision pack from your weak topics, with flashcards and plans. Make one before your next exam." },
  "/portal/study/search": { text: "Find a word or topic in your class books.", student: "Find a word or topic in your class books. Each result shows the page to open." },
};

/** One or two sentences shown on the tour's first card: what this role mainly uses the app for. */
export const ROLE_INTRO: Record<Role, string> = {
  owner: "You see the whole school: money, people, academics and settings.",
  principal: "You oversee academics, staff and approvals.",
  admin: "You run daily operations: records, fees, staff and setup.",
  admissions: "You manage enquiries and bring new students in.",
  accountant: "You handle fees, payments and the ledger in ₹.",
  exam_controller: "You plan exams, seating, papers and results.",
  teacher: "You mark attendance, set homework, enter marks and talk to parents.",
  student: "You see your timetable, homework, results and study tools.",
  guardian: "You follow your child's attendance, results, fees and school updates.",
};
