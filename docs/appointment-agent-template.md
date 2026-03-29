# Appointment Agent Template

This document explains the first `Appointment Agent` template implementation in `fonotp-web`, what data it owns, how the demo flow works, and the design logic behind the current MVP.

## Purpose

The `Appointment Agent` is the first example of turning `fonotp-web` from a control plane that stores voice agents into a control plane that can also define reusable agent templates and tenant-specific agents created from those templates.

The specific template goal is:

- manage `workers`
- manage `clients`
- manage `appointments`
- provide a text-first demo so a logged-in user can select the template, create an agent in their org, and try it from the dashboard

This is intentionally narrower than a full production scheduler. The current version proves the structure needed for future tenant-owned agents and future vertical templates.

## What Was Added

The MVP adds four major pieces:

1. `agent_templates` in the database
2. `template_key` on `agents_defs`
3. demo scheduling tables: `appointment_workers`, `appointment_clients`, `appointments`
4. dashboard UI and API routes for template creation and text demo interaction
5. an internal appointment command handler inside `fonotp-web`

## Core Design Decision

The main design choice is:

- templates are global definitions
- created agents are organization-owned instances

That means:

- admins or seeded platform data can define a template once
- each organization gets its own real agent record in `agents_defs`
- business data is stored against that created agent, not against the template

This avoids a common failure mode where all tenants share one mutable “template agent” row.

## Data Model

### `agent_templates`

This is the source definition for reusable agent types.

Current fields:

- `template_key`
- `name`
- `description`
- `category`
- `default_channel`
- `runtime_url`
- `stt_type`
- `stt_prompt`
- `llm_type`
- `llm_prompt`
- `tts_type`
- `tts_prompt`
- `tts_voice`
- timestamps

Why this exists:

- the system needs a place to define reusable agent products before a tenant creates one
- the template stores default config that can be copied into `agents_defs`
- the template is stable while instances remain tenant-specific

### `agents_defs.template_key`

Each created agent can now optionally point back to the template it came from.

Why this exists:

- lets the dashboard recognize “appointment agents”
- allows future filtering, reporting, upgrades, and analytics by template family
- keeps backward compatibility with existing non-template agents

### `appointment_workers`

Represents the service provider or resource.

Current fields:

- `id`
- `organization_id`
- `agent_id`
- `name`
- `role_label`
- `specialty`
- `location_label`
- `availability_summary`
- `status`
- `created_at`

Why `agent_id` is included:

- the same organization may eventually have multiple appointment agents
- demo data should belong to the specific created agent instance

### `appointment_clients`

Represents the customer/patient/guest.

Current fields:

- `id`
- `organization_id`
- `agent_id`
- `full_name`
- `phone`
- `email`
- `notes`
- `created_at`

### `appointments`

Represents scheduled interactions between one worker and one client.

Current fields:

- `id`
- `organization_id`
- `agent_id`
- `worker_id`
- `client_id`
- `status`
- `start_at`
- `end_at`
- `summary`
- timestamps

Why the model is this simple:

- enough to demonstrate agent reasoning and booking flow
- avoids overbuilding recurrence rules and calendar complexity too early
- leaves room for future tables such as `services`, `availability_rules`, or `locations`

## Seeded Template And Demo Agent

The seed now creates:

- a global template with `template_key = appointment-agent`
- one demo org-owned appointment agent for `org-nova`
- demo workers
- demo clients
- demo appointments

Why seed one org-owned demo agent:

- the dashboard can show a working example immediately
- the create-from-template flow can be tested against something already familiar
- it reduces ambiguity about what a created instance should look like

## API Endpoints Added

### `GET /api/agent-templates`

Returns the template catalog.

Current use:

- lets the dashboard discover that `Appointment Agent` exists

### `POST /api/agent-templates/:templateKey/create-agent`

Creates a real organization-owned agent from the chosen template and seeds demo scheduling data for it.

Current behavior:

- copies defaults from `agent_templates`
- inserts a row into `agents_defs`
- seeds workers, clients, and appointments for that created instance

Why creation is explicit:

- templates should not be runnable directly
- users should always operate on their own org instance

### `GET /api/appointment-agent/:agentId/context`

Returns a snapshot of:

- workers
- clients
- appointments
- computed available slots

This gives the dashboard a single load endpoint for the demo panel.

### `POST /api/appointment-agent/:agentId/chat`

Interprets appointment commands inside `fonotp-web` and then applies the resulting operation to the database.

Supported commands are intentionally simple:

- show workers
- book an appointment
- move or reschedule an appointment
- cancel one appointment
- cancel multiple appointments on a given day

The text demo is now handled directly in the control plane. There is no separate appointment runtime service anymore.

## Why The Chat Is Deterministic Right Now

The demo chat is implemented as rule-based command handling inside `server/index.js`.

That was deliberate.

Reasons:

- the product question is still “how should templated agents work in the control plane?”
- the current MVP should validate ownership, data flow, UI shape, and runtime boundaries before introducing a real text agent runtime
- deterministic logic is easier to test while the schema is still evolving

In other words:

- current goal: prove template architecture plus scheduling behavior
- later goal: replace the deterministic interpreter with a richer internal agent layer if needed

## Available Slots Logic

Available slots are currently computed in memory from:

- a worker-specific default slot pattern
- a small rolling day window
- existing non-cancelled appointments

This is intentionally synthetic.

Why:

- no separate availability table has been introduced yet
- the dashboard needs open slots immediately for a useful demo
- this keeps the first version easy to reason about

Future production direction:

- add recurring availability rules
- add worker blackout periods
- add service durations
- add timezone-aware slot generation

## Dashboard UI Added

The new dashboard panel:

- shows the appointment template
- lets the user create an appointment agent from it
- lets the user select among appointment agents in their org
- shows seeded workers, clients, appointments, and open slots
- provides a text chat box for trying the agent

This lives in:

- `src/components/AppointmentAgentPanel.tsx`

Why a separate component was added:

- keeps the new template flow isolated from the existing voice panel
- makes it easier to extract a reusable “template demo panel” pattern later

## Implementation Logic

### Why reuse `agents_defs`

The project already treats `agents_defs` as the canonical agent table.

Using it for created template instances means:

- existing auth and organization scoping still apply
- the voice and agent concepts stay in one control-plane model
- future templates can follow the same pattern instead of introducing a parallel agent table

### Why not add a full generic tool/runtime framework yet

That would be the long-term architecture, but it is too much for the first template.

The current implementation optimizes for:

- visible product progress
- coherent schema evolution
- a real end-to-end demo

### Why store appointment data per agent instance

Because two orgs may create the same template and need separate business data.

Also, one org may eventually run:

- one intake scheduler
- one follow-up scheduler
- one claims scheduling assistant

Those should not share workers/clients/appointments unless explicitly designed to do so.

## Current Limitations

This is an MVP, not the final agent framework.

Known limitations:

- no versioning for templates
- no admin UI for creating/editing templates
- no true LLM-backed text runtime
- no service catalog table
- no availability rules table
- no audit log for booking changes
- no conflict resolution beyond simple slot exclusion
- no transcript/run history for text chat yet

## Recommended Next Steps

1. Add `agent_runs` or similar for text interactions so the appointment demo has saved history.
2. Add `services` and `worker availability` tables so slot generation is data-driven.
3. Add template metadata for form fields and labels so the same engine can power medical, salon, restaurant, and legal scheduling variants.
4. Add admin-facing template management instead of seed-only templates.
5. Replace the deterministic appointment chat handler with a true text runtime contract that still reads/writes through `fonotp-web`.

## Files Touched For This Template

Database:

- `server/db/schema.sql`
- `server/db/seed.sql`

Server:

- `server/index.js`

Frontend:

- `src/App.tsx`
- `src/types.ts`
- `src/styles.css`
- `src/components/AppointmentAgentPanel.tsx`

## Summary

The `Appointment Agent` template is the first concrete step toward productizing templated agents in `fonotp-web`.

It proves:

- templates can exist separately from agent instances
- users can create real org-scoped agents from a shared template
- template-specific business data can live beside those agents
- the dashboard can present a runnable text demo without introducing a full runtime yet

That is the main architectural value of this change.
