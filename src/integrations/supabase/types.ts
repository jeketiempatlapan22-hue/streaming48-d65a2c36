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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          created_at: string
          id: string
          is_admin: boolean
          is_deleted: boolean
          is_pinned: boolean
          message: string
          token_id: string | null
          user_id: string | null
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_admin?: boolean
          is_deleted?: boolean
          is_pinned?: boolean
          message: string
          token_id?: string | null
          user_id?: string | null
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_admin?: boolean
          is_deleted?: boolean
          is_pinned?: boolean
          message?: string
          token_id?: string | null
          user_id?: string | null
          username?: string
        }
        Relationships: []
      }
      coin_balances: {
        Row: {
          balance: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coin_orders: {
        Row: {
          coin_amount: number
          created_at: string
          id: string
          package_id: string | null
          payment_proof_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          coin_amount: number
          created_at?: string
          id?: string
          package_id?: string | null
          payment_proof_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          coin_amount?: number
          created_at?: string
          id?: string
          package_id?: string | null
          payment_proof_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_orders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "coin_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_packages: {
        Row: {
          coin_amount: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          price: string
          qris_image_url: string | null
          sort_order: number
        }
        Insert: {
          coin_amount: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price: string
          qris_image_url?: string | null
          sort_order?: number
        }
        Update: {
          coin_amount?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: string
          qris_image_url?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      live_polls: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          is_active: boolean
          options: Json
          question: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          is_active?: boolean
          options?: Json
          question: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          is_active?: boolean
          options?: Json
          question?: string
        }
        Relationships: []
      }
      playlists: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          sort_order: number
          title: string
          type: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          title: string
          type?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          title?: string
          type?: string
          url?: string
        }
        Relationships: []
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          option_index: number
          poll_id: string
          voter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_index: number
          poll_id: string
          voter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_index?: number
          poll_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "live_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      shows: {
        Row: {
          access_password: string | null
          background_image_url: string | null
          category: string | null
          category_member: string | null
          coin_price: number
          created_at: string
          group_link: string | null
          id: string
          is_active: boolean
          is_order_closed: boolean
          is_replay: boolean
          is_subscription: boolean
          lineup: string | null
          max_subscribers: number
          price: string
          qris_image_url: string | null
          replay_coin_price: number
          schedule_date: string | null
          schedule_time: string | null
          subscription_benefits: string | null
          title: string
          updated_at: string
        }
        Insert: {
          access_password?: string | null
          background_image_url?: string | null
          category?: string | null
          category_member?: string | null
          coin_price?: number
          created_at?: string
          group_link?: string | null
          id?: string
          is_active?: boolean
          is_order_closed?: boolean
          is_replay?: boolean
          is_subscription?: boolean
          lineup?: string | null
          max_subscribers?: number
          price?: string
          qris_image_url?: string | null
          replay_coin_price?: number
          schedule_date?: string | null
          schedule_time?: string | null
          subscription_benefits?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          access_password?: string | null
          background_image_url?: string | null
          category?: string | null
          category_member?: string | null
          coin_price?: number
          created_at?: string
          group_link?: string | null
          id?: string
          is_active?: boolean
          is_order_closed?: boolean
          is_replay?: boolean
          is_subscription?: boolean
          lineup?: string | null
          max_subscribers?: number
          price?: string
          qris_image_url?: string | null
          replay_coin_price?: number
          schedule_date?: string | null
          schedule_time?: string | null
          subscription_benefits?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          id: string
          key: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          value?: string
        }
        Relationships: []
      }
      streams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_live: boolean
          title: string
          type: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_live?: boolean
          title: string
          type: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_live?: boolean
          title?: string
          type?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      subscription_orders: {
        Row: {
          created_at: string
          email: string | null
          id: string
          payment_method: string | null
          payment_proof_url: string | null
          phone: string | null
          show_id: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          payment_method?: string | null
          payment_proof_url?: string | null
          phone?: string | null
          show_id: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          payment_method?: string | null
          payment_proof_url?: string | null
          phone?: string | null
          show_id?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_orders_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "shows"
            referencedColumns: ["id"]
          },
        ]
      }
      token_sessions: {
        Row: {
          created_at: string
          fingerprint: string
          id: string
          is_active: boolean
          last_seen_at: string
          token_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          fingerprint: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          token_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          fingerprint?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          token_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_sessions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          code: string
          created_at: string
          duration_type: string | null
          expires_at: string | null
          id: string
          is_public: boolean | null
          max_devices: number
          show_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          duration_type?: string | null
          expires_at?: string | null
          id?: string
          is_public?: boolean | null
          max_devices?: number
          show_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          duration_type?: string | null
          expires_at?: string | null
          id?: string
          is_public?: boolean | null
          max_devices?: number
          show_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tokens_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "shows"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_coin_order: { Args: { _order_id: string }; Returns: Json }
      create_token_session: {
        Args: { _fingerprint: string; _token_code: string; _user_agent: string }
        Returns: Json
      }
      get_order_count: { Args: { _show_id: string }; Returns: number }
      get_public_shows: {
        Args: never
        Returns: {
          access_password: string | null
          background_image_url: string | null
          category: string | null
          category_member: string | null
          coin_price: number
          created_at: string
          group_link: string | null
          id: string
          is_active: boolean
          is_order_closed: boolean
          is_replay: boolean
          is_subscription: boolean
          lineup: string | null
          max_subscribers: number
          price: string
          qris_image_url: string | null
          replay_coin_price: number
          schedule_date: string | null
          schedule_time: string | null
          subscription_benefits: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      redeem_coins_for_membership: {
        Args: { _email: string; _phone: string; _show_id: string }
        Returns: Json
      }
      redeem_coins_for_token: { Args: { _show_id: string }; Returns: Json }
      release_token_session: {
        Args: { _fingerprint: string; _token_code: string }
        Returns: undefined
      }
      validate_token: { Args: { _code: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
