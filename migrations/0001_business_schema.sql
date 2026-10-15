-- InvoiceMatch AI business schema.
-- Lives in its own "app" schema: on Supabase the "public" schema is exposed through the Data API,
-- while "app" is reachable only through the server-side DATABASE_URL connection.
-- Mastra's workflow snapshots live in the separate "mastra" schema (created by @mastra/pg).

create schema if not exists app;

create table app.suppliers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (length(code) between 1 and 32),
  name        text not null check (length(name) between 1 and 120),
  tax_id      text,
  created_at  timestamptz not null default now()
);

create table app.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  po_number    text not null unique,
  supplier_id  uuid not null references app.suppliers(id),
  currency     char(3) not null check (currency in ('EUR', 'USD', 'GBP', 'JPY')),
  status       text not null check (status in ('OPEN', 'CLOSED')),
  subtotal     numeric(18, 6) not null check (subtotal >= 0),
  tax          numeric(18, 6) not null check (tax >= 0),
  total        numeric(18, 6) not null check (total >= 0),
  created_at   timestamptz not null default now()
);
create index purchase_orders_supplier_status_idx on app.purchase_orders (supplier_id, status);

create table app.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references app.purchase_orders(id) on delete cascade,
  line_id            text not null,
  position           integer not null check (position >= 0),
  sku                text,
  description        text not null,
  quantity           numeric(18, 6) not null check (quantity > 0),
  unit_price         numeric(18, 6) not null check (unit_price >= 0),
  tax_rate           numeric(7, 6) not null check (tax_rate between 0 and 1),
  line_subtotal      numeric(18, 6) not null check (line_subtotal >= 0),
  unique (purchase_order_id, line_id)
);

create table app.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null,
  supplier_id     uuid not null references app.suppliers(id),
  po_reference    text,
  invoice_date    date not null,
  currency        char(3) not null check (currency in ('EUR', 'USD', 'GBP', 'JPY')),
  -- Declared (printed) amounts as received; recomputed values live in the reconciliation result.
  subtotal        numeric(18, 6) not null check (subtotal >= 0),
  tax             numeric(18, 6) not null check (tax >= 0),
  total           numeric(18, 6) not null check (total >= 0),
  source          jsonb not null,
  is_historical   boolean not null default false,
  created_at      timestamptz not null default now()
);
-- Not unique on purpose: a second invoice with the same number must be stored and flagged as a
-- duplicate for review, never silently accepted or silently dropped.
create index invoices_supplier_number_idx on app.invoices (supplier_id, invoice_number);

create table app.invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references app.invoices(id) on delete cascade,
  line_id        text not null,
  position       integer not null check (position >= 0),
  sku            text,
  description    text not null,
  quantity       numeric(18, 6) not null check (quantity > 0),
  unit_price     numeric(18, 6) not null check (unit_price >= 0),
  tax_rate       numeric(7, 6) not null check (tax_rate between 0 and 1),
  line_subtotal  numeric(18, 6) check (line_subtotal >= 0),
  unique (invoice_id, line_id)
);

create table app.reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null unique references app.invoices(id),
  purchase_order_id  uuid references app.purchase_orders(id),
  workflow_run_id    text not null unique,
  idempotency_key    text not null unique,
  scenario_id        text,
  status             text not null check (status in (
                       'PROCESSING', 'MATCHED', 'REVIEW_REQUIRED', 'UNMATCHED',
                       'APPROVED_WITH_EXCEPTION', 'REJECTED', 'FAILED')),
  agent_mode         text not null check (agent_mode in ('mock', 'anthropic', 'none')),
  agent_invoked      boolean not null default false,
  result             jsonb,
  agent_output       jsonb,
  trace_id           text,
  error_code         text,
  error_message      text,
  requested_by       text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finalized_at       timestamptz
);
create index reconciliations_status_idx on app.reconciliations (status, created_at desc);

create table app.review_decisions (
  id                 uuid primary key default gen_random_uuid(),
  -- One terminal human decision per reconciliation; concurrent approvals lose on this constraint.
  reconciliation_id  uuid not null unique references app.reconciliations(id),
  reviewer           text not null,
  decision           text not null check (decision in ('APPROVE', 'REJECT')),
  reason             text not null check (length(reason) >= 5),
  idempotency_key    text not null unique,
  resume_status      text not null default 'PENDING' check (resume_status in ('PENDING', 'RESUMED')),
  created_at         timestamptz not null default now(),
  resumed_at         timestamptz
);

-- Append-only audit trail.
create table app.reconciliation_events (
  id                 bigserial primary key,
  reconciliation_id  uuid not null references app.reconciliations(id),
  event_type         text not null,
  actor              text not null,
  payload            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index reconciliation_events_rec_idx on app.reconciliation_events (reconciliation_id, id);

-- Server-side ledger for live model calls (budget guard). Mock runs never write here.
create table app.llm_usage (
  id                  uuid primary key default gen_random_uuid(),
  reconciliation_id   uuid references app.reconciliations(id),
  model               text not null,
  status              text not null check (status in ('RESERVED', 'COMPLETED', 'FAILED')),
  request_count       integer not null check (request_count >= 0),
  input_tokens        integer,
  output_tokens       integer,
  estimated_cost_usd  numeric(12, 6) not null default 0,
  created_at          timestamptz not null default now()
);

-- Immutability guards ---------------------------------------------------------------------------

create function app.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on %.% is not allowed (append-only)', tg_op, tg_table_schema, tg_table_name;
end;
$$;

create trigger reconciliation_events_append_only
  before update or delete on app.reconciliation_events
  for each row execute function app.forbid_mutation();

create function app.protect_review_decision() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'review decisions cannot be deleted';
  end if;
  if new.reconciliation_id is distinct from old.reconciliation_id
     or new.reviewer is distinct from old.reviewer
     or new.decision is distinct from old.decision
     or new.reason is distinct from old.reason
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'review decision fields are immutable';
  end if;
  return new;
end;
$$;

create trigger review_decisions_immutable
  before update or delete on app.review_decisions
  for each row execute function app.protect_review_decision();
