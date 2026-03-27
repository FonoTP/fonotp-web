INSERT INTO organizations (id, name, domain, plan, status, monthly_spend, active_calls) VALUES
  ('org-nova', 'Nova Health Connect', 'novahealth.example', 'Enterprise', 'Active', 18240, 18),
  ('org-axis', 'Axis Dispatch', 'axisdispatch.example', 'Growth', 'Active', 7340, 9),
  ('org-orbit', 'Orbit CX Labs', 'orbitcx.example', 'Trial', 'Trial', 1240, 2);

INSERT INTO platform_users (user_id, organization_id, name, email, password_hash, company, group_name, role, status, last_login) VALUES
  ('usr-1001', 'org-nova', 'Mara Kent', 'mara@novahealth.example', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'Nova Health Connect', 'Operations', 'Owner', 'Active', '2026-03-25 09:12'),
  ('usr-1002', 'org-nova', 'Dev Patel', 'dev@novahealth.example', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'Nova Health Connect', 'Bot Ops', 'Admin', 'Active', '2026-03-25 08:46'),
  ('usr-2001', 'org-axis', 'Anika Ross', 'anika@axisdispatch.example', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'Axis Dispatch', 'Support', 'Manager', 'Active', '2026-03-24 17:03'),
  ('usr-2002', 'org-axis', 'Luis Mendez', 'luis@axisdispatch.example', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'Axis Dispatch', 'Finance', 'Billing', 'Invited', 'Pending'),
  ('usr-3001', 'org-orbit', 'Sia Monroe', 'sia@orbitcx.example', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'Orbit CX Labs', 'Product', 'Agent', 'Suspended', '2026-03-20 14:19'),
  ('usr-admin', 'org-nova', 'Platform Admin', 'owner@fonotp.ai', '$2a$10$Mlm4PeWN.dP89a.MQP7or.6Rg7vDj0RUynBoEPezOlnKhpIY3jKBK', 'FonoTP', 'Platform', 'Owner', 'Active', '2026-03-25 10:02');

INSERT INTO agents (
  id, organization_id, created_by_user_id, name, slug, status, channel, stt_type, stt_prompt, llm_type, llm_prompt, tts_type, tts_prompt, tts_voice, runtime_url, created_at, updated_at
) VALUES
  (
    'agent-nova-intake',
    'org-nova',
    'usr-1001',
    'Nova Intake Assistant',
    'nova-intake',
    'Active',
    'WebRTC',
    'gpt-4o-mini-transcribe',
    'Transcribe spoken healthcare intake questions accurately in the selected language.',
    'gpt-realtime',
    'You are a concise healthcare intake assistant. Verify intent, ask short follow-up questions, and keep responses calm and clear.',
    'gpt-realtime',
    'Speak naturally, keep responses brief, and sound calm and clear.',
    'alloy',
    'ws://127.0.0.1:8090/ws',
    '2026-03-25T09:00:00.000Z',
    '2026-03-25T09:00:00.000Z'
  ),
  (
    'agent-nova-claims',
    'org-nova',
    'usr-1002',
    'Claims Assistant',
    'claims-assistant',
    'Active',
    'WebRTC',
    'gpt-4o-mini-transcribe',
    'Transcribe claims support calls accurately, preserving numbers, dates, and case details.',
    'gpt-realtime',
    'You are a claims support voice agent. Summarize issues clearly, gather missing details, and hand off when policy questions require a human.',
    'gpt-realtime',
    'Speak in a professional, reassuring tone and confirm key claim details clearly.',
    'verse',
    'ws://127.0.0.1:8090/ws',
    '2026-03-25T09:05:00.000Z',
    '2026-03-25T09:05:00.000Z'
  ),
  (
    'agent-axis-dispatch',
    'org-axis',
    'usr-2001',
    'Dispatch Assistant',
    'dispatch-assistant',
    'Active',
    'WebRTC',
    'gpt-4o-mini-transcribe',
    'Transcribe dispatch and route updates accurately, including names, addresses, and ETA values.',
    'gpt-realtime',
    'You are a dispatch voice assistant. Confirm jobs, capture ETA updates, and keep the caller moving efficiently.',
    'gpt-realtime',
    'Speak efficiently and clearly, prioritizing times, route details, and next actions.',
    'alloy',
    'ws://127.0.0.1:8090/ws',
    '2026-03-25T09:10:00.000Z',
    '2026-03-25T09:10:00.000Z'
  );

INSERT INTO calls (id, organization_id, caller, direction, channel, flow, duration, started_at, status, characters_in, characters_out) VALUES
  ('call-7801', 'org-nova', '+1 (317) 555-0141', 'Inbound', 'SIP', 'Appointment Routing', '08:24', '2026-03-25 09:20', 'Completed', 6821, 7410),
  ('call-7802', 'org-axis', 'api-trigger / pickup-queue', 'Outbound', 'API', 'Dispatch Confirmation', '03:17', '2026-03-25 09:31', 'Live', 2190, 1642),
  ('call-7803', 'org-nova', 'browser-client / claims-escalation', 'Inbound', 'WebRTC', 'Claims Assistant', '11:02', '2026-03-24 15:08', 'Escalated', 9024, 10011);

UPDATE calls
SET agent_id = 'agent-nova-claims',
    platform_user_id = 'usr-1001',
    runtime_session_id = 'rt-session-7803',
    ended_at = '2026-03-24 15:19',
    summary = 'The caller disputed a denied claim, the agent gathered details, then escalated to a human specialist.'
WHERE id = 'call-7803';

INSERT INTO call_transcript_entries (call_id, position, line) VALUES
  ('call-7801', 1, 'Caller asked to reschedule an oncology follow-up.'),
  ('call-7801', 2, 'AI confirmed patient identity and pulled available slots.'),
  ('call-7801', 3, 'Flow builder routed call to nurse queue after medication question.'),
  ('call-7802', 1, 'Outbound bot calling driver to confirm ETA window.'),
  ('call-7802', 2, 'WebSocket stream attached to AI bot service successfully.'),
  ('call-7802', 3, 'Live transfer available if driver requests operator.'),
  ('call-7803', 1, 'Customer entered through embedded web voice client.'),
  ('call-7803', 2, 'Service Builder recognized billing dispute intent.'),
  ('call-7803', 3, 'Session transferred to human claims specialist with transcript context.');

INSERT INTO billing_records (id, organization_id, month, amount, status, payment_method) VALUES
  ('bill-0326-nova', 'org-nova', 'March 2026', 18240, 'Processing', 'ACH ending 8821'),
  ('bill-0326-axis', 'org-axis', 'March 2026', 7340, 'Due', 'Visa ending 1118'),
  ('bill-0326-orbit', 'org-orbit', 'March 2026', 1240, 'Paid', 'Mastercard ending 2904');
