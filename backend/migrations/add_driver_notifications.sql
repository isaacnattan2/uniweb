CREATE TABLE IF NOT EXISTS driver_notifications (
  id text PRIMARY KEY,
  driver_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_notifications_feed_idx
  ON driver_notifications (driver_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS driver_notification_reads (
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id text NOT NULL REFERENCES driver_notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (driver_id, notification_id)
);

ALTER TABLE driver_app_release ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

INSERT INTO driver_notifications (id, kind, title, body, data, created_at)
SELECT 'apk:' || version_code, 'android_apk_release', 'Nova versão do UniEntregador',
       'Baixe e instale o novo APK para atualizar o aplicativo.',
       jsonb_build_object('versionName', version_name, 'versionCode', version_code), published_at
FROM driver_app_release
ON CONFLICT (id) DO NOTHING;
