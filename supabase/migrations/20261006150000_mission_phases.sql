-- Optional stage-gated roadmap for a Mission: an ordered list of phases
-- (id/name/status), plus which one is active. Absent/empty `phases` means
-- "no roadmap" — a mission behaves exactly as it does today, a flat tab
-- list (see the Mission/Phase type comments in extension/utils/missions.ts).
-- jsonb rather than a child table: a phase has no independent existence
-- outside its mission's ordering, and nothing here queries into it
-- server-side — same reasoning as workspaces.tabs already being jsonb.
alter table workspaces add column phases jsonb not null default '[]';
alter table workspaces add column active_phase_id uuid;
