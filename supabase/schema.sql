-- FieldBridge — Supabase schema (Phase 2 target: nightly ingestion)
-- Applied when the nightly pipeline lands; the dashboard reads the static
-- artifact until then.

create table if not exists public.run_manifests (
  id           bigint generated always as identity primary key,
  engine       text not null,            -- fieldbridge@0.1.0
  config_hash  text not null,            -- content hash of ENGINE_CONFIG
  snapshot     text not null,            -- source snapshot reference
  works        integer not null,
  created_at   timestamptz not null default now()
);

-- One row per (field_a, field_b, year) citation-flow cell, coverage-aware.
create table if not exists public.field_pairs (
  field_a          text not null,
  field_b          text not null,
  year             integer not null,
  flow_ab          double precision not null,  -- share of a's resolved refs into b
  flow_ba          double precision not null,
  per1k_ab         double precision not null,  -- size-normalized
  per1k_ba         double precision not null,
  coverage_a       double precision not null,  -- resolved/declared refs for a
  coverage_b       double precision not null,
  keyword_overlap  double precision,
  run_id           bigint references public.run_manifests(id),
  primary key (field_a, field_b, year, run_id)
);

-- Dual-signal gap scores per run. Only surfaced rows have status='surfaced'.
create table if not exists public.gap_signals (
  id            bigint generated always as identity primary key,
  run_id        bigint references public.run_manifests(id),
  field_a       text not null,
  field_b       text not null,
  year          integer not null,
  gap_score     double precision not null,
  citation_gap  double precision not null,
  sim_growth    double precision not null,
  status        text not null check (status in ('surfaced', 'suppressed')),
  suppressed_for text[] not null default '{}',
  unique (run_id, field_a, field_b)
);

-- Retrospective validation ledger: the institutional credibility artifact.
-- A job re-scores historical runs and records hit-rate vs later ground truth.
create table if not exists public.validation_runs (
  id            bigint generated always as identity primary key,
  scored_year   integer not null,
  horizon_year  integer not null,
  top_k         integer not null,
  hit_rate      double precision not null,
  precision_at_k double precision[] not null default '{}',
  total_surfaced integer not null,
  bridged_count  integer not null,
  created_at    timestamptz not null default now()
);

-- pgvector for Phase 3 embedding similarity (hidden-connection signal).
create extension if not exists vector;

create table if not exists public.field_embeddings (
  field     text primary key,
  year      integer not null,
  embedding vector(384),   -- S2 SPECTER or OpenAlex n-gram embeddings (Phase 3)
  updated_at timestamptz not null default now()
);

create index if not exists field_pairs_year_idx on public.field_pairs (year);
create index if not exists gap_signals_year_idx on public.gap_signals (year, status);
create index if not exists field_embeddings_year_idx on public.field_embeddings (year);