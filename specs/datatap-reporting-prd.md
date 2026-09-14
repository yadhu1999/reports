# DataTap Reporting & Dashboard Application
## Product Requirements Document

## 1. Summary

The DataTap Reporting application provides a visual analytics and reporting layer over Esper DataTap.

Today DataTap exposes data through asynchronous SQL queries. While powerful, this requires users to understand:

- SQL
- Available DataTap tables
- Table relationships
- Daily snapshot semantics
- report_date
- latest_data
- Query submission
- Query polling
- Result parsing

The Reporting application abstracts this complexity and allows users to create reports and visualizations through a graphical interface.

Users can select datasets, columns, filters, groupings, aggregations, and chart types, then save those configurations and combine them into dashboards.

---

## 2. Goals

The product must allow users to:

1. Query DataTap without writing SQL.
2. Build tabular reports.
3. Build charts.
4. Save reusable report definitions.
5. Save reusable visualization definitions.
6. Build dashboards containing multiple reports and visualizations.
7. Report on both current and historical snapshots.
8. Safely support joins across DataTap tables.
9. Export report data.
10. Hide DataTap credentials and implementation details from the browser.

---

## 3. Non-Goals for MVP

MVP will not initially provide:

- General-purpose SQL IDE
- Arbitrary user-defined SQL
- ETL functionality
- Data editing
- Data warehouse functionality
- Real-time streaming analytics
- Spreadsheet editing
- Complex calculated-field language
- Scheduled report delivery
- External dashboard embedding

---

## 4. Architecture

The application consists of:

Web Application\
↓\
Application API\
↓\
Report Query Engine\
↓\
DataTap API

Supporting services:

- Authentication
- Metadata service
- Report definition database
- Dashboard definition database
- Query execution service
- Result cache (see Cache Design and implementation status)

The browser never communicates directly with DataTap.

---

## 5. DataTap Integration

Base endpoint:

`https://develop-api.esper.cloud/api/data-tap/v0`

Query submission:

`POST /queries/`

Example request:

```json
{
  "query": "SELECT * FROM devices LIMIT 1;",
  "latest_data": true
}
```

DataTap returns HTTP 201 with:

- Query ID
- Status = PENDING

The backend polls:

`GET /queries/{query_id}`

until the request reaches a terminal state.

Successful results are returned from:

`content.result.data_array`

---

## 6. Supported Data Sources

Initial tables:

| Dataset | Description |
|---|---|
| devices | Device information and current status |
| users | User information |
| device_stats | Device system events and statistics |
| groups | Group information |
| device_apps | Applications installed on devices |

The application should internally maintain a metadata catalog containing:

- table name
- friendly name
- description
- columns
- column types
- friendly column labels
- category
- filter capabilities
- aggregation capabilities
- join relationships

The web client should retrieve this metadata from the application backend rather than hard-code it.

---

## 7. Snapshot Semantics

DataTap tables contain daily snapshots identified by:

`report_date`

The application must make snapshot behavior explicit.

Every report has a `data_scope`.

Supported values:

```text
LATEST
SNAPSHOT
DATE_RANGE
```

### LATEST

Backend sends:

```json
{
  "latest_data": true
}
```

The user does not need to add a report_date condition.

### SNAPSHOT

Generated SQL contains:

```sql
WHERE report_date = 'YYYY-MM-DD'
```

### DATE_RANGE

Generated SQL contains:

```sql
WHERE report_date BETWEEN ? AND ?
```

---

## 8. Query Builder

The application stores a structured query definition rather than SQL.

Example:

```json
{
  "source": "devices",
  "data_scope": {
    "type": "LATEST"
  },
  "columns": [
    "device_id",
    "name",
    "group_id",
    "os_version"
  ],
  "filters": [
    {
      "field": "os_version",
      "operator": "equals",
      "value": "14"
    }
  ],
  "sort": [
    {
      "field": "name",
      "direction": "asc"
    }
  ],
  "limit": 1000
}
```

The backend converts the definition into SQL.

This allows the application to validate all queries before DataTap execution.

---

## 9. Report Types

MVP report types:

### Detail Table

Returns individual records.

Example:

Devices with:

- Device name
- OS version
- Group
- Last-seen status

### Summary Table

Groups results and applies aggregations.

Example:

Devices by OS version.

Output:

| OS Version | Devices |
|---|---:|
| Android 13 | 2,182 |
| Android 14 | 5,928 |

### KPI

Returns a single summarized number.

Example:

Total devices

```sql
COUNT(DISTINCT device_id)
```

---

## 10. Column Selection

Users can:

- Add columns
- Remove columns
- Reorder columns
- Rename presentation labels
- Search available fields

Fields should be grouped into categories where appropriate.

Example for devices:

Identity

- device_id
- name
- serial

Operating System

- os_version
- build

Organization

- group_id

Status

- current state fields

System

- report_date

---

## 11. Filters

Supported operators depend on data type.

### String

- equals
- not equals
- contains
- does not contain
- starts with
- ends with
- is empty
- is not empty
- in
- not in

### Number

- equals
- not equals
- greater than
- greater than or equal
- less than
- less than or equal
- between
- is empty

### Date

- equals
- before
- after
- between
- relative range

### Boolean

- true
- false

Multiple filters support:

```text
AND
OR
```

MVP may restrict filters to a single top-level AND group.

---

## 12. Aggregations

MVP functions:

- COUNT
- COUNT DISTINCT
- SUM
- AVG
- MIN
- MAX

The UI must only offer compatible aggregations based on field type.

---

## 13. Grouping

A summary report may contain one or more dimensions.

Example:

```text
Group by:
  os_version

Measure:
  count(device_id)
```

Later:

```text
Group by:
  group_name
  os_version
```

---

## 14. Sorting

Users can define multiple sorting rules.

Example:

```text
1. device_count DESC
2. os_version ASC
```

---

## 15. Query Limits

The backend must enforce configurable limits.

Suggested defaults:

Preview:

`100 rows`

Normal detail report:

`10,000 rows`

Export:

Configurable higher limit.

A query must never execute without an explicit LIMIT unless it is an aggregate query expected to return bounded results.

---

## 16. Visualization Builder

A visualization references a report definition.

This separation is important.

Conceptually:

```text
Dataset Query
     ↓
Report
     ↓
Visualization
```

One report can therefore potentially support multiple visualizations.

---

## 17. Visualization Types

MVP:

- Table
- Bar
- Horizontal bar
- Stacked bar
- Line
- Area
- Pie
- Donut
- KPI

Each visualization defines:

```json
{
  "type": "bar",
  "dimension": "os_version",
  "measures": [
    "device_count"
  ],
  "series": null,
  "options": {}
}
```

---

## 18. Chart Compatibility

The system should prevent invalid visualizations.

For example:

Pie:

- exactly one dimension
- exactly one measure

Line:

- typically one time/date dimension
- one or more measures

KPI:

- exactly one aggregated measure

Bar:

- one category dimension
- one or more measures

---

## 19. Saved Reports

Report model:

```json
{
  "id": "rpt_123",
  "name": "Devices by OS",
  "description": "",
  "query_definition": {},
  "created_by": "user",
  "created_at": "...",
  "updated_at": "...",
  "last_executed_at": "..."
}
```

Operations:

- Create
- Read
- Update
- Duplicate
- Delete
- Execute

---

## 20. Saved Visualizations

Visualization model:

```json
{
  "id": "viz_123",
  "name": "Device OS Distribution",
  "report_id": "rpt_123",
  "visualization_definition": {},
  "created_by": "user"
}
```

---

## 21. Dashboards

Dashboard model:

```json
{
  "id": "dash_123",
  "name": "Fleet Operations",
  "description": "",
  "widgets": [
    {
      "id": "widget_1",
      "type": "visualization",
      "resource_id": "viz_123",
      "layout": {
        "x": 0,
        "y": 0,
        "width": 6,
        "height": 4
      }
    }
  ]
}
```

Dashboard widgets may reference:

- Reports
- Visualizations
- KPI cards

---

## 22. Dashboard Layout

Use a responsive grid.

Recommended:

12-column desktop layout.

Supported interactions:

- Drag
- Drop
- Resize
- Remove
- Duplicate

Suggested widget widths:

KPI:

3 columns

Small graph:

4-6 columns

Large graph:

6-12 columns

Table:

12 columns

---

## 23. Dashboard Execution

Opening a dashboard should:

1. Retrieve dashboard definition.
2. Determine all underlying report definitions.
3. Execute required queries.
4. Poll DataTap asynchronously.
5. Render each widget independently.

A failed widget must not block successful widgets.

---

## 24. Dashboard Filters

Post-MVP but architecture should support them.

Example:

```text
Report Date
Group
OS Version
Device Model
```

Dashboard filters should inject additional constraints into compatible report definitions at execution time.

The underlying saved report remains unchanged.

---

## 25. Join Support

Joins should be metadata-driven.

Users should not construct arbitrary join expressions.

Example relationship:

```json
{
  "left_table": "devices",
  "right_table": "groups",
  "conditions": [
    {
      "left": "group_id",
      "right": "group_id"
    }
  ],
  "historical_conditions": [
    {
      "left": "report_date",
      "right": "report_date"
    }
  ]
}
```

Generated latest query:

```sql
SELECT
  d.device_id,
  d.name,
  g.group_name
FROM devices d
JOIN groups g
  ON d.group_id = g.group_id
```

Historical query:

```sql
SELECT
  d.device_id,
  d.name,
  g.group_name,
  d.report_date
FROM devices d
JOIN groups g
  ON d.group_id = g.group_id
 AND d.report_date = g.report_date
```

This date condition must be automatically generated by the backend.

---

## 26. Backend API

Suggested application API.

### Metadata

```text
GET /api/reporting/datasets
GET /api/reporting/datasets/{dataset}
GET /api/reporting/datasets/{dataset}/fields
```

### Preview

```text
POST /api/reporting/query/preview
```

### Execution

```text
POST /api/reporting/query/execute
GET /api/reporting/executions/{id}
```

### Reports

```text
GET    /api/reports
POST   /api/reports
GET    /api/reports/{id}
PUT    /api/reports/{id}
DELETE /api/reports/{id}

POST   /api/reports/{id}/execute
POST   /api/reports/{id}/duplicate
```

### Visualizations

```text
GET    /api/visualizations
POST   /api/visualizations
GET    /api/visualizations/{id}
PUT    /api/visualizations/{id}
DELETE /api/visualizations/{id}
```

### Dashboards

```text
GET    /api/dashboards
POST   /api/dashboards
GET    /api/dashboards/{id}
PUT    /api/dashboards/{id}
DELETE /api/dashboards/{id}

POST   /api/dashboards/{id}/execute
```

---

## 27. Query Execution State Machine

```text
CREATED
   ↓
SUBMITTED
   ↓
PENDING
   ↓
RUNNING
   ↓
SUCCEEDED
```

Failure states:

```text
FAILED
TIMED_OUT
CANCELLED
```

The backend owns DataTap polling.

The browser polls only the application's execution endpoint.

---

## 28. Persistence

Recommended entities:

```text
users
reports
visualizations
dashboards
dashboard_widgets
query_executions
dataset_metadata
audit_events
```

Report results do not need to be permanently stored initially.

Saved objects store definitions.

---

## 29. Caching

An initial single-process caching layer is implemented; see [implementation status](../docs/caching-implementation.md) for delivered behavior and deployment extensions. The normative algorithm and acceptance criteria are in [Cache Design](datatap-reporting-cache-design.md).

Use browser memory plus policy-controlled IndexedDB for results and metadata, and a server result cache with single-flight execution and a shared DataTap request budget. Reserve localStorage for small UI preferences. Cache query results once across tables and visualizations, keyed by canonical query semantics and versioned authorization/connection scope.

Fresh latest-data defaults are 10 minutes (5 minutes for Device Statistics); completed historical scopes default to 24 hours. Historical data is not assumed immutable. Stale display has a bounded age and explicit refresh/error state. Manual refresh obeys quota, permissions and deduplication. The server owns TTL, eligibility, invalidation and persistence policy.

Saved definitions remain the system of record. Cache failure must never lose saved work or weaken tenant/permission isolation. API keys and secrets never enter browser storage.

---

## 30. Security

DataTap API credentials must:

- Exist only on backend systems.
- Never be exposed to browser JavaScript.
- Never appear in logs.
- Be stored in a secrets management system.

The query generator must:

- Use allowlisted tables.
- Use allowlisted columns.
- Use allowlisted functions.
- Escape or parameterize user input.
- Reject raw SQL input.
- Apply row limits.
- Apply tenant-level authorization.

---

## 31. Authorization

Suggested roles:

### Viewer

- View reports
- View dashboards

### Analyst

- Create and edit reports
- Create visualizations
- Create dashboards

### Administrator

- Manage users
- Manage shared assets
- Configure DataTap connection
- Inspect execution history

---

## 32. Observability

Record:

- report ID
- execution ID
- generated SQL hash
- DataTap query ID
- submission time
- completion time
- row count
- status
- error
- requesting user

Do not log credentials.

Generated SQL may be stored for debugging if appropriate security controls exist.

---

## 33. Performance Requirements

Target application behavior:

Cached dashboard widget:\
`< 1 second`

Report configuration interactions:\
`< 200 ms client-side response`

Query submission:\
`< 500 ms application overhead excluding DataTap`

Dashboard should progressively render widgets as results become available.

---

## 34. Error Handling

Users should see application-level errors rather than raw backend exceptions.

Examples:

"DataTap is taking longer than expected."

"Unable to execute this report."

"The selected field is no longer available."

"This graph requires at least one numeric measure."

"Historical joins require compatible snapshot data."

Technical details may be available in an expandable diagnostics panel for administrators.

---

## 35. Success Metrics

Product usage:

- Number of reports created
- Number of visualizations created
- Number of dashboards created
- Weekly active report consumers
- Weekly active report creators

Efficiency:

- Median time to first report
- Median time to first dashboard
- Percentage of successful report executions
- Query failure rate

Adoption target:

A new user should be able to build a useful device report in under five minutes without SQL.

---

## 36. Future Opportunities

The structured report model provides a foundation for AI.

Eventually a user could ask:

"Show me devices by Android version."

The AI generates the report definition, not raw unrestricted SQL.

Example:

```json
{
  "source": "devices",
  "data_scope": {
    "type": "LATEST"
  },
  "dimensions": [
    "os_version"
  ],
  "metrics": [
    {
      "function": "count_distinct",
      "field": "device_id"
    }
  ]
}
```

This same architecture could later support:

- AI report creation
- AI dashboard creation
- anomaly detection
- scheduled reports
- alerts
- InSite analytics integration
