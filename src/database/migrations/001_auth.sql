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

insert into users (full_name, username, password_hash, role)
values ('Administrador general', 'admin', crypt('admin', gen_salt('bf', 12)), 'admin')
on conflict (lower(username)) do nothing;
