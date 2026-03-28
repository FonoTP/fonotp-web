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

INSERT INTO agent_templates (
  template_key, name, description, category, default_channel, runtime_url, stt_type, stt_prompt, llm_type, llm_prompt, tts_type, tts_prompt, tts_voice, created_at, updated_at
) VALUES
  (
    'appointment-agent',
    'Appointment Agent',
    'Book, reschedule, cancel, and confirm appointments between workers and clients using shared scheduling data.',
    'Scheduling',
    'WebRTC',
    'ws://127.0.0.1:3011/ws',
    'gpt-4o-mini-transcribe',
    'Transcribe patient scheduling requests accurately, preserving names, dates, times, and doctor names.',
    'gpt-realtime',
    'You are a calm doctor appointment voice agent. Help callers book, reschedule, cancel, and confirm appointments with available medical staff. Use the scheduling tools instead of inventing availability.',
    'gpt-realtime',
    'Speak naturally, keep answers concise, and confirm dates and times clearly.',
    'alloy',
    '2026-03-25T08:30:00.000Z',
    '2026-03-25T08:30:00.000Z'
  );

INSERT INTO agents_defs (
  id, public_id, organization_id, created_by_user_id, template_key, name, slug, status, channel, runtime_url, stt_type, stt_prompt, llm_type, llm_prompt, tts_type, tts_prompt, tts_voice, created_at, updated_at
) VALUES
  (
    1,
    'agent-nova-intake',
    'org-nova',
    'usr-1001',
    NULL,
    'Nova Intake Assistant',
    'nova-intake',
    'Active',
    'WebRTC',
    'ws://127.0.0.1:8000/ws',
    'gpt-4o-mini-transcribe',
    'Transcribe spoken healthcare intake questions accurately in the selected language.',
    'gpt-realtime',
    'You are a concise healthcare intake assistant. Verify intent, ask short follow-up questions, and keep responses calm and clear.',
    'gpt-realtime',
    'Speak naturally, keep responses brief, and sound calm and clear.',
    'alloy',
    '2026-03-25T09:00:00.000Z',
    '2026-03-25T09:00:00.000Z'
  ),
  (
    2,
    'agent-nova-claims',
    'org-nova',
    'usr-1002',
    NULL,
    'Claims Assistant',
    'claims-assistant',
    'Active',
    'WebRTC',
    'ws://127.0.0.1:8000/ws',
    'gpt-4o-mini-transcribe',
    'Transcribe claims support calls accurately, preserving numbers, dates, and case details.',
    'gpt-realtime',
    'You are a claims support voice agent. Summarize issues clearly, gather missing details, and hand off when policy questions require a human.',
    'gpt-realtime',
    'Speak in a professional, reassuring tone and confirm key claim details clearly.',
    'verse',
    '2026-03-25T09:05:00.000Z',
    '2026-03-25T09:05:00.000Z'
  ),
  (
    3,
    'agent-axis-dispatch',
    'org-axis',
    'usr-2001',
    NULL,
    'Dispatch Assistant',
    'dispatch-assistant',
    'Active',
    'WebRTC',
    'ws://127.0.0.1:8000/ws',
    'gpt-4o-mini-transcribe',
    'Transcribe dispatch and route updates accurately, including names, addresses, and ETA values.',
    'gpt-realtime',
    'You are a dispatch voice assistant. Confirm jobs, capture ETA updates, and keep the caller moving efficiently.',
    'gpt-realtime',
    'Speak efficiently and clearly, prioritizing times, route details, and next actions.',
    'alloy',
    '2026-03-25T09:10:00.000Z',
    '2026-03-25T09:10:00.000Z'
  ),
  (
    4,
    'agent-nova-appointment-demo',
    'org-nova',
    'usr-1001',
    'appointment-agent',
    'Appointment Agent',
    'appointment-agent',
    'Active',
    'WebRTC',
    'ws://127.0.0.1:3011/ws',
    'gpt-4o-mini-transcribe',
    'Transcribe patient scheduling requests accurately, preserving names, dates, times, and doctor names.',
    'gpt-realtime',
    'You are a calm doctor appointment voice agent. Help callers book, reschedule, cancel, and confirm appointments with available medical staff. Use the scheduling tools instead of inventing availability.',
    'gpt-realtime',
    'Speak naturally, keep answers concise, and confirm dates and times clearly.',
    'alloy',
    '2026-03-25T09:12:00.000Z',
    '2026-03-25T09:12:00.000Z'
  );

INSERT INTO agent_sessions (
  id,
  organization_id,
  agent_id,
  platform_user_id,
  runtime_session_id,
  caller,
  direction,
  channel,
  session_status,
  language,
  stt_provider,
  flow,
  duration,
  started_at,
  ended_at,
  summary,
  characters_in,
  characters_out,
  agent_stt_type,
  agent_stt_prompt,
  agent_llm_type,
  agent_llm_prompt,
  agent_tts_type,
  agent_tts_prompt,
  agent_tts_voice
) VALUES
  (
    'session-7801',
    'org-nova',
    1,
    'usr-1001',
    'rt-session-7801',
    '+1 (317) 555-0141',
    'Inbound',
    'SIP',
    'Completed',
    'en',
    'openai',
    'Appointment Routing',
    '08:24',
    '2026-03-25 09:20',
    '2026-03-25 09:28',
    'The caller rescheduled an oncology follow-up and the intake assistant routed a medication question to the nurse queue.',
    6821,
    7410,
    'gpt-4o-mini-transcribe',
    'Transcribe spoken healthcare intake questions accurately in the selected language.',
    'gpt-realtime',
    'You are a concise healthcare intake assistant. Verify intent, ask short follow-up questions, and keep responses calm and clear.',
    'gpt-realtime',
    'Speak naturally, keep responses brief, and sound calm and clear.',
    'alloy'
  ),
  (
    'session-7802',
    'org-axis',
    3,
    'usr-2001',
    'rt-session-7802',
    'api-trigger / pickup-queue',
    'Outbound',
    'API',
    'Live',
    'en',
    'openai',
    'Dispatch Confirmation',
    '03:17',
    '2026-03-25 09:31',
    NULL,
    NULL,
    2190,
    1642,
    'gpt-4o-mini-transcribe',
    'Transcribe dispatch and route updates accurately, including names, addresses, and ETA values.',
    'gpt-realtime',
    'You are a dispatch voice assistant. Confirm jobs, capture ETA updates, and keep the caller moving efficiently.',
    'gpt-realtime',
    'Speak efficiently and clearly, prioritizing times, route details, and next actions.',
    'alloy'
  ),
  (
    'session-7803',
    'org-nova',
    2,
    'usr-1001',
    'rt-session-7803',
    'browser-client / claims-escalation',
    'Inbound',
    'WebRTC',
    'Escalated',
    'en',
    'openai',
    'Claims Assistant',
    '11:02',
    '2026-03-24 15:08',
    '2026-03-24 15:19',
    'The caller disputed a denied claim, the agent gathered details, then escalated to a human specialist.',
    9024,
    10011,
    'gpt-4o-mini-transcribe',
    'Transcribe claims support calls accurately, preserving numbers, dates, and case details.',
    'gpt-realtime',
    'You are a claims support voice agent. Summarize issues clearly, gather missing details, and hand off when policy questions require a human.',
    'gpt-realtime',
    'Speak in a professional, reassuring tone and confirm key claim details clearly.',
    'verse'
  );

INSERT INTO agent_session_events (agent_session_id, position, event_type, line) VALUES
  ('session-7801', 1, 'transcript', 'Caller asked to reschedule an oncology follow-up.'),
  ('session-7801', 2, 'transcript', 'AI confirmed patient identity and pulled available slots.'),
  ('session-7801', 3, 'transcript', 'Flow builder routed call to nurse queue after medication question.'),
  ('session-7802', 1, 'transcript', 'Outbound bot calling driver to confirm ETA window.'),
  ('session-7802', 2, 'transcript', 'WebSocket stream attached to AI bot service successfully.'),
  ('session-7802', 3, 'transcript', 'Live transfer available if driver requests operator.'),
  ('session-7803', 1, 'transcript', 'Customer entered through embedded web voice client.'),
  ('session-7803', 2, 'transcript', 'Service Builder recognized billing dispute intent.'),
  ('session-7803', 3, 'transcript', 'Session transferred to human claims specialist with transcript context.');

INSERT INTO billing_records (id, organization_id, month, amount, status, payment_method) VALUES
  ('bill-0326-nova', 'org-nova', 'March 2026', 18240, 'Processing', 'ACH ending 8821'),
  ('bill-0326-axis', 'org-axis', 'March 2026', 7340, 'Due', 'Visa ending 1118'),
  ('bill-0326-orbit', 'org-orbit', 'March 2026', 1240, 'Paid', 'Mastercard ending 2904');

INSERT INTO appointment_workers (
  id, organization_id, agent_id, name, role_label, specialty, location_label, availability_summary, status, created_at
) VALUES
  (
    'worker-nova-1',
    'org-nova',
    4,
    'Dr. Elise Warren',
    'Physician',
    'Primary care',
    'North Clinic',
    'Mon-Fri · 9:00, 11:00, 14:00',
    'Active',
    '2026-03-25T09:12:00.000Z'
  ),
  (
    'worker-nova-2',
    'org-nova',
    4,
    'Jordan Park',
    'Nurse practitioner',
    'Follow-up visits',
    'North Clinic',
    'Mon-Fri · 10:00, 13:00, 15:00',
    'Active',
    '2026-03-25T09:12:00.000Z'
  ),
  (
    'worker-nova-3',
    'org-nova',
    4,
    'Mina Alvarez',
    'Care coordinator',
    'New patient intake',
    'Virtual',
    'Mon-Thu · 9:30, 12:30, 16:00',
    'Active',
    '2026-03-25T09:12:00.000Z'
  );

INSERT INTO appointment_clients (
  id, organization_id, agent_id, full_name, phone, email, notes, created_at
) VALUES
  (
    'client-nova-1',
    'org-nova',
    4,
    'Amelia Stone',
    '+1 (317) 555-0177',
    'amelia.stone@example.com',
    'Prefers morning appointments.',
    '2026-03-25T09:12:00.000Z'
  ),
  (
    'client-nova-2',
    'org-nova',
    4,
    'Marcus Lee',
    '+1 (317) 555-0182',
    'marcus.lee@example.com',
    'Needs follow-up after annual physical.',
    '2026-03-25T09:12:00.000Z'
  ),
  (
    'client-nova-3',
    'org-nova',
    4,
    'Priya Nair',
    '+1 (317) 555-0194',
    'priya.nair@example.com',
    'Virtual visit requested.',
    '2026-03-25T09:12:00.000Z'
  );

INSERT INTO appointments (
  id, organization_id, agent_id, worker_id, client_id, status, start_at, end_at, summary, created_at, updated_at
) VALUES
  (
    'appt-nova-1',
    'org-nova',
    4,
    'worker-nova-1',
    'client-nova-1',
    'Scheduled',
    '2026-03-30T14:00:00.000Z',
    '2026-03-30T14:30:00.000Z',
    'Primary care follow-up for Amelia Stone with Dr. Elise Warren.',
    '2026-03-25T09:12:00.000Z',
    '2026-03-25T09:12:00.000Z'
  ),
  (
    'appt-nova-2',
    'org-nova',
    4,
    'worker-nova-2',
    'client-nova-2',
    'Confirmed',
    '2026-03-31T13:00:00.000Z',
    '2026-03-31T13:30:00.000Z',
    'Follow-up visit for Marcus Lee with Jordan Park.',
    '2026-03-25T09:12:00.000Z',
    '2026-03-25T09:12:00.000Z'
  );

SELECT setval(
  pg_get_serial_sequence('agents_defs', 'id'),
  COALESCE((SELECT MAX(id) FROM agents_defs), 1),
  true
);
