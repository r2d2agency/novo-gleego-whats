export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      group_secretary_config: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          auto_reply_enabled: boolean | null
          auto_reply_message: string | null
          connection_ids: string[] | null
          create_crm_task: boolean | null
          created_at: string | null
          daily_digest_enabled: boolean | null
          daily_digest_hour: number | null
          daily_digest_minute: number | null
          daily_digest_type: string | null
          default_connection_id: string | null
          excluded_senders: string[] | null
          followup_enabled: boolean | null
          followup_hours: number | null
          group_jids: string[] | null
          id: string
          is_active: boolean | null
          min_confidence: number | null
          notify_external_enabled: boolean | null
          notify_external_phone: string | null
          notify_members_whatsapp: boolean | null
          organization_id: string
          show_popup_alert: boolean | null
          updated_at: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          auto_reply_enabled?: boolean | null
          auto_reply_message?: string | null
          connection_ids?: string[] | null
          create_crm_task?: boolean | null
          created_at?: string | null
          daily_digest_enabled?: boolean | null
          daily_digest_hour?: number | null
          daily_digest_minute?: number | null
          daily_digest_type?: string | null
          default_connection_id?: string | null
          excluded_senders?: string[] | null
          followup_enabled?: boolean | null
          followup_hours?: number | null
          group_jids?: string[] | null
          id?: string
          is_active?: boolean | null
          min_confidence?: number | null
          notify_external_enabled?: boolean | null
          notify_external_phone?: string | null
          notify_members_whatsapp?: boolean | null
          organization_id: string
          show_popup_alert?: boolean | null
          updated_at?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          auto_reply_enabled?: boolean | null
          auto_reply_message?: string | null
          connection_ids?: string[] | null
          create_crm_task?: boolean | null
          created_at?: string | null
          daily_digest_enabled?: boolean | null
          daily_digest_hour?: number | null
          daily_digest_minute?: number | null
          daily_digest_type?: string | null
          default_connection_id?: string | null
          excluded_senders?: string[] | null
          followup_enabled?: boolean | null
          followup_hours?: number | null
          group_jids?: string[] | null
          id?: string
          is_active?: boolean | null
          min_confidence?: number | null
          notify_external_enabled?: boolean | null
          notify_external_phone?: string | null
          notify_members_whatsapp?: boolean | null
          organization_id?: string
          show_popup_alert?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      meta_oauth_connections: {
        Row: {
          access_token: string
          created_at: string
          fb_user_id: string | null
          id: string
          metadata: Json | null
          organization_id: string
          provider: string
          scopes: string[] | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          fb_user_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          provider: string
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          fb_user_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          provider?: string
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meta_pages: {
        Row: {
          created_at: string
          external_id: string
          external_name: string | null
          id: string
          kind: string
          metadata: Json | null
          oauth_connection_id: string | null
          organization_id: string
          page_access_token: string | null
          phone_number: string | null
          status: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          created_at?: string
          external_id: string
          external_name?: string | null
          id?: string
          kind: string
          metadata?: Json | null
          oauth_connection_id?: string | null
          organization_id: string
          page_access_token?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string
          external_name?: string | null
          id?: string
          kind?: string
          metadata?: Json | null
          oauth_connection_id?: string | null
          organization_id?: string
          page_access_token?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_pages_oauth_connection_id_fkey"
            columns: ["oauth_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_oauth_connections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
