-- «Где что лежит»: места (сумки, полки, папки с документами), вещи в них, правила «что должно быть в каждой тревожной сумке».
-- Тот же проект Supabase и тот же вход, что у «Задач» и Корзинки. Запускать целиком в Supabase → SQL Editor → Run (можно повторно).

create table if not exists w_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references w_places on delete set null,   -- где лежит само место (сумка — в шкафу, шкаф — на даче)
  name text not null,
  emoji text,
  note text,
  kit boolean not null default false,                       -- тревожная сумка: проверяется обязательный набор
  ord int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists w_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  place_id uuid references w_places on delete set null,     -- пусто = «Без места»
  name text not null,
  note text,
  qty int not null default 1 check (qty >= 0),
  check_on date,                                            -- когда проверить срок годности
  task_id uuid references tasks on delete set null,         -- задача-напоминание в «Задачах»
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists w_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,                                       -- «Зарядка для телефона»
  words text[] not null default '{}',                       -- по каким словам в названии вещи её узнавать
  need int not null default 1 check (need > 0),             -- сколько должно быть в каждой тревожной сумке
  ord int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists w_places_user on w_places (user_id);
create index if not exists w_items_user on w_items (user_id);
create index if not exists w_items_place on w_items (place_id);

alter table w_places enable row level security;
alter table w_items enable row level security;
alter table w_rules enable row level security;
drop policy if exists own on w_places;
drop policy if exists own on w_items;
drop policy if exists own on w_rules;
create policy own on w_places for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on w_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on w_rules for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on w_places, w_items, w_rules to authenticated;

-- Живая синхронизация: изменения на телефоне сразу видны на компьютере и наоборот.
do $$ begin
  begin alter publication supabase_realtime add table w_places; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table w_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table w_rules; exception when duplicate_object then null; end;
end $$;

-- Путь места: «Дача › Шкаф › Сумка от ноутбука».
create or replace function w_place_path(p_id uuid) returns text
language sql stable as $$
  with recursive up as (
    select id, parent_id, name, 0 as lvl from w_places where id = p_id
    union all
    select p.id, p.parent_id, p.name, up.lvl + 1 from w_places p join up on p.id = up.parent_id where up.lvl < 20
  )
  select string_agg(name, ' › ' order by lvl desc) from up
$$;

-- Срок годности → задача в «Задачах».
-- Поставила дату у вещи — появилась задача «Проверить срок: …» на этот день.
-- Сменила дату — задача переехала на новую дату (и снова не выполнена). Убрала дату или вещь — задача удалена (если ещё не выполнена).
create or replace function w_item_task() returns trigger
language plpgsql as $$
declare
  t text;
begin
  if tg_op = 'DELETE' then
    if old.task_id is not null then
      delete from tasks where id = old.task_id and done_on is null;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and new.check_on is not distinct from old.check_on
     and new.name = old.name
     and new.place_id is not distinct from old.place_id
     and new.note is not distinct from old.note then
    return new;
  end if;
  new.updated_at := now();

  if new.check_on is null then
    if new.task_id is not null then
      delete from tasks where id = new.task_id and done_on is null;
      new.task_id := null;
    end if;
    return new;
  end if;

  t := 'Проверить срок: ' || new.name || coalesce(' — ' || w_place_path(new.place_id), '');
  if new.task_id is not null and exists (select 1 from tasks where id = new.task_id) then
    update tasks set
      title = t,
      notes = new.note,
      due_date = new.check_on,
      done_on = case when tg_op = 'UPDATE' and new.check_on is distinct from old.check_on then null else done_on end
    where id = new.task_id;
  else
    insert into tasks (user_id, title, notes, due_date)
    values (new.user_id, t, new.note, new.check_on)
    returning id into new.task_id;
  end if;
  return new;
end $$;

drop trigger if exists w_item_task on w_items;
create trigger w_item_task before insert or update or delete on w_items
  for each row execute function w_item_task();
