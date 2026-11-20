-- ---------------------------------------------------------------------------
-- Fresh subscription codes + the Pro tier
--
-- Two things happen here.
--
-- 1. Codes can now grant **Pro**. Until now `subscription_codes.plan` only
--    allowed 'basic' and 'premium' (Plus and VIP), so the middle tier was the
--    one plan nobody could ever receive from a gift card or promo. The check
--    constraint and `admin_create_subscription_code` are widened to accept
--    'pro'; `codes.ts` maps it straight onto the app's `pro` plan id.
--
-- 2. A new batch of codes is minted: single-use Premium and Pro cards, plus
--    the Thanksgiving / Black Friday / Cyber Monday 2026 promos.
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING, so codes that have
-- already been handed out keep their uses_count and are left untouched.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Allow the 'pro' tier
-- ---------------------------------------------------------------------------

do $$
begin
  -- The original table was created with an inline check, so Postgres named it
  -- subscription_codes_plan_check. Drop whatever is there and re-add it wide.
  if exists (
    select 1 from pg_constraint where conname = 'subscription_codes_plan_check'
  ) then
    alter table public.subscription_codes
      drop constraint subscription_codes_plan_check;
  end if;

  alter table public.subscription_codes
    add constraint subscription_codes_plan_check
    check (plan in ('basic', 'pro', 'premium'));
end
$$;

-- `admin_create_subscription_code` validated the plan itself, so it has to be
-- replaced or the admin screen would still refuse to mint a Pro code.
create or replace function public.admin_create_subscription_code(
  _code text,
  _plan text,
  _months integer,
  _max_uses integer,
  _expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.subscription_codes;
begin
  if not public.is_codes_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  v_code := upper(trim(coalesce(_code, '')));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_code');
  end if;
  if _plan is null or _plan not in ('basic', 'pro', 'premium') then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;
  if _months is null or _months not in (1, 3, 12) then
    return jsonb_build_object('ok', false, 'error', 'invalid_months');
  end if;
  if _max_uses is null or _max_uses < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_max_uses');
  end if;

  insert into public.subscription_codes (code, plan, months, max_uses, expires_at, created_by)
  values (v_code, _plan, _months, _max_uses, _expires_at, '@drewmclawhorn3')
  returning * into v_row;

  return jsonb_build_object('ok', true, 'code', to_jsonb(v_row));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

revoke all on function public.admin_create_subscription_code(text, text, integer, integer, timestamptz) from public, anon;
grant execute on function public.admin_create_subscription_code(text, text, integer, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. New codes
--
--    COOLERUP-XXXX-XXXX        1 month Premium, single use   (40)
--    COOLERUP-3M-XXXX-XXXX     3 months Premium, single use  (15)
--    COOLERUP-1Y-XXXX-XXXX     12 months Premium, single use (8)
--    COOLERUP-PRO-XXXX-XXXX    1 month Pro, single use       (25)
--    COOLERUP-PRO-3M-XXXX-XXXX 3 months Pro, single use      (10)
--    plus the named promos below
-- ---------------------------------------------------------------------------

insert into public.subscription_codes
  (code, plan, months, max_uses, expires_at, created_by, active)
values
  ('COOLERUP-27YS-NI0G', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1IIT-N3XV', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-K9TF-TDHW', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-ZXUY-XXA9', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PWO1-5D0X', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-C77U-434Y', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-RZXA-3C7T', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-GNKE-JVSV', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1IBC-5QBR', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-ELAF-DRYP', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-TDW9-DIHC', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-XANK-8A48', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-YT86-09UU', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3CG8-GEXZ', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-2PVK-DV50', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-S9WR-3D81', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1T0L-PTC9', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-WKBC-61NP', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-6RL0-B5LO', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-0ZHF-9U5H', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-SGLB-LRT5', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-I0OU-YR87', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-J6JL-EJNH', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-5F4D-K3V1', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-2F4V-ETC6', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-MDZ9-5U9U', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-B022-QNJG', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-XO9B-G2V7', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-5YBC-TKRM', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-ISIK-C6Z4', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-5L85-FRCQ', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-G305-DVR4', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3XVC-RX62', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-WR0V-VYNU', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-EPRA-K0U0', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-UQ1Z-GU1P', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-TZRV-IUP7', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-ZSQP-COPJ', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-FF22-TRIU', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1YUZ-0KCP', 'premium', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-0LL8-PYGB', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-GOSN-XVAB', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-AJGR-H3L3', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-MKYO-CMBO', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-7PK6-KU0D', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-KNFB-76GH', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-47IE-5QDL', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-7NOX-9Y3P', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-BKS9-4OVD', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-LV2J-S1KN', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-MQ1D-LNXI', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-VXUK-1RAP', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-GQL0-KOKG', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-HRPA-G628', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-3M-TIX1-BAV4', 'premium', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-SODY-GYNV', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-2VPQ-12TD', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-4QDS-XUI0', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-I5EK-HWOV', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-YQIK-GQW0', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-UOED-SBOS', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-G506-9Q3K', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-1Y-MQBI-UGJX', 'premium', 12, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-P32Q-HS0T', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-MZTC-RCXZ', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-28C7-K3EJ', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-XFMU-EMOX', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-E4BX-DG67', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-2BMV-71XK', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-G3CU-82QI', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-IW07-WZTH', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-I7KY-CU1S', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-6X95-R6RF', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-8WNU-29SB', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-9114-ZG36', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-33D1-NU66', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-JRSW-NOJ7', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-OJN2-A905', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-U5DA-7AF7', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-V3FI-GWTS', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-YUZH-PK3I', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-JTC6-2518', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-OIDX-8UDX', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-RT59-PHD8', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3BZB-4FB5', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-GFXL-DPSS', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-FVRE-BYAL', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-AL85-U90Z', 'pro', 1, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-BG2U-KTTG', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-7HOH-DXHY', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-22YD-M863', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-PY0I-BQIU', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-UFCT-11OH', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-SWAC-M7X5', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-VY45-TKSJ', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-BES5-LG59', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-BQTI-5P3O', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-WT6F-ZMOM', 'pro', 3, 1, null, '@drewmclawhorn3', true),
  ('THANKSGIVING-2026', 'basic', 1, 1000, '2026-11-30 23:59:59+00', '@drewmclawhorn3', true),
  ('BLACKFRIDAY-2026', 'premium', 3, 500, '2026-12-02 23:59:59+00', '@drewmclawhorn3', true),
  ('CYBERMONDAY-2026', 'premium', 1, 1000, '2026-12-05 23:59:59+00', '@drewmclawhorn3', true),
  ('COOLERUP-PRO-1M', 'pro', 1, 100, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-3M-PROMO', 'pro', 3, 100, null, '@drewmclawhorn3', true),
  ('COOLERUP-PRO-1Y', 'pro', 12, 50, null, '@drewmclawhorn3', true),
  ('CREATOR-PRO', 'pro', 3, 100, null, '@drewmclawhorn3', true),
  ('STREAMER-PRO', 'pro', 1, 200, null, '@drewmclawhorn3', true)
on conflict (code) do nothing;

-- Sanity check
select plan,
       count(*) as codes,
       sum(max_uses - uses_count) as redemptions_left
from public.subscription_codes
where active
group by plan
order by plan;
