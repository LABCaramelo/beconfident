-- PROPOSTA INDEPENDENTE, v0.1, 2026-10-29. Não é o esquema do BeConfident.
-- Núcleo para um banco PostgreSQL vazio. UUIDs são gerados pela aplicação.
-- Sem configuração de usuários/papéis/RLS, backup ou criptografia: implementar
-- autorização por proprietário e controles operacionais antes de uso real.
BEGIN;

CREATE TABLE learners (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  native_language text NOT NULL DEFAULT 'pt-BR',
  target_language text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo', -- validar IANA na aplicação
  lifecycle text NOT NULL DEFAULT 'onboarding'
    CHECK (lifecycle IN ('onboarding','assessing','plan_ready','practicing','restricted','deleting','deleted')),
  self_level text CHECK (self_level IN ('beginner','intermediate','advanced')),
  daily_goal_minutes smallint NOT NULL DEFAULT 15 CHECK (daily_goal_minutes BETWEEN 1 AND 180),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE identities (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  provider text NOT NULL,
  subject_hash text NOT NULL, -- HMAC do identificador externo; valor de contato cifrado fora de logs
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject_hash)
);

CREATE TABLE account_link_challenges (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  target_provider text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE consent_events (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  purpose text NOT NULL, -- e.g. service_audio, reminders, analytics
  decision text NOT NULL CHECK (decision IN ('granted','withdrawn')),
  policy_version text NOT NULL,
  channel text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_event_key text NOT NULL UNIQUE
); -- append-only por papel da aplicação; retirada é novo evento
CREATE INDEX consent_events_latest ON consent_events (learner_id,purpose,occurred_at DESC,id);

CREATE TABLE lead_invites (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  campaign text,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  claimed_by uuid REFERENCES learners(id),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);

CREATE TABLE tutors (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  language text NOT NULL,
  accent text NOT NULL,
  persona_version text NOT NULL,
  voice_ref text NOT NULL, -- referência servidor; não segredo
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  tutor_id uuid REFERENCES tutors(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp','app','web')),
  mode text NOT NULL DEFAULT 'conversation' CHECK (mode IN ('onboarding','assessment','conversation','teacher','lesson','review')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  topic text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,learner_id)
);
CREATE INDEX conversations_owner ON conversations (learner_id,updated_at DESC,id);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  kind text NOT NULL CHECK (kind IN ('audio','image','document')),
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending','ready','rejected','expired','deleted')),
  content_type text NOT NULL,
  size_bytes bigint CHECK (size_bytes >= 0),
  duration_ms integer CHECK (duration_ms >= 0),
  sha256 text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,learner_id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('learner','tutor','system')),
  kind text NOT NULL CHECK (kind IN ('text','audio','image','choice','event')),
  text_content text,
  media_id uuid,
  reply_to_id uuid,
  client_message_id text,
  provider text,
  provider_message_id text,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processing','completed','failed','cancelled')),
  transcript_confidence numeric(4,3) CHECK (transcript_confidence BETWEEN 0 AND 1),
  model_version text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id,learner_id) REFERENCES conversations(id,learner_id),
  FOREIGN KEY (media_id,learner_id) REFERENCES media_assets(id,learner_id),
  UNIQUE (id,learner_id),
  UNIQUE (id,conversation_id,learner_id),
  UNIQUE (conversation_id,sequence),
  UNIQUE (conversation_id,client_message_id),
  UNIQUE (provider,provider_message_id),
  CHECK ((provider IS NULL) = (provider_message_id IS NULL))
);
ALTER TABLE messages ADD CONSTRAINT messages_reply_same_conversation
  FOREIGN KEY (reply_to_id,conversation_id,learner_id) REFERENCES messages(id,conversation_id,learner_id);

CREATE TABLE conversation_events (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  event_type text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id,learner_id) REFERENCES conversations(id,learner_id),
  UNIQUE (conversation_id,version)
);

CREATE TABLE response_jobs (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  input_message_id uuid NOT NULL,
  output_message_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (input_message_id,learner_id) REFERENCES messages(id,learner_id),
  FOREIGN KEY (output_message_id,learner_id) REFERENCES messages(id,learner_id),
  UNIQUE (input_message_id)
);

CREATE TABLE learner_memories (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  kind text NOT NULL CHECK (kind IN ('preference','goal','session_summary','learning_summary')),
  content text NOT NULL,
  source_message_id uuid,
  origin text NOT NULL CHECK (origin IN ('explicit','inferred','summarized')),
  confirmed_at timestamptz,
  expires_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_message_id,learner_id) REFERENCES messages(id,learner_id)
); -- validar finalidade; não persistir automaticamente fatos pessoais incidentais
CREATE INDEX memories_owner ON learner_memories (learner_id,kind) WHERE withdrawn_at IS NULL;

CREATE TABLE assessments (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  rubric_version text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','scoring','completed','insufficient','cancelled','failed')),
  stage text NOT NULL DEFAULT 'self_level',
  self_level text,
  result jsonb,
  confidence numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id,learner_id)
);

CREATE TABLE assessment_responses (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  item_key text NOT NULL,
  item_version text NOT NULL,
  response jsonb NOT NULL,
  source_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (assessment_id,learner_id) REFERENCES assessments(id,learner_id),
  FOREIGN KEY (source_message_id,learner_id) REFERENCES messages(id,learner_id),
  UNIQUE (assessment_id,item_key)
);

CREATE TABLE modules (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  skill text NOT NULL,
  level_band text NOT NULL,
  learning_objective text NOT NULL,
  prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamptz,
  UNIQUE (slug,version)
);

CREATE TABLE activities (
  id uuid PRIMARY KEY,
  module_id uuid NOT NULL REFERENCES modules(id),
  item_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('presentation','choice','text','audio','roleplay','checkpoint')),
  phase text NOT NULL CHECK (phase IN ('presentation','practice','application','consolidation')),
  content jsonb NOT NULL,
  rubric jsonb NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (module_id,item_key),
  UNIQUE (module_id,position)
); -- não expor rubric/solução antes da tentativa

CREATE TABLE study_plans (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  assessment_id uuid,
  version integer NOT NULL CHECK (version > 0),
  goals jsonb NOT NULL,
  selected_modules jsonb NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (assessment_id,learner_id) REFERENCES assessments(id,learner_id),
  UNIQUE (learner_id,version)
);

CREATE TABLE activity_attempts (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  activity_id uuid NOT NULL REFERENCES activities(id),
  client_attempt_id text NOT NULL,
  response jsonb NOT NULL,
  feedback jsonb,
  status text NOT NULL CHECK (status IN ('submitted','scoring','completed','failed')),
  passed boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id,client_attempt_id)
);

CREATE TABLE learning_errors (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  message_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('grammar','vocabulary','pronunciation','expression','comprehension')),
  skill_key text NOT NULL,
  original_excerpt text NOT NULL,
  corrected_excerpt text NOT NULL,
  micro_rule text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rubric_version text NOT NULL,
  disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (message_id,learner_id) REFERENCES messages(id,learner_id),
  UNIQUE (id,learner_id)
);

CREATE TABLE review_items (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  error_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','suspended')),
  scheduler_version text NOT NULL,
  due_at timestamptz NOT NULL,
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  successful_attempts integer NOT NULL DEFAULT 0 CHECK (successful_attempts >= 0),
  state_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (error_id,learner_id) REFERENCES learning_errors(id,learner_id),
  UNIQUE (error_id),
  UNIQUE (id,learner_id)
);
CREATE INDEX review_due ON review_items (learner_id,due_at,id) WHERE status = 'active';

CREATE TABLE review_attempts (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  review_item_id uuid NOT NULL,
  client_attempt_id text NOT NULL,
  response jsonb NOT NULL,
  rating text NOT NULL CHECK (rating IN ('again','assisted','independent','easy')),
  feedback jsonb NOT NULL,
  scheduler_version text NOT NULL,
  due_before timestamptz NOT NULL,
  due_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (review_item_id,learner_id) REFERENCES review_items(id,learner_id),
  UNIQUE (learner_id,client_attempt_id)
);

CREATE TABLE calls (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  tutor_id uuid NOT NULL REFERENCES tutors(id),
  conversation_id uuid,
  status text NOT NULL CHECK (status IN ('scheduled','created','connecting','active','ending','completed','cancelled','expired','failed')),
  topic text,
  scheduled_at timestamptz,
  scheduled_timezone text,
  started_at timestamptz,
  ended_at timestamptz,
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id,learner_id) REFERENCES conversations(id,learner_id),
  UNIQUE (id,learner_id),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE call_events (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL,
  call_id uuid NOT NULL,
  external_event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  sequence bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (call_id,learner_id) REFERENCES calls(id,learner_id),
  UNIQUE (call_id,sequence)
);

CREATE TABLE practice_events (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  source_key text NOT NULL UNIQUE,
  source_kind text NOT NULL CHECK (source_kind IN ('message','call','activity','review')),
  source_id uuid NOT NULL, -- referência validada no módulo de origem
  active_seconds integer NOT NULL CHECK (active_seconds >= 0),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  occurred_at timestamptz NOT NULL,
  local_date date NOT NULL,
  timezone_at_event text NOT NULL,
  rules_version text NOT NULL
);
CREATE INDEX practice_events_owner ON practice_events (learner_id,occurred_at,id);

CREATE TABLE daily_progress (
  learner_id uuid NOT NULL REFERENCES learners(id),
  local_date date NOT NULL,
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  goal_completed boolean NOT NULL DEFAULT false,
  last_rebuilt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id,local_date)
); -- agregado reconstruível, nunca fonte única de progresso

CREATE TABLE skill_snapshots (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  skill_key text NOT NULL,
  score numeric NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  scale_version text NOT NULL,
  evidence_refs jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  channel text NOT NULL,
  external_product_id text NOT NULL,
  grants jsonb NOT NULL, -- capacidade/limite, não preço enviado pelo cliente
  active boolean NOT NULL DEFAULT true,
  UNIQUE (channel,external_product_id)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  product_id uuid NOT NULL REFERENCES products(id),
  provider text NOT NULL,
  external_subscription_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('trial','active','grace','past_due','cancelled','expired','refunded','revoked')),
  access_until timestamptz,
  renews boolean NOT NULL DEFAULT false,
  provider_version text NOT NULL,
  last_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,external_subscription_id),
  UNIQUE (id,learner_id)
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  product_id uuid NOT NULL REFERENCES products(id),
  provider text NOT NULL,
  external_transaction_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('verified','refunded','revoked')),
  provider_version text NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (provider,external_transaction_id),
  UNIQUE (id,learner_id)
); -- titularidade canônica; restauração não transfere compra para outra conta

CREATE TABLE entitlements (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  subscription_id uuid,
  purchase_id uuid,
  source_kind text NOT NULL CHECK (source_kind IN ('trial','subscription','purchase','manual')),
  capability text NOT NULL,
  source_key text NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  usage_limit integer CHECK (usage_limit >= 0),
  FOREIGN KEY (subscription_id,learner_id) REFERENCES subscriptions(id,learner_id),
  FOREIGN KEY (purchase_id,learner_id) REFERENCES purchases(id,learner_id),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK ((source_kind = 'subscription' AND subscription_id IS NOT NULL AND purchase_id IS NULL)
      OR (source_kind = 'purchase' AND purchase_id IS NOT NULL AND subscription_id IS NULL)
      OR (source_kind IN ('trial','manual') AND subscription_id IS NULL AND purchase_id IS NULL))
);
CREATE INDEX entitlements_owner ON entitlements (learner_id,capability,expires_at);
CREATE UNIQUE INDEX entitlements_purchase_capability ON entitlements (purchase_id,capability)
  WHERE purchase_id IS NOT NULL;

CREATE TABLE purchase_events (
  id uuid PRIMARY KEY,
  learner_id uuid REFERENCES learners(id),
  purchase_id uuid,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  external_transaction_id text,
  event_type text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('pending','verified','rejected')),
  normalized_payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,external_event_id),
  FOREIGN KEY (purchase_id,learner_id) REFERENCES purchases(id,learner_id),
  CHECK (purchase_id IS NULL OR learner_id IS NOT NULL)
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  payload_sha256 text NOT NULL,
  normalized_payload jsonb NOT NULL, -- mínimo necessário; retenção curta, sem cabeçalhos de segredo
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','dead_letter')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider,external_event_id)
);
CREATE INDEX inbox_pending ON webhook_inbox (available_at,id) WHERE status = 'pending';

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  learner_id uuid REFERENCES learners(id),
  destination text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','unknown','dead_letter','cancelled')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX outbox_pending ON outbox (available_at,id) WHERE status = 'pending';

CREATE TABLE idempotency_records (
  principal_id uuid NOT NULL REFERENCES learners(id),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  response_status smallint,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id,operation,idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE TABLE data_requests (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id),
  kind text NOT NULL CHECK (kind IN ('export','deletion')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','processing','completed','failed','cancelled')),
  verification_ref text,
  result_media_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (result_media_id,learner_id) REFERENCES media_assets(id,learner_id)
);

COMMIT;
