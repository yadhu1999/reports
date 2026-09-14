# DataTap Reporting & Dashboard Application
## UX and Design Specification

## 1. Design Principles

The reporting application should feel like a purpose-built Esper analytics environment, not a SQL client.

The primary interaction model is:

**Choose → Filter → Summarize → Visualize → Save**

Users should see results while they are constructing a report.

Complex DataTap concepts should be represented in business language.

For example:

Instead of:

`latest_data = true`

show:

**Data: Latest snapshot**

Instead of:

`report_date`

show:

**Snapshot Date**

Raw SQL should be available only as an optional advanced/debug view.

---

## 2. Application Navigation

Primary navigation:

```text
Reporting
 ├── Dashboards
 ├── Reports
 ├── Visualizations
 └── Data Explorer
```

Optional later:

```text
 ├── Scheduled Reports
 └── Administration
```

---

## 3. Reporting Home

The reporting landing page should provide:

Header:

```text
Reporting
Build reports and dashboards from your Esper data.
```

Primary actions:

```text
+ New Report
+ New Dashboard
```

Sections:

- Recent dashboards
- Recent reports
- Favorites
- Recently viewed

---

## 4. Reports Page

Table layout:

| Name | Type | Dataset | Owner | Updated | Last Run | Actions |
|---|---|---|---|---|---|---|

Filters:

- Search
- Dataset
- Owner
- Type

Actions:

- Open
- Run
- Duplicate
- Add to dashboard
- Delete

---

## 5. Report Builder Layout

The Report Builder should use a three-zone layout.

```text
┌────────────────────────────────────────────────────────────┐
│ Devices by OS                              Save     Run     │
├──────────────┬───────────────────────────────┬──────────────┤
│ DATA         │ CONFIGURATION                 │ RESULTS      │
│              │                               │              │
│ Devices      │ Columns                       │ Table /      │
│ Fields       │ Filters                       │ Graph        │
│              │ Grouping                      │ preview      │
│              │ Sorting                       │              │
└──────────────┴───────────────────────────────┴──────────────┘
```

For smaller screen widths, the Data and Configuration areas may collapse into a single builder drawer.

---

## 6. Step 1: Dataset Selection

New Report modal:

```text
Create Report

What do you want to report on?

[ Devices ]
Device information and current status

[ Device Statistics ]
Device system events and statistics

[ Applications ]
Applications installed on devices

[ Groups ]
Device group information

[ Users ]
User information
```

Selecting a dataset opens the report builder.

---

## 7. Step 2: Data Scope

Top of builder:

```text
Data
○ Latest snapshot
○ Specific snapshot
○ Historical range
```

For Latest:

```text
Latest available data
```

For Specific:

```text
Snapshot date
[ September 9, 2026 ]
```

For Historical:

```text
From [ date ]
To   [ date ]
```

The user should always be able to see the selected scope.

Example:

```text
Devices • Latest snapshot
```

or

```text
Devices • Aug 1 – Sep 1, 2026
```

---

## 8. Step 3: Fields

Field panel:

```text
Fields                         Search fields...

Identity
☑ Device Name
☑ Device ID
☐ Serial Number

Operating System
☑ OS Version
☐ Build Version

Organization
☐ Group ID

Snapshot
☐ Snapshot Date
```

Selecting fields immediately updates the preview after a short debounce or explicit Run action.

---

## 9. Selected Columns

The configuration area shows:

```text
Columns

≡ Device Name                    ×
≡ Device ID                      ×
≡ OS Version                     ×

+ Add column
```

Drag handle changes order.

Clicking a field opens properties:

```text
Column

Field
OS Version

Display name
[ OS Version ]

Format
[ Automatic ]

Hide in table
[ ]
```

---

## 10. Filters

Filter builder:

```text
Filters

OS Version     equals      Android 14        ×

+ Add filter
```

Adding a filter:

```text
Field
[ OS Version         ▼ ]

Condition
[ Equals             ▼ ]

Value
[ Android 14           ]
```

For enumerated or low-cardinality fields, values should be selectable rather than manually typed where practical.

---

## 11. Filter Groups

Post-MVP:

```text
Match
[ All conditions ▼ ]

OS Version = Android 14

AND

Group Name = West Coast
```

Advanced:

```text
(
 OS Version = Android 14
 OR
 OS Version = Android 15
)
AND
Group Name = West Coast
```

---

## 12. Report Mode

Report builder should have a switch:

```text
Report type

[ Detail ] [ Summary ]
```

### Detail

Displays individual records.

### Summary

Enables:

- Dimensions
- Metrics

Example:

```text
Dimensions

OS Version

Metrics

COUNT DISTINCT Device ID
```

---

## 13. Summary Builder

Layout:

```text
Group by

[ OS Version              ]

Metrics

[ Count Distinct ] [ Device ID ]

+ Add metric
```

Live preview:

```text
OS Version          Devices
Android 13             832
Android 14           4,291
Android 15             619
```

---

## 14. Sorting

```text
Sort

1. Device Count       Descending
2. OS Version         Ascending

+ Add sort
```

---

## 15. Results Area

Tabs:

```text
[ Table ] [ Visualization ]
```

The Table tab always provides access to underlying data.

Results header:

```text
4,928 rows • Updated 11:42 AM
```

Actions:

```text
Refresh
Export CSV
```

---

## 16. Visualization Builder

When the Visualization tab is selected:

```text
Visualization

Type
[ Bar Chart ▼ ]

Category
[ OS Version ▼ ]

Value
[ Device Count ▼ ]

Series
[ None ▼ ]
```

Below:

```text
Display

☑ Show legend
☑ Show values
☐ Show grid lines

Sort
[ Largest first ▼ ]

Limit categories
[ 20 ]
```

---

## 17. Graph Picker

Graph options should be shown visually.

```text
┌────────┐ ┌────────┐ ┌────────┐
│  Bars  │ │  Line  │ │  Area  │
└────────┘ └────────┘ └────────┘

┌────────┐ ┌────────┐ ┌────────┐
│  Pie   │ │ Donut  │ │  KPI   │
└────────┘ └────────┘ └────────┘
```

Unavailable chart types should be disabled with an explanation.

Example:

```text
Line chart

Requires a date or ordered dimension.
```

---

## 18. KPI Visualization

Configuration:

```text
KPI

Value
Count Distinct Device ID

Label
Total Devices
```

Output:

```text
┌──────────────────────┐
│ Total Devices        │
│                      │
│      48,291          │
│                      │
└──────────────────────┘
```

Later:

- comparison period
- trend
- status indicator
- target

---

## 19. Save Report

Save dialog:

```text
Save Report

Name
[ Devices by OS Version ]

Description
[ Distribution of current devices by OS ]

Folder
[ My Reports ▼ ]

[ Cancel ] [ Save ]
```

After saving:

```text
Saved
```

should be shown unobtrusively.

---

## 20. Dashboard List

Dashboard cards:

```text
┌───────────────────────────────────┐
│ Fleet Overview                    │
│ 8 widgets                         │
│ Updated 2 hours ago               │
└───────────────────────────────────┘
```

Display:

- Name
- Description
- Widget count
- Owner
- Last updated
- Last viewed

---

## 21. Dashboard Viewer

Example:

```text
Fleet Overview

Snapshot: Latest                          Refresh

┌────────────┐ ┌────────────┐ ┌────────────┐
│ Devices    │ │ Online     │ │ Offline    │
│ 48,291     │ │ 47,082     │ │ 1,209      │
└────────────┘ └────────────┘ └────────────┘

┌─────────────────────────┐ ┌─────────────────────────┐
│ Devices by OS           │ │ Devices by Group        │
│                         │ │                         │
│        BAR CHART        │ │        PIE CHART        │
│                         │ │                         │
└─────────────────────────┘ └─────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ Recently Offline Devices                             │
│                                                      │
│                    TABLE                             │
└──────────────────────────────────────────────────────┘
```

---

## 22. Dashboard Edit Mode

Click:

```text
Edit Dashboard
```

Changes header to:

```text
Fleet Overview

+ Add Widget        Save       Cancel
```

Widgets show:

- Drag handle
- Resize handle
- Menu
- Remove

Grid should provide snap-to-column behavior.

---

## 23. Add Widget

Drawer:

```text
Add to Dashboard

Search reports and visualizations...

Saved Visualizations

Devices by OS
Offline Devices by Group
App Version Distribution

Saved Reports

Recently Offline Devices
Applications Installed
```

Selecting adds the object to the dashboard.

Also support:

```text
+ Create new report
```

which can return to the dashboard when finished.

---

## 24. Dashboard Filters

Future design:

Header:

```text
Fleet Overview

Group
[ All Groups ▼ ]

OS
[ All ▼ ]

Snapshot
[ Latest ▼ ]
```

Filters apply to compatible widgets.

Widgets that cannot support a filter remain unchanged.

---

## 25. Widget States

Every dashboard widget must independently support:

### Loading

```text
Loading report...
```

with skeleton rendering.

### No Data

```text
No data matches these filters.
```

### Error

```text
Unable to load this report.

Retry
```

### Loaded

Render visualization plus:

```text
Updated 11:44 AM
```

---

## 26. Data Explorer

A separate Data Explorer is useful for technical users.

Layout:

```text
Dataset: Devices

[ Data ] [ Schema ]

Device Name | Device ID | OS Version | Group ...
```

Schema tab:

```text
Field          Type        Description
device_id      string      Unique device identifier
name           string      Device name
report_date    date        Snapshot date
```

Users can click:

```text
Build report from this data
```

---

## 27. Historical Reporting UX

Historical reporting must avoid accidental interpretation errors.

When the user selects a date range, show:

```text
Historical mode

DataTap stores one snapshot per day. The same device may
therefore appear once for each snapshot date.
```

Do not show this warning repeatedly once the user understands the workflow, but retain context through labeling.

For a detail report over a date range, strongly recommend including:

```text
Snapshot Date
```

as a column.

---

## 28. Cross-Table Reporting

Rather than asking the user to "JOIN", use:

```text
Add related data
```

Example:

```text
Devices

Related data

+ Groups
+ Applications
```

Choosing Groups makes group fields available:

```text
Group
  Group Name
  Group ID
```

The backend determines the actual join.

Historical joins automatically include snapshot date.

---

## 29. Generated Query Inspector

Advanced users may open:

```text
⋯
View generated query
```

Drawer:

```sql
SELECT
    d.os_version,
    COUNT(DISTINCT d.device_id) AS device_count
FROM devices d
GROUP BY d.os_version
ORDER BY device_count DESC
LIMIT 1000;
```

Read-only for MVP.

This is useful for transparency and DataTap debugging without turning the product into a SQL editor.

---

## 30. Report Builder Interaction Model

The page should generally avoid a wizard.

Users should be able to move freely among:

- Data
- Fields
- Filters
- Grouping
- Visualization

The result pane provides continuous feedback.

Use an explicit **Run** action once queries become expensive.

For early/simple queries, automatic previews may use:

```text
LIMIT 100
```

---

## 31. Recommended Component Hierarchy

```text
ReportingShell

├── ReportingNavigation
├── ReportList
├── ReportBuilder
│   ├── DatasetSelector
│   ├── SnapshotSelector
│   ├── FieldBrowser
│   ├── ColumnConfigurator
│   ├── FilterBuilder
│   ├── AggregationBuilder
│   ├── SortBuilder
│   ├── QueryStatus
│   ├── ResultsTable
│   └── VisualizationBuilder
│
├── DashboardList
└── DashboardEditor
    ├── DashboardToolbar
    ├── DashboardFilterBar
    └── DashboardGrid
        └── DashboardWidget
```

---

## 32. Backend Design

Recommended logical services:

```text
API Layer
   │
   ├── Metadata Service
   ├── Report Service
   ├── Visualization Service
   ├── Dashboard Service
   └── Query Execution Service
                │
                ├── Query Validator
                ├── SQL Generator
                ├── DataTap Client
                ├── Polling Worker
                └── Result Normalizer
```

---

## 33. Query Compilation

Frontend sends a declarative model.

Example:

```json
{
  "dataset": "devices",
  "scope": {
    "type": "latest"
  },
  "select": [
    {
      "field": "os_version",
      "alias": "OS Version"
    }
  ],
  "metrics": [
    {
      "field": "device_id",
      "aggregation": "count_distinct",
      "alias": "Devices"
    }
  ],
  "group_by": [
    "os_version"
  ],
  "sort": [
    {
      "field": "Devices",
      "direction": "desc"
    }
  ],
  "limit": 1000
}
```

Backend generates:

```sql
SELECT
    os_version,
    COUNT(DISTINCT device_id) AS "Devices"
FROM devices
GROUP BY os_version
ORDER BY "Devices" DESC
LIMIT 1000;
```

with:

```json
{
  "latest_data": true
}
```

---

## 34. DataTap Execution

Backend workflow:

```text
Receive report definition
        ↓
Authorize request
        ↓
Validate fields
        ↓
Compile SQL
        ↓
POST /queries/
        ↓
Receive DataTap Query ID
        ↓
Poll /queries/{id}
        ↓
SUCCEEDED
        ↓
Extract content.result.data_array
        ↓
Normalize result
        ↓
Return result to frontend
```

Browser-visible application status:

```text
queued
running
complete
failed
```

DataTap implementation-specific states should remain backend concerns.

---

## 35. Normalized Result Format

The backend should return a consistent format regardless of DataTap response details.

Example:

```json
{
  "execution_id": "exec_123",
  "status": "succeeded",
  "columns": [
    {
      "id": "os_version",
      "label": "OS Version",
      "type": "string"
    },
    {
      "id": "devices",
      "label": "Devices",
      "type": "number"
    }
  ],
  "rows": [
    ["Android 13", 832],
    ["Android 14", 4291]
  ],
  "metadata": {
    "row_count": 2,
    "executed_at": "2026-09-10T18:30:00Z"
  }
}
```

A column-oriented metadata description allows both the table renderer and visualization library to consume the same result.

---

## 36. Frontend Technology Recommendations

A practical implementation could use:

```text
React
TypeScript
Next.js or equivalent React framework
TanStack Query
TanStack Table
React Grid Layout or Gridstack
Apache ECharts
```

ECharts is particularly suitable because the same library supports:

- Line
- Bar
- Area
- Pie
- Scatter
- Heatmap
- Large datasets
- Interactive tooltips
- Image export

The implementation should hide the charting library behind an internal Visualization component API.

---

## 37. Backend Technology Recommendations

Any existing Esper-standard backend stack can support this.

Logical requirements matter more than framework choice.

The backend needs:

- REST API
- authentication middleware
- tenant context
- secrets management
- SQL generation
- DataTap polling
- persistent storage
- planned result caching, single-flight execution, and tenant request-budget scheduling

A worker queue becomes useful when dashboards contain many asynchronous reports.

---

## 38. Query Safety Model

Never accept frontend-generated SQL as executable input.

The browser submits:

```text
dataset
fields
filters
aggregations
sorting
scope
limit
```

The backend constructs SQL from an allowlisted schema.

Values should be parameterized or safely escaped.

Identifiers must come from the metadata catalog rather than user strings.

---

## 39. Metadata Catalog

Create a metadata registry independent of DataTap.

Conceptual example:

```yaml
devices:
  label: Devices
  description: Device information and current status

  fields:
    device_id:
      label: Device ID
      type: string
      dimension: true
      filterable: true

    report_date:
      label: Snapshot Date
      type: date
      dimension: true
      filterable: true

  relationships:
    groups:
      type: many-to-one
      join:
        - devices.group_id = groups.group_id
      historical_join:
        - devices.report_date = groups.report_date
```

This becomes one of the most important abstractions in the system.

It lets DataTap remain a general SQL data service while Reporting exposes a curated semantic model.

---

## 40. Product Architecture Direction

The most important architectural choice is to make the report definition a first-class object rather than treating generated SQL as the report.

The hierarchy should be:

```text
DATA SOURCE
    ↓
SEMANTIC MODEL
    ↓
REPORT DEFINITION
    ↓
QUERY EXECUTION
    ↓
RESULT SET
    ↓
VISUALIZATION
    ↓
DASHBOARD
```

This creates a platform rather than a one-off report builder.

It also makes future capabilities such as AI-generated analytics straightforward because AI can construct and manipulate the semantic report definition instead of generating unrestricted SQL.


## Cache architecture and refresh interaction

The [Cache Design](datatap-reporting-cache-design.md) defines storage layers, deterministic keys, stale-while-revalidate, the additive execution response contract, invalidation, request quotas, security and acceptance tests. It supersedes general caching recommendations elsewhere in this specification; the [implementation status](../docs/caching-implementation.md) distinguishes the delivered single-process layer from remaining deployment extensions.

Dashboard widgets render eligible cached rows immediately with their original execution age and snapshot information. Each widget independently shows refreshing, stale or refresh-deferred status. An explicit refresh coalesces identical queries and respects the tenant-wide budget. Refresh failure retains eligible stale results with an explanation, rather than showing zero or erasing the table. Never present cached data as live connectivity.

Browser persistence uses server-authorized IndexedDB entries; memory caches are session-bound. Saved report definitions remain server-owned. Initial implementation targets the current single-process Express backend; shared Redis coordination is required before replicas are introduced.
