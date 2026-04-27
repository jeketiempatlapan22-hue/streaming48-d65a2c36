
-- Internal helper / trigger / cron / service-role only functions
DO $$
DECLARE
  fn TEXT;
  internal_fns TEXT[] := ARRAY[
    'public._reseller_find_token(uuid, text)',
    'public.auto_cleanup_chat()',
    'public.auto_reset_long_token_sessions()',
    'public.auto_unblock_expired_ips()',
    'public.award_quiz_coins(uuid, integer, uuid)',
    'public.cascade_delete_tokens_on_show_delete()',
    'public.check_rate_limit(text, integer, integer)',
    'public.cleanup_expired_qris_orders()',
    'public.cleanup_live_chat_daily()',
    'public.cleanup_old_logs()',
    'public.cleanup_rate_limits()',
    'public.cleanup_replay_access_tokens()',
    'public.cleanup_replay_artifacts()',
    'public.cleanup_replay_tokens()',
    'public.cleanup_stale_viewers()',
    'public.cleanup_token_sessions_on_token_delete()',
    'public.confirm_membership_order(uuid)',
    'public.confirm_regular_order(uuid)',
    'public.get_active_show_external_id()',
    'public.handle_new_user()',
    'public.hash_token(text)',
    'public.is_ip_blocked(text)',
    'public.log_coin_order_transaction()',
    'public.log_reseller_audit(uuid, text, text, text, text, jsonb)',
    'public.log_token_redeem_transaction()',
    'public.migrate_tokens_on_replay_flip()',
    'public.record_rate_limit_violation(text, text, text, integer, integer)',
    'public.refresh_live_quiz_state()',
    'public.reseller_list_recent_tokens_by_id(uuid, integer)',
    'public.reseller_mark_paid_by_short(text, text, text)',
    'public.reseller_my_stats_by_id(uuid)',
    'public.reseller_reset_token_sessions_by_id(uuid, text)',
    'public.reset_ip_visit_log_daily()',
    'public.touch_restream_code_usage(text)',
    'public.trg_sync_live_quiz_state_fn()',
    'public.update_resellers_updated_at()',
    'public.update_updated_at_column()',
    'public.validate_feedback_insert()',
    'public.validate_reseller_session(text)',
    'public.get_token_active_sessions(uuid)',
    'public.get_tokens_active_sessions(uuid[])',
    'public.check_user_replay_access(uuid)',
    'public.hash_reseller_password(text, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Function not found, skipping: %', fn;
    END;
  END LOOP;
END $$;
