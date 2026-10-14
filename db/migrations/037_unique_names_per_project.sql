-- 037: Template and config names unique per project, not globally
-- Description: unique (project_id, name, version) on schedule_templates and config_templates
--
-- Both tables had UNIQUE (name, version) across ALL projects. Saving a
-- schedule template or configuration in a new project with a name another
-- project already uses (e.g. "Standard" v1.0) failed with a raw SQL
-- integrity error. The keys now include project_id. Safe to re-run.

ALTER TABLE schedule_templates
    DROP INDEX IF EXISTS unique_name_version,
    ADD UNIQUE INDEX IF NOT EXISTS unique_project_name_version (project_id, name, version);

ALTER TABLE config_templates
    DROP INDEX IF EXISTS unique_name_version,
    ADD UNIQUE INDEX IF NOT EXISTS unique_project_name_version (project_id, template_name, template_version);
