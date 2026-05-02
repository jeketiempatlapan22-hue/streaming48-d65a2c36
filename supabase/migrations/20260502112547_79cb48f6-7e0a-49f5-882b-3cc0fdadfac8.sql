-- 1. Tambah kolom archived_show_title untuk simpan judul show terakhir
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS archived_show_title TEXT;

-- 2. Ubah trigger cascade delete: jangan hapus token reseller, cukup archive
CREATE OR REPLACE FUNCTION public.cascade_delete_tokens_on_show_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Untuk token RESELLER: archive (soft) supaya riwayat tetap utuh di dashboard reseller & bot WA
  UPDATE public.tokens
     SET status = 'archived',
         archived_to_replay = true,
         archived_show_title = COALESCE(archived_show_title, OLD.title),
         show_id = NULL
   WHERE show_id = OLD.id
     AND reseller_id IS NOT NULL;

  -- Untuk token NON-reseller (viewer biasa, bundle, dll): tetap hard-delete seperti sebelumnya
  DELETE FROM public.tokens WHERE show_id = OLD.id AND reseller_id IS NULL;
  RETURN OLD;
END;
$function$;

-- 3. Update RPC reseller_list_my_tokens agar fallback ke archived_show_title
CREATE OR REPLACE FUNCTION public.reseller_list_my_tokens(_session_token text, _limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reseller_id uuid;
  v_tokens jsonb;
BEGIN
  v_reseller_id := validate_reseller_session(_session_token);
  IF v_reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_tokens
  FROM (
    SELECT
      tk.id, tk.code, tk.show_id, tk.status, tk.max_devices,
      tk.expires_at, tk.created_at,
      COALESCE(s.title, tk.archived_show_title, '(Show telah dihapus)') AS show_title,
      s.short_id AS show_short_id,
      COALESCE(s.is_replay, false) AS is_replay_show,
      (tk.archived_to_replay OR tk.status = 'archived') AS is_archived,
      (tk.show_id IS NULL AND tk.archived_show_title IS NOT NULL) AS is_show_deleted,
      CASE
        WHEN COALESCE(s.is_replay, false) OR tk.archived_to_replay OR tk.status = 'archived'
        THEN 'replay'
        ELSE 'live'
      END AS effective_link_kind,
      (
        SELECT rt.expires_at FROM public.replay_tokens rt
        WHERE rt.code = tk.code LIMIT 1
      ) AS replay_expires_at,
      EXISTS (
        SELECT 1 FROM reseller_payments rp
        WHERE rp.reseller_id = tk.reseller_id
          AND rp.token_code = tk.code
      ) AS is_paid,
      (
        SELECT rp.paid_at FROM reseller_payments rp
        WHERE rp.reseller_id = tk.reseller_id
          AND rp.token_code = tk.code
        LIMIT 1
      ) AS paid_at
    FROM tokens tk
    LEFT JOIN shows s ON s.id = tk.show_id
    WHERE tk.reseller_id = v_reseller_id
    ORDER BY tk.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500))
  ) t;

  RETURN jsonb_build_object('success', true, 'tokens', v_tokens);
END;
$function$;

-- 4. Update RPC reseller_list_recent_tokens_by_id (untuk bot WA)
CREATE OR REPLACE FUNCTION public.reseller_list_recent_tokens_by_id(_reseller_id uuid, _limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _rows jsonb;
BEGIN
  IF _reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'last4', right(t.code, 4),
    'show_title', COALESCE(s.title, t.archived_show_title, '(Show telah dihapus)'),
    'status', t.status,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'created_at', t.created_at,
    'is_expired', (t.expires_at IS NOT NULL AND t.expires_at <= now()),
    'is_replay_show', COALESCE(s.is_replay, false),
    'is_archived', (t.archived_to_replay OR t.status = 'archived'),
    'is_show_deleted', (t.show_id IS NULL AND t.archived_show_title IS NOT NULL),
    'effective_link_kind', CASE
      WHEN COALESCE(s.is_replay, false) OR t.archived_to_replay OR t.status = 'archived'
      THEN 'replay' ELSE 'live'
    END
  ) ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO _rows
  FROM (
    SELECT * FROM public.tokens
    WHERE reseller_id = _reseller_id
    ORDER BY created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 20), 50))
  ) t
  LEFT JOIN public.shows s ON s.id = t.show_id;

  RETURN jsonb_build_object('success', true, 'tokens', _rows);
END;
$function$;

-- 5. Perketat: tegaskan hanya admin yang boleh DELETE riwayat audit reseller & token reseller
-- (Sudah implisit via "Admins manage reseller audit", tapi tambah policy eksplisit untuk kejelasan)
DROP POLICY IF EXISTS "Block non-admin delete reseller audit" ON public.reseller_token_audit;
CREATE POLICY "Block non-admin delete reseller audit"
ON public.reseller_token_audit
FOR DELETE
TO anon, authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Dan policy eksplisit untuk DELETE token reseller (hanya admin)
DROP POLICY IF EXISTS "Only admin can delete reseller tokens" ON public.tokens;
CREATE POLICY "Only admin can delete reseller tokens"
ON public.tokens
FOR DELETE
TO authenticated
USING (
  reseller_id IS NULL OR has_role(auth.uid(), 'admin'::app_role)
);