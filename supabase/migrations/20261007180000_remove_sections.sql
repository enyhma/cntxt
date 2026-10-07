-- Sections are removed. A Quest-scoped resource survived its Quest being
-- deleted by living one tier down on a Section folder
-- (20261006140000_resource_sections.sql) — but that was before a Project
-- became the persistent, window-bound workspace itself
-- (20261007170000_project_quest_restructure.sql). A Project already
-- outlives any Quest nested under it, so the extra Section tier a resource
-- needed to survive on is redundant: a resource now lives directly on its
-- Project instead.

-- Re-parent every Section-held resource to that Section's own parent
-- Project before Sections are removed — otherwise it would be lost to
-- resources.folder_id's "on delete cascade" once the Section row is gone.
update resources
set folder_id = (
  select parent_id from folders where folders.id = resources.folder_id
)
where folder_id in (select id from folders where kind = 'section');

delete from folders where kind = 'section';

alter table folders drop constraint if exists folders_kind_check;
alter table folders add constraint folders_kind_check
  check (kind in ('area', 'project'));
