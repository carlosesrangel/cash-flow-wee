-- The sync functions never actually measured which records were newly
-- created vs. updated (each upsert call reports the same aggregate count
-- for both), so `sync_runs.records_created`/`records_updated` were being
-- populated with a fabricated value equal to `records_received`. Rather
-- than continue lying via a `not null default 0`, make both columns
-- nullable so the sync orchestrator can report "not measured" as null
-- instead of a fake number.
alter table sync_runs alter column records_created drop not null;
alter table sync_runs alter column records_created drop default;
alter table sync_runs alter column records_updated drop not null;
alter table sync_runs alter column records_updated drop default;
