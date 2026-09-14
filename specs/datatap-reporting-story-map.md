# DataTap Reporting & Dashboard Application
## Story Map

## 1. Product Objective

Build a web-based reporting and visualization application on top of Esper DataTap that allows users to:

- Explore DataTap data without writing SQL.
- Select tables and columns.
- Apply filters and grouping.
- Build tabular reports.
- Build charts and graphs.
- Save reports and visualizations.
- Assemble saved reports and graphs into dashboards.
- Re-open and edit previously saved content.
- Safely query both current and historical device data.
- Abstract DataTap query creation, submission, polling, and result parsing behind a backend service.

The application consists of:

1. Web frontend
2. Application backend
3. DataTap integration layer
4. Report definition store
5. Dashboard definition store
6. Planned query-result caching and execution history

---

## 2. Primary Personas

### Operations User

Wants to understand fleet state without SQL.

Examples:

- Devices offline by site
- OS versions by device group
- Battery or system statistics
- Installed application inventory
- User assignment by device

### Technical User

Understands the underlying data model and wants more control over dimensions, metrics, filters, grouping, and joins.

### Administrator

Manages access, DataTap credentials, query limits, shared reports, and dashboards.

### Executive / Business User

Primarily consumes dashboards and saved reports rather than creating new ones.

---

## 3. Story Map

### Activity 1: Discover Data

#### User Tasks

Browse available datasets.

#### Stories

As a user, I want to see the available DataTap tables so that I know what information I can report on.

As a user, I want to see human-readable table descriptions.

As a user, I want to see available columns for each table.

As a user, I want to see the data type of each column.

As a user, I want important fields such as device ID, group ID, timestamps, and report date identified.

As a user, I want to preview a small number of rows before building a report.

#### Initial datasets

- devices
- users
- device_stats
- groups
- device_apps

---

### Activity 2: Choose Data Scope

#### User Tasks

Determine whether the report represents current state or historical data.

#### Stories

As a user, I want to select "Current data" so the application automatically queries the latest snapshot.

As a user, I want to select a specific snapshot date.

As a user, I want to select a date range for historical analysis.

As a user, I want the system to prevent accidental duplication caused by multiple daily snapshots.

As a user, I want the UI to clearly indicate whether a report is current-state or historical.

#### Scope Modes

- Latest snapshot
- Specific snapshot
- Date range
- All available history, advanced users only

---

### Activity 3: Build a Table Report

#### User Tasks

Choose a dataset, columns, filters, grouping, sorting, and aggregations.

#### Stories

As a user, I want to choose which columns appear in my report.

As a user, I want to rearrange columns.

As a user, I want to rename displayed column headers.

As a user, I want to filter records.

As a user, I want different filter operators depending on the field type.

As a user, I want to sort by one or more columns.

As a user, I want to group records by dimensions.

As a user, I want to calculate counts, distinct counts, minimums, maximums, averages, and totals.

As a user, I want to limit the number of returned records.

As a user, I want to preview the report before saving it.

---

### Activity 4: Build a Graph

#### User Tasks

Choose dimensions, measures, chart type, and display options.

#### Stories

As a user, I want to select a chart type.

As a user, I want to choose the field used for the X axis.

As a user, I want to choose one or more measures for the Y axis.

As a user, I want to group chart data by another dimension.

As a user, I want to apply the same filtering capabilities available to table reports.

As a user, I want the system to recommend compatible chart types based on my data.

As a user, I want to preview the graph before saving it.

#### Initial Visualization Types

- Bar chart
- Horizontal bar chart
- Line chart
- Area chart
- Pie chart
- Donut chart
- Stacked bar chart
- KPI / single value
- Table
- Pivot-style summary table

Later:

- Scatter plot
- Histogram
- Heatmap
- Treemap
- Gauge
- Map, where geographic data exists

---

### Activity 5: Work Across Related Tables

#### User Tasks

Combine related data without constructing SQL manually.

#### Stories

As a user, I want to add group information to a device report.

As a user, I want to add application information to a device report.

As a user, I want to build reports from predefined table relationships.

As a user, I want historical joins to automatically include report_date.

As a technical user, I want to inspect the generated query.

#### Initial Relationship

`devices.group_id = groups.group_id`

For historical data:

`devices.group_id = groups.group_id`
and
`devices.report_date = groups.report_date`

Additional relationships should be defined as the DataTap schema is documented.

---

### Activity 6: Save a Report

#### User Tasks

Persist report configuration.

#### Stories

As a user, I want to give a report a name and description.

As a user, I want the report definition saved rather than only its current results.

As a user, I want to reopen the report later and run it against current data.

As a user, I want to duplicate a report.

As a user, I want to edit an existing report.

As a user, I want to delete a report.

As a user, I want to see when the report was last run.

As a user, I want to see when it was last modified.

---

### Activity 7: Save a Visualization

#### Stories

As a user, I want to save a graph independently from a dashboard.

As a user, I want to edit the graph configuration later.

As a user, I want to duplicate a graph.

As a user, I want to change visualization type without rebuilding the underlying query.

---

### Activity 8: Build a Dashboard

#### User Tasks

Create dashboard, add widgets, arrange layout.

#### Stories

As a user, I want to create a named dashboard.

As a user, I want to add saved reports to it.

As a user, I want to add saved graphs to it.

As a user, I want to resize dashboard widgets.

As a user, I want to drag widgets to rearrange them.

As a user, I want a dashboard widget to retain its report configuration.

As a user, I want to refresh the entire dashboard.

As a user, I want to refresh individual widgets.

As a user, I want dashboard-wide filters such as date, group, or device attributes.

As a user, I want dashboard filters to propagate to compatible widgets.

---

### Activity 9: Consume a Dashboard

#### Stories

As a user, I want a dashboard to automatically run its reports when opened.

As a user, I want to see loading status independently for each widget.

As a user, I want one failing widget to not break the entire dashboard.

As a user, I want to see when each widget was last refreshed.

As a user, I want to drill into the underlying report.

As a user, I want to inspect the underlying data behind a graph.

---

### Activity 10: Export and Share

#### Stories

As a user, I want to export tabular data to CSV.

As a user, I want to export graphs as PNG.

As a user, I want to share a saved report with another user.

As a user, I want to share a dashboard.

Later:

- PDF dashboard export
- Scheduled reports
- Email delivery
- Slack delivery
- Public or embedded dashboards

---

### Activity 11: Manage Query Execution

#### Stories

As a user, I want the application to show that a query is processing.

As a user, I want the application to poll DataTap automatically.

As a user, I want useful error messages when a query fails.

As an administrator, I want query execution limits.

As an administrator, I want maximum row limits.

As an administrator, I want to see query execution history.

---

### Activity 12: Security and Governance

#### Stories

As an administrator, I want DataTap API keys stored only on the backend.

As an administrator, I want users authenticated before accessing reports.

As an administrator, I want tenant isolation enforced.

As an administrator, I want saved reports scoped by tenant.

As an administrator, I want audit records for report and dashboard changes.

As an administrator, I want arbitrary SQL disabled for normal users.

---

## 4. MVP Story Slice

The first production release should support:

1. User authentication
2. Five initial DataTap tables
3. Column metadata
4. Latest-data reports
5. Specific snapshot reports
6. Basic filters
7. Sorting
8. Grouping
9. Aggregations
10. Table reports
11. Bar charts
12. Line charts
13. Pie/donut charts
14. KPI cards
15. Save/edit/delete reports
16. Save/edit/delete visualizations
17. Dashboards
18. Drag and resize dashboard widgets
19. DataTap asynchronous query polling
20. CSV export
21. Backend-only API credential management

---

## 5. Follow-on Releases

### Release 2

- Cross-table relationships
- Historical trend reports
- Dashboard-level filters
- Pivot reports
- Sharing
- Permissions
- Execution history
- Caching

### Release 3

- Scheduled reporting
- Email delivery
- PDF generation
- AI-assisted report generation
- Natural-language query creation
- Calculated fields
- Custom formulas
- Alerts based on report conditions

---

## 6. North Star User Journey

The ideal workflow should be:

Select Data → Choose Current or Historical → Select Columns → Filter → Group / Aggregate → Preview → Choose Table or Visualization → Save → Add to Dashboard → Share / Consume

A user should be able to create a useful fleet report without understanding SQL or the DataTap asynchronous query API.


## Caching stories

Detailed behavior and delivery stages: [Cache Design](datatap-reporting-cache-design.md). Core result caching is implemented; [implementation status](../docs/caching-implementation.md) identifies remaining administrator, draft-recovery and deployment extensions.

- As a user, I can reopen a report or dashboard quickly using eligible cached results, with visible execution age and snapshot date.
- As a user, I can refresh a widget or dashboard without duplicating queries shared by its charts and tables.
- As a user, I see why refresh is deferred by quota and can continue viewing eligible stale data without it being labeled fresh.
- As a user, cache loss or unavailable browser storage does not lose saved reports or prevent server-backed execution.
- As a user, switching accounts, tenants or connections immediately removes old results from view; cached data follows my current permissions.
- As a user, I can clear locally cached data without deleting server-saved reports, and unsaved drafts have explicit conflict handling.
- As an administrator, I control dataset/field persistence eligibility, freshness, stale limits, cache bounds and tenant request budgets.
- As an operator, I can measure cache hits, coalesced jobs, quota deferrals and evictions without logging device/user records or credentials.
