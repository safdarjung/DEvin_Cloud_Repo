
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "academic_calendar_events": {
                  Row: {
                    "academic_year_id": string,"audience": string,"created_at": string,"created_by": string,"description": string | null,"ends_on": string,"id": string,"institution_id": string,"kind": string,"starts_on": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"audience"?: string,"created_at"?: string,"created_by": string,"description"?: string | null,"ends_on": string,"id"?: string,"institution_id": string,"kind": string,"starts_on": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"audience"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"ends_on"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"starts_on"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "academic_calendar_events_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "academic_calendar_events_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "academic_calendar_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"academic_years": {
                  Row: {
                    "created_at": string,"ends_on": string,"id": string,"institution_id": string,"is_current": boolean,"name": string,"starts_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_on": string,"id"?: string,"institution_id": string,"is_current"?: boolean,"name": string,"starts_on": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ends_on"?: string,"id"?: string,"institution_id"?: string,"is_current"?: boolean,"name"?: string,"starts_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "academic_years_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"achievements": {
                  Row: {
                    "category": string,"created_at": string,"description": string | null,"event_date": string,"id": string,"institution_id": string,"level": string,"position": string | null,"recorded_by": string,"student_id": string,"title": string,"updated_at": string,"verified_at": string | null,"verified_by": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"description"?: string | null,"event_date": string,"id"?: string,"institution_id": string,"level": string,"position"?: string | null,"recorded_by"?: string,"student_id": string,"title": string,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"description"?: string | null,"event_date"?: string,"id"?: string,"institution_id"?: string,"level"?: string,"position"?: string | null,"recorded_by"?: string,"student_id"?: string,"title"?: string,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "achievements_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "achievements_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "achievements_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "achievements_verified_by_fkey"
      columns: ["verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "achievements_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_definitions": {
                  Row: {
                    "actions": (string)[] | null,"archived_at": string | null,"base_slug": string | null,"created_at": string,"created_by": string | null,"examples": (string)[] | null,"id": string,"institution_id": string,"instructions": string | null,"is_enabled": boolean,"name": string | null,"slug": string,"summary": string | null,"tools": (string)[] | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actions"?: (string)[] | null,"archived_at"?: string | null,"base_slug"?: string | null,"created_at"?: string,"created_by"?: string | null,"examples"?: (string)[] | null,"id"?: string,"institution_id": string,"instructions"?: string | null,"is_enabled"?: boolean,"name"?: string | null,"slug"?: string,"summary"?: string | null,"tools"?: (string)[] | null,"updated_at"?: string
                  }
                  Update: {
                    "actions"?: (string)[] | null,"archived_at"?: string | null,"base_slug"?: string | null,"created_at"?: string,"created_by"?: string | null,"examples"?: (string)[] | null,"id"?: string,"institution_id"?: string,"instructions"?: string | null,"is_enabled"?: boolean,"name"?: string | null,"slug"?: string,"summary"?: string | null,"tools"?: (string)[] | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_definitions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_definitions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "agent_id": string,"catalog_version": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"finished_at": string | null,"id": string,"institution_id": string,"log": NonNullable<Json>,"proposals": NonNullable<Json>,"requested_by": string,"risk_class": string,"started_at": string | null,"status": string,"summary": string,"task": string,"updated_at": string,"workflow_run_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"catalog_version": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"finished_at"?: string | null,"id"?: string,"institution_id": string,"log"?: NonNullable<Json>,"proposals"?: NonNullable<Json>,"requested_by": string,"risk_class"?: string,"started_at"?: string | null,"status"?: string,"summary"?: string,"task": string,"updated_at"?: string,"workflow_run_id"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"catalog_version"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"finished_at"?: string | null,"id"?: string,"institution_id"?: string,"log"?: NonNullable<Json>,"proposals"?: NonNullable<Json>,"requested_by"?: string,"risk_class"?: string,"started_at"?: string | null,"status"?: string,"summary"?: string,"task"?: string,"updated_at"?: string,"workflow_run_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_agent_institution_fk"
      columns: ["agent_id","institution_id"]
isOneToOne: false
      referencedRelation: "agent_definitions"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "agent_runs_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_workflow_run_fk"
      columns: ["workflow_run_id","institution_id"]
isOneToOne: false
      referencedRelation: "workflow_runs"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"ai_usage_events": {
                  Row: {
                    "agent_run_id": string | null,"cost_estimate_usd": number,"created_at": string,"error_code": string | null,"feature": string,"id": string,"input_tokens": number,"institution_id": string,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"provider": string,"redactions": number,"role": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_run_id"?: string | null,"cost_estimate_usd": number,"created_at"?: string,"error_code"?: string | null,"feature": string,"id"?: string,"input_tokens": number,"institution_id": string,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"provider": string,"redactions"?: number,"role"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "agent_run_id"?: string | null,"cost_estimate_usd"?: number,"created_at"?: string,"error_code"?: string | null,"feature"?: string,"id"?: string,"input_tokens"?: number,"institution_id"?: string,"latency_ms"?: number,"model"?: string,"ok"?: boolean,"output_tokens"?: number,"provider"?: string,"redactions"?: number,"role"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"alumni_profiles": {
                  Row: {
                    "batch_year": number,"city": string | null,"contact_email": string | null,"contact_phone": string | null,"created_at": string,"id": string,"institution_id": string,"occupation": string | null,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_year": number,"city"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"id"?: string,"institution_id": string,"occupation"?: string | null,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "batch_year"?: number,"city"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"id"?: string,"institution_id"?: string,"occupation"?: string | null,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alumni_profiles_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alumni_profiles_student_id_fkey"
      columns: ["student_id"]
isOneToOne: true
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"announcement_audiences": {
                  Row: {
                    "announcement_id": string,"audience_type": string,"class_section_id": string | null,"created_at": string,"grade_id": string | null,"id": string,"institution_id": string,"role": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "announcement_id": string,"audience_type": string,"class_section_id"?: string | null,"created_at"?: string,"grade_id"?: string | null,"id"?: string,"institution_id": string,"role"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "announcement_id"?: string,"audience_type"?: string,"class_section_id"?: string | null,"created_at"?: string,"grade_id"?: string | null,"id"?: string,"institution_id"?: string,"role"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_audiences_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_audiences_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_audiences_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_audiences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "body": string,"category": string,"created_at": string,"created_by": string,"id": string,"institution_id": string,"published_at": string | null,"published_by": string | null,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"category"?: string,"created_at"?: string,"created_by": string,"id"?: string,"institution_id": string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"category"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"institution_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcements_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcements_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"answer_sheets": {
                  Row: {
                    "created_at": string,"exam_paper_id": string,"id": string,"institution_id": string,"storage_path": string,"student_id": string,"updated_at": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"exam_paper_id": string,"id"?: string,"institution_id": string,"storage_path": string,"student_id": string,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"exam_paper_id"?: string,"id"?: string,"institution_id"?: string,"storage_path"?: string,"student_id"?: string,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "answer_sheets_exam_paper_id_fkey"
      columns: ["exam_paper_id"]
isOneToOne: false
      referencedRelation: "exam_papers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "answer_sheets_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "answer_sheets_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "answer_sheets_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"application_decisions": {
                  Row: {
                    "application_id": string,"created_at": string,"decided_by": string | null,"decision": string,"id": string,"institution_id": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "application_id": string,"created_at"?: string,"decided_by"?: string | null,"decision": string,"id"?: string,"institution_id": string,"note"?: string | null
                  }
                  Update: {
                    "application_id"?: string,"created_at"?: string,"decided_by"?: string | null,"decision"?: string,"id"?: string,"institution_id"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_decisions_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "application_decisions_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "application_decisions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"applications": {
                  Row: {
                    "academic_year_id": string,"applicant": NonNullable<Json>,"application_no": string,"created_at": string,"enquiry_id": string | null,"grade_applied_id": string,"guardian": NonNullable<Json>,"id": string,"institution_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"applicant": NonNullable<Json>,"application_no": string,"created_at"?: string,"enquiry_id"?: string | null,"grade_applied_id": string,"guardian": NonNullable<Json>,"id"?: string,"institution_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"applicant"?: NonNullable<Json>,"application_no"?: string,"created_at"?: string,"enquiry_id"?: string | null,"grade_applied_id"?: string,"guardian"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "applications_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "applications_enquiry_id_fkey"
      columns: ["enquiry_id"]
isOneToOne: false
      referencedRelation: "enquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "applications_grade_applied_id_fkey"
      columns: ["grade_applied_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "applications_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"assets": {
                  Row: {
                    "asset_tag": string | null,"category": string,"created_at": string,"id": string,"institution_id": string,"location": string | null,"name": string,"room_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_tag"?: string | null,"category": string,"created_at"?: string,"id"?: string,"institution_id": string,"location"?: string | null,"name": string,"room_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "asset_tag"?: string | null,"category"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"location"?: string | null,"name"?: string,"room_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assets_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assets_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"assignment_answer_keys": {
                  Row: {
                    "answers": NonNullable<Json>,"assignment_id": string,"created_at": string,"id": string,"institution_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"assignment_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"updated_at"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"assignment_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_answer_keys_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: true
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_answer_keys_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"assignment_submissions": {
                  Row: {
                    "assignment_id": string,"attempt": number,"content": Json | null,"created_at": string,"feedback": string | null,"graded_at": string | null,"graded_by": string | null,"id": string,"institution_id": string,"is_late": boolean,"max_score": number | null,"score": number | null,"status": string,"student_id": string,"submitted_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"attempt"?: number,"content"?: Json | null,"created_at"?: string,"feedback"?: string | null,"graded_at"?: string | null,"graded_by"?: string | null,"id"?: string,"institution_id": string,"is_late"?: boolean,"max_score"?: number | null,"score"?: number | null,"status"?: string,"student_id": string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assignment_id"?: string,"attempt"?: number,"content"?: Json | null,"created_at"?: string,"feedback"?: string | null,"graded_at"?: string | null,"graded_by"?: string | null,"id"?: string,"institution_id"?: string,"is_late"?: boolean,"max_score"?: number | null,"score"?: number | null,"status"?: string,"student_id"?: string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_submissions_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_submissions_graded_by_fkey"
      columns: ["graded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_submissions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_submissions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "ai_generated": boolean,"class_section_id": string,"content": Json | null,"created_at": string,"created_by": string,"curriculum_unit_id": string | null,"due_at": string | null,"id": string,"institution_id": string,"instructions": string | null,"status": string,"subject_id": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_generated"?: boolean,"class_section_id": string,"content"?: Json | null,"created_at"?: string,"created_by": string,"curriculum_unit_id"?: string | null,"due_at"?: string | null,"id"?: string,"institution_id": string,"instructions"?: string | null,"status"?: string,"subject_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_generated"?: boolean,"class_section_id"?: string,"content"?: Json | null,"created_at"?: string,"created_by"?: string,"curriculum_unit_id"?: string | null,"due_at"?: string | null,"id"?: string,"institution_id"?: string,"instructions"?: string | null,"status"?: string,"subject_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_corrections": {
                  Row: {
                    "corrected_by": string | null,"created_at": string,"id": string,"institution_id": string,"new_status": string,"old_status": string,"reason": string,"record_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "corrected_by"?: string | null,"created_at"?: string,"id"?: string,"institution_id": string,"new_status": string,"old_status": string,"reason": string,"record_id": string
                  }
                  Update: {
                    "corrected_by"?: string | null,"created_at"?: string,"id"?: string,"institution_id"?: string,"new_status"?: string,"old_status"?: string,"reason"?: string,"record_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_corrections_corrected_by_fkey"
      columns: ["corrected_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_corrections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_corrections_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "attendance_records"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_records": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"note": string | null,"session_id": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"note"?: string | null,"session_id": string,"status": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"note"?: string | null,"session_id"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_records_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_records_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "attendance_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_records_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_sessions": {
                  Row: {
                    "class_section_id": string,"created_at": string,"date": string,"id": string,"institution_id": string,"marked_by": string | null,"period_id": string | null,"status": string,"submitted_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"date": string,"id"?: string,"institution_id": string,"marked_by"?: string | null,"period_id"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"date"?: string,"id"?: string,"institution_id"?: string,"marked_by"?: string | null,"period_id"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_sessions_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_sessions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_sessions_marked_by_fkey"
      columns: ["marked_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_sessions_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_user_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": string,"institution_id": string,"metadata": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: string,"institution_id": string,"metadata"?: Json | null
                  }
                  Update: {
                    "action"?: string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"institution_id"?: string,"metadata"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"behaviour_incidents": {
                  Row: {
                    "category": string,"created_at": string,"id": string,"institution_id": string,"note": string | null,"occurred_on": string,"points": number,"reported_by": string,"severity": string,"student_id": string,"updated_at": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"id"?: string,"institution_id": string,"note"?: string | null,"occurred_on"?: string,"points"?: number,"reported_by": string,"severity"?: string,"student_id": string,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"note"?: string | null,"occurred_on"?: string,"points"?: number,"reported_by"?: string,"severity"?: string,"student_id"?: string,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "behaviour_incidents_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "behaviour_incidents_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "behaviour_incidents_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "behaviour_incidents_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"briefings": {
                  Row: {
                    "brief_date": string,"created_at": string,"headline": string,"id": string,"institution_id": string,"items": NonNullable<Json>,"provider": string | null,"role": string,"sources": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brief_date": string,"created_at"?: string,"headline": string,"id"?: string,"institution_id": string,"items": NonNullable<Json>,"provider"?: string | null,"role": string,"sources": NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "brief_date"?: string,"created_at"?: string,"headline"?: string,"id"?: string,"institution_id"?: string,"items"?: NonNullable<Json>,"provider"?: string | null,"role"?: string,"sources"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "briefings_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"budgets": {
                  Row: {
                    "amount_paise": number,"category_id": string,"created_at": string,"id": string,"institution_id": string,"period_end": string,"period_start": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paise": number,"category_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"period_end": string,"period_start": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_paise"?: number,"category_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"period_end"?: string,"period_start"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budgets_category_fk"
      columns: ["category_id","institution_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "budgets_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"campuses": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_default": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_default"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_default"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campuses_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"canteen_items": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_active": boolean,"name": string,"price_paise": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"price_paise": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"price_paise"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "canteen_items_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"canteen_transactions": {
                  Row: {
                    "amount_paise": number,"created_at": string,"id": string,"institution_id": string,"item_id": string | null,"kind": string,"note": string | null,"quantity": number | null,"recorded_by": string,"student_id": string,"unit_price_paise": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paise": number,"created_at"?: string,"id"?: string,"institution_id": string,"item_id"?: string | null,"kind": string,"note"?: string | null,"quantity"?: number | null,"recorded_by": string,"student_id": string,"unit_price_paise"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_paise"?: number,"created_at"?: string,"id"?: string,"institution_id"?: string,"item_id"?: string | null,"kind"?: string,"note"?: string | null,"quantity"?: number | null,"recorded_by"?: string,"student_id"?: string,"unit_price_paise"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "canteen_transactions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canteen_transactions_item_fkey"
      columns: ["item_id","institution_id"]
isOneToOne: false
      referencedRelation: "canteen_items"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "canteen_transactions_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canteen_transactions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"certificates": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"issued_at": string,"issued_by": string,"kind": string,"lifecycle_event_id": string | null,"serial_no": string,"snapshot": NonNullable<Json>,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"issued_at"?: string,"issued_by": string,"kind": string,"lifecycle_event_id"?: string | null,"serial_no": string,"snapshot": NonNullable<Json>,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"issued_at"?: string,"issued_by"?: string,"kind"?: string,"lifecycle_event_id"?: string | null,"serial_no"?: string,"snapshot"?: NonNullable<Json>,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "certificates_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_lifecycle_event_id_fkey"
      columns: ["lifecycle_event_id"]
isOneToOne: false
      referencedRelation: "student_lifecycle_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"class_sections": {
                  Row: {
                    "academic_year_id": string,"capacity": number | null,"class_teacher_id": string | null,"created_at": string,"grade_id": string,"id": string,"institution_id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"capacity"?: number | null,"class_teacher_id"?: string | null,"created_at"?: string,"grade_id": string,"id"?: string,"institution_id": string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"capacity"?: number | null,"class_teacher_id"?: string | null,"created_at"?: string,"grade_id"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_sections_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sections_class_teacher_id_fkey"
      columns: ["class_teacher_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sections_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_sections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"club_event_signups": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"institution_id": string,"signed_up_by": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"institution_id": string,"signed_up_by": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"institution_id"?: string,"signed_up_by"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_event_signups_event_fk"
      columns: ["event_id","institution_id"]
isOneToOne: false
      referencedRelation: "club_events"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "club_event_signups_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_event_signups_signed_up_by_fkey"
      columns: ["signed_up_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_event_signups_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"club_events": {
                  Row: {
                    "capacity": number | null,"club_id": string,"created_at": string,"description": string | null,"ends_at": string | null,"id": string,"institution_id": string,"signup_closes_at": string | null,"starts_at": string,"status": string,"title": string,"updated_at": string,"venue": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"club_id": string,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"institution_id": string,"signup_closes_at"?: string | null,"starts_at": string,"status"?: string,"title": string,"updated_at"?: string,"venue"?: string | null
                  }
                  Update: {
                    "capacity"?: number | null,"club_id"?: string,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"institution_id"?: string,"signup_closes_at"?: string | null,"starts_at"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_events_club_fk"
      columns: ["club_id","institution_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "club_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"club_members": {
                  Row: {
                    "club_id": string,"created_at": string,"id": string,"institution_id": string,"joined_by": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"joined_by": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"joined_by"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_members_club_fk"
      columns: ["club_id","institution_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "club_members_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_members_joined_by_fkey"
      columns: ["joined_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_members_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"clubs": {
                  Row: {
                    "capacity": number | null,"created_at": string,"description": string | null,"id": string,"institution_id": string,"is_active": boolean,"name": string,"patron_staff_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"created_at"?: string,"description"?: string | null,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"patron_staff_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number | null,"created_at"?: string,"description"?: string | null,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"patron_staff_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clubs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clubs_patron_staff_id_fkey"
      columns: ["patron_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"compliance_events": {
                  Row: {
                    "created_at": string,"document_id": string | null,"id": string,"institution_id": string,"item_id": string,"new_due_on": string,"note": string | null,"recorded_by": string,"renewed_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_id"?: string | null,"id"?: string,"institution_id": string,"item_id": string,"new_due_on": string,"note"?: string | null,"recorded_by": string,"renewed_on": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"document_id"?: string | null,"id"?: string,"institution_id"?: string,"item_id"?: string,"new_due_on"?: string,"note"?: string | null,"recorded_by"?: string,"renewed_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "compliance_events_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_events_item_fkey"
      columns: ["item_id","institution_id"]
isOneToOne: false
      referencedRelation: "compliance_items"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "compliance_events_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"compliance_items": {
                  Row: {
                    "authority": string | null,"category": string,"created_at": string,"due_on": string,"id": string,"institution_id": string,"notes": string | null,"owner_staff_id": string | null,"reference_no": string | null,"renew_every_months": number | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "authority"?: string | null,"category": string,"created_at"?: string,"due_on": string,"id"?: string,"institution_id": string,"notes"?: string | null,"owner_staff_id"?: string | null,"reference_no"?: string | null,"renew_every_months"?: number | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "authority"?: string | null,"category"?: string,"created_at"?: string,"due_on"?: string,"id"?: string,"institution_id"?: string,"notes"?: string | null,"owner_staff_id"?: string | null,"reference_no"?: string | null,"renew_every_months"?: number | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "compliance_items_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_items_owner_staff_id_fkey"
      columns: ["owner_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"concession_awards": {
                  Row: {
                    "academic_year_id": string,"amount_paise": number | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"institution_id": string,"percent": number | null,"reason": string,"requested_by": string,"rule_id": string | null,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"amount_paise"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"institution_id": string,"percent"?: number | null,"reason": string,"requested_by"?: string,"rule_id"?: string | null,"status"?: string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"amount_paise"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"institution_id"?: string,"percent"?: number | null,"reason"?: string,"requested_by"?: string,"rule_id"?: string | null,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "concession_awards_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concession_awards_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concession_awards_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concession_awards_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concession_awards_rule_fk"
      columns: ["rule_id","institution_id"]
isOneToOne: false
      referencedRelation: "concession_rules"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "concession_awards_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"concession_rules": {
                  Row: {
                    "amount_paise": number | null,"created_at": string,"criteria": string | null,"id": string,"institution_id": string,"is_active": boolean,"name": string,"percent": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paise"?: number | null,"created_at"?: string,"criteria"?: string | null,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"percent"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_paise"?: number | null,"created_at"?: string,"criteria"?: string | null,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"percent"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "concession_rules_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"concessions": {
                  Row: {
                    "amount": number | null,"approved_by": string,"created_at": string,"fee_assignment_id": string,"head": string | null,"id": string,"institution_id": string,"kind": string,"percent": number | null,"reason": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"approved_by": string,"created_at"?: string,"fee_assignment_id": string,"head"?: string | null,"id"?: string,"institution_id": string,"kind": string,"percent"?: number | null,"reason": string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number | null,"approved_by"?: string,"created_at"?: string,"fee_assignment_id"?: string,"head"?: string | null,"id"?: string,"institution_id"?: string,"kind"?: string,"percent"?: number | null,"reason"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "concessions_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concessions_fee_assignment_id_fkey"
      columns: ["fee_assignment_id"]
isOneToOne: false
      referencedRelation: "fee_assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "concessions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"curriculum_unit_coverage": {
                  Row: {
                    "class_section_id": string,"covered_on": string,"created_at": string,"curriculum_unit_id": string,"id": string,"institution_id": string,"lesson_plan_id": string | null,"marked_by": string,"notes": string | null,"subject_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"covered_on": string,"created_at"?: string,"curriculum_unit_id": string,"id"?: string,"institution_id": string,"lesson_plan_id"?: string | null,"marked_by": string,"notes"?: string | null,"subject_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"covered_on"?: string,"created_at"?: string,"curriculum_unit_id"?: string,"id"?: string,"institution_id"?: string,"lesson_plan_id"?: string | null,"marked_by"?: string,"notes"?: string | null,"subject_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "curriculum_unit_coverage_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_unit_coverage_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_unit_coverage_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_unit_coverage_lesson_plan_id_fkey"
      columns: ["lesson_plan_id"]
isOneToOne: false
      referencedRelation: "lesson_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_unit_coverage_marked_by_fkey"
      columns: ["marked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_unit_coverage_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"curriculum_units": {
                  Row: {
                    "created_at": string,"description": string | null,"grade_id": string,"id": string,"institution_id": string,"sequence": number,"subject_id": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"grade_id": string,"id"?: string,"institution_id": string,"sequence": number,"subject_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"grade_id"?: string,"id"?: string,"institution_id"?: string,"sequence"?: number,"subject_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "curriculum_units_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_units_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "curriculum_units_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"dashboard_preferences": {
                  Row: {
                    "created_at": string,"institution_id": string,"layout": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"institution_id": string,"layout"?: NonNullable<Json>,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"institution_id"?: string,"layout"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "dashboard_preferences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dashboard_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_attempts": {
                  Row: {
                    "attempted_at": string,"channel": string,"error": string | null,"id": string,"institution_id": string,"notification_id": string,"provider": string | null,"provider_ref": string | null,"rendered_body": string,"status": string,"to_address": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempted_at"?: string,"channel": string,"error"?: string | null,"id"?: string,"institution_id": string,"notification_id": string,"provider"?: string | null,"provider_ref"?: string | null,"rendered_body": string,"status": string,"to_address"?: string | null
                  }
                  Update: {
                    "attempted_at"?: string,"channel"?: string,"error"?: string | null,"id"?: string,"institution_id"?: string,"notification_id"?: string,"provider"?: string | null,"provider_ref"?: string | null,"rendered_body"?: string,"status"?: string,"to_address"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_attempts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "delivery_attempts_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"diary_acknowledgements": {
                  Row: {
                    "acknowledged_by": string,"created_at": string,"entry_id": string,"id": string,"institution_id": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_by": string,"created_at"?: string,"entry_id": string,"id"?: string,"institution_id": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "acknowledged_by"?: string,"created_at"?: string,"entry_id"?: string,"id"?: string,"institution_id"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "diary_acknowledgements_acknowledged_by_fkey"
      columns: ["acknowledged_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_acknowledgements_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "diary_entries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_acknowledgements_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_acknowledgements_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"diary_entries": {
                  Row: {
                    "body": string,"class_section_id": string,"created_at": string,"created_by": string,"due_date": string | null,"entry_date": string,"id": string,"institution_id": string,"requires_ack": boolean,"subject_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"class_section_id": string,"created_at"?: string,"created_by": string,"due_date"?: string | null,"entry_date": string,"id"?: string,"institution_id": string,"requires_ack"?: boolean,"subject_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"class_section_id"?: string,"created_at"?: string,"created_by"?: string,"due_date"?: string | null,"entry_date"?: string,"id"?: string,"institution_id"?: string,"requires_ack"?: boolean,"subject_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "diary_entries_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_entries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_entries_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diary_entries_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "created_at": string,"created_by": string,"deleted_at": string | null,"deleted_by": string | null,"entity_id": string,"entity_type": string,"file_name": string,"id": string,"institution_id": string,"kind": string,"mime": string,"path": string,"size_bytes": number,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"deleted_at"?: string | null,"deleted_by"?: string | null,"entity_id": string,"entity_type": string,"file_name": string,"id"?: string,"institution_id": string,"kind": string,"mime": string,"path": string,"size_bytes": number,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"entity_id"?: string,"entity_type"?: string,"file_name"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"mime"?: string,"path"?: string,"size_bytes"?: number,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"duty_assignments": {
                  Row: {
                    "created_at": string,"date": string,"duty_type_id": string,"id": string,"institution_id": string,"staff_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date": string,"duty_type_id": string,"id"?: string,"institution_id": string,"staff_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"date"?: string,"duty_type_id"?: string,"id"?: string,"institution_id"?: string,"staff_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "duty_assignments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_assignments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_assignments_type_fk"
      columns: ["duty_type_id","institution_id"]
isOneToOne: false
      referencedRelation: "duty_types"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"duty_swap_requests": {
                  Row: {
                    "assignment_id": string,"created_at": string,"decided_at": string | null,"from_staff_id": string,"id": string,"institution_id": string,"requested_by": string,"status": string,"to_staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"created_at"?: string,"decided_at"?: string | null,"from_staff_id": string,"id"?: string,"institution_id": string,"requested_by": string,"status"?: string,"to_staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "assignment_id"?: string,"created_at"?: string,"decided_at"?: string | null,"from_staff_id"?: string,"id"?: string,"institution_id"?: string,"requested_by"?: string,"status"?: string,"to_staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "duty_swap_requests_assignment_fk"
      columns: ["assignment_id","institution_id"]
isOneToOne: false
      referencedRelation: "duty_assignments"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "duty_swap_requests_from_staff_id_fkey"
      columns: ["from_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_swap_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_swap_requests_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "duty_swap_requests_to_staff_id_fkey"
      columns: ["to_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"duty_types": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_active": boolean,"name": string,"slots_per_day": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"slots_per_day"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"slots_per_day"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "duty_types_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"enquiries": {
                  Row: {
                    "assigned_to": string | null,"child_name": string,"created_at": string,"email": string | null,"grade_applied_id": string | null,"guardian_name": string,"id": string,"institution_id": string,"notes": Json | null,"phone": string,"source": string,"source_ip_hash": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"child_name": string,"created_at"?: string,"email"?: string | null,"grade_applied_id"?: string | null,"guardian_name": string,"id"?: string,"institution_id": string,"notes"?: Json | null,"phone": string,"source"?: string,"source_ip_hash"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"child_name"?: string,"created_at"?: string,"email"?: string | null,"grade_applied_id"?: string | null,"guardian_name"?: string,"id"?: string,"institution_id"?: string,"notes"?: Json | null,"phone"?: string,"source"?: string,"source_ip_hash"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enquiries_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enquiries_grade_applied_id_fkey"
      columns: ["grade_applied_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enquiries_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"enrolment_status_history": {
                  Row: {
                    "changed_by": string | null,"created_at": string,"enrolment_id": string,"from_status": string | null,"id": string,"institution_id": string,"reason": string | null,"to_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_by"?: string | null,"created_at"?: string,"enrolment_id": string,"from_status"?: string | null,"id"?: string,"institution_id": string,"reason"?: string | null,"to_status": string
                  }
                  Update: {
                    "changed_by"?: string | null,"created_at"?: string,"enrolment_id"?: string,"from_status"?: string | null,"id"?: string,"institution_id"?: string,"reason"?: string | null,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrolment_status_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrolment_status_history_enrolment_id_fkey"
      columns: ["enrolment_id"]
isOneToOne: false
      referencedRelation: "enrolments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrolment_status_history_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"enrolments": {
                  Row: {
                    "academic_year_id": string,"class_section_id": string,"created_at": string,"ended_on": string | null,"id": string,"institution_id": string,"roll_no": number | null,"started_on": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"class_section_id": string,"created_at"?: string,"ended_on"?: string | null,"id"?: string,"institution_id": string,"roll_no"?: number | null,"started_on": string,"status"?: string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"class_section_id"?: string,"created_at"?: string,"ended_on"?: string | null,"id"?: string,"institution_id"?: string,"roll_no"?: number | null,"started_on"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrolments_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrolments_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrolments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrolments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"ends_at": string | null,"id": string,"institution_id": string,"is_public": boolean,"location": string | null,"starts_at": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at"?: string | null,"id"?: string,"institution_id": string,"is_public"?: boolean,"location"?: string | null,"starts_at": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string | null,"id"?: string,"institution_id"?: string,"is_public"?: boolean,"location"?: string | null,"starts_at"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"exam_papers": {
                  Row: {
                    "class_section_id": string,"created_at": string,"duration_minutes": number | null,"exam_id": string,"held_on": string | null,"id": string,"institution_id": string,"max_marks": number,"pass_marks": number,"room_id": string | null,"scheduled_at": string | null,"subject_id": string,"unit_ids": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"duration_minutes"?: number | null,"exam_id": string,"held_on"?: string | null,"id"?: string,"institution_id": string,"max_marks": number,"pass_marks": number,"room_id"?: string | null,"scheduled_at"?: string | null,"subject_id": string,"unit_ids"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"duration_minutes"?: number | null,"exam_id"?: string,"held_on"?: string | null,"id"?: string,"institution_id"?: string,"max_marks"?: number,"pass_marks"?: number,"room_id"?: string | null,"scheduled_at"?: string | null,"subject_id"?: string,"unit_ids"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exam_papers_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_papers_exam_id_fkey"
      columns: ["exam_id"]
isOneToOne: false
      referencedRelation: "exams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_papers_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_papers_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_papers_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"exam_seating_plans": {
                  Row: {
                    "created_at": string,"exam_id": string,"exam_name": string,"generated_by": string | null,"id": string,"institution_id": string,"rooms": NonNullable<Json>,"seat_count": number,"section_ids": (string)[],"slot_start": string,"superseded_by": string | null,"updated_at": string,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"exam_id": string,"exam_name": string,"generated_by"?: string | null,"id"?: string,"institution_id": string,"rooms": NonNullable<Json>,"seat_count": number,"section_ids": (string)[],"slot_start": string,"superseded_by"?: string | null,"updated_at"?: string,"version_no": number
                  }
                  Update: {
                    "created_at"?: string,"exam_id"?: string,"exam_name"?: string,"generated_by"?: string | null,"id"?: string,"institution_id"?: string,"rooms"?: NonNullable<Json>,"seat_count"?: number,"section_ids"?: (string)[],"slot_start"?: string,"superseded_by"?: string | null,"updated_at"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "exam_seating_plans_exam_id_fkey"
      columns: ["exam_id"]
isOneToOne: false
      referencedRelation: "exams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seating_plans_generated_by_fkey"
      columns: ["generated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seating_plans_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seating_plans_superseded_by_fkey"
      columns: ["superseded_by"]
isOneToOne: false
      referencedRelation: "exam_seating_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"exam_seats": {
                  Row: {
                    "class_section_id": string,"created_at": string,"id": string,"institution_id": string,"plan_id": string,"room_id": string,"seat_no": number,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"plan_id": string,"room_id": string,"seat_no": number,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"plan_id"?: string,"room_id"?: string,"seat_no"?: number,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exam_seats_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seats_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seats_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "exam_seating_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seats_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exam_seats_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"exams": {
                  Row: {
                    "academic_year_id": string,"created_at": string,"grading_scale_key": string,"id": string,"institution_id": string,"name": string,"published_at": string | null,"status": string,"term_id": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"created_at"?: string,"grading_scale_key"?: string,"id"?: string,"institution_id": string,"name": string,"published_at"?: string | null,"status"?: string,"term_id": string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"created_at"?: string,"grading_scale_key"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"published_at"?: string | null,"status"?: string,"term_id"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exams_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exams_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exams_term_id_fkey"
      columns: ["term_id"]
isOneToOne: false
      referencedRelation: "terms"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_categories": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_active": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_categories_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount_paise": number,"category_id": string,"created_at": string,"description": string,"id": string,"institution_id": string,"payee": string | null,"recorded_by": string,"reverses_expense_id": string | null,"spent_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_paise": number,"category_id": string,"created_at"?: string,"description": string,"id"?: string,"institution_id": string,"payee"?: string | null,"recorded_by"?: string,"reverses_expense_id"?: string | null,"spent_on": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_paise"?: number,"category_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"institution_id"?: string,"payee"?: string | null,"recorded_by"?: string,"reverses_expense_id"?: string | null,"spent_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_category_fk"
      columns: ["category_id","institution_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "expenses_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_reverses_expense_id_fkey"
      columns: ["reverses_expense_id"]
isOneToOne: true
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_assignments": {
                  Row: {
                    "academic_year_id": string,"assigned_by": string | null,"created_at": string,"fee_structure_id": string,"id": string,"institution_id": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"assigned_by"?: string | null,"created_at"?: string,"fee_structure_id": string,"id"?: string,"institution_id": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"assigned_by"?: string | null,"created_at"?: string,"fee_structure_id"?: string,"id"?: string,"institution_id"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_assignments_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_assignments_fee_structure_id_fkey"
      columns: ["fee_structure_id"]
isOneToOne: false
      referencedRelation: "fee_structures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_assignments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_assignments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_components": {
                  Row: {
                    "amount": number,"applies_to_new_only": boolean,"created_at": string,"fee_structure_id": string,"frequency": string,"head": string,"id": string,"institution_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"applies_to_new_only"?: boolean,"created_at"?: string,"fee_structure_id": string,"frequency": string,"head": string,"id"?: string,"institution_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"applies_to_new_only"?: boolean,"created_at"?: string,"fee_structure_id"?: string,"frequency"?: string,"head"?: string,"id"?: string,"institution_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_components_fee_structure_id_fkey"
      columns: ["fee_structure_id"]
isOneToOne: false
      referencedRelation: "fee_structures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_components_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_reminders": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"invoice_id": string,"notification_id": string | null,"outstanding": number,"recipient_user_id": string,"reminder_date": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"invoice_id": string,"notification_id"?: string | null,"outstanding": number,"recipient_user_id": string,"reminder_date": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"invoice_id"?: string,"notification_id"?: string | null,"outstanding"?: number,"recipient_user_id"?: string,"reminder_date"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_reminders_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_reminders_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_reminders_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_reminders_recipient_user_id_fkey"
      columns: ["recipient_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_reminders_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_structures": {
                  Row: {
                    "academic_year_id": string,"created_at": string,"grade_id": string,"id": string,"institution_id": string,"is_default": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"created_at"?: string,"grade_id": string,"id"?: string,"institution_id": string,"is_default"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"created_at"?: string,"grade_id"?: string,"id"?: string,"institution_id"?: string,"is_default"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_structures_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_structures_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fee_structures_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"forecast_backtests": {
                  Row: {
                    "as_of": string,"class_section_id": string | null,"created_at": string,"holdout": NonNullable<Json>,"id": string,"institution_id": string,"kind": string,"mape": number,"model": string,"n_train": number,"origin_start": string,"params": NonNullable<Json>,"series_key": string,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of": string,"class_section_id"?: string | null,"created_at"?: string,"holdout": NonNullable<Json>,"id"?: string,"institution_id": string,"kind": string,"mape": number,"model": string,"n_train": number,"origin_start": string,"params": NonNullable<Json>,"series_key": string,"unit": string,"updated_at"?: string
                  }
                  Update: {
                    "as_of"?: string,"class_section_id"?: string | null,"created_at"?: string,"holdout"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"kind"?: string,"mape"?: number,"model"?: string,"n_train"?: number,"origin_start"?: string,"params"?: NonNullable<Json>,"series_key"?: string,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "forecast_backtests_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "forecast_backtests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"forecasts": {
                  Row: {
                    "as_of": string,"backtest_id": string,"class_section_id": string | null,"confidence": number,"created_at": string,"evidence": NonNullable<Json>,"horizon": number,"id": string,"institution_id": string,"kind": string,"lower": number,"model": string,"period_label": string,"period_start": string,"point": number,"series_key": string,"unit": string,"updated_at": string,"upper": number
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of": string,"backtest_id": string,"class_section_id"?: string | null,"confidence": number,"created_at"?: string,"evidence": NonNullable<Json>,"horizon": number,"id"?: string,"institution_id": string,"kind": string,"lower": number,"model": string,"period_label": string,"period_start": string,"point": number,"series_key": string,"unit": string,"updated_at"?: string,"upper": number
                  }
                  Update: {
                    "as_of"?: string,"backtest_id"?: string,"class_section_id"?: string | null,"confidence"?: number,"created_at"?: string,"evidence"?: NonNullable<Json>,"horizon"?: number,"id"?: string,"institution_id"?: string,"kind"?: string,"lower"?: number,"model"?: string,"period_label"?: string,"period_start"?: string,"point"?: number,"series_key"?: string,"unit"?: string,"updated_at"?: string,"upper"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "forecasts_backtest_fk"
      columns: ["backtest_id","institution_id","series_key","model"]
isOneToOne: false
      referencedRelation: "forecast_backtests"
      referencedColumns: ["id","institution_id","series_key","model"]
    },{
      foreignKeyName: "forecasts_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "forecasts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"form_responses": {
                  Row: {
                    "answers": NonNullable<Json>,"created_at": string,"form_id": string,"id": string,"institution_id": string,"respondent_user_id": string,"student_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"created_at"?: string,"form_id": string,"id"?: string,"institution_id": string,"respondent_user_id": string,"student_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"created_at"?: string,"form_id"?: string,"id"?: string,"institution_id"?: string,"respondent_user_id"?: string,"student_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_responses_form_fk"
      columns: ["form_id","institution_id"]
isOneToOne: false
      referencedRelation: "forms"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "form_responses_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_responses_respondent_user_id_fkey"
      columns: ["respondent_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_responses_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"form_sections": {
                  Row: {
                    "class_section_id": string,"created_at": string,"form_id": string,"institution_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"form_id": string,"institution_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"form_id"?: string,"institution_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_sections_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_sections_form_fk"
      columns: ["form_id","institution_id"]
isOneToOne: false
      referencedRelation: "forms"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "form_sections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"forms": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string,"description": string | null,"fields": NonNullable<Json>,"id": string,"institution_id": string,"published_at": string | null,"published_by": string | null,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"fields": NonNullable<Json>,"id"?: string,"institution_id": string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"fields"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "forms_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "forms_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "forms_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"gate_passes": {
                  Row: {
                    "collector_name": string,"collector_relation": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"exit_marked_by": string | null,"exited_at": string | null,"guardian_id": string | null,"id": string,"institution_id": string,"pickup_person_id": string | null,"reason": string,"requested_at": string,"requested_by": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "collector_name": string,"collector_relation": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"exit_marked_by"?: string | null,"exited_at"?: string | null,"guardian_id"?: string | null,"id"?: string,"institution_id": string,"pickup_person_id"?: string | null,"reason": string,"requested_at"?: string,"requested_by": string,"status"?: string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "collector_name"?: string,"collector_relation"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"exit_marked_by"?: string | null,"exited_at"?: string | null,"guardian_id"?: string | null,"id"?: string,"institution_id"?: string,"pickup_person_id"?: string | null,"reason"?: string,"requested_at"?: string,"requested_by"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gate_passes_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_exit_marked_by_fkey"
      columns: ["exit_marked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_pickup_person_id_fkey"
      columns: ["pickup_person_id"]
isOneToOne: false
      referencedRelation: "pickup_persons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gate_passes_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"grades": {
                  Row: {
                    "code": string,"created_at": string,"display_name": string,"grade_group": string,"id": string,"institution_id": string,"sort_key": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"display_name": string,"grade_group": string,"id"?: string,"institution_id": string,"sort_key": number,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"display_name"?: string,"grade_group"?: string,"id"?: string,"institution_id"?: string,"sort_key"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grades_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"guardian_students": {
                  Row: {
                    "created_at": string,"guardian_id": string,"institution_id": string,"is_primary": boolean,"portal_access": boolean,"relationship": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"guardian_id": string,"institution_id": string,"is_primary"?: boolean,"portal_access"?: boolean,"relationship": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"guardian_id"?: string,"institution_id"?: string,"is_primary"?: boolean,"portal_access"?: boolean,"relationship"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "guardian_students_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "guardian_students_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "guardian_students_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"guardians": {
                  Row: {
                    "created_at": string,"details": Json | null,"email": string | null,"full_name": string,"id": string,"institution_id": string,"phone": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details"?: Json | null,"email"?: string | null,"full_name": string,"id"?: string,"institution_id": string,"phone": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"details"?: Json | null,"email"?: string | null,"full_name"?: string,"id"?: string,"institution_id"?: string,"phone"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "guardians_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "guardians_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"health_profiles": {
                  Row: {
                    "allergies": string | null,"blood_group": string | null,"conditions": string | null,"created_at": string,"emergency_note": string | null,"id": string,"institution_id": string,"student_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allergies"?: string | null,"blood_group"?: string | null,"conditions"?: string | null,"created_at"?: string,"emergency_note"?: string | null,"id"?: string,"institution_id": string,"student_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "allergies"?: string | null,"blood_group"?: string | null,"conditions"?: string | null,"created_at"?: string,"emergency_note"?: string | null,"id"?: string,"institution_id"?: string,"student_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_profiles_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_profiles_student_id_fkey"
      columns: ["student_id"]
isOneToOne: true
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_profiles_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"health_visits": {
                  Row: {
                    "complaint": string,"created_at": string,"id": string,"institution_id": string,"outcome": string,"recorded_by": string,"student_id": string,"treatment": string | null,"updated_at": string,"updated_by": string | null,"visited_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "complaint": string,"created_at"?: string,"id"?: string,"institution_id": string,"outcome"?: string,"recorded_by": string,"student_id": string,"treatment"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"visited_at"?: string
                  }
                  Update: {
                    "complaint"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"outcome"?: string,"recorded_by"?: string,"student_id"?: string,"treatment"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"visited_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_visits_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_visits_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_visits_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_visits_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"helpdesk_messages": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"institution_id": string,"ticket_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"body": string,"created_at"?: string,"id"?: string,"institution_id": string,"ticket_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"ticket_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "helpdesk_messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "helpdesk_messages_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "helpdesk_messages_ticket_fkey"
      columns: ["ticket_id","institution_id"]
isOneToOne: false
      referencedRelation: "helpdesk_tickets"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"helpdesk_tickets": {
                  Row: {
                    "assignee_staff_id": string | null,"category": string,"created_at": string,"due_at": string,"id": string,"institution_id": string,"priority": string,"raised_by": string,"resolved_at": string | null,"status": string,"subject": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_staff_id"?: string | null,"category": string,"created_at"?: string,"due_at": string,"id"?: string,"institution_id": string,"priority": string,"raised_by": string,"resolved_at"?: string | null,"status"?: string,"subject": string,"updated_at"?: string
                  }
                  Update: {
                    "assignee_staff_id"?: string | null,"category"?: string,"created_at"?: string,"due_at"?: string,"id"?: string,"institution_id"?: string,"priority"?: string,"raised_by"?: string,"resolved_at"?: string | null,"status"?: string,"subject"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "helpdesk_tickets_assignee_staff_id_fkey"
      columns: ["assignee_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "helpdesk_tickets_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "helpdesk_tickets_raised_by_fkey"
      columns: ["raised_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hostel_allocations": {
                  Row: {
                    "allocated_by": string | null,"allocated_on": string,"created_at": string,"id": string,"institution_id": string,"room_id": string,"student_id": string,"updated_at": string,"vacated_by": string | null,"vacated_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allocated_by"?: string | null,"allocated_on": string,"created_at"?: string,"id"?: string,"institution_id": string,"room_id": string,"student_id": string,"updated_at"?: string,"vacated_by"?: string | null,"vacated_on"?: string | null
                  }
                  Update: {
                    "allocated_by"?: string | null,"allocated_on"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"room_id"?: string,"student_id"?: string,"updated_at"?: string,"vacated_by"?: string | null,"vacated_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostel_allocations_allocated_by_fkey"
      columns: ["allocated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_allocations_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_allocations_room_fk"
      columns: ["room_id","institution_id"]
isOneToOne: false
      referencedRelation: "hostel_rooms"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "hostel_allocations_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_allocations_vacated_by_fkey"
      columns: ["vacated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hostel_roll_call_entries": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"note": string | null,"roll_call_id": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"note"?: string | null,"roll_call_id": string,"status": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"note"?: string | null,"roll_call_id"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostel_roll_call_entries_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_roll_call_entries_roll_call_fk"
      columns: ["roll_call_id","institution_id"]
isOneToOne: false
      referencedRelation: "hostel_roll_calls"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "hostel_roll_call_entries_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"hostel_roll_calls": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"session": string,"taken_by": string,"taken_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"session": string,"taken_by"?: string,"taken_on": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"session"?: string,"taken_by"?: string,"taken_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostel_roll_calls_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_roll_calls_taken_by_fkey"
      columns: ["taken_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hostel_rooms": {
                  Row: {
                    "block": string,"capacity": number,"created_at": string,"id": string,"institution_id": string,"is_active": boolean,"room_no": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "block": string,"capacity": number,"created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"room_no": string,"updated_at"?: string
                  }
                  Update: {
                    "block"?: string,"capacity"?: number,"created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"room_no"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostel_rooms_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"house_members": {
                  Row: {
                    "created_at": string,"house_id": string,"id": string,"institution_id": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"house_id": string,"id"?: string,"institution_id": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"house_id"?: string,"id"?: string,"institution_id"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "house_members_house_fk"
      columns: ["house_id","institution_id"]
isOneToOne: false
      referencedRelation: "houses"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "house_members_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "house_members_student_id_fkey"
      columns: ["student_id"]
isOneToOne: true
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"house_points": {
                  Row: {
                    "awarded_by": string,"created_at": string,"house_id": string,"id": string,"institution_id": string,"points": number,"reason": string,"student_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "awarded_by": string,"created_at"?: string,"house_id": string,"id"?: string,"institution_id": string,"points": number,"reason": string,"student_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "awarded_by"?: string,"created_at"?: string,"house_id"?: string,"id"?: string,"institution_id"?: string,"points"?: number,"reason"?: string,"student_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "house_points_awarded_by_fkey"
      columns: ["awarded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "house_points_house_fk"
      columns: ["house_id","institution_id"]
isOneToOne: false
      referencedRelation: "houses"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "house_points_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "house_points_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"houses": {
                  Row: {
                    "colour": string | null,"created_at": string,"id": string,"institution_id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "colour"?: string | null,"created_at"?: string,"id"?: string,"institution_id": string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "colour"?: string | null,"created_at"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "houses_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "committed_at": string | null,"committed_by": string | null,"committed_count": number,"created_at": string,"created_by": string | null,"entity_type": string,"error_count": number,"file_name": string,"id": string,"institution_id": string,"row_count": number,"skipped_count": number,"status": string,"updated_at": string,"valid_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "committed_at"?: string | null,"committed_by"?: string | null,"committed_count"?: number,"created_at"?: string,"created_by"?: string | null,"entity_type": string,"error_count"?: number,"file_name": string,"id"?: string,"institution_id": string,"row_count"?: number,"skipped_count"?: number,"status"?: string,"updated_at"?: string,"valid_count"?: number
                  }
                  Update: {
                    "committed_at"?: string | null,"committed_by"?: string | null,"committed_count"?: number,"created_at"?: string,"created_by"?: string | null,"entity_type"?: string,"error_count"?: number,"file_name"?: string,"id"?: string,"institution_id"?: string,"row_count"?: number,"skipped_count"?: number,"status"?: string,"updated_at"?: string,"valid_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_committed_by_fkey"
      columns: ["committed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_batches_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "batch_id": string,"created_at": string,"data": NonNullable<Json>,"entity_id": string | null,"errors": Json | null,"id": string,"institution_id": string,"row_no": number,"status": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"created_at"?: string,"data": NonNullable<Json>,"entity_id"?: string | null,"errors"?: Json | null,"id"?: string,"institution_id": string,"row_no": number,"status"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "batch_id"?: string,"created_at"?: string,"data"?: NonNullable<Json>,"entity_id"?: string | null,"errors"?: Json | null,"id"?: string,"institution_id"?: string,"row_no"?: number,"status"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_rows_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"insight_actions": {
                  Row: {
                    "action": string,"actual_outcome": string | null,"created_at": string,"created_by": string,"decided_at": string,"expected_outcome": string,"goal": string | null,"id": string,"insight_id": string,"institution_id": string,"intervention_status": string | null,"kind": string,"measured_at": string | null,"owner": string,"owner_staff_id": string | null,"rationale": string,"review_date": string | null,"status": string,"steps": Json | null,"student_id": string | null,"supersedes_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actual_outcome"?: string | null,"created_at"?: string,"created_by": string,"decided_at"?: string,"expected_outcome": string,"goal"?: string | null,"id"?: string,"insight_id": string,"institution_id": string,"intervention_status"?: string | null,"kind"?: string,"measured_at"?: string | null,"owner": string,"owner_staff_id"?: string | null,"rationale": string,"review_date"?: string | null,"status": string,"steps"?: Json | null,"student_id"?: string | null,"supersedes_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "action"?: string,"actual_outcome"?: string | null,"created_at"?: string,"created_by"?: string,"decided_at"?: string,"expected_outcome"?: string,"goal"?: string | null,"id"?: string,"insight_id"?: string,"institution_id"?: string,"intervention_status"?: string | null,"kind"?: string,"measured_at"?: string | null,"owner"?: string,"owner_staff_id"?: string | null,"rationale"?: string,"review_date"?: string | null,"status"?: string,"steps"?: Json | null,"student_id"?: string | null,"supersedes_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "insight_actions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insight_actions_insight_id_fkey"
      columns: ["insight_id"]
isOneToOne: false
      referencedRelation: "insights"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insight_actions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insight_actions_owner_staff_id_fkey"
      columns: ["owner_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insight_actions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insight_actions_supersedes_id_fkey"
      columns: ["supersedes_id"]
isOneToOne: false
      referencedRelation: "insight_actions"
      referencedColumns: ["id"]
    }
                  ]
                },"insights": {
                  Row: {
                    "approval_required": boolean,"class_section_id": string | null,"confidence": number,"created_at": string,"date_from": string,"date_to": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"dedupe_key": string,"detector_version": number,"domain": string,"entity_id": string | null,"entity_label": string | null,"entity_type": string | null,"evidence": NonNullable<Json>,"explained_at": string | null,"explained_by": string | null,"explanation": Json | null,"explanation_model": string | null,"explanation_provider": string | null,"factors": NonNullable<Json>,"id": string,"institution_id": string,"kind": string,"pattern": string,"recommended_actions": (string)[],"reviewer_id": string | null,"reviewer_role": string,"severity": string,"signal": string,"sources": (string)[],"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_required"?: boolean,"class_section_id"?: string | null,"confidence": number,"created_at"?: string,"date_from": string,"date_to": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"dedupe_key": string,"detector_version": number,"domain": string,"entity_id"?: string | null,"entity_label"?: string | null,"entity_type"?: string | null,"evidence": NonNullable<Json>,"explained_at"?: string | null,"explained_by"?: string | null,"explanation"?: Json | null,"explanation_model"?: string | null,"explanation_provider"?: string | null,"factors"?: NonNullable<Json>,"id"?: string,"institution_id": string,"kind": string,"pattern": string,"recommended_actions"?: (string)[],"reviewer_id"?: string | null,"reviewer_role": string,"severity": string,"signal": string,"sources"?: (string)[],"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "approval_required"?: boolean,"class_section_id"?: string | null,"confidence"?: number,"created_at"?: string,"date_from"?: string,"date_to"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"dedupe_key"?: string,"detector_version"?: number,"domain"?: string,"entity_id"?: string | null,"entity_label"?: string | null,"entity_type"?: string | null,"evidence"?: NonNullable<Json>,"explained_at"?: string | null,"explained_by"?: string | null,"explanation"?: Json | null,"explanation_model"?: string | null,"explanation_provider"?: string | null,"factors"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"kind"?: string,"pattern"?: string,"recommended_actions"?: (string)[],"reviewer_id"?: string | null,"reviewer_role"?: string,"severity"?: string,"signal"?: string,"sources"?: (string)[],"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "insights_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insights_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insights_explained_by_fkey"
      columns: ["explained_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insights_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "insights_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"institution_sequences": {
                  Row: {
                    "created_at": string,"institution_id": string,"key": string,"next_value": number,"pattern": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"institution_id": string,"key": string,"next_value"?: number,"pattern"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"institution_id"?: string,"key"?: string,"next_value"?: number,"pattern"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "institution_sequences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"institutions": {
                  Row: {
                    "address": Json | null,"ai_policy": string,"board": string,"created_at": string,"id": string,"is_demo": boolean,"name": string,"settings": NonNullable<Json>,"slug": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: Json | null,"ai_policy"?: string,"board"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"name": string,"settings"?: NonNullable<Json>,"slug": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: Json | null,"ai_policy"?: string,"board"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"name"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inventory_items": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_active": boolean,"name": string,"reorder_level": number,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"name": string,"reorder_level"?: number,"unit": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"name"?: string,"reorder_level"?: number,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_items_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"item_id": string,"kind": string,"note": string | null,"quantity": number,"recorded_by": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"item_id": string,"kind": string,"note"?: string | null,"quantity": number,"recorded_by": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"item_id"?: string,"kind"?: string,"note"?: string | null,"quantity"?: number,"recorded_by"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_item_fkey"
      columns: ["item_id","institution_id"]
isOneToOne: false
      referencedRelation: "inventory_items"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "inventory_movements_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"guardian_id": string | null,"id": string,"institution_id": string,"invited_by": string | null,"revoked_at": string | null,"role": string,"staff_id": string | null,"student_id": string | null,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"guardian_id"?: string | null,"id"?: string,"institution_id": string,"invited_by"?: string | null,"revoked_at"?: string | null,"role": string,"staff_id"?: string | null,"student_id"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"guardian_id"?: string | null,"id"?: string,"institution_id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"role"?: string,"staff_id"?: string | null,"student_id"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_instalments": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"due_on": string,"id": string,"institution_id": string,"invoice_id": string,"seq": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"due_on": string,"id"?: string,"institution_id": string,"invoice_id": string,"seq": number,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"due_on"?: string,"id"?: string,"institution_id"?: string,"invoice_id"?: string,"seq"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_instalments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_instalments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_instalments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_lines": {
                  Row: {
                    "amount": number,"concession_amount": number,"created_at": string,"description": string,"head": string,"id": string,"institution_id": string,"invoice_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"concession_amount"?: number,"created_at"?: string,"description": string,"head": string,"id"?: string,"institution_id": string,"invoice_id": string
                  }
                  Update: {
                    "amount"?: number,"concession_amount"?: number,"created_at"?: string,"description"?: string,"head"?: string,"id"?: string,"institution_id"?: string,"invoice_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_lines_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_lines_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "academic_year_id": string,"concession_total": number,"created_at": string,"due_on": string | null,"id": string,"institution_id": string,"invoice_no": string,"paid_total": number,"status": string,"student_id": string,"subtotal": number,"term_id": string,"total": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"concession_total"?: number,"created_at"?: string,"due_on"?: string | null,"id"?: string,"institution_id": string,"invoice_no": string,"paid_total"?: number,"status"?: string,"student_id": string,"subtotal"?: number,"term_id": string,"total"?: number,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"concession_total"?: number,"created_at"?: string,"due_on"?: string | null,"id"?: string,"institution_id"?: string,"invoice_no"?: string,"paid_total"?: number,"status"?: string,"student_id"?: string,"subtotal"?: number,"term_id"?: string,"total"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_term_id_fkey"
      columns: ["term_id"]
isOneToOne: false
      referencedRelation: "terms"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"idempotency_key": string,"institution_id": string | null,"last_error": string | null,"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"payload": NonNullable<Json>,"run_after": string,"status": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key": string,"institution_id"?: string | null,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"run_after"?: string,"status"?: string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"institution_id"?: string | null,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"run_after"?: string,"status"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"late_fee_charges": {
                  Row: {
                    "amount": number,"charge_date": string,"created_at": string,"days_late": number,"id": string,"institution_id": string,"invoice_id": string,"invoice_line_id": string,"rule_id": string,"unit_seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"charge_date": string,"created_at"?: string,"days_late": number,"id"?: string,"institution_id": string,"invoice_id": string,"invoice_line_id": string,"rule_id": string,"unit_seq": number
                  }
                  Update: {
                    "amount"?: number,"charge_date"?: string,"created_at"?: string,"days_late"?: number,"id"?: string,"institution_id"?: string,"invoice_id"?: string,"invoice_line_id"?: string,"rule_id"?: string,"unit_seq"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "late_fee_charges_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "late_fee_charges_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "late_fee_charges_invoice_line_id_fkey"
      columns: ["invoice_line_id"]
isOneToOne: true
      referencedRelation: "invoice_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "late_fee_charges_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "late_fee_rules"
      referencedColumns: ["id"]
    }
                  ]
                },"late_fee_rules": {
                  Row: {
                    "amount": number,"cap": number | null,"created_at": string,"fee_structure_id": string,"grace_days": number,"id": string,"institution_id": string,"is_active": boolean,"kind": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"cap"?: number | null,"created_at"?: string,"fee_structure_id": string,"grace_days"?: number,"id"?: string,"institution_id": string,"is_active"?: boolean,"kind": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"cap"?: number | null,"created_at"?: string,"fee_structure_id"?: string,"grace_days"?: number,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"kind"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "late_fee_rules_fee_structure_id_fkey"
      columns: ["fee_structure_id"]
isOneToOne: true
      referencedRelation: "fee_structures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "late_fee_rules_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "late_fee_rules_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_requests": {
                  Row: {
                    "created_at": string,"created_by": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"end_date": string,"id": string,"institution_id": string,"leave_type": string,"reason": string,"staff_id": string,"start_date": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"end_date": string,"id"?: string,"institution_id": string,"leave_type": string,"reason": string,"staff_id": string,"start_date": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"end_date"?: string,"id"?: string,"institution_id"?: string,"leave_type"?: string,"reason"?: string,"staff_id"?: string,"start_date"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_entries": {
                  Row: {
                    "account": string,"created_at": string,"credit": number,"debit": number,"entry_date": string,"id": string,"institution_id": string,"invoice_id": string | null,"memo": string | null,"payment_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account": string,"created_at"?: string,"credit"?: number,"debit"?: number,"entry_date": string,"id"?: string,"institution_id": string,"invoice_id"?: string | null,"memo"?: string | null,"payment_id"?: string | null
                  }
                  Update: {
                    "account"?: string,"created_at"?: string,"credit"?: number,"debit"?: number,"entry_date"?: string,"id"?: string,"institution_id"?: string,"invoice_id"?: string | null,"memo"?: string | null,"payment_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"lesson_plans": {
                  Row: {
                    "class_section_id": string,"created_at": string,"created_by": string,"curriculum_unit_id": string | null,"id": string,"institution_id": string,"objectives": string,"planned_on": string,"resources": string | null,"subject_id": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"created_by": string,"curriculum_unit_id"?: string | null,"id"?: string,"institution_id": string,"objectives": string,"planned_on": string,"resources"?: string | null,"subject_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"created_by"?: string,"curriculum_unit_id"?: string | null,"id"?: string,"institution_id"?: string,"objectives"?: string,"planned_on"?: string,"resources"?: string | null,"subject_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lesson_plans_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_plans_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_plans_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_plans_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lesson_plans_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"library_books": {
                  Row: {
                    "author": string,"created_at": string,"id": string,"institution_id": string,"isbn": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author": string,"created_at"?: string,"id"?: string,"institution_id": string,"isbn"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "author"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"isbn"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "library_books_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"library_copies": {
                  Row: {
                    "accession_no": string,"book_id": string,"created_at": string,"id": string,"institution_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accession_no": string,"book_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accession_no"?: string,"book_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "library_copies_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "library_books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_copies_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"library_loans": {
                  Row: {
                    "copy_id": string,"created_at": string,"due_on": string,"fine_amount": number,"fine_invoice_line_id": string | null,"fine_waived": boolean,"id": string,"institution_id": string,"issued_by": string | null,"issued_on": string,"renew_count": number,"returned_by": string | null,"returned_on": string | null,"staff_id": string | null,"student_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "copy_id": string,"created_at"?: string,"due_on": string,"fine_amount"?: number,"fine_invoice_line_id"?: string | null,"fine_waived"?: boolean,"id"?: string,"institution_id": string,"issued_by"?: string | null,"issued_on": string,"renew_count"?: number,"returned_by"?: string | null,"returned_on"?: string | null,"staff_id"?: string | null,"student_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "copy_id"?: string,"created_at"?: string,"due_on"?: string,"fine_amount"?: number,"fine_invoice_line_id"?: string | null,"fine_waived"?: boolean,"id"?: string,"institution_id"?: string,"issued_by"?: string | null,"issued_on"?: string,"renew_count"?: number,"returned_by"?: string | null,"returned_on"?: string | null,"staff_id"?: string | null,"student_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "library_loans_copy_id_fkey"
      columns: ["copy_id"]
isOneToOne: false
      referencedRelation: "library_copies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_fine_invoice_line_id_fkey"
      columns: ["fine_invoice_line_id"]
isOneToOne: false
      referencedRelation: "invoice_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_returned_by_fkey"
      columns: ["returned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_loans_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_requests": {
                  Row: {
                    "asset_id": string | null,"assigned_at": string | null,"assignee_staff_id": string | null,"closed_at": string | null,"closed_by": string | null,"created_at": string,"id": string,"institution_id": string,"issue": string,"location": string | null,"priority": string,"raised_at": string,"raised_by": string,"resolution_note": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"assigned_at"?: string | null,"assignee_staff_id"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"id"?: string,"institution_id": string,"issue": string,"location"?: string | null,"priority"?: string,"raised_at"?: string,"raised_by"?: string,"resolution_note"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "asset_id"?: string | null,"assigned_at"?: string | null,"assignee_staff_id"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"id"?: string,"institution_id"?: string,"issue"?: string,"location"?: string | null,"priority"?: string,"raised_at"?: string,"raised_by"?: string,"resolution_note"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_requests_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_requests_assignee_staff_id_fkey"
      columns: ["assignee_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_requests_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_requests_raised_by_fkey"
      columns: ["raised_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"marks": {
                  Row: {
                    "created_at": string,"entered_by": string | null,"exam_paper_id": string,"id": string,"institution_id": string,"is_absent": boolean,"marks_obtained": number | null,"source": string,"student_id": string,"superseded_by": string | null,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"entered_by"?: string | null,"exam_paper_id": string,"id"?: string,"institution_id": string,"is_absent"?: boolean,"marks_obtained"?: number | null,"source"?: string,"student_id": string,"superseded_by"?: string | null,"version_no"?: number
                  }
                  Update: {
                    "created_at"?: string,"entered_by"?: string | null,"exam_paper_id"?: string,"id"?: string,"institution_id"?: string,"is_absent"?: boolean,"marks_obtained"?: number | null,"source"?: string,"student_id"?: string,"superseded_by"?: string | null,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "marks_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marks_exam_paper_id_fkey"
      columns: ["exam_paper_id"]
isOneToOne: false
      referencedRelation: "exam_papers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marks_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marks_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marks_superseded_by_fkey"
      columns: ["superseded_by"]
isOneToOne: false
      referencedRelation: "marks"
      referencedColumns: ["id"]
    }
                  ]
                },"mastery_snapshots": {
                  Row: {
                    "academic_year_id": string,"class_section_id": string,"computed_at": string,"confidence": number,"created_at": string,"curriculum_unit_id": string,"detector_version": string,"evidence": NonNullable<Json>,"id": string,"institution_id": string,"mark_count": number,"score": number,"student_id": string,"subject_id": string,"submission_count": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"class_section_id": string,"computed_at": string,"confidence": number,"created_at"?: string,"curriculum_unit_id": string,"detector_version": string,"evidence": NonNullable<Json>,"id"?: string,"institution_id": string,"mark_count"?: number,"score": number,"student_id": string,"subject_id": string,"submission_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"class_section_id"?: string,"computed_at"?: string,"confidence"?: number,"created_at"?: string,"curriculum_unit_id"?: string,"detector_version"?: string,"evidence"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"mark_count"?: number,"score"?: number,"student_id"?: string,"subject_id"?: string,"submission_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mastery_snapshots_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mastery_snapshots_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mastery_snapshots_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mastery_snapshots_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mastery_snapshots_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mastery_snapshots_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"guardian_id": string | null,"id": string,"institution_id": string,"role": string,"staff_id": string | null,"status": string,"student_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"guardian_id"?: string | null,"id"?: string,"institution_id": string,"role": string,"staff_id"?: string | null,"status"?: string,"student_id"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"guardian_id"?: string | null,"id"?: string,"institution_id"?: string,"role"?: string,"staff_id"?: string | null,"status"?: string,"student_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"message_threads": {
                  Row: {
                    "created_at": string,"created_by": string,"guardian_id": string,"id": string,"institution_id": string,"last_message_at": string,"student_id": string,"subject": string,"teacher_staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"guardian_id": string,"id"?: string,"institution_id": string,"last_message_at"?: string,"student_id": string,"subject": string,"teacher_staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"guardian_id"?: string,"id"?: string,"institution_id"?: string,"last_message_at"?: string,"student_id"?: string,"subject"?: string,"teacher_staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_threads_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_threads_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "guardians"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_threads_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_threads_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_threads_teacher_staff_id_fkey"
      columns: ["teacher_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "body": string,"created_at": string,"id": string,"institution_id": string,"read_at": string | null,"sender_profile_id": string,"thread_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"id"?: string,"institution_id": string,"read_at"?: string | null,"sender_profile_id": string,"thread_id": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"read_at"?: string | null,"sender_profile_id"?: string,"thread_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_profile_id_fkey"
      columns: ["sender_profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "message_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"notices": {
                  Row: {
                    "audience": Json | null,"body": string,"created_at": string,"expires_at": string | null,"id": string,"institution_id": string,"is_public": boolean,"publish_at": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: Json | null,"body": string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"institution_id": string,"is_public"?: boolean,"publish_at"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: Json | null,"body"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"institution_id"?: string,"is_public"?: boolean,"publish_at"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notices_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "category": string,"channel": string,"created_at": string,"enabled": boolean,"institution_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"channel": string,"created_at"?: string,"enabled": boolean,"institution_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "category"?: string,"channel"?: string,"created_at"?: string,"enabled"?: boolean,"institution_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "body": string,"created_at": string,"data": Json | null,"id": string,"institution_id": string,"read_at": string | null,"recipient_user_id": string,"title": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"data"?: Json | null,"id"?: string,"institution_id": string,"read_at"?: string | null,"recipient_user_id": string,"title": string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"data"?: Json | null,"id"?: string,"institution_id"?: string,"read_at"?: string | null,"recipient_user_id"?: string,"title"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_recipient_user_id_fkey"
      columns: ["recipient_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"online_payment_intents": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"currency": string,"id": string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"payment_id": string | null,"provider": string,"provider_order_id": string,"provider_payment_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"payment_id"?: string | null,"provider": string,"provider_order_id": string,"provider_payment_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"idempotency_key"?: string,"institution_id"?: string,"invoice_id"?: string,"payment_id"?: string | null,"provider"?: string,"provider_order_id"?: string,"provider_payment_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_payment_intents_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_payment_intents_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_payment_intents_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_payment_intents_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"page_versions": {
                  Row: {
                    "blocks": NonNullable<Json>,"created_at": string,"created_by": string | null,"id": string,"institution_id": string,"page_id": string,"published_at": string | null,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"institution_id": string,"page_id": string,"published_at"?: string | null,"version_no": number
                  }
                  Update: {
                    "blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"institution_id"?: string,"page_id"?: string,"published_at"?: string | null,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_versions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_versions_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "pages"
      referencedColumns: ["id"]
    }
                  ]
                },"pages": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"published_version_id": string | null,"slug": string,"title": string,"updated_at": string,"website_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"published_version_id"?: string | null,"slug": string,"title": string,"updated_at"?: string,"website_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"published_version_id"?: string | null,"slug"?: string,"title"?: string,"updated_at"?: string,"website_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pages_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pages_website_id_fkey"
      columns: ["website_id"]
isOneToOne: false
      referencedRelation: "websites"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_reversals": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"kind": string,"payment_id": string,"reason": string,"reversed_by": string | null,"snapshot": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"kind": string,"payment_id": string,"reason": string,"reversed_by"?: string | null,"snapshot": NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"institution_id"?: string,"invoice_id"?: string,"kind"?: string,"payment_id"?: string,"reason"?: string,"reversed_by"?: string | null,"snapshot"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_reversals_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_reversals_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_reversals_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_reversals_reversed_by_fkey"
      columns: ["reversed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"mode": string,"received_at": string,"received_by": string | null,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"idempotency_key": string,"institution_id": string,"invoice_id": string,"mode": string,"received_at": string,"received_by"?: string | null,"reference"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"institution_id"?: string,"invoice_id"?: string,"mode"?: string,"received_at"?: string,"received_by"?: string | null,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payroll_runs": {
                  Row: {
                    "created_at": string,"created_by": string,"finalized_at": string | null,"finalized_by": string | null,"id": string,"institution_id": string,"month": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"finalized_at"?: string | null,"finalized_by"?: string | null,"id"?: string,"institution_id": string,"month": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"finalized_at"?: string | null,"finalized_by"?: string | null,"id"?: string,"institution_id"?: string,"month"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payroll_runs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_runs_finalized_by_fkey"
      columns: ["finalized_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_runs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"payslips": {
                  Row: {
                    "components": NonNullable<Json>,"created_at": string,"gross_paise": number,"id": string,"institution_id": string,"net_paise": number,"run_id": string,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "components": NonNullable<Json>,"created_at"?: string,"gross_paise": number,"id"?: string,"institution_id": string,"net_paise": number,"run_id": string,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "components"?: NonNullable<Json>,"created_at"?: string,"gross_paise"?: number,"id"?: string,"institution_id"?: string,"net_paise"?: number,"run_id"?: string,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payslips_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payslips_run_fk"
      columns: ["run_id","institution_id"]
isOneToOne: false
      referencedRelation: "payroll_runs"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "payslips_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"periods": {
                  Row: {
                    "created_at": string,"ends_at": string,"id": string,"institution_id": string,"is_break": boolean,"name": string,"seq": number,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at": string,"id"?: string,"institution_id": string,"is_break"?: boolean,"name": string,"seq": number,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string,"id"?: string,"institution_id"?: string,"is_break"?: boolean,"name"?: string,"seq"?: number,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "periods_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"pickup_persons": {
                  Row: {
                    "created_at": string,"created_by": string,"full_name": string,"id": string,"institution_id": string,"phone": string,"phone_masked": string | null,"relation": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"full_name": string,"id"?: string,"institution_id": string,"phone": string,"phone_masked"?: never,"relation": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"full_name"?: string,"id"?: string,"institution_id"?: string,"phone"?: string,"phone_masked"?: never,"relation"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pickup_persons_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pickup_persons_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pickup_persons_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_invite_codes": {
                  Row: {
                    "code_hash": string,"created_at": string,"email_hash": string | null,"expires_at": string,"id": string,"max_uses": number,"note": string | null,"revoked_at": string | null,"updated_at": string,"used_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code_hash": string,"created_at"?: string,"email_hash"?: string | null,"expires_at"?: string,"id"?: string,"max_uses"?: number,"note"?: string | null,"revoked_at"?: string | null,"updated_at"?: string,"used_count"?: number
                  }
                  Update: {
                    "code_hash"?: string,"created_at"?: string,"email_hash"?: string | null,"expires_at"?: string,"id"?: string,"max_uses"?: number,"note"?: string | null,"revoked_at"?: string | null,"updated_at"?: string,"used_count"?: number
                  }
                  Relationships: [
                    
                  ]
                },"platform_invite_redemptions": {
                  Row: {
                    "created_at": string,"created_institution_id": string | null,"id": string,"invite_code_id": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_institution_id"?: string | null,"id"?: string,"invite_code_id": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_institution_id"?: string | null,"id"?: string,"invite_code_id"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_invite_redemptions_created_institution_id_fkey"
      columns: ["created_institution_id"]
isOneToOne: true
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "platform_invite_redemptions_invite_code_id_fkey"
      columns: ["invite_code_id"]
isOneToOne: false
      referencedRelation: "platform_invite_codes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "platform_invite_redemptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_leads": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"institution_name": string | null,"kind": string,"message": string | null,"name": string,"phone": string | null,"role": string | null,"source_ip_hash": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: string,"institution_name"?: string | null,"kind": string,"message"?: string | null,"name": string,"phone"?: string | null,"role"?: string | null,"source_ip_hash": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"institution_name"?: string | null,"kind"?: string,"message"?: string | null,"name"?: string,"phone"?: string | null,"role"?: string | null,"source_ip_hash"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"practice_attempts": {
                  Row: {
                    "answers": NonNullable<Json>,"created_at": string,"curriculum_unit_id": string,"difficulty": string,"id": string,"institution_id": string,"max_score": number,"questions": NonNullable<Json>,"score": number,"student_id": string,"subject_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"created_at"?: string,"curriculum_unit_id": string,"difficulty": string,"id"?: string,"institution_id": string,"max_score": number,"questions": NonNullable<Json>,"score": number,"student_id": string,"subject_id": string,"updated_at"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"created_at"?: string,"curriculum_unit_id"?: string,"difficulty"?: string,"id"?: string,"institution_id"?: string,"max_score"?: number,"questions"?: NonNullable<Json>,"score"?: number,"student_id"?: string,"subject_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "practice_attempts_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "practice_attempts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "practice_attempts_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "practice_attempts_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"full_name": string | null,"id": string,"is_platform_admin": boolean,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"full_name"?: string | null,"id": string,"is_platform_admin"?: boolean,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"full_name"?: string | null,"id"?: string,"is_platform_admin"?: boolean,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ptm_bookings": {
                  Row: {
                    "booked_by": string,"cancelled_at": string | null,"cancelled_by": string | null,"created_at": string,"event_id": string,"id": string,"institution_id": string,"slot_id": string,"staff_id": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booked_by": string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"event_id": string,"id"?: string,"institution_id": string,"slot_id": string,"staff_id": string,"status"?: string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "booked_by"?: string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"event_id"?: string,"id"?: string,"institution_id"?: string,"slot_id"?: string,"staff_id"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ptm_bookings_booked_by_fkey"
      columns: ["booked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_bookings_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_bookings_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "ptm_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_bookings_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_bookings_slot_fk"
      columns: ["slot_id","event_id","staff_id"]
isOneToOne: false
      referencedRelation: "ptm_slots"
      referencedColumns: ["id","event_id","staff_id"]
    },{
      foreignKeyName: "ptm_bookings_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_bookings_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"ptm_event_sections": {
                  Row: {
                    "class_section_id": string,"created_at": string,"event_id": string,"institution_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"event_id": string,"institution_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"event_id"?: string,"institution_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ptm_event_sections_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_event_sections_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "ptm_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_event_sections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"ptm_events": {
                  Row: {
                    "booking_closes_at": string,"created_at": string,"created_by": string,"day_ends_at": string,"day_starts_at": string,"event_date": string,"id": string,"institution_id": string,"published_at": string | null,"published_by": string | null,"slot_minutes": number,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_closes_at": string,"created_at"?: string,"created_by": string,"day_ends_at": string,"day_starts_at": string,"event_date": string,"id"?: string,"institution_id": string,"published_at"?: string | null,"published_by"?: string | null,"slot_minutes": number,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "booking_closes_at"?: string,"created_at"?: string,"created_by"?: string,"day_ends_at"?: string,"day_starts_at"?: string,"event_date"?: string,"id"?: string,"institution_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"slot_minutes"?: number,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ptm_events_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_events_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ptm_slots": {
                  Row: {
                    "created_at": string,"created_by": string,"event_id": string,"id": string,"institution_id": string,"seq": number,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"event_id": string,"id"?: string,"institution_id": string,"seq": number,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"event_id"?: string,"id"?: string,"institution_id"?: string,"seq"?: number,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ptm_slots_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_slots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "ptm_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_slots_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ptm_slots_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"question_bank": {
                  Row: {
                    "answer": string,"body": string,"created_at": string,"created_by": string,"curriculum_unit_id": string | null,"difficulty": string,"grade_id": string,"id": string,"institution_id": string,"is_active": boolean,"marks": number,"options": Json | null,"subject_id": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"body": string,"created_at"?: string,"created_by": string,"curriculum_unit_id"?: string | null,"difficulty": string,"grade_id": string,"id"?: string,"institution_id": string,"is_active"?: boolean,"marks"?: number,"options"?: Json | null,"subject_id": string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "answer"?: string,"body"?: string,"created_at"?: string,"created_by"?: string,"curriculum_unit_id"?: string | null,"difficulty"?: string,"grade_id"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"marks"?: number,"options"?: Json | null,"subject_id"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_bank_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_bank_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_bank_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_bank_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_bank_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"receipts": {
                  Row: {
                    "created_at": string,"financial_year": string,"id": string,"institution_id": string,"payment_id": string,"receipt_no": string,"snapshot": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"financial_year": string,"id"?: string,"institution_id": string,"payment_id": string,"receipt_no": string,"snapshot": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"financial_year"?: string,"id"?: string,"institution_id"?: string,"payment_id"?: string,"receipt_no"?: string,"snapshot"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "receipts_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"recheck_decisions": {
                  Row: {
                    "applied_marks_id": string | null,"applied_result_id": string | null,"created_at": string,"decided_by": string | null,"decision": string,"id": string,"institution_id": string,"new_marks": number | null,"note": string | null,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_marks_id"?: string | null,"applied_result_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"decision": string,"id"?: string,"institution_id": string,"new_marks"?: number | null,"note"?: string | null,"request_id": string
                  }
                  Update: {
                    "applied_marks_id"?: string | null,"applied_result_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"decision"?: string,"id"?: string,"institution_id"?: string,"new_marks"?: number | null,"note"?: string | null,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recheck_decisions_applied_marks_id_fkey"
      columns: ["applied_marks_id"]
isOneToOne: false
      referencedRelation: "marks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_decisions_applied_result_id_fkey"
      columns: ["applied_result_id"]
isOneToOne: false
      referencedRelation: "results"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_decisions_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_decisions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_decisions_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "recheck_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"recheck_requests": {
                  Row: {
                    "created_at": string,"exam_paper_id": string,"id": string,"institution_id": string,"reason": string,"requested_by": string | null,"result_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"exam_paper_id": string,"id"?: string,"institution_id": string,"reason": string,"requested_by"?: string | null,"result_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"exam_paper_id"?: string,"id"?: string,"institution_id"?: string,"reason"?: string,"requested_by"?: string | null,"result_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recheck_requests_exam_paper_id_fkey"
      columns: ["exam_paper_id"]
isOneToOne: false
      referencedRelation: "exam_papers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_requests_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recheck_requests_result_id_fkey"
      columns: ["result_id"]
isOneToOne: false
      referencedRelation: "results"
      referencedColumns: ["id"]
    }
                  ]
                },"resource_sections": {
                  Row: {
                    "class_section_id": string,"created_at": string,"institution_id": string,"resource_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"institution_id": string,"resource_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"institution_id"?: string,"resource_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_sections_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resource_sections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resource_sections_resource_fk"
      columns: ["resource_id","institution_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"resources": {
                  Row: {
                    "created_at": string,"created_by": string,"curriculum_unit_id": string | null,"description": string | null,"document_id": string | null,"id": string,"institution_id": string,"kind": string,"published": boolean,"subject_id": string,"title": string,"updated_at": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"curriculum_unit_id"?: string | null,"description"?: string | null,"document_id"?: string | null,"id"?: string,"institution_id": string,"kind": string,"published"?: boolean,"subject_id": string,"title": string,"updated_at"?: string,"url"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"curriculum_unit_id"?: string | null,"description"?: string | null,"document_id"?: string | null,"id"?: string,"institution_id"?: string,"kind"?: string,"published"?: boolean,"subject_id"?: string,"title"?: string,"updated_at"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "resources_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"result_remarks": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"institution_id": string,"remark": string,"result_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"institution_id": string,"remark": string,"result_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"institution_id"?: string,"remark"?: string,"result_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "result_remarks_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "result_remarks_result_id_fkey"
      columns: ["result_id"]
isOneToOne: true
      referencedRelation: "results"
      referencedColumns: ["id"]
    }
                  ]
                },"results": {
                  Row: {
                    "created_at": string,"exam_id": string,"grade": string,"id": string,"institution_id": string,"max_total": number,"percentage": number,"published_at": string,"snapshot": NonNullable<Json>,"student_id": string,"superseded_by": string | null,"total": number,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"exam_id": string,"grade": string,"id"?: string,"institution_id": string,"max_total": number,"percentage": number,"published_at"?: string,"snapshot": NonNullable<Json>,"student_id": string,"superseded_by"?: string | null,"total": number,"version_no"?: number
                  }
                  Update: {
                    "created_at"?: string,"exam_id"?: string,"grade"?: string,"id"?: string,"institution_id"?: string,"max_total"?: number,"percentage"?: number,"published_at"?: string,"snapshot"?: NonNullable<Json>,"student_id"?: string,"superseded_by"?: string | null,"total"?: number,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "results_exam_id_fkey"
      columns: ["exam_id"]
isOneToOne: false
      referencedRelation: "exams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "results_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "results_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "results_superseded_by_fkey"
      columns: ["superseded_by"]
isOneToOne: false
      referencedRelation: "results"
      referencedColumns: ["id"]
    }
                  ]
                },"rooms": {
                  Row: {
                    "capacity": number,"created_at": string,"id": string,"institution_id": string,"kind": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"created_at"?: string,"id"?: string,"institution_id": string,"kind"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rooms_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"safety_acknowledgements": {
                  Row: {
                    "alert_id": string,"created_at": string,"id": string,"institution_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "alert_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_acknowledgements_alert_fkey"
      columns: ["alert_id","institution_id"]
isOneToOne: false
      referencedRelation: "safety_alerts"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "safety_acknowledgements_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_acknowledgements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"safety_alert_sections": {
                  Row: {
                    "alert_id": string,"class_section_id": string,"created_at": string,"id": string,"institution_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id": string,"class_section_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"updated_at"?: string
                  }
                  Update: {
                    "alert_id"?: string,"class_section_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_alert_sections_alert_fkey"
      columns: ["alert_id","institution_id"]
isOneToOne: false
      referencedRelation: "safety_alerts"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "safety_alert_sections_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_alert_sections_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"safety_alerts": {
                  Row: {
                    "audience": string,"closed_at": string | null,"closed_by": string | null,"created_at": string,"created_by": string,"id": string,"institution_id": string,"kind": string,"message": string,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": string,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"institution_id": string,"kind": string,"message": string,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: string,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"message"?: string,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_alerts_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_alerts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_alerts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"safety_headcounts": {
                  Row: {
                    "alert_id": string,"class_section_id": string,"created_at": string,"id": string,"institution_id": string,"marked_by": string,"missing_count": number,"note": string | null,"present_count": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id": string,"class_section_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"marked_by": string,"missing_count": number,"note"?: string | null,"present_count": number,"updated_at"?: string
                  }
                  Update: {
                    "alert_id"?: string,"class_section_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"marked_by"?: string,"missing_count"?: number,"note"?: string | null,"present_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_headcounts_alert_fkey"
      columns: ["alert_id","institution_id"]
isOneToOne: false
      referencedRelation: "safety_alerts"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "safety_headcounts_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_headcounts_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_headcounts_marked_by_fkey"
      columns: ["marked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"salary_structures": {
                  Row: {
                    "components": NonNullable<Json>,"created_at": string,"created_by": string,"gross_paise": number,"id": string,"institution_id": string,"is_active": boolean,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "components": NonNullable<Json>,"created_at"?: string,"created_by"?: string,"gross_paise"?: number,"id"?: string,"institution_id": string,"is_active"?: boolean,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "components"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"gross_paise"?: number,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "salary_structures_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "salary_structures_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "salary_structures_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"scheduled_reports": {
                  Row: {
                    "created_at": string,"created_by": string,"cron": string,"id": string,"institution_id": string,"name": string,"next_run_at": string | null,"params": NonNullable<Json>,"recipient_roles": (string)[],"source": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"cron": string,"id"?: string,"institution_id": string,"name": string,"next_run_at"?: string | null,"params"?: NonNullable<Json>,"recipient_roles": (string)[],"source": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"cron"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"next_run_at"?: string | null,"params"?: NonNullable<Json>,"recipient_roles"?: (string)[],"source"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scheduled_reports_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scheduled_reports_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"school_lab_bookings": {
                  Row: {
                    "booked_by": string,"cancelled_at": string | null,"cancelled_by": string | null,"class_section_id": string,"created_at": string,"date": string,"id": string,"institution_id": string,"lab_id": string,"period_id": string,"purpose": string | null,"staff_id": string,"status": string,"subject_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booked_by": string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"class_section_id": string,"created_at"?: string,"date": string,"id"?: string,"institution_id": string,"lab_id": string,"period_id": string,"purpose"?: string | null,"staff_id": string,"status"?: string,"subject_id": string,"updated_at"?: string
                  }
                  Update: {
                    "booked_by"?: string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"class_section_id"?: string,"created_at"?: string,"date"?: string,"id"?: string,"institution_id"?: string,"lab_id"?: string,"period_id"?: string,"purpose"?: string | null,"staff_id"?: string,"status"?: string,"subject_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_lab_bookings_booked_by_fkey"
      columns: ["booked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_lab_fk"
      columns: ["lab_id","institution_id"]
isOneToOne: false
      referencedRelation: "school_labs"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "school_lab_bookings_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_bookings_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    }
                  ]
                },"school_lab_equipment": {
                  Row: {
                    "condition": string,"created_at": string,"expiry_on": string | null,"hazard_class": string | null,"id": string,"institution_id": string,"kind": string,"lab_id": string,"name": string,"quantity": number,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "condition"?: string,"created_at"?: string,"expiry_on"?: string | null,"hazard_class"?: string | null,"id"?: string,"institution_id": string,"kind": string,"lab_id": string,"name": string,"quantity"?: number,"unit": string,"updated_at"?: string
                  }
                  Update: {
                    "condition"?: string,"created_at"?: string,"expiry_on"?: string | null,"hazard_class"?: string | null,"id"?: string,"institution_id"?: string,"kind"?: string,"lab_id"?: string,"name"?: string,"quantity"?: number,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_lab_equipment_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_equipment_lab_fk"
      columns: ["lab_id","institution_id"]
isOneToOne: false
      referencedRelation: "school_labs"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"school_lab_experiments": {
                  Row: {
                    "booking_id": string,"completed": boolean,"created_at": string,"curriculum_unit_id": string | null,"id": string,"institution_id": string,"notes": string | null,"recorded_by": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id": string,"completed"?: boolean,"created_at"?: string,"curriculum_unit_id"?: string | null,"id"?: string,"institution_id": string,"notes"?: string | null,"recorded_by"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "booking_id"?: string,"completed"?: boolean,"created_at"?: string,"curriculum_unit_id"?: string | null,"id"?: string,"institution_id"?: string,"notes"?: string | null,"recorded_by"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_lab_experiments_booking_fk"
      columns: ["booking_id","institution_id"]
isOneToOne: false
      referencedRelation: "school_lab_bookings"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "school_lab_experiments_curriculum_unit_id_fkey"
      columns: ["curriculum_unit_id"]
isOneToOne: false
      referencedRelation: "curriculum_units"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_experiments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_experiments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"school_lab_incidents": {
                  Row: {
                    "booking_id": string | null,"cost_paise": number | null,"created_at": string,"description": string,"id": string,"institution_id": string,"kind": string,"lab_id": string,"reported_by": string,"severity": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"cost_paise"?: number | null,"created_at"?: string,"description": string,"id"?: string,"institution_id": string,"kind": string,"lab_id": string,"reported_by"?: string,"severity": string,"updated_at"?: string
                  }
                  Update: {
                    "booking_id"?: string | null,"cost_paise"?: number | null,"created_at"?: string,"description"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"lab_id"?: string,"reported_by"?: string,"severity"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_lab_incidents_booking_fk"
      columns: ["booking_id","lab_id","institution_id"]
isOneToOne: false
      referencedRelation: "school_lab_bookings"
      referencedColumns: ["id","lab_id","institution_id"]
    },{
      foreignKeyName: "school_lab_incidents_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_lab_incidents_lab_fk"
      columns: ["lab_id","institution_id"]
isOneToOne: false
      referencedRelation: "school_labs"
      referencedColumns: ["id","institution_id"]
    },{
      foreignKeyName: "school_lab_incidents_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"school_labs": {
                  Row: {
                    "capacity": number,"created_at": string,"id": string,"institution_id": string,"is_active": boolean,"kind": string,"name": string,"room_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"created_at"?: string,"id"?: string,"institution_id": string,"is_active"?: boolean,"kind": string,"name": string,"room_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"id"?: string,"institution_id"?: string,"is_active"?: boolean,"kind"?: string,"name"?: string,"room_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "school_labs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "school_labs_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"school_start_attempts": {
                  Row: {
                    "client_hash": string,"code_hash": string,"created_at": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_hash": string,"code_hash": string,"created_at"?: string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "client_hash"?: string,"code_hash"?: string,"created_at"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"simulation_scenarios": {
                  Row: {
                    "assumptions": NonNullable<Json>,"created_at": string,"created_by": string,"decided_at": string | null,"decided_by": string | null,"id": string,"institution_id": string,"name": string,"rationale": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assumptions": NonNullable<Json>,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"institution_id": string,"name": string,"rationale"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assumptions"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"institution_id"?: string,"name"?: string,"rationale"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "simulation_scenarios_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "simulation_scenarios_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "simulation_scenarios_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "created_at": string,"department_id": string | null,"designation": string,"email": string | null,"employee_no": string,"full_name": string,"id": string,"institution_id": string,"is_teaching": boolean,"phone": string | null,"status": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department_id"?: string | null,"designation": string,"email"?: string | null,"employee_no": string,"full_name": string,"id"?: string,"institution_id": string,"is_teaching"?: boolean,"phone"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"department_id"?: string | null,"designation"?: string,"email"?: string | null,"employee_no"?: string,"full_name"?: string,"id"?: string,"institution_id"?: string,"is_teaching"?: boolean,"phone"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_attendance": {
                  Row: {
                    "check_in_at": string | null,"created_at": string,"date": string,"id": string,"institution_id": string,"marked_by": string | null,"note": string | null,"source": string,"staff_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "check_in_at"?: string | null,"created_at"?: string,"date": string,"id"?: string,"institution_id": string,"marked_by"?: string | null,"note"?: string | null,"source"?: string,"staff_id": string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "check_in_at"?: string | null,"created_at"?: string,"date"?: string,"id"?: string,"institution_id"?: string,"marked_by"?: string | null,"note"?: string | null,"source"?: string,"staff_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_attendance_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_attendance_marked_by_fkey"
      columns: ["marked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_attendance_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"student_leave_requests": {
                  Row: {
                    "class_section_id": string,"created_at": string,"created_by": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"end_date": string,"id": string,"institution_id": string,"reason": string,"start_date": string,"status": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"end_date": string,"id"?: string,"institution_id": string,"reason": string,"start_date": string,"status"?: string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"end_date"?: string,"id"?: string,"institution_id"?: string,"reason"?: string,"start_date"?: string,"status"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "student_leave_requests_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_leave_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_leave_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_leave_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_leave_requests_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"student_lifecycle_events": {
                  Row: {
                    "batch_id": string | null,"created_at": string,"created_by": string,"effective_on": string,"from_enrolment_id": string | null,"id": string,"institution_id": string,"kind": string,"reason": string | null,"student_id": string,"tc_no": string | null,"tc_snapshot": Json | null,"to_enrolment_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id"?: string | null,"created_at"?: string,"created_by": string,"effective_on": string,"from_enrolment_id"?: string | null,"id"?: string,"institution_id": string,"kind": string,"reason"?: string | null,"student_id": string,"tc_no"?: string | null,"tc_snapshot"?: Json | null,"to_enrolment_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "batch_id"?: string | null,"created_at"?: string,"created_by"?: string,"effective_on"?: string,"from_enrolment_id"?: string | null,"id"?: string,"institution_id"?: string,"kind"?: string,"reason"?: string | null,"student_id"?: string,"tc_no"?: string | null,"tc_snapshot"?: Json | null,"to_enrolment_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "student_lifecycle_events_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_lifecycle_events_from_enrolment_id_fkey"
      columns: ["from_enrolment_id"]
isOneToOne: false
      referencedRelation: "enrolments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_lifecycle_events_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_lifecycle_events_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "student_lifecycle_events_to_enrolment_id_fkey"
      columns: ["to_enrolment_id"]
isOneToOne: false
      referencedRelation: "enrolments"
      referencedColumns: ["id"]
    }
                  ]
                },"students": {
                  Row: {
                    "admission_no": string,"created_at": string,"details": Json | null,"dob": string,"first_name": string,"gender": string,"id": string,"institution_id": string,"last_name": string | null,"photo_path": string | null,"source_application_id": string | null,"status": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admission_no": string,"created_at"?: string,"details"?: Json | null,"dob": string,"first_name": string,"gender": string,"id"?: string,"institution_id": string,"last_name"?: string | null,"photo_path"?: string | null,"source_application_id"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "admission_no"?: string,"created_at"?: string,"details"?: Json | null,"dob"?: string,"first_name"?: string,"gender"?: string,"id"?: string,"institution_id"?: string,"last_name"?: string | null,"photo_path"?: string | null,"source_application_id"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "students_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "students_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"studio_requests": {
                  Row: {
                    "context": NonNullable<Json>,"created_at": string,"created_by": string,"decided_at": string | null,"decided_by": string | null,"desired_outcome": string,"id": string,"institution_id": string,"notes": (string)[],"problem": string,"proposal": Json | null,"status": string,"terms": NonNullable<Json>,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"created_by": string,"decided_at"?: string | null,"decided_by"?: string | null,"desired_outcome": string,"id"?: string,"institution_id": string,"notes"?: (string)[],"problem": string,"proposal"?: Json | null,"status"?: string,"terms"?: NonNullable<Json>,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"desired_outcome"?: string,"id"?: string,"institution_id"?: string,"notes"?: (string)[],"problem"?: string,"proposal"?: Json | null,"status"?: string,"terms"?: NonNullable<Json>,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "studio_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "studio_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "studio_requests_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"study_items": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"folder": string | null,"id": string,"institution_id": string,"kind": string,"pinned": boolean,"source_chat_id": string | null,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"created_at"?: string,"folder"?: string | null,"id"?: string,"institution_id": string,"kind": string,"pinned"?: boolean,"source_chat_id"?: string | null,"title": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"folder"?: string | null,"id"?: string,"institution_id"?: string,"kind"?: string,"pinned"?: boolean,"source_chat_id"?: string | null,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "study_items_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "study_items_source_chat_id_fkey"
      columns: ["source_chat_id"]
isOneToOne: false
      referencedRelation: "study_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "study_items_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"study_preferences": {
                  Row: {
                    "created_at": string,"institution_id": string,"skills": NonNullable<Json>,"style": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"institution_id": string,"skills"?: NonNullable<Json>,"style"?: NonNullable<Json>,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"institution_id"?: string,"skills"?: NonNullable<Json>,"style"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "study_preferences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "study_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"subject_assignments": {
                  Row: {
                    "class_section_id": string,"created_at": string,"id": string,"institution_id": string,"subject_id": string,"teacher_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"subject_id": string,"teacher_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"subject_id"?: string,"teacher_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subject_assignments_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subject_assignments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subject_assignments_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subject_assignments_teacher_id_fkey"
      columns: ["teacher_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"subjects": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"institution_id": string,"kind": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"institution_id": string,"kind": string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"kind"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subjects_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"substitutions": {
                  Row: {
                    "cancelled_at": string | null,"created_at": string,"created_by": string | null,"date": string,"id": string,"institution_id": string,"leave_request_id": string | null,"note": string | null,"original_teacher_id": string,"period_id": string,"slot_id": string,"status": string,"substitute_teacher_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"date": string,"id"?: string,"institution_id": string,"leave_request_id"?: string | null,"note"?: string | null,"original_teacher_id": string,"period_id": string,"slot_id": string,"status"?: string,"substitute_teacher_id": string,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"date"?: string,"id"?: string,"institution_id"?: string,"leave_request_id"?: string | null,"note"?: string | null,"original_teacher_id"?: string,"period_id"?: string,"slot_id"?: string,"status"?: string,"substitute_teacher_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "substitutions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_leave_request_id_fkey"
      columns: ["leave_request_id"]
isOneToOne: false
      referencedRelation: "leave_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_original_teacher_id_fkey"
      columns: ["original_teacher_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_slot_id_fkey"
      columns: ["slot_id"]
isOneToOne: false
      referencedRelation: "timetable_slots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "substitutions_substitute_teacher_id_fkey"
      columns: ["substitute_teacher_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"survey_audiences": {
                  Row: {
                    "audience_type": string,"class_section_id": string | null,"created_at": string,"grade_id": string | null,"id": string,"institution_id": string,"role": string | null,"survey_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience_type": string,"class_section_id"?: string | null,"created_at"?: string,"grade_id"?: string | null,"id"?: string,"institution_id": string,"role"?: string | null,"survey_id": string,"updated_at"?: string
                  }
                  Update: {
                    "audience_type"?: string,"class_section_id"?: string | null,"created_at"?: string,"grade_id"?: string | null,"id"?: string,"institution_id"?: string,"role"?: string | null,"survey_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_audiences_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_audiences_grade_id_fkey"
      columns: ["grade_id"]
isOneToOne: false
      referencedRelation: "grades"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_audiences_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_audiences_survey_id_fkey"
      columns: ["survey_id"]
isOneToOne: false
      referencedRelation: "surveys"
      referencedColumns: ["id"]
    }
                  ]
                },"survey_respondents": {
                  Row: {
                    "created_at": string,"institution_id": string,"survey_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"institution_id": string,"survey_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"institution_id"?: string,"survey_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_respondents_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_respondents_survey_id_fkey"
      columns: ["survey_id"]
isOneToOne: false
      referencedRelation: "surveys"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_respondents_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"survey_responses": {
                  Row: {
                    "answers": NonNullable<Json>,"created_at": string,"id": string,"institution_id": string,"respondent_user_id": string | null,"survey_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"created_at"?: string,"id"?: string,"institution_id": string,"respondent_user_id"?: string | null,"survey_id": string,"updated_at"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"institution_id"?: string,"respondent_user_id"?: string | null,"survey_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_responses_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_responses_respondent_user_id_fkey"
      columns: ["respondent_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "survey_responses_survey_id_fkey"
      columns: ["survey_id"]
isOneToOne: false
      referencedRelation: "surveys"
      referencedColumns: ["id"]
    }
                  ]
                },"surveys": {
                  Row: {
                    "closed_at": string | null,"closes_at": string,"created_at": string,"created_by": string,"description": string | null,"id": string,"institution_id": string,"is_anonymous": boolean,"opened_at": string | null,"questions": NonNullable<Json>,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closes_at": string,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"institution_id": string,"is_anonymous"?: boolean,"opened_at"?: string | null,"questions": NonNullable<Json>,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closes_at"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"institution_id"?: string,"is_anonymous"?: boolean,"opened_at"?: string | null,"questions"?: NonNullable<Json>,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "surveys_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "surveys_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"terms": {
                  Row: {
                    "academic_year_id": string,"created_at": string,"ends_on": string,"id": string,"institution_id": string,"name": string,"sequence": number,"starts_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"created_at"?: string,"ends_on": string,"id"?: string,"institution_id": string,"name": string,"sequence": number,"starts_on": string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"created_at"?: string,"ends_on"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"sequence"?: number,"starts_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "terms_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "terms_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"timetable_slots": {
                  Row: {
                    "class_section_id": string,"created_at": string,"id": string,"institution_id": string,"period_id": string,"room_id": string | null,"subject_id": string,"teacher_id": string,"updated_at": string,"version_id": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"id"?: string,"institution_id": string,"period_id": string,"room_id"?: string | null,"subject_id": string,"teacher_id": string,"updated_at"?: string,"version_id": string,"weekday": number
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"period_id"?: string,"room_id"?: string | null,"subject_id"?: string,"teacher_id"?: string,"updated_at"?: string,"version_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "timetable_slots_class_section_id_fkey"
      columns: ["class_section_id"]
isOneToOne: false
      referencedRelation: "class_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_teacher_id_fkey"
      columns: ["teacher_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_slots_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "timetable_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"timetable_versions": {
                  Row: {
                    "academic_year_id": string,"created_at": string,"created_by": string,"id": string,"institution_id": string,"name": string,"published_at": string | null,"published_by": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "academic_year_id": string,"created_at"?: string,"created_by": string,"id"?: string,"institution_id": string,"name": string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "academic_year_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"published_at"?: string | null,"published_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "timetable_versions_academic_year_id_fkey"
      columns: ["academic_year_id"]
isOneToOne: false
      referencedRelation: "academic_years"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_versions_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "timetable_versions_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"transport_assignments": {
                  Row: {
                    "assigned_by": string,"created_at": string,"id": string,"institution_id": string,"route_id": string,"stop_id": string,"student_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_by": string,"created_at"?: string,"id"?: string,"institution_id": string,"route_id": string,"stop_id": string,"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_by"?: string,"created_at"?: string,"id"?: string,"institution_id"?: string,"route_id"?: string,"stop_id"?: string,"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transport_assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_assignments_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_assignments_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "transport_routes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_assignments_stop_id_fkey"
      columns: ["stop_id"]
isOneToOne: false
      referencedRelation: "transport_stops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_assignments_stop_route_fk"
      columns: ["stop_id","route_id"]
isOneToOne: false
      referencedRelation: "transport_stops"
      referencedColumns: ["id","route_id"]
    },{
      foreignKeyName: "transport_assignments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: true
      referencedRelation: "students"
      referencedColumns: ["id"]
    }
                  ]
                },"transport_routes": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"name": string,"status": string,"updated_at": string,"vehicle_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"name": string,"status"?: string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"name"?: string,"status"?: string,"updated_at"?: string,"vehicle_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transport_routes_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_routes_vehicle_id_fkey"
      columns: ["vehicle_id"]
isOneToOne: false
      referencedRelation: "transport_vehicles"
      referencedColumns: ["id"]
    }
                  ]
                },"transport_stops": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"map_x": number,"map_y": number,"name": string,"pickup_time": string,"route_id": string,"seq": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"map_x": number,"map_y": number,"name": string,"pickup_time": string,"route_id": string,"seq": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"map_x"?: number,"map_y"?: number,"name"?: string,"pickup_time"?: string,"route_id"?: string,"seq"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transport_stops_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transport_stops_route_id_fkey"
      columns: ["route_id"]
isOneToOne: false
      referencedRelation: "transport_routes"
      referencedColumns: ["id"]
    }
                  ]
                },"transport_vehicles": {
                  Row: {
                    "capacity": number,"created_at": string,"driver_name": string,"id": string,"institution_id": string,"registration_no": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"created_at"?: string,"driver_name": string,"id"?: string,"institution_id": string,"registration_no": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"driver_name"?: string,"id"?: string,"institution_id"?: string,"registration_no"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transport_vehicles_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"vaccinations": {
                  Row: {
                    "administered_on": string,"created_at": string,"dose": string | null,"id": string,"institution_id": string,"notes": string | null,"recorded_by": string,"student_id": string,"updated_at": string,"updated_by": string | null,"vaccine": string
                  }
                  ComputedFields: never
                  Insert: {
                    "administered_on": string,"created_at"?: string,"dose"?: string | null,"id"?: string,"institution_id": string,"notes"?: string | null,"recorded_by": string,"student_id": string,"updated_at"?: string,"updated_by"?: string | null,"vaccine": string
                  }
                  Update: {
                    "administered_on"?: string,"created_at"?: string,"dose"?: string | null,"id"?: string,"institution_id"?: string,"notes"?: string | null,"recorded_by"?: string,"student_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"vaccine"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vaccinations_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vaccinations_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vaccinations_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "students"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vaccinations_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"visitor_entries": {
                  Row: {
                    "checked_in_at": string,"checked_in_by": string,"checked_out_at": string | null,"checked_out_by": string | null,"created_at": string,"full_name": string,"host_staff_id": string | null,"id": string,"id_last4": string | null,"id_type": string | null,"institution_id": string,"meeting_with": string | null,"phone": string,"purpose": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_in_at"?: string,"checked_in_by": string,"checked_out_at"?: string | null,"checked_out_by"?: string | null,"created_at"?: string,"full_name": string,"host_staff_id"?: string | null,"id"?: string,"id_last4"?: string | null,"id_type"?: string | null,"institution_id": string,"meeting_with"?: string | null,"phone": string,"purpose": string,"updated_at"?: string
                  }
                  Update: {
                    "checked_in_at"?: string,"checked_in_by"?: string,"checked_out_at"?: string | null,"checked_out_by"?: string | null,"created_at"?: string,"full_name"?: string,"host_staff_id"?: string | null,"id"?: string,"id_last4"?: string | null,"id_type"?: string | null,"institution_id"?: string,"meeting_with"?: string | null,"phone"?: string,"purpose"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visitor_entries_checked_in_by_fkey"
      columns: ["checked_in_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visitor_entries_checked_out_by_fkey"
      columns: ["checked_out_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visitor_entries_host_staff_id_fkey"
      columns: ["host_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visitor_entries_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"websites": {
                  Row: {
                    "created_at": string,"id": string,"institution_id": string,"is_live": boolean,"nav": Json | null,"theme": Json | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"institution_id": string,"is_live"?: boolean,"nav"?: Json | null,"theme"?: Json | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"institution_id"?: string,"is_live"?: boolean,"nav"?: Json | null,"theme"?: Json | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "websites_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: true
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_runs": {
                  Row: {
                    "created_at": string,"cursor_node_id": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"engine_version": string | null,"entity_id": string | null,"finished_at": string | null,"graph": NonNullable<Json>,"id": string,"institution_id": string,"last_value": number | null,"pending_decision": string | null,"requested_by": string | null,"started_at": string,"status": string,"steps": NonNullable<Json>,"trigger_key": string,"trigger_kind": string,"updated_at": string,"workflow_id": string,"workflow_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"cursor_node_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"engine_version"?: string | null,"entity_id"?: string | null,"finished_at"?: string | null,"graph": NonNullable<Json>,"id"?: string,"institution_id": string,"last_value"?: number | null,"pending_decision"?: string | null,"requested_by"?: string | null,"started_at"?: string,"status"?: string,"steps"?: NonNullable<Json>,"trigger_key": string,"trigger_kind": string,"updated_at"?: string,"workflow_id": string,"workflow_version": number
                  }
                  Update: {
                    "created_at"?: string,"cursor_node_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"engine_version"?: string | null,"entity_id"?: string | null,"finished_at"?: string | null,"graph"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"last_value"?: number | null,"pending_decision"?: string | null,"requested_by"?: string | null,"started_at"?: string,"status"?: string,"steps"?: NonNullable<Json>,"trigger_key"?: string,"trigger_kind"?: string,"updated_at"?: string,"workflow_id"?: string,"workflow_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_runs_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_runs_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_runs_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_runs_workflow_fk"
      columns: ["workflow_id","institution_id"]
isOneToOne: false
      referencedRelation: "workflows"
      referencedColumns: ["id","institution_id"]
    }
                  ]
                },"workflows": {
                  Row: {
                    "created_at": string,"created_by": string,"edges": NonNullable<Json>,"id": string,"institution_id": string,"name": string,"next_run_at": string | null,"nodes": NonNullable<Json>,"status": string,"trigger_config": string,"trigger_type": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"edges": NonNullable<Json>,"id"?: string,"institution_id": string,"name": string,"next_run_at"?: string | null,"nodes": NonNullable<Json>,"status"?: string,"trigger_config"?: string,"trigger_type": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"edges"?: NonNullable<Json>,"id"?: string,"institution_id"?: string,"name"?: string,"next_run_at"?: string | null,"nodes"?: NonNullable<Json>,"status"?: string,"trigger_config"?: string,"trigger_type"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflows_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflows_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"acknowledge_safety_alert":
{ Args: { "p_alert_id": string,"p_institution_id": string }; Returns: {
              "alert_id": string,
"created_at": string,
"id": string,
"institution_id": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "safety_acknowledgements"
        isOneToOne: true
        isSetofReturn: false
      } },
"add_enquiry_note":
{ Args: { "p_enquiry_id": string,"p_institution_id": string,"p_text": string }; Returns: Json
                           },
"ai_usage_by_provider":
{ Args: { "p_from": string,"p_institution_id": string,"p_to": string }; Returns: {
              "cost_usd": number,"input_tokens": number,"ok_requests": number,"output_tokens": number,"provider": string,"requests": number
            }[]
                           },
"ai_usage_sum":
{ Args: { "p_feature"?: string,"p_from": string,"p_institution_id": string,"p_role"?: string,"p_user_id"?: string }; Returns: number
                           },
"ai_usage_tokens_by_role":
{ Args: { "p_from": string,"p_institution_id": string }; Returns: {
              "cost_usd": number,"role": string,"tokens": number
            }[]
                           },
"allocate_hostel_room":
{ Args: { "p_room_id": string,"p_student_id": string }; Returns: Json
                           },
"apply_late_fees":
{ Args: { "p_institution_id": string }; Returns: Json
                           },
"apply_recheck_decision":
{ Args: { "p_decision": string,"p_new_marks": number,"p_note": string,"p_request_id": string }; Returns: Json
                           },
"apply_school_template":
{ Args: { "p_institution_id": string,"p_template": Json }; Returns: Json
                           },
"assert_forecast_window":
{ Args: { "p_from": string,"p_to": string }; Returns: undefined
                           },
"assign_substitution":
{ Args: { "p_date": string,"p_leave_request_id"?: string,"p_note"?: string,"p_slot_id": string,"p_substitute_id": string }; Returns: {
              "cancelled_at": string | null,
"created_at": string,
"created_by": string | null,
"date": string,
"id": string,
"institution_id": string,
"leave_request_id": string | null,
"note": string | null,
"original_teacher_id": string,
"period_id": string,
"slot_id": string,
"status": string,
"substitute_teacher_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "substitutions"
        isOneToOne: true
        isSetofReturn: false
      } },
"attendance_daily_counts":
{ Args: { "p_by_section"?: boolean,"p_class_section_id"?: string,"p_from": string,"p_institution_id": string,"p_student_id"?: string,"p_to": string }; Returns: {
              "class_section_id": string,"date": string,"n": number,"status": string
            }[]
                           },
"award_house_points":
{ Args: { "p_house_id": string,"p_points": number,"p_reason": string,"p_student_id"?: string }; Returns: {
              "awarded_by": string,
"created_at": string,
"house_id": string,
"id": string,
"institution_id": string,
"points": number,
"reason": string,
"student_id": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "house_points"
        isOneToOne: true
        isSetofReturn: false
      } },
"book_ptm_slot":
{ Args: { "p_slot_id": string,"p_student_id": string }; Returns: string
                           },
"book_school_lab":
{ Args: { "p_class_section_id": string,"p_date": string,"p_lab_id": string,"p_period_id": string,"p_purpose"?: string,"p_staff_id"?: string,"p_subject_id": string }; Returns: Json
                           },
"cancel_club_event_signup":
{ Args: { "p_event_id": string,"p_student_id": string }; Returns: undefined
                           },
"cancel_duty_swap":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"cancel_ptm_booking":
{ Args: { "p_booking_id": string }; Returns: string
                           },
"cancel_school_lab_booking":
{ Args: { "p_booking_id": string }; Returns: Json
                           },
"cancel_substitution":
{ Args: { "p_substitution_id": string }; Returns: {
              "cancelled_at": string | null,
"created_at": string,
"created_by": string | null,
"date": string,
"id": string,
"institution_id": string,
"leave_request_id": string | null,
"note": string | null,
"original_teacher_id": string,
"period_id": string,
"slot_id": string,
"status": string,
"substitute_teacher_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "substitutions"
        isOneToOne: true
        isSetofReturn: false
      } },
"canteen_balance":
{ Args: { "p_institution_id": string,"p_student_id": string }; Returns: number
                           },
"canteen_purchase":
{ Args: { "p_institution_id": string,"p_item_id": string,"p_quantity": number,"p_student_id": string }; Returns: Json
                           },
"canteen_topup":
{ Args: { "p_amount_paise": number,"p_institution_id": string,"p_note"?: string,"p_student_id": string }; Returns: Json
                           },
"close_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"close_safety_alert":
{ Args: { "p_alert_id": string,"p_institution_id": string }; Returns: {
              "audience": string,
"closed_at": string | null,
"closed_by": string | null,
"created_at": string,
"created_by": string,
"id": string,
"institution_id": string,
"kind": string,
"message": string,
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "safety_alerts"
        isOneToOne: true
        isSetofReturn: false
      } },
"commit_import_batch":
{ Args: { "p_batch_id": string }; Returns: Json
                           },
"compliance_summary":
{ Args: { "p_institution_id": string }; Returns: {
              "category": string,"item_count": number,"status": string
            }[]
                           },
"compute_mastery":
{ Args: { "p_class_section_id"?: string,"p_institution_id": string,"p_run_at"?: string }; Returns: number
                           },
"compute_mastery_sweep":
{ Args: { "p_institution_id": string,"p_run_at": string }; Returns: number
                           },
"convert_enquiry":
{ Args: { "p_academic_year_id": string,"p_applicant": Json,"p_enquiry_id": string,"p_grade_id": string,"p_guardian": Json,"p_institution_id": string }; Returns: Json
                           },
"correct_attendance":
{ Args: { "p_institution_id": string,"p_new_status": string,"p_reason": string,"p_record_id": string }; Returns: {
              "created_at": string,
"id": string,
"institution_id": string,
"note": string | null,
"session_id": string,
"status": string,
"student_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "attendance_records"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_institution":
{ Args: { "p_name": string,"p_slug": string,"p_timezone"?: string,"p_year_start"?: string }; Returns: string
                           },
"create_institution_with_invite":
{ Args: { "p_code": string,"p_name": string,"p_slug": string }; Returns: {
              "institution_id": string,"slug": string
            }[]
                           },
"create_payment_intent":
{ Args: { "p_amount": number,"p_idempotency_key": string,"p_invoice_id": string,"p_provider": string,"p_provider_order_id": string }; Returns: string
                           },
"create_safety_alert":
{ Args: { "p_audience": string,"p_institution_id": string,"p_kind": string,"p_message": string,"p_section_ids": (string)[],"p_title": string }; Returns: {
              "audience": string,
"closed_at": string | null,
"closed_by": string | null,
"created_at": string,
"created_by": string,
"id": string,
"institution_id": string,
"kind": string,
"message": string,
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "safety_alerts"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_application":
{ Args: { "p_application_id": string,"p_decision": string,"p_institution_id": string,"p_note": string }; Returns: Json
                           },
"decide_concession_award":
{ Args: { "p_award_id": string,"p_decision": string,"p_note"?: string }; Returns: Json
                           },
"decide_insight":
{ Args: { "p_action": string,"p_insight_id": string,"p_note"?: string,"p_reviewer_id"?: string }; Returns: {
              "approval_required": boolean,
"class_section_id": string | null,
"confidence": number,
"created_at": string,
"date_from": string,
"date_to": string,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"dedupe_key": string,
"detector_version": number,
"domain": string,
"entity_id": string | null,
"entity_label": string | null,
"entity_type": string | null,
"evidence": NonNullable<Json>,
"explained_at": string | null,
"explained_by": string | null,
"explanation": Json | null,
"explanation_model": string | null,
"explanation_provider": string | null,
"factors": NonNullable<Json>,
"id": string,
"institution_id": string,
"kind": string,
"pattern": string,
"recommended_actions": (string)[],
"reviewer_id": string | null,
"reviewer_role": string,
"severity": string,
"signal": string,
"sources": (string)[],
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "insights"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_leave":
{ Args: { "p_decision": string,"p_leave_id": string,"p_note"?: string }; Returns: {
              "created_at": string,
"created_by": string,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"end_date": string,
"id": string,
"institution_id": string,
"leave_type": string,
"reason": string,
"staff_id": string,
"start_date": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "leave_requests"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_student_leave":
{ Args: { "p_decision": string,"p_leave_id": string,"p_note"?: string }; Returns: {
              "class_section_id": string,
"created_at": string,
"created_by": string,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"end_date": string,
"id": string,
"institution_id": string,
"reason": string,
"start_date": string,
"status": string,
"student_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "student_leave_requests"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_studio_request":
{ Args: { "p_decision": string,"p_note"?: string,"p_request_id": string }; Returns: {
              "context": NonNullable<Json>,
"created_at": string,
"created_by": string,
"decided_at": string | null,
"decided_by": string | null,
"desired_outcome": string,
"id": string,
"institution_id": string,
"notes": (string)[],
"problem": string,
"proposal": Json | null,
"status": string,
"terms": NonNullable<Json>,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "studio_requests"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_workflow_run":
{ Args: { "p_decision": string,"p_note"?: string,"p_run_id": string }; Returns: {
              "created_at": string,
"cursor_node_id": string | null,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"engine_version": string | null,
"entity_id": string | null,
"finished_at": string | null,
"graph": NonNullable<Json>,
"id": string,
"institution_id": string,
"last_value": number | null,
"pending_decision": string | null,
"requested_by": string | null,
"started_at": string,
"status": string,
"steps": NonNullable<Json>,
"trigger_key": string,
"trigger_kind": string,
"updated_at": string,
"workflow_id": string,
"workflow_version": number
            }
                          SetofOptions: {
        from: "*"
        to: "workflow_runs"
        isOneToOne: true
        isSetofReturn: false
      } },
"duty_staff_options":
{ Args: { "p_institution_id": string }; Returns: {
              "display_name": string,"staff_id": string
            }[]
                           },
"emit_workflow_event":
{ Args: { "p_entity_id": string,"p_event": string,"p_institution_id": string }; Returns: number
                           },
"enqueue_due_forecasts":
{ Args: { "p_now"?: string }; Returns: undefined
                           },
"enqueue_due_late_fees":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_due_reports":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_due_workflows":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_fee_reminders":
{ Args: { "p_institution_id": string,"p_term_id": string }; Returns: Json
                           },
"enqueue_insight_detection":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_invoice_reminders":
{ Args: { "p_institution_id": string,"p_invoice_ids": (string)[] }; Returns: Json
                           },
"enqueue_mastery_compute":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_term_invoices":
{ Args: { "p_grade_id"?: string,"p_institution_id": string,"p_term_id": string }; Returns: Json
                           },
"enrol_applicant":
{ Args: { "p_application_id": string,"p_class_section_id": string,"p_fee_structure_id": string,"p_roll_no": number }; Returns: Json
                           },
"enter_marks":
{ Args: { "p_institution_id": string,"p_paper_id": string,"p_rows": Json }; Returns: Json
                           },
"exam_mark_outliers":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: {
              "class_section_id": string,"details": Json,"exam_paper_id": string,"outlier_type": string,"student_id": string,"subject_id": string
            }[]
                           },
"exam_verification":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"exit_student":
{ Args: { "p_conduct"?: string,"p_destination_school"?: string,"p_kind": string,"p_left_on"?: string,"p_reason": string,"p_student_id": string }; Returns: Json
                           },
"finalize_payroll_run":
{ Args: { "p_run_id": string }; Returns: string
                           },
"finance_collection_report":
{ Args: { "p_academic_year_id": string,"p_group_by"?: string,"p_institution_id": string,"p_term_id"?: string }; Returns: {
              "billed": number,"collected": number,"group_key": string,"group_label": string,"invoice_count": number,"outstanding": number,"payment_count": number,"reversed": number,"sort_order": number
            }[]
                           },
"forecast_attendance_series":
{ Args: { "p_from": string,"p_institution_id": string,"p_to": string }; Returns: {
              "class_section_id": string,"points": Json
            }[]
                           },
"forecast_fee_series":
{ Args: { "p_institution_id": string }; Returns: {
              "billed_paise": number,"collected_paise": number,"name": string,"sequence": number,"starts_on": string,"term_id": string,"window_end": string
            }[]
                           },
"generate_duty_roster":
{ Args: { "p_from": string,"p_institution_id": string,"p_to": string }; Returns: Json
                           },
"generate_invoice":
{ Args: { "p_student_id": string,"p_term_id": string }; Returns: string
                           },
"generate_payroll_run":
{ Args: { "p_institution_id": string,"p_month": string }; Returns: string
                           },
"generate_seating_plan":
{ Args: { "p_exam_id": string,"p_institution_id": string,"p_rooms": Json,"p_slot_start": string }; Returns: {
              "created_at": string,
"exam_id": string,
"exam_name": string,
"generated_by": string | null,
"id": string,
"institution_id": string,
"rooms": NonNullable<Json>,
"seat_count": number,
"section_ids": (string)[],
"slot_start": string,
"superseded_by": string | null,
"updated_at": string,
"version_no": number
            }
                          SetofOptions: {
        from: "*"
        to: "exam_seating_plans"
        isOneToOne: true
        isSetofReturn: false
      } },
"get_public_site":
{ Args: { "p_slug": string }; Returns: {
              "institution_id": string,"institution_name": string,"nav": Json,"theme": Json,"website_id": string
            }[]
                           },
"grade_submission":
{ Args: { "p_feedback"?: string,"p_max_score": number,"p_score": number,"p_submission_id": string }; Returns: {
              "assignment_id": string,
"attempt": number,
"content": Json | null,
"created_at": string,
"feedback": string | null,
"graded_at": string | null,
"graded_by": string | null,
"id": string,
"institution_id": string,
"is_late": boolean,
"max_score": number | null,
"score": number | null,
"status": string,
"student_id": string,
"submitted_at": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "assignment_submissions"
        isOneToOne: true
        isSetofReturn: false
      } },
"house_standings":
{ Args: { "p_institution_id": string }; Returns: {
              "house_id": string,"points": number
            }[]
                           },
"insight_src_admissions":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "open_count": number,"over_14": number,"over_2": number,"over_7": number,"stage": string
            }[]
                           },
"insight_src_attendance":
{ Args: { "p_as_of": string,"p_institution_id": string,"p_student_max_recent_pct": number }; Returns: {
              "base_days": number,"base_denominator": number,"base_present": number,"class_section_id": string,"level": string,"recent_days": number,"recent_denominator": number,"recent_present": number,"section_label": string,"student_id": string
            }[]
                           },
"insight_src_fees":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "concessions_base": number,"concessions_flagged": number,"concessions_recent": number,"overdue_count_now": number,"overdue_count_then": number,"overdue_now": number,"overdue_then": number
            }[]
                           },
"insight_src_marks":
{ Args: { "p_as_of": string,"p_institution_id": string,"p_min_drop_pts": number }; Returns: {
              "class_section_id": string,"last_exam_id": string,"last_pct": number,"last_published_on": string,"prev_exam_id": string,"prev_pct": number,"section_label": string,"student_id": string,"subject_id": string,"subject_name": string
            }[]
                           },
"insight_src_room_capacity":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "class_section_id": string,"section_label": string,"slots_over": number,"smallest_capacity": number,"strength": number,"version_id": string
            }[]
                           },
"insight_src_rooms":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "open_maintenance": number,"periods_total": number,"periods_used": number,"room_id": string,"room_name": string,"version_id": string
            }[]
                           },
"insight_src_submissions":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "awaiting_count": number,"class_section_id": string,"due_count": number,"level": string,"missing_count": number,"oldest_awaiting_days": number,"section_label": string,"student_id": string
            }[]
                           },
"insight_src_workload":
{ Args: { "p_as_of": string,"p_institution_id": string }; Returns: {
              "periods_week": number,"staff_id": string,"version_id": string
            }[]
                           },
"inventory_stock":
{ Args: { "p_institution_id": string }; Returns: {
              "is_active": boolean,"is_low_stock": boolean,"item_id": string,"name": string,"on_hand": number,"reorder_level": number,"unit": string
            }[]
                           },
"invite_member":
{ Args: { "p_email": string,"p_guardian_id"?: string,"p_institution_id": string,"p_role": string,"p_staff_id"?: string,"p_student_id"?: string }; Returns: {
              "invitation_id": string,"token": string
            }[]
                           },
"invoice_instalment_status":
{ Args: { "p_institution_id": string,"p_invoice_id"?: string,"p_term_id"?: string }; Returns: {
              "amount": number,"due_on": string,"invoice_id": string,"paid_amount": number,"seq": number,"status": string
            }[]
                           },
"issue_certificate":
{ Args: { "p_conduct"?: string,"p_kind": string,"p_purpose"?: string,"p_student_id": string }; Returns: Json
                           },
"issue_library_loan":
{ Args: { "p_copy_id": string,"p_staff_id"?: string,"p_student_id"?: string }; Returns: Json
                           },
"jobs_claim":
{ Args: { "p_worker_id": string }; Returns: {
              "attempts": number,
"created_at": string,
"id": string,
"idempotency_key": string,
"institution_id": string | null,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"run_after": string,
"status": string,
"type": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"jobs_complete":
{ Args: { "p_error"?: string,"p_id": string,"p_ok": boolean }; Returns: undefined
                           },
"jobs_requeue":
{ Args: { "p_id": string,"p_institution_id": string }; Returns: {
              "attempts": number,
"created_at": string,
"id": string,
"idempotency_key": string,
"institution_id": string | null,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"run_after": string,
"status": string,
"type": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"join_club":
{ Args: { "p_club_id": string,"p_student_id": string }; Returns: {
              "club_id": string,
"created_at": string,
"id": string,
"institution_id": string,
"joined_by": string,
"student_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "club_members"
        isOneToOne: true
        isSetofReturn: false
      } },
"lab_attendance_marks_correlation":
{ Args: { "p_institution_id": string }; Returns: {
              "avg_attendance_pct": number,"avg_mark_pct": number,"class_section_id": string,"grade": string,"n": number,"pearson_r": number,"section": string,"subject": string,"subject_id": string
            }[]
                           },
"lab_fee_risk_cohorts":
{ Args: { "p_institution_id": string }; Returns: {
              "attendance_band": string,"avg_days_overdue": number,"grade": string,"grade_id": string,"invoices": number,"overdue_invoices": number,"overdue_paise": number,"students": number
            }[]
                           },
"lab_section_anomalies":
{ Args: { "p_institution_id": string }; Returns: {
              "attendance_pct": number,"attendance_z": number,"avg_mark_pct": number,"class_section_id": string,"fee_overdue_rate": number,"fee_overdue_z": number,"grade": string,"mark_z": number,"section": string,"students": number
            }[]
                           },
"lab_trend_breaks":
{ Args: { "p_institution_id": string }; Returns: {
              "class_section_id": string,"delta_pct": number,"grade": string,"is_break": boolean,"prior_pct": number,"prior_weeks": number,"recent_pct": number,"recent_weeks": number,"section": string,"students": number,"weekly_sd": number
            }[]
                           },
"leave_club":
{ Args: { "p_club_id": string,"p_student_id": string }; Returns: undefined
                           },
"ledger_totals":
{ Args: { "p_account"?: string,"p_from": string,"p_institution_id": string,"p_to": string }; Returns: {
              "total_credit": number,"total_debit": number
            }[]
                           },
"ledger_voucher_lines":
{ Args: { "p_from": string,"p_institution_id": string,"p_receipts_only"?: boolean,"p_to": string }; Returns: {
              "account": string,"admission_no": string,"charge_head": string,"credit": number,"debit": number,"entry_date": string,"entry_id": string,"memo": string,"voucher_no": string,"voucher_type": string
            }[]
                           },
"link_guardian":
{ Args: { "p_email"?: string,"p_full_name"?: string,"p_guardian_id"?: string,"p_is_primary"?: boolean,"p_phone"?: string,"p_relationship": string,"p_student_id": string }; Returns: Json
                           },
"mark_period_attendance":
{ Args: { "p_class_section_id": string,"p_date": string,"p_institution_id": string,"p_period_id": string,"p_records": Json }; Returns: {
              "class_section_id": string,
"created_at": string,
"date": string,
"id": string,
"institution_id": string,
"marked_by": string | null,
"period_id": string | null,
"status": string,
"submitted_at": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "attendance_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"mark_safety_headcount":
{ Args: { "p_alert_id": string,"p_class_section_id": string,"p_institution_id": string,"p_missing_count": number,"p_note": string,"p_present_count": number }; Returns: {
              "alert_id": string,
"class_section_id": string,
"created_at": string,
"id": string,
"institution_id": string,
"marked_by": string,
"missing_count": number,
"note": string | null,
"present_count": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "safety_headcounts"
        isOneToOne: true
        isSetofReturn: false
      } },
"mark_thread_read":
{ Args: { "p_thread_id": string }; Returns: number
                           },
"mastery_heatmap":
{ Args: { "p_academic_year_id": string,"p_class_section_id": string,"p_gap_threshold": number,"p_min_confidence": number,"p_subject_id": string }; Returns: {
              "below": number,"class_section_id": string,"curriculum_unit_id": string,"mean_score": number,"students": number,"subject_id": string
            }[]
                           },
"mastery_student_stats":
{ Args: { "p_academic_year_id": string,"p_class_section_id": string,"p_gap_threshold": number,"p_min_confidence": number }; Returns: {
              "class_section_id": string,"confident_units": number,"gap_units": number,"mean_score": number,"student_id": string
            }[]
                           },
"message_thread_names":
{ Args: { "p_thread_ids": (string)[] }; Returns: {
              "guardian_name": string,"teacher_name": string,"thread_id": string
            }[]
                           },
"messageable_teachers":
{ Args: { "p_institution_id": string,"p_student_id": string }; Returns: {
              "full_name": string,"is_class_teacher": boolean,"staff_id": string,"subject_names": (string)[]
            }[]
                           },
"my_open_forms":
{ Args: { "p_institution_id": string }; Returns: {
              "description": string,"fields": Json,"id": string,"published_at": string,"responded": boolean,"student_id": string,"student_name": string,"title": string
            }[]
                           },
"my_open_surveys":
{ Args: { "p_institution_id": string }; Returns: {
              "closes_at": string,"description": string,"id": string,"is_anonymous": boolean,"questions": Json,"responded": boolean,"title": string
            }[]
                           },
"my_upcoming_exam_papers":
{ Args: { "p_days"?: number,"p_student_id": string }; Returns: {
              "duration_minutes": number,"exam_id": string,"exam_name": string,"paper_id": string,"scheduled_at": string,"subject_name": string
            }[]
                           },
"open_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"peek_platform_invite_code":
{ Args: { "p_code": string,"p_email": string }; Returns: boolean
                           },
"promote_students":
{ Args: { "p_exclude"?: (string)[],"p_from_year_id": string,"p_mappings": Json,"p_overrides"?: Json,"p_to_year_id": string }; Returns: Json
                           },
"propose_studio_request":
{ Args: { "p_proposal": Json,"p_request_id": string }; Returns: {
              "context": NonNullable<Json>,
"created_at": string,
"created_by": string,
"decided_at": string | null,
"decided_by": string | null,
"desired_outcome": string,
"id": string,
"institution_id": string,
"notes": (string)[],
"problem": string,
"proposal": Json | null,
"status": string,
"terms": NonNullable<Json>,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "studio_requests"
        isOneToOne: true
        isSetofReturn: false
      } },
"ptm_slots_for_student":
{ Args: { "p_event_id"?: string,"p_student_id": string }; Returns: {
              "booking_closes_at": string,"booking_id": string,"ends_at": string,"event_date": string,"event_id": string,"event_title": string,"is_class_teacher": boolean,"seq": number,"slot_id": string,"staff_id": string,"starts_at": string,"state": string,"subjects": (string)[],"teacher_name": string
            }[]
                           },
"publish_announcement":
{ Args: { "p_announcement_id": string }; Returns: {
              "body": string,
"category": string,
"created_at": string,
"created_by": string,
"id": string,
"institution_id": string,
"published_at": string | null,
"published_by": string | null,
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "announcements"
        isOneToOne: true
        isSetofReturn: false
      } },
"publish_exam_results":
{ Args: { "p_exam_id": string }; Returns: Json
                           },
"publish_page":
{ Args: { "p_page_id": string,"p_version_id": string }; Returns: {
              "created_at": string,
"id": string,
"institution_id": string,
"published_version_id": string | null,
"slug": string,
"title": string,
"updated_at": string,
"website_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "pages"
        isOneToOne: true
        isSetofReturn: false
      } },
"publish_timetable":
{ Args: { "p_version_id": string }; Returns: {
              "academic_year_id": string,
"created_at": string,
"created_by": string,
"id": string,
"institution_id": string,
"name": string,
"published_at": string | null,
"published_by": string | null,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "timetable_versions"
        isOneToOne: true
        isSetofReturn: false
      } },
"raise_helpdesk_ticket":
{ Args: { "p_body": string,"p_category": string,"p_institution_id": string,"p_priority": string,"p_subject": string }; Returns: Json
                           },
"record_audit_event":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_entity_id"?: string,"p_entity_type": string,"p_institution_id": string,"p_metadata"?: Json }; Returns: string
                           },
"record_insight_action":
{ Args: { "p_action": string,"p_actual_outcome"?: string,"p_expected_outcome": string,"p_insight_id": string,"p_owner": string,"p_rationale": string,"p_status"?: string,"p_supersedes_id"?: string }; Returns: {
              "action": string,
"actual_outcome": string | null,
"created_at": string,
"created_by": string,
"decided_at": string,
"expected_outcome": string,
"goal": string | null,
"id": string,
"insight_id": string,
"institution_id": string,
"intervention_status": string | null,
"kind": string,
"measured_at": string | null,
"owner": string,
"owner_staff_id": string | null,
"rationale": string,
"review_date": string | null,
"status": string,
"steps": Json | null,
"student_id": string | null,
"supersedes_id": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "insight_actions"
        isOneToOne: true
        isSetofReturn: false
      } },
"record_insights":
{ Args: { "p_institution_id": string,"p_rows": Json }; Returns: number
                           },
"record_inventory_movement":
{ Args: { "p_institution_id": string,"p_item_id": string,"p_kind": string,"p_note"?: string,"p_quantity": number }; Returns: Json
                           },
"record_online_payment":
{ Args: { "p_amount_paise": number,"p_method": string,"p_order_id": string,"p_provider_payment_id": string }; Returns: Json
                           },
"record_payment":
{ Args: { "p_amount": number,"p_idempotency_key": string,"p_invoice_id": string,"p_mode": string,"p_received_at": string,"p_reference": string }; Returns: Json
                           },
"record_school_start_attempt":
{ Args: { "p_client_hash": string,"p_code": string }; Returns: undefined
                           },
"renew_compliance_item":
{ Args: { "p_document_id": string,"p_institution_id": string,"p_item_id": string,"p_new_due_on": string,"p_note": string,"p_renewed_on": string }; Returns: {
              "authority": string | null,
"category": string,
"created_at": string,
"due_on": string,
"id": string,
"institution_id": string,
"notes": string | null,
"owner_staff_id": string | null,
"reference_no": string | null,
"renew_every_months": number | null,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "compliance_items"
        isOneToOne: true
        isSetofReturn: false
      } },
"renew_library_loan":
{ Args: { "p_loan_id": string }; Returns: Json
                           },
"reopen_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"report_attendance_daily":
{ Args: { "p_as_of": string,"p_day_offset"?: number,"p_institution_id": string }; Returns: {
              "date": string,"denominator": number,"enrolled": number,"grade": string,"marked": number,"percentage": number,"present_weighted": number,"section": string,"session_status": string
            }[]
                           },
"report_fee_defaulters":
{ Args: { "p_as_of": string,"p_institution_id": string,"p_min_days_overdue"?: number }; Returns: {
              "admission_no": string,"days_overdue": number,"due_on": string,"grade": string,"invoice_no": string,"outstanding": string,"section": string,"student": string
            }[]
                           },
"request_duty_swap":
{ Args: { "p_assignment_id": string,"p_to_staff_id": string }; Returns: Json
                           },
"request_recheck":
{ Args: { "p_exam_paper_id": string,"p_institution_id": string,"p_reason": string,"p_result_id": string }; Returns: Json
                           },
"respond_duty_swap":
{ Args: { "p_accept": boolean,"p_request_id": string }; Returns: Json
                           },
"return_library_loan":
{ Args: { "p_loan_id": string,"p_waive_fine"?: boolean }; Returns: Json
                           },
"revoke_invitation":
{ Args: { "p_invitation_id": string }; Returns: undefined
                           },
"save_hostel_roll_call":
{ Args: { "p_entries": Json,"p_institution_id": string,"p_session": string,"p_taken_on": string }; Returns: string
                           },
"school_lab_utilisation":
{ Args: { "p_from": string,"p_institution_id": string,"p_to": string }; Returns: {
              "bookings": number,"lab_id": string,"periods_used": number
            }[]
                           },
"send_message":
{ Args: { "p_body": string,"p_thread_id": string }; Returns: {
              "body": string,
"created_at": string,
"id": string,
"institution_id": string,
"read_at": string | null,
"sender_profile_id": string,
"thread_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "messages"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_duty_assignment":
{ Args: { "p_assignment_id": string,"p_cancel"?: boolean,"p_staff_id"?: string }; Returns: Json
                           },
"set_insight_explanation":
{ Args: { "p_explanation": Json,"p_insight_id": string,"p_model": string,"p_provider": string }; Returns: {
              "approval_required": boolean,
"class_section_id": string | null,
"confidence": number,
"created_at": string,
"date_from": string,
"date_to": string,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"dedupe_key": string,
"detector_version": number,
"domain": string,
"entity_id": string | null,
"entity_label": string | null,
"entity_type": string | null,
"evidence": NonNullable<Json>,
"explained_at": string | null,
"explained_by": string | null,
"explanation": Json | null,
"explanation_model": string | null,
"explanation_provider": string | null,
"factors": NonNullable<Json>,
"id": string,
"institution_id": string,
"kind": string,
"pattern": string,
"recommended_actions": (string)[],
"reviewer_id": string | null,
"reviewer_role": string,
"severity": string,
"signal": string,
"sources": (string)[],
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "insights"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_invoice_instalments":
{ Args: { "p_invoice_id": string,"p_parts": Json }; Returns: number
                           },
"sign_up_club_event":
{ Args: { "p_event_id": string,"p_student_id": string }; Returns: {
              "created_at": string,
"event_id": string,
"id": string,
"institution_id": string,
"signed_up_by": string,
"student_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "club_event_signups"
        isOneToOne: true
        isSetofReturn: false
      } },
"staff_check_in":
{ Args: { "p_institution_id": string }; Returns: {
              "check_in_at": string | null,
"created_at": string,
"date": string,
"id": string,
"institution_id": string,
"marked_by": string | null,
"note": string | null,
"source": string,
"staff_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "staff_attendance"
        isOneToOne: true
        isSetofReturn: false
      } },
"start_message_thread":
{ Args: { "p_body": string,"p_counterpart_id": string,"p_institution_id": string,"p_student_id": string,"p_subject": string }; Returns: {
              "created_at": string,
"created_by": string,
"guardian_id": string,
"id": string,
"institution_id": string,
"last_message_at": string,
"student_id": string,
"subject": string,
"teacher_staff_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "message_threads"
        isOneToOne: true
        isSetofReturn: false
      } },
"start_recheck_review":
{ Args: { "p_institution_id": string,"p_request_id": string }; Returns: Json
                           },
"start_workflow_run":
{ Args: { "p_workflow_id": string }; Returns: string
                           },
"submit_assignment":
{ Args: { "p_answers"?: Json,"p_assignment_id": string,"p_text"?: string }; Returns: {
              "assignment_id": string,
"attempt": number,
"content": Json | null,
"created_at": string,
"feedback": string | null,
"graded_at": string | null,
"graded_by": string | null,
"id": string,
"institution_id": string,
"is_late": boolean,
"max_score": number | null,
"score": number | null,
"status": string,
"student_id": string,
"submitted_at": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "assignment_submissions"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_attendance":
{ Args: { "p_institution_id": string,"p_session_id": string }; Returns: {
              "class_section_id": string,
"created_at": string,
"date": string,
"id": string,
"institution_id": string,
"marked_by": string | null,
"period_id": string | null,
"status": string,
"submitted_at": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "attendance_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_form_response":
{ Args: { "p_answers": Json,"p_form_id": string,"p_student_id": string }; Returns: string
                           },
"submit_platform_lead":
{ Args: { "p_ip_hash": string,"p_payload": Json }; Returns: Json
                           },
"submit_practice_attempt":
{ Args: { "p_answers": Json,"p_curriculum_unit_id": string,"p_difficulty": string,"p_institution_id": string,"p_questions": Json,"p_student_id": string }; Returns: {
              "answers": NonNullable<Json>,
"created_at": string,
"curriculum_unit_id": string,
"difficulty": string,
"id": string,
"institution_id": string,
"max_score": number,
"questions": NonNullable<Json>,
"score": number,
"student_id": string,
"subject_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "practice_attempts"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_public_enquiry":
{ Args: { "p_ip_hash": string,"p_payload": Json,"p_slug": string }; Returns: Json
                           },
"submit_survey_response":
{ Args: { "p_answers": Json,"p_survey_id": string }; Returns: undefined
                           },
"survey_results":
{ Args: { "p_survey_id": string }; Returns: Json
                           },
"sync_alumni":
{ Args: { "p_institution_id": string }; Returns: number
                           },
"term_collection_totals":
{ Args: { "p_institution_id": string,"p_term_id": string }; Returns: {
              "collected": number,"due": number,"invoice_count": number
            }[]
                           },
"update_helpdesk_ticket":
{ Args: { "p_assignee_staff_id": string,"p_institution_id": string,"p_status": string,"p_ticket_id": string }; Returns: Json
                           },
"vacate_hostel_allocation":
{ Args: { "p_allocation_id": string }; Returns: Json
                           },
"verify_achievement":
{ Args: { "p_achievement_id": string,"p_institution_id": string }; Returns: {
              "category": string,
"created_at": string,
"description": string | null,
"event_date": string,
"id": string,
"institution_id": string,
"level": string,
"position": string | null,
"recorded_by": string,
"student_id": string,
"title": string,
"updated_at": string,
"verified_at": string | null,
"verified_by": string | null,
"void_reason": string | null,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "achievements"
        isOneToOne: true
        isSetofReturn: false
      } },
"void_achievement":
{ Args: { "p_achievement_id": string,"p_institution_id": string,"p_reason": string }; Returns: {
              "category": string,
"created_at": string,
"description": string | null,
"event_date": string,
"id": string,
"institution_id": string,
"level": string,
"position": string | null,
"recorded_by": string,
"student_id": string,
"title": string,
"updated_at": string,
"verified_at": string | null,
"verified_by": string | null,
"void_reason": string | null,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "achievements"
        isOneToOne: true
        isSetofReturn: false
      } },
"void_behaviour_incident":
{ Args: { "p_incident_id": string,"p_reason": string }; Returns: {
              "category": string,
"created_at": string,
"id": string,
"institution_id": string,
"note": string | null,
"occurred_on": string,
"points": number,
"reported_by": string,
"severity": string,
"student_id": string,
"updated_at": string,
"void_reason": string | null,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "behaviour_incidents"
        isOneToOne: true
        isSetofReturn: false
      } },
"void_expense":
{ Args: { "p_expense_id": string,"p_reason": string }; Returns: Json
                           },
"void_payment":
{ Args: { "p_idempotency_key": string,"p_kind": string,"p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"workflow_metric":
{ Args: { "p_as_of": string,"p_entity_id": string,"p_institution_id": string,"p_metric": string }; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"storage": {
          Tables: {
            "buckets": {
                  Row: {
                    "allowed_mime_types": (string)[] | null,"avif_autodetection": boolean | null,"created_at": string | null,"file_size_limit": number | null,"id": string,"lifecycle_configuration": Json | null,"lifecycle_configuration_generation": string | null,"name": string,"owner": string | null,"owner_id": string | null,"public": boolean | null,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string | null,"versioning_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_mime_types"?: (string)[] | null,"avif_autodetection"?: boolean | null,"created_at"?: string | null,"file_size_limit"?: number | null,"id": string,"lifecycle_configuration"?: Json | null,"lifecycle_configuration_generation"?: string | null,"name": string,"owner"?: string | null,"owner_id"?: string | null,"public"?: boolean | null,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string | null,"versioning_status"?: string
                  }
                  Update: {
                    "allowed_mime_types"?: (string)[] | null,"avif_autodetection"?: boolean | null,"created_at"?: string | null,"file_size_limit"?: number | null,"id"?: string,"lifecycle_configuration"?: Json | null,"lifecycle_configuration_generation"?: string | null,"name"?: string,"owner"?: string | null,"owner_id"?: string | null,"public"?: boolean | null,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string | null,"versioning_status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"buckets_analytics": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"format": string,"id": string,"name": string,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"format"?: string,"id"?: string,"name": string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"format"?: string,"id"?: string,"name"?: string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"buckets_vectors": {
                  Row: {
                    "created_at": string,"id": string,"type": Database["storage"]['Enums']["buckettype"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"type"?: Database["storage"]['Enums']["buckettype"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"iceberg_namespaces": {
                  Row: {
                    "bucket_name": string,"catalog_id": string,"created_at": string,"id": string,"metadata": NonNullable<Json>,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_name": string,"catalog_id": string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "bucket_name"?: string,"catalog_id"?: string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
      columns: ["catalog_id"]
isOneToOne: false
      referencedRelation: "buckets_analytics"
      referencedColumns: ["id"]
    }
                  ]
                },"iceberg_tables": {
                  Row: {
                    "bucket_name": string,"catalog_id": string,"created_at": string,"id": string,"location": string,"name": string,"namespace_id": string,"remote_table_id": string | null,"shard_id": string | null,"shard_key": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_name": string,"catalog_id": string,"created_at"?: string,"id"?: string,"location": string,"name": string,"namespace_id": string,"remote_table_id"?: string | null,"shard_id"?: string | null,"shard_key"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "bucket_name"?: string,"catalog_id"?: string,"created_at"?: string,"id"?: string,"location"?: string,"name"?: string,"namespace_id"?: string,"remote_table_id"?: string | null,"shard_id"?: string | null,"shard_key"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "iceberg_tables_catalog_id_fkey"
      columns: ["catalog_id"]
isOneToOne: false
      referencedRelation: "buckets_analytics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "iceberg_tables_namespace_id_fkey"
      columns: ["namespace_id"]
isOneToOne: false
      referencedRelation: "iceberg_namespaces"
      referencedColumns: ["id"]
    }
                  ]
                },"migrations": {
                  Row: {
                    "executed_at": string | null,"hash": string,"id": number,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "executed_at"?: string | null,"hash": string,"id": number,"name": string
                  }
                  Update: {
                    "executed_at"?: string | null,"hash"?: string,"id"?: number,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"objects": {
                  Row: {
                    "archived_at": string | null,"bucket_id": string | null,"created_at": string | null,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string | null,"metadata": Json | null,"name": string | null,"owner": string | null,"owner_id": string | null,"path_tokens": (string)[] | null,"updated_at": string | null,"user_metadata": Json | null,"version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"bucket_id"?: string | null,"created_at"?: string | null,"id"?: string,"is_delete_marker"?: boolean,"is_versioned"?: boolean,"last_accessed_at"?: string | null,"metadata"?: Json | null,"name"?: string | null,"owner"?: string | null,"owner_id"?: string | null,"path_tokens"?: never,"updated_at"?: string | null,"user_metadata"?: Json | null,"version"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"bucket_id"?: string | null,"created_at"?: string | null,"id"?: string,"is_delete_marker"?: boolean,"is_versioned"?: boolean,"last_accessed_at"?: string | null,"metadata"?: Json | null,"name"?: string | null,"owner"?: string | null,"owner_id"?: string | null,"path_tokens"?: never,"updated_at"?: string | null,"user_metadata"?: Json | null,"version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "objects_bucketId_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    }
                  ]
                },"s3_multipart_uploads": {
                  Row: {
                    "bucket_id": string,"created_at": string,"id": string,"in_progress_size": number,"key": string,"metadata": Json | null,"owner_id": string | null,"upload_signature": string,"user_metadata": Json | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"id": string,"in_progress_size"?: number,"key": string,"metadata"?: Json | null,"owner_id"?: string | null,"upload_signature": string,"user_metadata"?: Json | null,"version": string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"id"?: string,"in_progress_size"?: number,"key"?: string,"metadata"?: Json | null,"owner_id"?: string | null,"upload_signature"?: string,"user_metadata"?: Json | null,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    }
                  ]
                },"s3_multipart_uploads_parts": {
                  Row: {
                    "bucket_id": string,"created_at": string,"etag": string,"id": string,"key": string,"owner_id": string | null,"part_number": number,"size": number,"upload_id": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"etag": string,"id"?: string,"key": string,"owner_id"?: string | null,"part_number": number,"size"?: number,"upload_id": string,"version": string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"etag"?: string,"id"?: string,"key"?: string,"owner_id"?: string | null,"part_number"?: number,"size"?: number,"upload_id"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
      columns: ["upload_id"]
isOneToOne: false
      referencedRelation: "s3_multipart_uploads"
      referencedColumns: ["id"]
    }
                  ]
                },"vector_indexes": {
                  Row: {
                    "bucket_id": string,"created_at": string,"data_type": string,"dimension": number,"distance_metric": string,"id": string,"metadata_configuration": Json | null,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_id": string,"created_at"?: string,"data_type": string,"dimension": number,"distance_metric": string,"id"?: string,"metadata_configuration"?: Json | null,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"data_type"?: string,"dimension"?: number,"distance_metric"?: string,"id"?: string,"metadata_configuration"?: Json | null,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vector_indexes_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "buckets_vectors"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "allow_any_operation":
{ Args: { "expected_operations": (string)[] }; Returns: boolean
                           },
"allow_only_operation":
{ Args: { "expected_operation": string }; Returns: boolean
                           },
"can_insert_object":
{ Args: { "bucketid": string,"metadata": Json,"name": string,"owner": string }; Returns: undefined
                           },
"extension":
{ Args: { "name": string }; Returns: string
                           },
"filename":
{ Args: { "name": string }; Returns: string
                           },
"foldername":
{ Args: { "name": string }; Returns: (string)[]
                           },
"get_common_prefix":
{ Args: { "p_delimiter": string,"p_key": string,"p_prefix": string }; Returns: string
                           },
"get_size_by_bucket":
{ Args: { "delete_markers"?: string,"noncurrent_versions"?: string }; Returns: {
              "bucket_id": string,"size": number
            }[]
                           },
"list_multipart_uploads_with_delimiter":
{ Args: { "bucket_id": string,"delimiter_param": string,"max_keys"?: number,"next_key_token"?: string,"next_upload_token"?: string,"prefix_param": string,"raw_prefix_param"?: string }; Returns: {
              "created_at": string,"id": string,"key": string
            }[]
                           },
"list_objects_with_delimiter":
{ Args: { "_bucket_id": string,"delete_markers"?: string,"delimiter_param": string,"max_keys"?: number,"next_token"?: string,"next_token_archived_at"?: string,"next_token_version"?: string,"noncurrent_versions"?: string,"prefix_param": string,"sort_order"?: string,"start_after"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"operation":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"search":
{ Args: { "bucketname": string,"delete_markers"?: string,"levels"?: number,"limits"?: number,"noncurrent_versions"?: string,"offsets"?: number,"prefix": string,"search"?: string,"sortcolumn"?: string,"sortorder"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"search_by_timestamp":
{ Args: { "delete_markers"?: string,"noncurrent_versions"?: string,"p_bucket_id": string,"p_level": number,"p_limit": number,"p_prefix": string,"p_sort_column": string,"p_sort_column_after": string,"p_sort_order": string,"p_start_after": string,"p_start_after_version"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"key": string,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           },
"search_v2":
{ Args: { "bucket_name": string,"delete_markers"?: string,"levels"?: number,"limits"?: number,"noncurrent_versions"?: string,"prefix": string,"sort_column"?: string,"sort_column_after"?: string,"sort_order"?: string,"start_after"?: string,"start_after_archived_at"?: string,"start_after_is_continuation"?: boolean,"start_after_version"?: string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"is_delete_marker": boolean,"is_versioned": boolean,"key": string,"last_accessed_at": string,"metadata": Json,"name": string,"updated_at": string,"version": string
            }[]
                           }
          }
          Enums: {
            "buckettype": "STANDARD"|"ANALYTICS"|"VECTOR"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        },"storage": {
          Enums: {
            "buckettype": ["STANDARD", "ANALYTICS", "VECTOR"]
          }
        }
} as const
