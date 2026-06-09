create extension if not exists "pgcrypto";

do $$
begin
  create type user_role as enum ('client', 'legal_advisor', 'admin');
exception
  when duplicate_object then null;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  full_name varchar(160) not null,
  username varchar(60) not null,
  password_hash text not null,
  role user_role not null default 'client',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_lowercase check (username = lower(username))
);

create unique index if not exists users_username_unique on users (lower(username));

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  last_activity timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_idx on auth_sessions (user_id);

create table if not exists virtual_meeting_events (
  meeting_id varchar(80) primary key,
  started_at timestamptz not null default now(),
  started_by uuid references users(id),
  finished_at timestamptz,
  finished_by uuid references users(id)
);

do $$
begin
  create type appointment_period as enum ('morning', 'afternoon');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type service_mode as enum ('presencial', 'virtual');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type case_status as enum ('open', 'review', 'closed');
exception when duplicate_object then null;
end $$;

create sequence if not exists appointment_number_seq;

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  sequence_number bigint not null default nextval('appointment_number_seq'),
  client_id uuid not null references users(id),
  advisor_id uuid not null references users(id),
  appointment_date date not null,
  period appointment_period not null,
  mode service_mode not null,
  service varchar(160) not null,
  created_at timestamptz not null default now(),
  unique (advisor_id, appointment_date, period)
);

create sequence if not exists legal_case_number_seq;

create table if not exists legal_cases (
  id uuid primary key default gen_random_uuid(),
  case_number varchar(80) not null unique,
  client_id uuid not null references users(id),
  advisor_id uuid not null references users(id),
  service varchar(160) not null,
  description text not null,
  status case_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists case_appointments (
  case_id uuid not null references legal_cases(id) on delete cascade,
  appointment_id uuid primary key references appointments(id) on delete cascade,
  linked_at timestamptz not null default now()
);

create table if not exists case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references legal_cases(id) on delete cascade,
  uploaded_by uuid not null references users(id),
  original_name varchar(255) not null,
  stored_name varchar(255) not null unique,
  mime_type varchar(160) not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title varchar(180) not null,
  message text not null,
  kind varchar(60) not null,
  target_id uuid,
  action varchar(60),
  unique_key varchar(180) unique,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);

delete from notifications where kind = 'appointment_created';

insert into notifications (user_id, title, message, kind, action, unique_key, created_at)
select a.advisor_id, 'Citas programadas para el ' || to_char(a.appointment_date, 'DD/MM/YYYY'),
       'Tienes ' || count(*)::text || ' cita' || case when count(*) = 1 then '' else 's' end ||
       ' programada' || case when count(*) = 1 then '' else 's' end || ' para este dia.',
       'appointment_day', 'agenda', 'appointments-day:' || a.advisor_id::text || ':' || a.appointment_date::text, max(a.created_at)
from appointments a
group by a.advisor_id, a.appointment_date
on conflict (unique_key) do update
set title = excluded.title, message = excluded.message;

insert into notifications (user_id, title, message, kind, target_id, action, unique_key, created_at)
select lc.client_id, 'Expediente creado', 'El asesor creo el expediente ' || lc.case_number || ' para tu cita.',
       'case_created', lc.id, 'cases', 'case-created:' || lc.id::text, lc.created_at
from legal_cases lc
on conflict (unique_key) do nothing;
