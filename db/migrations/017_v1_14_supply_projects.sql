-- Personal projects are finite; selecting one does not create or charge anything.
CREATE TABLE IF NOT EXISTS supply_project_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  definition_version INT NOT NULL CHECK(definition_version > 0),
  definition_json JSONB NOT NULL CHECK(jsonb_typeof(definition_json)='object'),
  stage_index INT NOT NULL DEFAULT 0 CHECK(stage_index BETWEEN 0 AND 3),
  delivered_json JSONB NOT NULL DEFAULT '{"ore":0,"energy":0,"parts":0}'::jsonb CHECK(jsonb_typeof(delivered_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(user_id,project_key),
  CHECK((stage_index=3 AND completed_at IS NOT NULL) OR (stage_index<3 AND completed_at IS NULL))
);
CREATE TABLE IF NOT EXISTS supply_project_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json JSONB NOT NULL CHECK(jsonb_typeof(result_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
INSERT INTO cosmetics(id,name,category,metadata) VALUES
('title_cargo_dispatcher','Диспетчер лунного конвоя','title','{"supply_project":true}'::jsonb),
('title_polar_engineer','Исследователь полюса','title','{"supply_project":true}'::jsonb),
('title_dawn_founder','Основатель Рассвета','title','{"supply_project":true}'::jsonb)
ON CONFLICT(id) DO NOTHING;
