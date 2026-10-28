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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: number
          is_maintenance: boolean | null
          maintenance_message: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          is_maintenance?: boolean | null
          maintenance_message?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          is_maintenance?: boolean | null
          maintenance_message?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      banned_users: {
        Row: {
          auto: boolean
          banned_at: string
          banned_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_permanent: boolean
          kind: string
          reason: string | null
          report_count: number | null
          user_id: string | null
          username: string
        }
        Insert: {
          auto?: boolean
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          kind?: string
          reason?: string | null
          report_count?: number | null
          user_id?: string | null
          username: string
        }
        Update: {
          auto?: boolean
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          kind?: string
          reason?: string | null
          report_count?: number | null
          user_id?: string | null
          username?: string
        }
        Relationships: []
      }
      banned_words: {
        Row: {
          created_at: string
          id: string
          severity: string
          word: string
        }
        Insert: {
          created_at?: string
          id?: string
          severity?: string
          word: string
        }
        Update: {
          created_at?: string
          id?: string
          severity?: string
          word?: string
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_username: string
          blocker_id: string
          blocker_username: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_username: string
          blocker_id: string
          blocker_username: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_username?: string
          blocker_id?: string
          blocker_username?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          gif_url: string | null
          id: string
          parent_id: string | null
          username: string
          video_id: string
        }
        Insert: {
          body: string
          created_at?: string
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          username: string
          video_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          username?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          created_at: string
          from_id: string | null
          from_username: string
          id: string
          message: string
          to_id: string | null
          to_username: string
        }
        Insert: {
          created_at?: string
          from_id?: string | null
          from_username: string
          id?: string
          message: string
          to_id?: string | null
          to_username: string
        }
        Update: {
          created_at?: string
          from_id?: string | null
          from_username?: string
          id?: string
          message?: string
          to_id?: string | null
          to_username?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string | null
          follower_username: string
          following_username: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id?: string | null
          follower_username: string
          following_username: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string | null
          follower_username?: string
          following_username?: string
          id?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          device_id: string | null
          user_id: string | null
          video_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          user_id?: string | null
          video_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          user_id?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          created_at: string | null
          id: string
          message: string | null
          receiver_id: string | null
          sender_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message?: string | null
          receiver_id?: string | null
          sender_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string | null
          receiver_id?: string | null
          sender_id?: string | null
        }
        Relationships: []
      }
      muted_words: {
        Row: {
          id: string
          word: string
        }
        Insert: {
          id?: string
          word: string
        }
        Update: {
          id?: string
          word?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_user_id: string | null
          created_at: string | null
          id: string
          read: boolean | null
          target_user_id: string | null
          text: string | null
          type: string | null
          video_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          target_user_id?: string | null
          text?: string | null
          type?: string | null
          video_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          target_user_id?: string | null
          text?: string | null
          type?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          handle: string
          id: string
          links: Json
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle: string
          id: string
          links?: Json
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string
          id?: string
          links?: Json
        }
        Relationships: []
      }
      reports: {
        Row: {
          action_taken: string | null
          auto_actioned: boolean
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_user_id: string | null
          reported_username: string
          reported_video_id: string | null
          reporter_id: string
          reporter_username: string
          status: string
          video_id: string | null
        }
        Insert: {
          action_taken?: string | null
          auto_actioned?: boolean
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_user_id?: string | null
          reported_username: string
          reported_video_id?: string | null
          reporter_id: string
          reporter_username: string
          status?: string
          video_id?: string | null
        }
        Update: {
          action_taken?: string | null
          auto_actioned?: boolean
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_user_id?: string | null
          reported_username?: string
          reported_video_id?: string | null
          reporter_id?: string
          reporter_username?: string
          status?: string
          video_id?: string | null
        }
        Relationships: []
      }
      reposts: {
        Row: { created_at: string; id: string; user_id: string; video_id: string }
        Insert: { created_at?: string; id?: string; user_id: string; video_id: string }
        Update: { created_at?: string; id?: string; user_id?: string; video_id?: string }
        Relationships: [
          {
            foreignKeyName: "reposts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          media_type: string
          media_url: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          media_type?: string
          media_url: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          media_type?: string
          media_url?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      story_likes: {
        Row: { created_at: string; id: string; story_id: string; user_id: string }
        Insert: { created_at?: string; id?: string; story_id: string; user_id: string }
        Update: { created_at?: string; id?: string; story_id?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "story_likes_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_videos: {
        Row: { created_at: string; user_id: string; video_id: string }
        Insert: { created_at?: string; user_id: string; video_id: string }
        Update: { created_at?: string; user_id?: string; video_id?: string }
        Relationships: [
          {
            foreignKeyName: "saved_videos_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          caption: string
          comments_count: number
          created_at: string
          hidden: boolean
          hidden_reason: string | null
          id: string
          likes_count: number
          reposts_count: number
          shares_count: number
          user_id: string | null
          username: string
          video_url: string
        }
        Insert: {
          caption?: string
          comments_count?: number
          created_at?: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          likes_count?: number
          reposts_count?: number
          shares_count?: number
          user_id?: string | null
          username: string
          video_url: string
        }
        Update: {
          caption?: string
          comments_count?: number
          created_at?: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          likes_count?: number
          reposts_count?: number
          shares_count?: number
          user_id?: string | null
          username?: string
          video_url?: string
        }
        Relationships: []
      }
      moderation_log: {
        Row: {
          action: string
          actor: string | null
          auto: boolean
          created_at: string
          expires_at: string | null
          id: string
          is_permanent: boolean
          reason: string | null
          report_count: number | null
          user_id: string | null
          username: string | null
          window_hours: number | null
        }
        Insert: {
          action: string
          actor?: string | null
          auto?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          reason?: string | null
          report_count?: number | null
          user_id?: string | null
          username?: string | null
          window_hours?: number | null
        }
        Update: {
          action?: string
          actor?: string | null
          auto?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          is_permanent?: boolean
          reason?: string | null
          report_count?: number | null
          user_id?: string | null
          username?: string | null
          window_hours?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_status: {
        Args: never
        Returns: {
          is_maintenance: boolean
          maintenance_message: string | null
          updated_at: string | null
        }[]
      }
      set_app_status: {
        Args: { _maintenance: boolean; _message?: string | null }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_share: { Args: { _video_id: string }; Returns: undefined }
      is_banned: { Args: { _username: string }; Returns: boolean }
      is_banned_uid: { Args: { _uid: string }; Returns: boolean }
      ban_status_for_handle: {
        Args: { _handle: string }
        Returns: {
          is_banned: boolean
          reason: string
          is_permanent: boolean
          expires_at: string
        }[]
      }
      is_banned_username: { Args: { _username: string }; Returns: boolean }
      is_muted: { Args: { _username: string }; Returns: boolean }
      contains_banned_word: { Args: { _text: string }; Returns: boolean }
      am_i_admin: { Args: never; Returns: boolean }
      apply_moderation: {
        Args: {
          _user_id: string | null
          _username: string
          _action: string
          _reason: string
          _hours?: number | null
          _permanent?: boolean
          _kind?: string
          _auto?: boolean
          _actor?: string
          _report_count?: number | null
          _window_hours?: number | null
        }
        Returns: Json
      }
      report_content: {
        Args: { _video_id: string | null; _reported_username: string; _reason: string; _details?: string | null }
        Returns: Json
      }
      admin_reports: {
        Args: { _limit?: number }
        Returns: {
          id: string
          video_id: string | null
          reported_video_id: string | null
          reporter_username: string
          reported_username: string
          reported_user_id: string | null
          reason: string
          details: string | null
          status: string
          action_taken: string | null
          created_at: string
        }[]
      }
      admin_bans: {
        Args: never
        Returns: {
          id: string
          username: string
          user_id: string | null
          reason: string | null
          banned_by: string | null
          kind: string
          is_permanent: boolean
          expires_at: string | null
          auto: boolean
          report_count: number | null
          created_at: string
          active: boolean
        }[]
      }
      admin_moderation_log: {
        Args: { _limit?: number }
        Returns: {
          id: string
          username: string | null
          action: string
          reason: string | null
          report_count: number | null
          is_permanent: boolean
          expires_at: string | null
          auto: boolean
          actor: string | null
          created_at: string
        }[]
      }
      admin_ban: {
        Args: { _username: string; _hours?: number | null; _permanent?: boolean; _reason?: string }
        Returns: Json
      }
      admin_unban: { Args: { _username: string }; Returns: Json }
      admin_dismiss_report: { Args: { _report_id: string }; Returns: Json }
      admin_unhide_video: { Args: { _video_id: string }; Returns: Json }
      my_ban_status: {
        Args: never
        Returns: {
          is_banned: boolean
          reason: string
          is_permanent: boolean
          expires_at: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
