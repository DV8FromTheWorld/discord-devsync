# Analytics Events → BigQuery

## Two Event Systems

### 1. Analytics Events (client-side / product analytics)
- **YAML definitions (source of truth):** `discord_analytics/schemas/src/main/yaml/events/` (~2,462 events)
  - Subdirs: `impression/`, `network_action/`, `activity_internal/`
- **Shared traits:** `discord_analytics/schemas/src/main/yaml/traits/` (e.g. `base.yaml` has ~97 common fields)
- **Domain routing constants:** `discord_analytics/schemas/src/main/yaml/constants.yaml`

### 2. Generic Events (backend / server-side)
- **YAML definitions:** `discord_analytics/schemas/generic_events/events/` (~182 events)
- **Shared traits:** `discord_analytics/schemas/generic_events/traits/`

## YAML Event Format

```yaml
type: event
name: accepted_instant_invite
description: Tracked by the backend when a user accepts an invite to a server.
domains: [ANALYTICS, MODELING, REPORTING, TNS]
owner: aperture-onpoint
data_purposes: [ANALYTICS, PERSONALIZATION, SCORING, REPORTING, SAFETY]
extend:
  1: base
properties:
  1: [channel, INT, [ID.CHANNEL_ID]]
  2: [channel_type, INT, [], 'Channel type (see ChannelType constant)']
```

The `domains` field controls BigQuery dataset routing: `ANALYTICS`, `REPORTING`, `MODELING`, `TNS`, `VAULT`, `FEATURES`.

## Pipeline: YAML → BigQuery

```
YAML definitions (source of truth)
  → event_yaml_to_protobuf.py / clyde gen analytics
Protobuf definitions (proto/discord_protos/discord_data/analytics_events/v1/)
  → analytics_ingest Rust service
Avro-encoded events in GCS
  → Airflow DAG (load_stream_events_into_bigquery_v1.py)
BigQuery tables (events.* / generic_events.*)
```

## Code Generation

- **YAML → Proto:** `discord_data/tools/proto_utils/event_yaml_to_protobuf.py`
- **YAML → TypeScript:** `tools/generate_typescript_analytics.py` → `discord_app/utils/AnalyticsSchema.tsx`
- **Regenerate all:** `clyde gen analytics`
- **CI validation:** `tools/ci/analytics_schema.sh`

## Backend Event Tracking (Python)

Events are also constructed in Python API code, e.g.:
- `discord_api/discord/lib/analytics/events/messages.py` — builds event property dicts for message-related analytics (message_create, etc.)
- Properties are assembled as plain dicts with keys matching the YAML schema field names.

## Key File Paths

| Purpose | Path |
|---|---|
| Analytics event YAMLs | `discord_analytics/schemas/src/main/yaml/events/` |
| Generic event YAMLs | `discord_analytics/schemas/generic_events/events/` |
| Base trait (shared fields) | `discord_analytics/schemas/src/main/yaml/traits/base.yaml` |
| Generated protos | `proto/discord_protos/discord_data/analytics_events/v1/` |
| Generated TS types | `discord_app/utils/AnalyticsSchema.tsx` |
| Legacy JSON aggregate | `discord_analytics/schemas/src/main/yaml/LegacyJson.yaml` |
| BQ ingestion DAG | `discord_analytics/airflow/dependencies/dag_builders/load_stream_events_into_bigquery_v1.py` |
| Avro→BQ schema | `discord_analytics/airflow/dependencies/common/avro/bigquery.py` |
| Python event builders | `discord_api/discord/lib/analytics/events/` |
