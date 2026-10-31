
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
            "academic_years": {
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
                },"ai_usage_events": {
                  Row: {
                    "cost_estimate_usd": number,"created_at": string,"error_code": string | null,"feature": string,"id": string,"input_tokens": number,"institution_id": string,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"provider": string,"redactions": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_estimate_usd": number,"created_at"?: string,"error_code"?: string | null,"feature": string,"id"?: string,"input_tokens": number,"institution_id": string,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"provider": string,"redactions"?: number,"user_id"?: string | null
                  }
                  Update: {
                    "cost_estimate_usd"?: number,"created_at"?: string,"error_code"?: string | null,"feature"?: string,"id"?: string,"input_tokens"?: number,"institution_id"?: string,"latency_ms"?: number,"model"?: string,"ok"?: boolean,"output_tokens"?: number,"provider"?: string,"redactions"?: number,"user_id"?: string | null
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
                    "assignment_id": string,"content": Json | null,"created_at": string,"feedback": string | null,"id": string,"institution_id": string,"score": number | null,"student_id": string,"submitted_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"content"?: Json | null,"created_at"?: string,"feedback"?: string | null,"id"?: string,"institution_id": string,"score"?: number | null,"student_id": string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assignment_id"?: string,"content"?: Json | null,"created_at"?: string,"feedback"?: string | null,"id"?: string,"institution_id"?: string,"score"?: number | null,"student_id"?: string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_submissions_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
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
                    "class_section_id": string,"created_at": string,"date": string,"id": string,"institution_id": string,"marked_by": string | null,"status": string,"submitted_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"date": string,"id"?: string,"institution_id": string,"marked_by"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"date"?: string,"id"?: string,"institution_id"?: string,"marked_by"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
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
                    "class_section_id": string,"created_at": string,"exam_id": string,"held_on": string | null,"id": string,"institution_id": string,"max_marks": number,"pass_marks": number,"subject_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_section_id": string,"created_at"?: string,"exam_id": string,"held_on"?: string | null,"id"?: string,"institution_id": string,"max_marks": number,"pass_marks": number,"subject_id": string,"updated_at"?: string
                  }
                  Update: {
                    "class_section_id"?: string,"created_at"?: string,"exam_id"?: string,"held_on"?: string | null,"id"?: string,"institution_id"?: string,"max_marks"?: number,"pass_marks"?: number,"subject_id"?: string,"updated_at"?: string
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
      foreignKeyName: "exam_papers_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "subjects"
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_enquiry_note":
{ Args: { "p_enquiry_id": string,"p_institution_id": string,"p_text": string }; Returns: Json
                           },
"apply_recheck_decision":
{ Args: { "p_decision": string,"p_new_marks": number,"p_note": string,"p_request_id": string }; Returns: Json
                           },
"close_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
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
"decide_application":
{ Args: { "p_application_id": string,"p_decision": string,"p_institution_id": string,"p_note": string }; Returns: Json
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
"exam_verification":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"generate_invoice":
{ Args: { "p_student_id": string,"p_term_id": string }; Returns: string
                           },
"get_public_site":
{ Args: { "p_slug": string }; Returns: {
              "institution_id": string,"institution_name": string,"nav": Json,"theme": Json,"website_id": string
            }[]
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
"open_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
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
"record_audit_event":
{ Args: { "p_action": string,"p_after"?: Json,"p_before"?: Json,"p_entity_id"?: string,"p_entity_type": string,"p_institution_id": string,"p_metadata"?: Json }; Returns: string
                           },
"record_payment":
{ Args: { "p_amount": number,"p_idempotency_key": string,"p_invoice_id": string,"p_mode": string,"p_received_at": string,"p_reference": string }; Returns: Json
                           },
"reopen_marks_entry":
{ Args: { "p_exam_id": string,"p_institution_id": string }; Returns: Json
                           },
"request_recheck":
{ Args: { "p_exam_paper_id": string,"p_institution_id": string,"p_reason": string,"p_result_id": string }; Returns: Json
                           },
"start_recheck_review":
{ Args: { "p_institution_id": string,"p_request_id": string }; Returns: Json
                           },
"submit_attendance":
{ Args: { "p_institution_id": string,"p_session_id": string }; Returns: {
              "class_section_id": string,
"created_at": string,
"date": string,
"id": string,
"institution_id": string,
"marked_by": string | null,
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
"submit_public_enquiry":
{ Args: { "p_ip_hash": string,"p_payload": Json,"p_slug": string }; Returns: Json
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
