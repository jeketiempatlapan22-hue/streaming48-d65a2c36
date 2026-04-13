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
      admin_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      auth_metrics: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          event_type: string
          id: string
          source: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type: string
          id?: string
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type?: string
          id?: string
          source?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      blocked_ips: {
        Row: {
          auto_blocked: boolean
          blocked_at: string
          created_at: string
          id: string
          ip_address: string
          is_active: boolean
          reason: string
          unblocked_at: string | null
          unblocked_by: string | null
          violation_count: number
        }
        Insert: {
          auto_blocked?: boolean
          blocked_at?: string
          created_at?: string
          id?: string
          ip_address: string
          is_active?: boolean
          reason?: string
          unblocked_at?: string | null
          unblocked_by?: string | null
          violation_count?: number
        }
        Update: {
          auto_blocked?: boolean
          blocked_at?: string
          created_at?: string
          id?: string
          ip_address?: string
          is_active?: boolean
          reason?: string
          unblocked_at?: string | null
          unblocked_by?: string | null
          violation_count?: number
        }
        Relationships: []
      }
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
      chat_moderators: {
        Row: {
          created_at: string
          id: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
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
          payment_gateway_order_id: string | null
          payment_proof_url: string | null
          phone: string | null
          price: string | null
          short_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          coin_amount: number
          created_at?: string
          id?: string
          package_id?: string | null
          payment_gateway_order_id?: string | null
          payment_proof_url?: string | null
          phone?: string | null
          price?: string | null
          short_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          coin_amount?: number
          created_at?: string
          id?: string
          package_id?: string | null
          payment_gateway_order_id?: string | null
          payment_proof_url?: string | null
          phone?: string | null
          price?: string | null
          short_id?: string | null
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
      coin_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          reference_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string
          id?: string
          reference_id?: string | null
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          reference_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      landing_descriptions: {
        Row: {
          content: string
          created_at: string
          icon: string
          id: string
          image_url: string | null
          is_active: boolean
          sort_order: number
          text_align: string | null
          title: string
        }
        Insert: {
          content?: string
          created_at?: string
          icon?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort_order?: number
          text_align?: string | null
          title?: string
        }
        Update: {
          content?: string
          created_at?: string
          icon?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort_order?: number
          text_align?: string | null
          title?: string
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
      member_photos: {
        Row: {
          created_at: string
          id: string
          name: string
          photo_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          photo_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          photo_url?: string | null
        }
        Relationships: []
      }
      moderators: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      password_reset_requests: {
        Row: {
          created_at: string
          id: string
          identifier: string
          phone: string
          processed_at: string | null
          secure_token: string | null
          short_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier?: string
          phone?: string
          processed_at?: string | null
          secure_token?: string | null
          short_id?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
          phone?: string
          processed_at?: string | null
          secure_token?: string | null
          short_id?: string
          status?: string
          user_id?: string
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
      rate_limit_violations: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          ip_address: string
          violation_key: string
        }
        Insert: {
          created_at?: string
          endpoint?: string
          id?: string
          ip_address: string
          violation_key?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          ip_address?: string
          violation_key?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          key: string
          request_count: number
          window_start: string
        }
        Insert: {
          key: string
          request_count?: number
          window_start?: string
        }
        Update: {
          key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      referral_claims: {
        Row: {
          claimed_by: string
          created_at: string
          id: string
          referral_code_id: string
        }
        Insert: {
          claimed_by: string
          created_at?: string
          id?: string
          referral_code_id: string
        }
        Update: {
          claimed_by?: string
          created_at?: string
          id?: string
          referral_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_claims_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          reward_coins: number
          user_id: string
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          reward_coins?: number
          user_id: string
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          reward_coins?: number
          user_id?: string
          uses?: number
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          ip_address: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          ip_address?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          severity?: string
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
          external_show_id: string | null
          group_link: string | null
          id: string
          is_active: boolean
          is_order_closed: boolean
          is_replay: boolean
          is_subscription: boolean
          lineup: string | null
          max_subscribers: number
          membership_duration_days: number
          price: string
          qris_image_url: string | null
          qris_price: number
          replay_coin_price: number
          replay_qris_price: number
          schedule_date: string | null
          schedule_time: string | null
          short_id: string | null
          subscription_benefits: string | null
          team: string | null
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
          external_show_id?: string | null
          group_link?: string | null
          id?: string
          is_active?: boolean
          is_order_closed?: boolean
          is_replay?: boolean
          is_subscription?: boolean
          lineup?: string | null
          max_subscribers?: number
          membership_duration_days?: number
          price?: string
          qris_image_url?: string | null
          qris_price?: number
          replay_coin_price?: number
          replay_qris_price?: number
          schedule_date?: string | null
          schedule_time?: string | null
          short_id?: string | null
          subscription_benefits?: string | null
          team?: string | null
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
          external_show_id?: string | null
          group_link?: string | null
          id?: string
          is_active?: boolean
          is_order_closed?: boolean
          is_replay?: boolean
          is_subscription?: boolean
          lineup?: string | null
          max_subscribers?: number
          membership_duration_days?: number
          price?: string
          qris_image_url?: string | null
          qris_price?: number
          replay_coin_price?: number
          replay_qris_price?: number
          schedule_date?: string | null
          schedule_time?: string | null
          short_id?: string | null
          subscription_benefits?: string | null
          team?: string | null
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
          payment_gateway_order_id: string | null
          payment_method: string | null
          payment_proof_url: string | null
          payment_status: string | null
          phone: string | null
          qr_string: string | null
          short_id: string | null
          show_id: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          payment_gateway_order_id?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string | null
          phone?: string | null
          qr_string?: string | null
          short_id?: string | null
          show_id: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          payment_gateway_order_id?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string | null
          phone?: string | null
          qr_string?: string | null
          short_id?: string | null
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
      suspicious_activity_log: {
        Row: {
          activity_type: string
          created_at: string
          description: string
          id: string
          ip_hint: string | null
          metadata: Json | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string
          description?: string
          id?: string
          ip_hint?: string | null
          metadata?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string
          description?: string
          id?: string
          ip_hint?: string | null
          metadata?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_messages: {
        Row: {
          chat_id: number
          created_at: string
          processed: boolean
          raw_update: Json
          text: string | null
          update_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          processed?: boolean
          raw_update?: Json
          text?: string | null
          update_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          processed?: boolean
          raw_update?: Json
          text?: string | null
          update_id?: number
        }
        Relationships: []
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
      user_bans: {
        Row: {
          banned_by: string
          created_at: string
          evidence: Json | null
          id: string
          is_active: boolean
          reason: string
          unbanned_at: string | null
          user_id: string
        }
        Insert: {
          banned_by?: string
          created_at?: string
          evidence?: Json | null
          id?: string
          is_active?: boolean
          reason?: string
          unbanned_at?: string | null
          user_id: string
        }
        Update: {
          banned_by?: string
          created_at?: string
          evidence?: Json | null
          id?: string
          is_active?: boolean
          reason?: string
          unbanned_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      viewer_counts: {
        Row: {
          id: string
          last_seen_at: string
          viewer_key: string
        }
        Insert: {
          id?: string
          last_seen_at?: string
          viewer_key: string
        }
        Update: {
          id?: string
          last_seen_at?: string
          viewer_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_cleanup_chat: { Args: never; Returns: undefined }
      auto_unblock_expired_ips: { Args: never; Returns: undefined }
      change_poll_vote: {
        Args: { _new_option_index: number; _poll_id: string; _voter_id: string }
        Returns: undefined
      }
      check_rate_limit: {
        Args: { _key: string; _max_requests: number; _window_seconds: number }
        Returns: boolean
      }
      claim_referral: { Args: { _code: string }; Returns: Json }
      cleanup_old_logs: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      cleanup_stale_viewers: { Args: never; Returns: undefined }
      confirm_coin_order: { Args: { _order_id: string }; Returns: Json }
      confirm_membership_order: { Args: { _order_id: string }; Returns: Json }
      confirm_regular_order: { Args: { _order_id: string }; Returns: Json }
      create_show_order: {
        Args: {
          _email?: string
          _payment_method?: string
          _payment_proof_url?: string
          _phone: string
          _show_id: string
        }
        Returns: Json
      }
      create_token_session: {
        Args: { _fingerprint: string; _token_code: string; _user_agent: string }
        Returns: Json
      }
      get_ban_info: { Args: { _user_id: string }; Returns: Json }
      get_chat_messages: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          id: string
          is_admin: boolean
          is_deleted: boolean
          is_pinned: boolean
          message: string
          token_id: string
          username: string
        }[]
      }
      get_confirmed_order_count: { Args: { _show_id: string }; Returns: number }
      get_my_password_reset_status: { Args: never; Returns: Json }
      get_or_create_referral_code: { Args: never; Returns: Json }
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
          external_show_id: string | null
          group_link: string | null
          id: string
          is_active: boolean
          is_order_closed: boolean
          is_replay: boolean
          is_subscription: boolean
          lineup: string | null
          max_subscribers: number
          membership_duration_days: number
          price: string
          qris_image_url: string | null
          qris_price: number
          replay_coin_price: number
          replay_qris_price: number
          schedule_date: string | null
          schedule_time: string | null
          short_id: string | null
          subscription_benefits: string | null
          team: string | null
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
      get_purchased_show_passwords: { Args: never; Returns: Json }
      get_safe_playlists: {
        Args: never
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          sort_order: number
          title: string
          type: string
          url: string
        }[]
      }
      get_stream_status: {
        Args: never
        Returns: {
          description: string
          is_live: boolean
          title: string
        }[]
      }
      get_viewer_count: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hash_token: { Args: { _token: string }; Returns: string }
      is_ip_blocked: { Args: { _ip: string }; Returns: boolean }
      is_user_banned: { Args: { _user_id: string }; Returns: boolean }
      parse_show_datetime: {
        Args: { _date: string; _time: string }
        Returns: string
      }
      record_rate_limit_violation: {
        Args: {
          _endpoint: string
          _ip: string
          _threshold?: number
          _violation_key: string
          _window_minutes?: number
        }
        Returns: Json
      }
      redeem_coins_for_membership: {
        Args: { _email: string; _phone: string; _show_id: string }
        Returns: Json
      }
      redeem_coins_for_replay: { Args: { _show_id: string }; Returns: Json }
      redeem_coins_for_token: { Args: { _show_id: string }; Returns: Json }
      release_token_session: {
        Args: { _fingerprint: string; _token_code: string }
        Returns: undefined
      }
      request_password_reset:
        | { Args: { _identifier: string }; Returns: Json }
        | {
            Args: { _identifier: string; _new_password?: string }
            Returns: Json
          }
      self_reset_token_session: {
        Args: { _fingerprint: string; _token_code: string }
        Returns: Json
      }
      validate_token: { Args: { _code: string }; Returns: Json }
      viewer_heartbeat: { Args: { _key: string }; Returns: undefined }
      viewer_leave: { Args: { _key: string }; Returns: undefined }
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
