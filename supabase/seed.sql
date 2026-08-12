insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'WEE')
on conflict (id) do nothing;
