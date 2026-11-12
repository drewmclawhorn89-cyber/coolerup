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
      beta_features: {
        Row: {
          enabled: boolean
          feature_name: string
          id: string
          tested_by: string | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          feature_name: string
          id?: string
          tested_by?: string | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          feature_name?: string
          id?: string
          tested_by?: string | null
          updated_at?: string
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
      coin_cashouts: {
        Row: {
          amount_cents: number
          coins: number
          created_at: string
          diamonds: number
          id: string
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          coins: number
          created_at?: string
          diamonds: number
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          coins?: number
          created_at?: string
          diamonds?: number
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_cashouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_purchases: {
        Row: {
          amount_cents: number
          coins: number
          created_at: string
          id: string
          pack_id: string
          paid_at: string | null
          status: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          coins: number
          created_at?: string
          id?: string
          pack_id: string
          paid_at?: string | null
          status?: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          coins?: number
          created_at?: string
          id?: string
          pack_id?: string
          paid_at?: string | null
          status?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_venmo_orders: {
        Row: {
          admin_note: string | null
          amount_cents: number
          coins: number
          created_at: string
          id: string
          pack_id: string
          payer_handle: string | null
          reference_code: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
          venmo_note: string | null
        }
        Insert: {
          admin_note?: string | null
          amount_cents: number
          coins: number
          created_at?: string
          id?: string
          pack_id: string
          payer_handle?: string | null
          reference_code: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
          venmo_note?: string | null
        }
        Update: {
          admin_note?: string | null
          amount_cents?: number
          coins?: number
          created_at?: string
          id?: string
          pack_id?: string
          payer_handle?: string | null
          reference_code?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          venmo_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coin_venmo_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string
          gif_credit: string | null
          gif_url: string | null
          id: string
          parent_id: string | null
          username: string
          video_id: string
        }
        Insert: {
          body: string
          created_at?: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          username: string
          video_id: string
        }
        Update: {
          body?: string
          created_at?: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          username?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_fund_earnings: {
        Row: {
          amount: number
          created_at: string
          earnings: number
          id: string
          milestone_views: number
          user_id: string
          video_id: string | null
          views: number
        }
        Insert: {
          amount: number
          created_at?: string
          earnings?: number
          id?: string
          milestone_views: number
          user_id: string
          video_id?: string | null
          views?: number
        }
        Update: {
          amount?: number
          created_at?: string
          earnings?: number
          id?: string
          milestone_views?: number
          user_id?: string
          video_id?: string | null
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "creator_fund_earnings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_fund_earnings_video_id_fkey"
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
          gif_credit: string | null
          gif_url: string | null
          id: string
          message: string
          to_id: string | null
          to_username: string
        }
        Insert: {
          created_at?: string
          from_id?: string | null
          from_username: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          message: string
          to_id?: string | null
          to_username: string
        }
        Update: {
          created_at?: string
          from_id?: string | null
          from_username?: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          message?: string
          to_id?: string | null
          to_username?: string
        }
        Relationships: []
      }
      follower_rewards: {
        Row: {
          claimed: boolean
          created_at: string
          follower_count: number
          id: string
          notified: boolean
          paid_at: string | null
          paid_by: string | null
          payout_method: string | null
          payout_note: string | null
          payout_requested_at: string | null
          payout_venmo_handle: string | null
          reward_amount: number
          user_id: string
          username: string | null
        }
        Insert: {
          claimed?: boolean
          created_at?: string
          follower_count?: number
          id?: string
          notified?: boolean
          paid_at?: string | null
          paid_by?: string | null
          payout_method?: string | null
          payout_note?: string | null
          payout_requested_at?: string | null
          payout_venmo_handle?: string | null
          reward_amount?: number
          user_id: string
          username?: string | null
        }
        Update: {
          claimed?: boolean
          created_at?: string
          follower_count?: number
          id?: string
          notified?: boolean
          paid_at?: string | null
          paid_by?: string | null
          payout_method?: string | null
          payout_note?: string | null
          payout_requested_at?: string | null
          payout_venmo_handle?: string | null
          reward_amount?: number
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follower_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      full_video_comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_video_comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "full_video_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      full_video_comments: {
        Row: {
          body: string
          created_at: string
          gif_credit: string | null
          gif_url: string | null
          id: string
          parent_id: string | null
          user_id: string | null
          username: string
          video_id: string
        }
        Insert: {
          body: string
          created_at?: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          user_id?: string | null
          username: string
          video_id: string
        }
        Update: {
          body?: string
          created_at?: string
          gif_credit?: string | null
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          user_id?: string | null
          username?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_video_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "full_video_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "full_video_comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "full_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      full_video_likes: {
        Row: {
          created_at: string
          id: string
          reaction: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reaction: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reaction?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "full_video_likes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "full_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      full_videos: {
        Row: {
          category: string
          created_at: string
          description: string
          duration: number
          id: string
          is_youtube: boolean
          status: string
          tags: string[]
          thumbnail_url: string | null
          title: string
          user_id: string
          username: string
          video_1080_url: string | null
          video_480_url: string | null
          video_720_url: string | null
          video_url: string
          views: number
          youtube_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          duration?: number
          id?: string
          is_youtube?: boolean
          status?: string
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          user_id: string
          username: string
          video_1080_url?: string | null
          video_480_url?: string | null
          video_720_url?: string | null
          video_url: string
          views?: number
          youtube_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          duration?: number
          id?: string
          is_youtube?: boolean
          status?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          user_id?: string
          username?: string
          video_1080_url?: string | null
          video_480_url?: string | null
          video_720_url?: string | null
          video_url?: string
          views?: number
          youtube_id?: string | null
        }
        Relationships: []
      }
      gif_reports: {
        Row: {
          created_at: string
          gif_id: string
          id: string
          reason: string
          reporter_id: string | null
        }
        Insert: {
          created_at?: string
          gif_id: string
          id?: string
          reason?: string
          reporter_id?: string | null
        }
        Update: {
          created_at?: string
          gif_id?: string
          id?: string
          reason?: string
          reporter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gif_reports_gif_id_fkey"
            columns: ["gif_id"]
            isOneToOne: false
            referencedRelation: "gifs"
            referencedColumns: ["id"]
          },
        ]
      }
      gifs: {
        Row: {
          created_at: string
          gif_url: string
          id: string
          is_public: boolean
          source_video_id: string | null
          title: string
          use_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          gif_url: string
          id?: string
          is_public?: boolean
          source_video_id?: string | null
          title?: string
          use_count?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          gif_url?: string
          id?: string
          is_public?: boolean
          source_video_id?: string | null
          title?: string
          use_count?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gifs_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_card_orders: {
        Row: {
          amount_cents: number
          card_id: string
          card_name: string
          code: string | null
          created_at: string
          id: string
          payment_intent_id: string | null
          provider_order_id: string | null
          recipient_email: string
          redemption_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          card_id: string
          card_name: string
          code?: string | null
          created_at?: string
          id?: string
          payment_intent_id?: string | null
          provider_order_id?: string | null
          recipient_email: string
          redemption_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          card_id?: string
          card_name?: string
          code?: string | null
          created_at?: string
          id?: string
          payment_intent_id?: string | null
          provider_order_id?: string | null
          recipient_email?: string
          redemption_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      gift_claims: {
        Row: {
          amount: number
          coins: number
          created_at: string
          diamonds: number
          gift: string | null
          gift_id: string
          id: string
          user_id: string
        }
        Insert: {
          amount?: number
          coins?: number
          created_at?: string
          diamonds?: number
          gift?: string | null
          gift_id: string
          id?: string
          user_id: string
        }
        Update: {
          amount?: number
          coins?: number
          created_at?: string
          diamonds?: number
          gift?: string | null
          gift_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_join_requests: {
        Row: {
          created_at: string
          group_id: string
          id: string
          status: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          status?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          status?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_join_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
          username: string | null
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
          username?: string | null
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "group_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      group_posts: {
        Row: {
          caption: string | null
          created_at: string
          group_id: string
          id: string
          image_url: string | null
          likes: number
          user_id: string
          username: string | null
          video_url: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          group_id: string
          id?: string
          image_url?: string | null
          likes?: number
          user_id: string
          username?: string | null
          video_url?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          group_id?: string
          id?: string
          image_url?: string | null
          likes?: number
          user_id?: string
          username?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          avatar_image: string | null
          cover_image: string | null
          created_at: string
          creator_id: string
          creator_username: string | null
          description: string | null
          id: string
          members_count: number
          name: string
          privacy: string
        }
        Insert: {
          avatar_image?: string | null
          cover_image?: string | null
          created_at?: string
          creator_id: string
          creator_username?: string | null
          description?: string | null
          id?: string
          members_count?: number
          name: string
          privacy?: string
        }
        Update: {
          avatar_image?: string | null
          cover_image?: string | null
          created_at?: string
          creator_id?: string
          creator_username?: string | null
          description?: string | null
          id?: string
          members_count?: number
          name?: string
          privacy?: string
        }
        Relationships: []
      }
      gta6_badges: {
        Row: {
          awarded_at: string
          handle: string
        }
        Insert: {
          awarded_at?: string
          handle: string
        }
        Update: {
          awarded_at?: string
          handle?: string
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
      live_gifts: {
        Row: {
          coins: number | null
          created_at: string | null
          diamonds: number | null
          gift_type: string | null
          id: string
          live_id: string | null
          quantity: number | null
          receiver_id: string | null
          sender_id: string | null
        }
        Insert: {
          coins?: number | null
          created_at?: string | null
          diamonds?: number | null
          gift_type?: string | null
          id?: string
          live_id?: string | null
          quantity?: number | null
          receiver_id?: string | null
          sender_id?: string | null
        }
        Update: {
          coins?: number | null
          created_at?: string | null
          diamonds?: number | null
          gift_type?: string | null
          id?: string
          live_id?: string | null
          quantity?: number | null
          receiver_id?: string | null
          sender_id?: string | null
        }
        Relationships: []
      }
      live_guests: {
        Row: {
          id: string
          is_active: boolean
          joined_at: string
          live_id: string
          user_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          joined_at?: string
          live_id: string
          user_id: string
        }
        Update: {
          id?: string
          is_active?: boolean
          joined_at?: string
          live_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_guests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_join_requests: {
        Row: {
          created_at: string
          id: string
          live_id: string
          requester_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          live_id: string
          requester_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          live_id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_join_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_mods: {
        Row: {
          added_by: string
          created_at: string
          id: string
          live_id: string
          user_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          live_id: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          live_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_mods_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_mods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_mutes: {
        Row: {
          created_at: string
          id: string
          live_id: string
          muted_by: string
          until: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          live_id: string
          muted_by: string
          until?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          live_id?: string
          muted_by?: string
          until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_mutes_muted_by_fkey"
            columns: ["muted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_room_state: {
        Row: {
          comments_off: boolean
          live_id: string
          pinned: Json | null
          updated_at: string
        }
        Insert: {
          comments_off?: boolean
          live_id: string
          pinned?: Json | null
          updated_at?: string
        }
        Update: {
          comments_off?: boolean
          live_id?: string
          pinned?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          location: string | null
          price: number
          seller_username: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          location?: string | null
          price: number
          seller_username: string
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          location?: string | null
          price?: number
          seller_username?: string
          title?: string
          user_id?: string
        }
        Relationships: []
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
      payouts: {
        Row: {
          amount: number
          destination: string | null
          diamonds: number
          id: string
          method: string
          note: string | null
          paid_at: string | null
          paid_by: string | null
          requested_at: string
          status: string
          user_id: string
          username: string | null
        }
        Insert: {
          amount: number
          destination?: string | null
          diamonds?: number
          id?: string
          method?: string
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          requested_at?: string
          status?: string
          user_id: string
          username?: string | null
        }
        Update: {
          amount?: number
          destination?: string | null
          diamonds?: number
          id?: string
          method?: string
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          requested_at?: string
          status?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          created_at: string
          display_name: string | null
          handle: string
          id: string
          links: Json
          onboarding_complete: boolean
          show_liked: boolean
          username: string | null
          venmo_handle: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          display_name?: string | null
          handle: string
          id: string
          links?: Json
          onboarding_complete?: boolean
          show_liked?: boolean
          username?: string | null
          venmo_handle?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string
          id?: string
          links?: Json
          onboarding_complete?: boolean
          show_liked?: boolean
          username?: string | null
          venmo_handle?: string | null
        }
        Relationships: []
      }
      push_config: {
        Row: {
          created_at: string
          id: string
          private_key: string
          public_key: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          private_key: string
          public_key: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          private_key?: string
          public_key?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      redeemed_codes: {
        Row: {
          code: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          code: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          code?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "redeemed_codes_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "subscription_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "redeemed_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Row: {
          created_at: string
          id: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          video_id?: string
        }
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
      reserved_usernames: {
        Row: {
          reason: string | null
          username: string
        }
        Insert: {
          reason?: string | null
          username: string
        }
        Update: {
          reason?: string | null
          username?: string
        }
        Relationships: []
      }
      saved_full_videos: {
        Row: {
          created_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_full_videos_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "full_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_videos: {
        Row: {
          created_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
          video_id?: string
        }
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
      saved_sounds: {
        Row: {
          created_at: string
          sound_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          sound_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          sound_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_sounds_sound_id_fkey"
            columns: ["sound_id"]
            isOneToOne: false
            referencedRelation: "sounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_sounds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_history: {
        Row: {
          created_at: string
          id: string
          query: string
          query_key: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          query_key?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          query_key?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sounds: {
        Row: {
          audio_url: string
          created_at: string
          creator_username: string
          id: string
          original_video_id: string | null
          title: string
          uses_count: number
        }
        Insert: {
          audio_url: string
          created_at?: string
          creator_username: string
          id?: string
          original_video_id?: string | null
          title: string
          uses_count?: number
        }
        Update: {
          audio_url?: string
          created_at?: string
          creator_username?: string
          id?: string
          original_video_id?: string | null
          title?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sounds_original_video_id_fkey"
            columns: ["original_video_id"]
            isOneToOne: true
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
          likes_count: number
          media_type: string
          media_url: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          likes_count?: number
          media_type?: string
          media_url: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          likes_count?: number
          media_type?: string
          media_url?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      story_likes: {
        Row: {
          created_at: string
          id: string
          story_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          story_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          story_id?: string
          user_id?: string
        }
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
      subscription_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          max_uses: number
          months: number
          plan: string
          uses_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          max_uses?: number
          months: number
          plan: string
          uses_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          max_uses?: number
          months?: number
          plan?: string
          uses_count?: number
        }
        Relationships: []
      }
      user_balance: {
        Row: {
          diamonds: number
          real_balance: number
          total_earned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          diamonds?: number
          real_balance?: number
          total_earned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          diamonds?: number
          real_balance?: number
          total_earned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_balance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_coins: {
        Row: {
          balance: number
          diamonds: number
          last_gift_id: string | null
          paid_balance: number
          total_earned: number
          total_recharged: number
          total_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          diamonds?: number
          last_gift_id?: string | null
          paid_balance?: number
          total_earned?: number
          total_recharged?: number
          total_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          diamonds?: number
          last_gift_id?: string | null
          paid_balance?: number
          total_earned?: number
          total_recharged?: number
          total_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_coins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
      video_views: {
        Row: {
          created_at: string
          id: string
          user_id: string
          video_id: string
          viewer_id: string | null
          views: number
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          video_id: string
          viewer_id?: string | null
          views?: number
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          video_id?: string
          viewer_id?: string | null
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          quality: string
          reposts_count: number
          shares_count: number
          sound_id: string | null
          user_id: string | null
          username: string
          video_1080_url: string | null
          video_360_url: string | null
          video_480_url: string | null
          video_720_url: string | null
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
          quality?: string
          reposts_count?: number
          shares_count?: number
          sound_id?: string | null
          user_id?: string | null
          username: string
          video_1080_url?: string | null
          video_360_url?: string | null
          video_480_url?: string | null
          video_720_url?: string | null
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
          quality?: string
          reposts_count?: number
          shares_count?: number
          sound_id?: string | null
          user_id?: string | null
          username?: string
          video_1080_url?: string | null
          video_360_url?: string | null
          video_480_url?: string | null
          video_720_url?: string | null
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_sound_id_fkey"
            columns: ["sound_id"]
            isOneToOne: false
            referencedRelation: "sounds"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_cache: {
        Row: {
          cached_at: string
          expires_at: string
          query: string
          videos: Json
        }
        Insert: {
          cached_at?: string
          expires_at: string
          query: string
          videos?: Json
        }
        Update: {
          cached_at?: string
          expires_at?: string
          query?: string
          videos?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_gif_use: {
        Args: { p_gif_id: string }
        Returns: undefined
      }
      add_live_mod: {
        Args: { p_live_id: string; p_user_id: string }
        Returns: number
      }
      admin_ban: {
        Args: {
          _hours?: number
          _permanent?: boolean
          _reason?: string
          _username: string
        }
        Returns: Json
      }
      admin_bans: {
        Args: never
        Returns: {
          active: boolean
          auto: boolean
          banned_by: string
          created_at: string
          expires_at: string
          id: string
          is_permanent: boolean
          kind: string
          reason: string
          report_count: number
          user_id: string
          username: string
        }[]
      }
      admin_coin_venmo_orders: { Args: { _limit?: number }; Returns: Json }
      admin_create_subscription_code: {
        Args: {
          _code: string
          _expires_at?: string
          _max_uses: number
          _months: number
          _plan: string
        }
        Returns: Json
      }
      admin_delete_subscription_code: { Args: { _code: string }; Returns: Json }
      admin_dismiss_report: { Args: { _report_id: string }; Returns: Json }
      admin_follower_payouts: { Args: { _limit?: number }; Returns: Json }
      admin_list_subscription_codes: { Args: never; Returns: Json }
      admin_mark_creator_payout_paid: {
        Args: { p_note?: string; p_payout_id: string }
        Returns: Json
      }
      admin_mark_payout_paid: {
        Args: { _method?: string; _note?: string; _reward_id: string }
        Returns: Json
      }
      admin_moderation_log: {
        Args: { _limit?: number }
        Returns: {
          action: string
          actor: string
          auto: boolean
          created_at: string
          expires_at: string
          id: string
          is_permanent: boolean
          reason: string
          report_count: number
          username: string
        }[]
      }
      admin_payout_stats: { Args: never; Returns: Json }
      admin_payouts: { Args: { p_limit?: number }; Returns: Json }
      admin_reports: {
        Args: { _limit?: number }
        Returns: {
          action_taken: string
          created_at: string
          details: string
          id: string
          reason: string
          reported_user_id: string
          reported_username: string
          reported_video_id: string
          reporter_username: string
          status: string
          video_id: string
        }[]
      }
      admin_review_coin_venmo_order: {
        Args: { _action: string; _note?: string; _order_id: string }
        Returns: Json
      }
      admin_set_subscription_code_active: {
        Args: { _active: boolean; _code: string }
        Returns: Json
      }
      admin_unban: { Args: { _username: string }; Returns: Json }
      admin_unhide_video: { Args: { _video_id: string }; Returns: Json }
      am_i_admin: { Args: never; Returns: boolean }
      app_status: {
        Args: never
        Returns: {
          is_maintenance: boolean
          maintenance_message: string
          updated_at: string
        }[]
      }
      apply_moderation: {
        Args: {
          _action: string
          _actor?: string
          _auto?: boolean
          _hours?: number
          _kind?: string
          _permanent?: boolean
          _reason: string
          _report_count?: number
          _user_id: string
          _username: string
          _window_hours?: number
        }
        Returns: Json
      }
      award_first_follower_reward: {
        Args: { _user_id: string; _username?: string }
        Returns: Json
      }
      award_gta6_badge: { Args: never; Returns: boolean }
      ban_status_for_handle: {
        Args: { _handle: string }
        Returns: {
          expires_at: string
          is_banned: boolean
          is_permanent: boolean
          reason: string
        }[]
      }
      check_creator_fund: { Args: { p_user_id?: string }; Returns: Json }
      coin_admin_ok: { Args: never; Returns: boolean }
      contains_banned_word: { Args: { _text: string }; Returns: boolean }
      create_sound_from_video: { Args: { _video_id: string }; Returns: string }
      end_live_session: { Args: { p_live_id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_full_video_views: {
        Args: { video_id: string }
        Returns: undefined
      }
      increment_share: { Args: { _video_id: string }; Returns: undefined }
      increment_sound_use: { Args: { _sound_id: string }; Returns: undefined }
      is_banned: { Args: { _username: string }; Returns: boolean }
      is_banned_uid: { Args: { _uid: string }; Returns: boolean }
      is_banned_username: { Args: { _username: string }; Returns: boolean }
      is_codes_admin: { Args: never; Returns: boolean }
      is_group_member:
        | { Args: { _group_id: string; _user_id: string }; Returns: boolean }
        | { Args: { gid: string }; Returns: boolean }
      is_group_staff: { Args: { gid: string }; Returns: boolean }
      is_live_mod: {
        Args: { p_live_id: string; p_user_id: string }
        Returns: boolean
      }
      is_muted: { Args: { _username: string }; Returns: boolean }
      is_reserved_username: { Args: { _username: string }; Returns: boolean }
      leave_live_guest: {
        Args: { p_live_id: string; p_user_id?: string }
        Returns: undefined
      }
      mute_live_user: {
        Args: { p_live_id: string; p_minutes?: number; p_user_id: string }
        Returns: string
      }
      my_ban_status: {
        Args: never
        Returns: {
          expires_at: string
          is_banned: boolean
          is_permanent: boolean
          reason: string
        }[]
      }
      my_code_subscriptions: { Args: never; Returns: Json }
      my_coin_venmo_orders: { Args: never; Returns: Json }
      my_creator_fund: { Args: never; Returns: Json }
      my_earnings_summary: { Args: never; Returns: Json }
      my_follower_reward: { Args: never; Returns: Json }
      my_gift_earnings: { Args: { p_limit?: number }; Returns: Json }
      my_payouts: { Args: { p_limit?: number }; Returns: Json }
      my_real_balance: { Args: never; Returns: number }
      my_wallet: { Args: never; Returns: Json }
      norm_handle: { Args: { _handle: string }; Returns: string }
      pin_live_message: {
        Args: { p_live_id: string; p_message: Json }
        Returns: Json
      }
      record_video_view: { Args: { p_video_id: string }; Returns: Json }
      redeem_subscription_code: { Args: { _code: string }; Returns: Json }
      remove_live_mod: {
        Args: { p_live_id: string; p_user_id: string }
        Returns: number
      }
      report_content: {
        Args: {
          _details?: string
          _reason: string
          _reported_username: string
          _video_id: string
        }
        Returns: Json
      }
      request_follower_payout: {
        Args: { _venmo_handle: string }
        Returns: Json
      }
      request_join_live: { Args: { p_live_id: string }; Returns: string }
      request_payout: {
        Args: { p_amount?: number; p_destination?: string; p_method?: string }
        Returns: Json
      }
      respond_join_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: string
      }
      send_live_gift: {
        Args: {
          p_coins: number
          p_gift_type: string
          p_live_id: string
          p_quantity?: number
          p_receiver_id: string
        }
        Returns: {
          balance: number
          gift_id: string
        }[]
      }
      set_app_status: {
        Args: { _maintenance: boolean; _message?: string }
        Returns: undefined
      }
      set_live_comments: {
        Args: { p_live_id: string; p_off: boolean }
        Returns: boolean
      }
      set_my_venmo_handle: { Args: { p_handle: string }; Returns: Json }
      set_video_sound: {
        Args: { _sound_id: string; _video_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sound_title_for_video: {
        Args: { _caption: string; _username: string }
        Returns: string
      }
      submit_coin_venmo_payment: {
        Args: { _order_id: string; _payer_handle: string; _venmo_note?: string }
        Returns: Json
      }
      take_follower_reward_notice: { Args: never; Returns: Json }
      unmute_live_user: {
        Args: { p_live_id: string; p_user_id: string }
        Returns: undefined
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
