-- 008: externally owned opportunities and synchronisation (R4-01 to R4-26).
-- Safe to run while the previous code is deployed: it only adds tables.
--
-- Source-controlled data (what the provider says) lives on external_opportunities and is only
-- ever written by a successful sync. Everything local (faculty interest, student tracking and its
-- history, readiness guidance) lives in its own table keyed by the local id, so a sync can never
-- overwrite it (R4-15, R4-16, R4-20).

-- R4-01: a source is a row, not a code path. Mitacs is the first.
CREATE TABLE IF NOT EXISTS external_sources (
    id            TEXT        PRIMARY KEY,
    name          TEXT        NOT NULL,
    owner_name    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The local copy of a provider's record. (source_id, external_id) is the identity, so a repeated
-- sync updates rather than duplicates (R4-09). source_state: listed in the last successful sync,
-- not_seen (absent from a successful sync, last-known content kept, R4-10), or withdrawn (the
-- provider said so).
CREATE TABLE IF NOT EXISTS external_opportunities (
    id                 SERIAL      PRIMARY KEY,
    source_id          TEXT        NOT NULL REFERENCES external_sources(id),
    external_id        TEXT        NOT NULL,
    title              TEXT        NOT NULL,
    description        TEXT        NOT NULL DEFAULT '',
    areas              TEXT[]      NOT NULL DEFAULT '{}',
    authoritative_url  TEXT        NOT NULL,
    closes_on          DATE,
    source_state       TEXT        NOT NULL DEFAULT 'listed'
                                   CHECK (source_state IN ('listed', 'not_seen', 'withdrawn')),
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    not_seen_since     TIMESTAMPTZ,
    last_changed_at    TIMESTAMPTZ,
    UNIQUE (source_id, external_id)
);

-- One row per sync attempt (R4-14). status: running, succeeded or failed.
CREATE TABLE IF NOT EXISTS external_sync_runs (
    id              SERIAL      PRIMARY KEY,
    source_id       TEXT        NOT NULL REFERENCES external_sources(id),
    feed_label      TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
    failure_reason  TEXT,
    feed_synced_at  TEXT,
    counts          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    malformed       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    triggered_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS external_sync_runs_source_idx ON external_sync_runs (source_id, id DESC);

-- How a run classified each record it handled (R4-08).
CREATE TABLE IF NOT EXISTS external_sync_items (
    id                          SERIAL  PRIMARY KEY,
    run_id                      INTEGER NOT NULL REFERENCES external_sync_runs(id) ON DELETE CASCADE,
    external_opportunity_id     INTEGER REFERENCES external_opportunities(id) ON DELETE CASCADE,
    external_id                 TEXT    NOT NULL,
    classification              TEXT    NOT NULL,
    changed_fields              TEXT[]  NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS external_sync_items_run_idx ON external_sync_items (run_id);

-- What the source changed, and when (R4-17): kind is changed, not_seen, reappeared or withdrawn.
CREATE TABLE IF NOT EXISTS external_source_events (
    id                          SERIAL      PRIMARY KEY,
    external_opportunity_id     INTEGER     NOT NULL REFERENCES external_opportunities(id) ON DELETE CASCADE,
    run_id                      INTEGER     REFERENCES external_sync_runs(id) ON DELETE SET NULL,
    kind                        TEXT        NOT NULL,
    changed_fields              TEXT[]      NOT NULL DEFAULT '{}',
    previous                    JSONB,
    occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_source_events_opp_idx ON external_source_events (external_opportunity_id, id);

-- Local: a verified faculty member willing to support students pursuing it (R4-18 to R4-20), with
-- their own commentary (R4-16).
CREATE TABLE IF NOT EXISTS external_interest (
    external_opportunity_id  INTEGER     NOT NULL REFERENCES external_opportunities(id) ON DELETE CASCADE,
    faculty_user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note                     TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (external_opportunity_id, faculty_user_id)
);

-- Local: a student's own association with it and the history of what they recorded (R4-15).
CREATE TABLE IF NOT EXISTS external_student_links (
    external_opportunity_id  INTEGER     NOT NULL REFERENCES external_opportunities(id) ON DELETE CASCADE,
    user_id                  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                   TEXT        NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (external_opportunity_id, user_id)
);
CREATE TABLE IF NOT EXISTS external_student_link_history (
    id                       SERIAL      PRIMARY KEY,
    external_opportunity_id  INTEGER     NOT NULL REFERENCES external_opportunities(id) ON DELETE CASCADE,
    user_id                  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                   TEXT        NOT NULL,
    recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Local: readiness guidance written by Algoma faculty or staff (R4-21 to R4-24).
CREATE TABLE IF NOT EXISTS external_guidance (
    external_opportunity_id  INTEGER     PRIMARY KEY REFERENCES external_opportunities(id) ON DELETE CASCADE,
    suggest_prior_outcome    BOOLEAN     NOT NULL DEFAULT false,
    note                     TEXT,
    updated_by               INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE external_sources              ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_opportunities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_sync_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_sync_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_source_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_interest             ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_student_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_student_link_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_guidance             ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (id) VALUES ('008_external_sources') ON CONFLICT DO NOTHING;
