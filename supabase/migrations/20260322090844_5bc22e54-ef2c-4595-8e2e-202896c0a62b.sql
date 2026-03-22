-- Referral codes table
CREATE TABLE public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL UNIQUE,
  uses integer NOT NULL DEFAULT 0,
  reward_coins integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referral" ON public.referral_codes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage referrals" ON public.referral_codes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Referral claims table
CREATE TABLE public.referral_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referral_code_id, claimed_by)
);
ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own claims" ON public.referral_claims FOR SELECT TO authenticated USING (claimed_by = auth.uid());
CREATE POLICY "Admins can manage claims" ON public.referral_claims FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Coin transactions table
CREATE TABLE public.coin_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  type text NOT NULL DEFAULT 'purchase',
  description text NOT NULL DEFAULT '',
  reference_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON public.coin_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage transactions" ON public.coin_transactions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_transactions;

-- RPC: get_or_create_referral_code
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref RECORD;
  new_code text;
BEGIN
  SELECT * INTO ref FROM public.referral_codes WHERE user_id = auth.uid();
  IF FOUND THEN
    RETURN jsonb_build_object('code', ref.code, 'uses', ref.uses, 'reward_coins', ref.reward_coins);
  END IF;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  INSERT INTO public.referral_codes (user_id, code) VALUES (auth.uid(), new_code) RETURNING * INTO ref;
  RETURN jsonb_build_object('code', ref.code, 'uses', ref.uses, 'reward_coins', ref.reward_coins);
END;
$$;

-- RPC: claim_referral
CREATE OR REPLACE FUNCTION public.claim_referral(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref RECORD;
  already_claimed boolean;
BEGIN
  SELECT * INTO ref FROM public.referral_codes WHERE code = upper(_code);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kode referral tidak ditemukan');
  END IF;
  IF ref.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tidak bisa klaim kode sendiri');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.referral_claims WHERE claimed_by = auth.uid()) INTO already_claimed;
  IF already_claimed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kamu sudah pernah klaim referral');
  END IF;
  INSERT INTO public.referral_claims (referral_code_id, claimed_by) VALUES (ref.id, auth.uid());
  UPDATE public.referral_codes SET uses = uses + 1 WHERE id = ref.id;
  INSERT INTO public.coin_balances (user_id, balance) VALUES (auth.uid(), ref.reward_coins)
  ON CONFLICT (user_id) DO UPDATE SET balance = coin_balances.balance + ref.reward_coins, updated_at = now();
  INSERT INTO public.coin_balances (user_id, balance) VALUES (ref.user_id, ref.reward_coins)
  ON CONFLICT (user_id) DO UPDATE SET balance = coin_balances.balance + ref.reward_coins, updated_at = now();
  INSERT INTO public.coin_transactions (user_id, amount, type, description) VALUES
    (auth.uid(), ref.reward_coins, 'referral_claim', 'Klaim kode referral ' || ref.code),
    (ref.user_id, ref.reward_coins, 'referral_reward', 'Reward referral dari user baru');
  RETURN jsonb_build_object('success', true, 'reward', ref.reward_coins);
END;
$$;

-- Log coin order confirmations
CREATE OR REPLACE FUNCTION public.log_coin_order_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
    INSERT INTO public.coin_transactions (user_id, amount, type, description, reference_id)
    VALUES (NEW.user_id, NEW.coin_amount, 'purchase', 'Pembelian ' || NEW.coin_amount || ' koin', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_coin_order_confirmed
  AFTER UPDATE ON public.coin_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_coin_order_transaction();

-- Log token redemptions
CREATE OR REPLACE FUNCTION public.log_token_redeem_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  price integer;
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.show_id IS NOT NULL THEN
    SELECT title, coin_price, replay_coin_price, is_replay INTO s FROM public.shows WHERE id = NEW.show_id;
    price := CASE WHEN s.is_replay THEN s.replay_coin_price ELSE s.coin_price END;
    IF price > 0 THEN
      INSERT INTO public.coin_transactions (user_id, amount, type, description, reference_id)
      VALUES (NEW.user_id, -price, 'redeem', 'Tukar koin untuk ' || COALESCE(s.title, 'show'), NEW.show_id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_token_created_log
  AFTER INSERT ON public.tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.log_token_redeem_transaction();