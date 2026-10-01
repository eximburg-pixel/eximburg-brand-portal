-- =====================================================================
-- EXIMBURG BRAND PORTAL — Supabase setup
-- Run once: Supabase → SQL Editor → New query → paste all → Run.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  name text, phone text, email text, city text, brand text,
  role text not null default 'customer' check (role in ('customer','admin','accounts','production')),
  created_at timestamptz not null default now()
);
create table if not exists public.settings(
  key text primary key, value jsonb not null default '{}', updated_at timestamptz default now()
);
create table if not exists public.events(
  id bigserial primary key,
  session_id text,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  type text not null check (length(type) <= 40),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_user_idx on public.events(user_id, created_at desc);
create index if not exists events_created_idx on public.events(created_at desc);

create table if not exists public.bookings(
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text, phone text, brand text, city text, gstin text, call_time text,
  slot_month text not null, slot_no int not null,
  packs int not null, price numeric not null, order_value numeric not null, approval_fee numeric not null,
  flavours jsonb not null, offer boolean not null default false,
  stage text not null default 'awaiting_payment',
  hold_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists bookings_month_idx on public.bookings(slot_month, slot_no);

-- v4.2 dispatch fields (safe on existing installs)
alter table public.bookings add column if not exists shipping_charge numeric not null default 0;
alter table public.bookings add column if not exists dispatch jsonb not null default '{}'::jsonb;

create table if not exists public.payments(
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null,
  amount numeric not null, expected numeric not null, utr text not null, paid_on date,
  slip_path text not null, status text not null default 'submitted' check (status in ('submitted','verified','rejected')),
  note text default '', reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.payments drop constraint if exists payments_milestone_check;
alter table public.payments add constraint payments_milestone_check check (milestone in ('booking10','approval40','delivery50','shipping'));

create table if not exists public.booking_updates(
  id bigserial primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  stage text, note text, by_role text, by_name text,
  created_at timestamptz not null default now()
);
-- public, no personal data: powers the live "slot just booked" feed
create table if not exists public.slot_events(
  id bigserial primary key, slot_month text, slot_no int, city text, created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'anon') $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$
  select my_role() in ('admin','accounts','production') $$;
-- Admin + Accounts see money, leads and activity. Production never does.
create or replace function public.is_office() returns boolean language sql stable security definer set search_path=public as $$
  select my_role() in ('admin','accounts') $$;
create or replace function public.exb_price(p int) returns numeric language sql immutable as $$
  select case when p >= 14000 then 83 when p >= 12000 then 85 when p >= 9000 then 87 else 90 end::numeric $$;  -- keep in sync with index.html tiers
create or replace function public.exb_settings() returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select value from settings where key='portal'), '{}'::jsonb) $$;

-- new auth user → profile (role is always 'customer'; cannot be set from the browser)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id, name, phone, email, city, brand)
  values (new.id, left(new.raw_user_meta_data->>'name',80), left(new.raw_user_meta_data->>'phone',15),
          left(new.raw_user_meta_data->>'email',120), left(new.raw_user_meta_data->>'city',60), left(new.raw_user_meta_data->>'brand',40))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.events enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.booking_updates enable row level security;
alter table public.slot_events enable row level security;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select to authenticated using (id = auth.uid() or is_office());

drop policy if exists p_settings_sel on public.settings;
create policy p_settings_sel on public.settings for select to anon, authenticated using (true);
drop policy if exists p_settings_ins on public.settings;
create policy p_settings_ins on public.settings for insert to authenticated with check (my_role() = 'admin');
drop policy if exists p_settings_upd on public.settings;
create policy p_settings_upd on public.settings for update to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists p_events_ins on public.events;
create policy p_events_ins on public.events for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());
drop policy if exists p_events_sel on public.events;
create policy p_events_sel on public.events for select to authenticated using (is_office());

drop policy if exists p_bookings_sel on public.bookings;
create policy p_bookings_sel on public.bookings for select to authenticated using (user_id = auth.uid() or is_office());
drop policy if exists p_payments_sel on public.payments;
create policy p_payments_sel on public.payments for select to authenticated using (user_id = auth.uid() or is_office());
drop policy if exists p_updates_sel on public.booking_updates;
create policy p_updates_sel on public.booking_updates for select to authenticated
  using (is_office() or exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
drop policy if exists p_slot_events_sel on public.slot_events;
create policy p_slot_events_sel on public.slot_events for select to anon, authenticated using (true);
-- bookings / payments / updates have NO insert or update policies: they change only through the functions below.

-- ---------- customer functions ----------
create or replace function public.update_my_profile(p_brand text, p_city text) returns void
language sql security definer set search_path=public as $$
  update profiles set brand = coalesce(nullif(left(p_brand,40),''), brand), city = coalesce(nullif(left(p_city,60),''), city) where id = auth.uid() $$;

create or replace function public.slot_status() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s jsonb := exb_settings(); cs int; m text; nm text; t int[]; nt int[]; rec jsonb;
begin
  cs := greatest(0, coalesce((s->>'monthSlots')::int,15) - coalesce((s->>'royalSwagReserved')::int,8));
  m  := to_char(now() at time zone 'Asia/Kolkata','YYYY-MM');
  nm := to_char(date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month','YYYY-MM');
  select coalesce(array_agg(slot_no order by slot_no), '{}') into t from bookings
    where slot_month = m and stage <> 'cancelled' and not (stage = 'awaiting_payment' and hold_until < now());
  select coalesce(array_agg(slot_no order by slot_no), '{}') into nt from bookings
    where slot_month = nm and stage <> 'cancelled' and not (stage = 'awaiting_payment' and hold_until < now());
  select coalesce(jsonb_agg(x), '[]') into rec from
    (select city, slot_no, slot_month, created_at from slot_events where created_at > now() - interval '30 days' order by created_at desc limit 8) x;
  return jsonb_build_object('month', m, 'next_month', nm, 'client_slots', cs,
    'offline', least(cs, coalesce((s->'offlineSlots'->>m)::int,0)), 'taken', to_jsonb(t),
    'next_offline', least(cs, coalesce((s->'offlineSlots'->>nm)::int,0)), 'next_taken', to_jsonb(nt),
    'hold_hours', coalesce((s->>'holdHours')::int,48), 'recent', rec);
end $$;

-- Atomic slot allocation: lowest free slot this month, else next month (no double booking).
create or replace function public.book_slot(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s jsonb := exb_settings(); me profiles; cs int; off int; m text; n int; tries int := 0;
        packs int; tot int; nfl int; okl boolean; pr numeric; ov numeric; hold int; offer boolean; b bookings;
begin
  if auth.uid() is null then raise exception 'Please sign in to book a slot.'; end if;
  select * into me from profiles where id = auth.uid();
  perform pg_advisory_xact_lock(7151957);
  packs := (p->>'packs')::int;
  select coalesce(sum((f->>'packs')::int),0), count(*), coalesce(bool_and((f->>'packs')::int >= 1000 and (f->>'packs')::int % 1000 = 0), false)
    into tot, nfl, okl from jsonb_array_elements(coalesce(p->'flavours','[]'::jsonb)) f;
  if packs is null or packs < 7000 or packs % 1000 <> 0 then raise exception 'Invalid batch size. Minimum is 7,000 packs in lots of 1,000.'; end if;
  if nfl < 1 or nfl > 6 then raise exception 'Choose 1 to 6 flavours.'; end if;
  if tot <> packs or not okl then raise exception 'Flavour split must be in lots of 1,000 packs.'; end if;
  if (select count(*) from bookings where user_id = auth.uid() and stage = 'awaiting_payment' and hold_until > now()) >= 2 then
    raise exception 'You already have 2 unpaid slots on hold. Pay or let one expire first.'; end if;

  cs := greatest(0, coalesce((s->>'monthSlots')::int,15) - coalesce((s->>'royalSwagReserved')::int,8));
  hold := coalesce((s->>'holdHours')::int,48);
  m := to_char(now() at time zone 'Asia/Kolkata','YYYY-MM');
  loop
    off := least(cs, coalesce((s->'offlineSlots'->>m)::int,0));
    select min(g) into n from generate_series(off+1, cs) g
      where not exists (select 1 from bookings x where x.slot_month = m and x.slot_no = g and x.stage <> 'cancelled'
                        and not (x.stage = 'awaiting_payment' and x.hold_until < now()));
    exit when n is not null;
    m := to_char(to_date(m||'-01','YYYY-MM-DD') + interval '1 month','YYYY-MM');
    tries := tries + 1;
    if tries >= 12 then raise exception 'All production slots for the next 12 months are full. Please contact us.'; end if;
  end loop;

  pr := exb_price(packs); ov := packs * pr;
  offer := coalesce((s->'offer'->>'enabled')::boolean, true) and ov >= coalesce((s->'offer'->>'threshold')::numeric, 1000000);
  insert into bookings(code, user_id, name, phone, brand, city, gstin, call_time, slot_month, slot_no, packs, price, order_value, approval_fee, flavours, offer, stage, hold_until)
  values ('EXB-'||to_char(now() at time zone 'Asia/Kolkata','YYMMDD')||'-'||upper(substr(md5(random()::text),1,4)), auth.uid(),
          coalesce(nullif(left(p->>'name',80),''), me.name), coalesce(nullif(left(p->>'phone',15),''), me.phone),
          coalesce(nullif(left(p->>'brand',40),''), me.brand), coalesce(nullif(left(p->>'city',60),''), me.city),
          left(p->>'gstin',15), left(p->>'call_time',40), m, n, packs, pr, ov, nfl*6000, p->'flavours', offer, 'awaiting_payment', now() + make_interval(hours => hold))
  returning * into b;
  update profiles set brand = coalesce(nullif(left(p->>'brand',40),''), brand) where id = auth.uid();
  insert into slot_events(slot_month, slot_no, city) values (m, n, left(coalesce(b.city,''),40));
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, 'awaiting_payment', format('Slot %s reserved for %s. Pay the 10%% booking amount within %s hours to confirm.', n, m, hold), 'system', 'System');
  return to_jsonb(b);
end $$;

create or replace function public.submit_payment(p_booking uuid, p_milestone text, p_amount numeric, p_utr text, p_paid_on date, p_path text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b bookings; due text; exp numeric; me profiles;
begin
  select * into b from bookings where id = p_booking and user_id = auth.uid() for update;
  if not found then raise exception 'Booking not found.'; end if;
  select * into me from profiles where id = auth.uid();
  due := case b.stage when 'awaiting_payment' then 'booking10' when 'awaiting_40' then 'approval40' when 'awaiting_50' then 'delivery50' when 'awaiting_shipping' then 'shipping' end;
  if due is null then raise exception 'No payment is due on this booking right now.'; end if;
  if due <> p_milestone then raise exception 'This payment does not match the amount due.'; end if;
  if coalesce(length(trim(p_utr)),0) < 6 then raise exception 'Enter the UTR / transaction reference number.'; end if;
  if p_path is null or split_part(p_path,'/',1) <> auth.uid()::text then raise exception 'Upload the payment slip.'; end if;
  if exists (select 1 from payments where upper(utr) = upper(trim(p_utr)) and status <> 'rejected') then raise exception 'This UTR has already been submitted.'; end if;
  if b.stage = 'awaiting_payment' and b.hold_until < now() then
    if exists (select 1 from bookings x where x.id <> b.id and x.slot_month = b.slot_month and x.slot_no = b.slot_no and x.stage <> 'cancelled'
               and not (x.stage = 'awaiting_payment' and x.hold_until < now())) then
      update bookings set stage = 'cancelled', updated_at = now() where id = b.id;
      insert into booking_updates(booking_id, stage, note, by_role, by_name) values (b.id, 'cancelled', 'Hold expired and the slot went to another brand.', 'system', 'System');
      return jsonb_build_object('ok', false, 'error', 'Your hold expired and this slot was taken. Please book a new slot — your slip was not submitted.');
    end if;
  end if;
  exp := case when due = 'shipping' then round(b.shipping_charge)
         else round(b.order_value * case due when 'booking10' then .10 when 'approval40' then .40 else .50 end + case when due = 'approval40' then b.approval_fee else 0 end) end;
  insert into payments(booking_id, user_id, milestone, amount, expected, utr, paid_on, slip_path)
  values (b.id, auth.uid(), due, p_amount, exp, upper(trim(p_utr)), p_paid_on, p_path);
  update bookings set stage = 'payment_review', updated_at = now() where id = b.id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, 'payment_review', format('Payment slip submitted (UTR %s).', upper(trim(p_utr))), 'customer', me.name);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- staff functions ----------
create or replace function public.review_payment(p_payment uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare pm payments; ns text; me profiles; hold int := coalesce((exb_settings()->>'holdHours')::int,48);
begin
  if my_role() not in ('admin','accounts') then raise exception 'Only Accounts can verify payments.'; end if;
  select * into me from profiles where id = auth.uid();
  select * into pm from payments where id = p_payment for update;
  if not found or pm.status <> 'submitted' then raise exception 'This payment was already reviewed.'; end if;
  if not p_ok and coalesce(trim(p_note),'') = '' then raise exception 'Write the reason for rejection — the customer will see it.'; end if;
  update payments set status = case when p_ok then 'verified' else 'rejected' end, note = coalesce(p_note,''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_payment;
  ns := case when p_ok then case pm.milestone when 'booking10' then 'confirmed' when 'approval40' then 'approval_packaging' when 'delivery50' then 'shipping_quote' else 'docs_pending' end
             else case pm.milestone when 'booking10' then 'awaiting_payment' when 'approval40' then 'awaiting_40' when 'delivery50' then 'awaiting_50' else 'awaiting_shipping' end end;
  update bookings set stage = ns, updated_at = now(),
    hold_until = case when not p_ok and pm.milestone = 'booking10' then now() + make_interval(hours => hold) else hold_until end
  where id = pm.booking_id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (pm.booking_id, ns, case when p_ok then format('Payment of ₹%s verified by Accounts. %s', to_char(pm.amount,'FM99,99,99,999'), coalesce(p_note,''))
                                  else 'Payment slip rejected: '||p_note end, my_role(), me.name);
end $$;

create or replace function public.set_stage(p_booking uuid, p_stage text, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; r text := my_role(); me profiles; nxt text;
begin
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found.'; end if;
  select * into me from profiles where id = auth.uid();
  nxt := case b.stage when 'confirmed' then 'label_design' when 'label_design' then 'awaiting_40' when 'approval_packaging' then 'manufacturing'
         when 'manufacturing' then 'qc' when 'dispatched' then 'delivered' end;   -- qc → awaiting_50 only via submit_qc (report required)
  if not (r = 'admin' or (r = 'production' and p_stage = nxt)) then raise exception 'Your role cannot move this order to that stage.'; end if;
  if p_stage not in ('awaiting_payment','payment_review','confirmed','label_design','awaiting_40','approval_packaging','manufacturing','qc','awaiting_50','shipping_quote','awaiting_shipping','docs_pending','ready_dispatch','dispatched','delivered','cancelled')
    then raise exception 'Unknown stage.'; end if;
  update bookings set stage = p_stage, updated_at = now() where id = p_booking;
  insert into booking_updates(booking_id, stage, note, by_role, by_name) values (p_booking, p_stage, coalesce(p_note,''), r, me.name);
end $$;

-- Production feed: only orders already cleared by Accounts/Admin, with NO amounts, prices, UTRs or slips.
create or replace function public.production_orders() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
  if my_role() not in ('production','admin') then raise exception 'Production access only.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'code', b.code, 'brand', b.brand, 'name', b.name, 'city', b.city, 'phone', b.phone,
      'slot_month', b.slot_month, 'slot_no', b.slot_no, 'packs', b.packs, 'flavours', b.flavours,
      'stage', b.stage, 'created_at', b.created_at, 'updated_at', b.updated_at,
      'dispatch', jsonb_strip_nulls(jsonb_build_object('qc_path', b.dispatch->'qc_path', 'qc_at', b.dispatch->'qc_at', 'qc_note', b.dispatch->'qc_note', 'qc_by', b.dispatch->'qc_by')) ||
        case when b.stage in ('ready_dispatch','dispatched','delivered') then
          jsonb_strip_nulls(jsonb_build_object('invoice_no', b.dispatch->'invoice_no', 'invoice_date', b.dispatch->'invoice_date', 'invoice_path', b.dispatch->'invoice_path',
            'eway_no', b.dispatch->'eway_no', 'eway_date', b.dispatch->'eway_date', 'eway_valid_till', b.dispatch->'eway_valid_till', 'eway_path', b.dispatch->'eway_path',
            'transporter', b.dispatch->'transporter', 'vehicle_no', b.dispatch->'vehicle_no', 'lr_no', b.dispatch->'lr_no', 'dispatched_on', b.dispatch->'dispatched_on'))
        else '{}'::jsonb end,
      'upd', (select coalesce(jsonb_agg(jsonb_build_object('stage', u.stage, 'created_at', u.created_at, 'by_role', u.by_role, 'by_name', u.by_name,
                'note', case when u.by_role in ('production','admin') then u.note else '' end) order by u.created_at), '[]'::jsonb)
              from booking_updates u where u.booking_id = b.id
                and u.stage not in ('awaiting_payment','payment_review','cancelled'))
    ) order by b.updated_at desc), '[]'::jsonb) into r
  from bookings b
  where b.stage in ('confirmed','label_design','awaiting_40','approval_packaging','manufacturing','qc','awaiting_50','shipping_quote','awaiting_shipping','docs_pending','ready_dispatch','dispatched','delivered');
  return r;
end $$;
revoke execute on function public.production_orders() from anon, public;
grant execute on function public.production_orders() to authenticated;

-- Accounts: shipping charge after the 50% is verified (0 = customer pickup / free shipping)
create or replace function public.set_shipping(p_booking uuid, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; me profiles; ns text;
begin
  if not is_office() then raise exception 'Only Accounts can set shipping charges.'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found or b.stage not in ('shipping_quote','awaiting_shipping') then raise exception 'Shipping can be set only after the 50%% payment is verified.'; end if;
  if coalesce(p_amount,0) < 0 then raise exception 'Shipping charge cannot be negative.'; end if;
  select * into me from profiles where id = auth.uid();
  ns := case when coalesce(p_amount,0) > 0 then 'awaiting_shipping' else 'docs_pending' end;
  update bookings set shipping_charge = round(coalesce(p_amount,0)), stage = ns, updated_at = now(),
         dispatch = dispatch || jsonb_build_object('shipping_note', coalesce(p_note,'')) where id = b.id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, ns, case when coalesce(p_amount,0) > 0 then format('Shipping charge ₹%s added. %s', to_char(round(p_amount),'FM99,99,99,999'), coalesce(p_note,'')) else 'No shipping charge. '||coalesce(p_note,'') end, my_role(), me.name);
end $$;

-- Accounts: tax invoice + e-way bill → order is cleared for dispatch
create or replace function public.set_dispatch_docs(p_booking uuid, p_doc jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; me profiles;
begin
  if not is_office() then raise exception 'Only Accounts can add invoice and e-way bill.'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found or b.stage not in ('docs_pending','ready_dispatch') then raise exception 'Invoice and e-way bill are added after shipping is paid.'; end if;
  if coalesce(p_doc->>'invoice_no','') = '' or coalesce(p_doc->>'invoice_date','') = '' or coalesce(p_doc->>'eway_valid_till','') = ''
     or coalesce(p_doc->>'invoice_path','') = '' or coalesce(p_doc->>'eway_path','') = '' then raise exception 'Invoice and e-way bill details and files are required.'; end if;
  if (p_doc->>'eway_no') !~ '^[0-9]{12}$' then raise exception 'E-way bill number must be 12 digits.'; end if;
  select * into me from profiles where id = auth.uid();
  update bookings set dispatch = dispatch || jsonb_build_object('invoice_no', p_doc->>'invoice_no', 'invoice_date', p_doc->>'invoice_date', 'invoice_path', p_doc->>'invoice_path',
         'eway_no', p_doc->>'eway_no', 'eway_date', coalesce(p_doc->>'eway_date', p_doc->>'invoice_date'), 'eway_valid_till', p_doc->>'eway_valid_till', 'eway_path', p_doc->>'eway_path'),
         stage = 'ready_dispatch', updated_at = now() where id = b.id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, 'ready_dispatch', format('Invoice %s and e-way bill %s ready. Cleared for dispatch.', p_doc->>'invoice_no', p_doc->>'eway_no'), my_role(), me.name);
end $$;

-- Production: QC passed only with the QC report attached
create or replace function public.submit_qc(p_booking uuid, p_path text, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; me profiles;
begin
  if my_role() not in ('production','admin') then raise exception 'Only Production can submit QC.'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found or b.stage <> 'qc' then raise exception 'This order is not in quality check.'; end if;
  if coalesce(p_path,'') = '' or split_part(p_path,'/',1) <> b.id::text then raise exception 'Attach the QC report.'; end if;
  select * into me from profiles where id = auth.uid();
  update bookings set stage = 'awaiting_50', updated_at = now(),
         dispatch = dispatch || jsonb_build_object('qc_path', p_path, 'qc_at', now(), 'qc_note', coalesce(p_note,''), 'qc_by', me.name) where id = b.id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, 'awaiting_50', 'QC passed. Report attached. '||coalesce(p_note,''), my_role(), me.name);
end $$;
revoke execute on function public.submit_qc(uuid,text,text) from anon, public;
grant execute on function public.submit_qc(uuid,text,text) to authenticated;

-- Production: dispatch needs transporter, vehicle and LR
create or replace function public.mark_dispatched(p_booking uuid, p_info jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; me profiles;
begin
  if my_role() not in ('production','admin') then raise exception 'Only Production can dispatch.'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found or b.stage <> 'ready_dispatch' then raise exception 'This order is not cleared for dispatch yet.'; end if;
  if coalesce(trim(p_info->>'transporter'),'') = '' or coalesce(trim(p_info->>'vehicle_no'),'') = '' or coalesce(trim(p_info->>'lr_no'),'') = '' then
    raise exception 'Fill transporter, vehicle number and LR / docket number.'; end if;
  select * into me from profiles where id = auth.uid();
  update bookings set stage = 'dispatched', updated_at = now(), dispatch = dispatch || jsonb_build_object('transporter', trim(p_info->>'transporter'),
         'vehicle_no', upper(trim(p_info->>'vehicle_no')), 'lr_no', trim(p_info->>'lr_no'), 'dispatched_on', coalesce(nullif(p_info->>'dispatched_on',''), to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD')))
  where id = b.id;
  insert into booking_updates(booking_id, stage, note, by_role, by_name)
  values (b.id, 'dispatched', format('Dispatched by %s, vehicle %s, LR %s. %s', trim(p_info->>'transporter'), upper(trim(p_info->>'vehicle_no')), trim(p_info->>'lr_no'), coalesce(p_info->>'note','')), my_role(), me.name);
end $$;
revoke execute on function public.set_shipping(uuid,numeric,text), public.set_dispatch_docs(uuid,jsonb), public.mark_dispatched(uuid,jsonb) from anon, public;
grant execute on function public.set_shipping(uuid,numeric,text), public.set_dispatch_docs(uuid,jsonb), public.mark_dispatched(uuid,jsonb) to authenticated;

create or replace function public.set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if my_role() <> 'admin' then raise exception 'Only Admin can change roles.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own Admin role.'; end if;
  if p_role not in ('customer','admin','accounts','production') then raise exception 'Unknown role.'; end if;
  update profiles set role = p_role where id = p_user;
end $$;

revoke execute on function public.book_slot(jsonb), public.submit_payment(uuid,text,numeric,text,date,text),
  public.review_payment(uuid,boolean,text), public.set_stage(uuid,text,text), public.set_role(uuid,text),
  public.update_my_profile(text,text) from anon, public;
grant execute on function public.book_slot(jsonb), public.submit_payment(uuid,text,numeric,text,date,text),
  public.review_payment(uuid,boolean,text), public.set_stage(uuid,text,text), public.set_role(uuid,text),
  public.update_my_profile(text,text) to authenticated;
grant execute on function public.slot_status() to anon, authenticated;

-- ---------- payment slip storage (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips','payment-slips', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
drop policy if exists slips_insert on storage.objects;
create policy slips_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists slips_select on storage.objects;
create policy slips_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_office()));

-- dispatch documents: Accounts/Admin upload; staff and the order's own customer can read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispatch-docs','dispatch-docs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated with check (bucket_id = 'dispatch-docs' and (public.is_office()
  or (public.my_role() = 'production' and name like '%/qc-%')));
drop policy if exists docs_select on storage.objects;
create policy docs_select on storage.objects for select to authenticated using (bucket_id = 'dispatch-docs' and (public.is_staff()
  or exists (select 1 from public.bookings b where b.id::text = (storage.foldername(name))[1] and b.user_id = auth.uid())));

-- ---------- realtime (live slot board + live status updates) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.slot_events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.bookings; exception when others then null; end;
  begin alter publication supabase_realtime add table public.payments; exception when others then null; end;
  begin alter publication supabase_realtime add table public.booking_updates; exception when others then null; end;
  begin alter publication supabase_realtime add table public.events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
end $$;

-- =====================================================================
-- AFTER RUNNING: make yourself Admin (sign up once on index.html first)
--   update public.profiles set role = 'admin' where phone = '98XXXXXXXX';
-- Staff (Accounts / Production): they sign up on admin.html, then Admin
-- assigns the role in admin.html → Team.
-- Reset a forgotten password:
--   update auth.users set encrypted_password = crypt('NewPass@123', gen_salt('bf'))
--   where email = '9198XXXXXXXX@phone.eximburg.in';
-- =====================================================================
