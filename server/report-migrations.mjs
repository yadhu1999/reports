export const offlineInventoryColumns = [
  'name',
  'groups.group_name',
  'os_version',
  'last_seen',
  'report_date',
];
export const onlineDescription =
  'Last seen within 30 minutes of the snapshot. Based on daily DataTap data.';
export const offlineDescription =
  'Last seen more than 24 hours before the snapshot. Missing timestamps are Unknown.';
export function migrateConnectivityReports(db) {
  for (const report of db.reports) {
    if (report.query_definition?.source !== 'devices') continue;
    if (
      report.id === 'r_recent' &&
      JSON.stringify(report.query_definition.columns) ===
        JSON.stringify(['name', 'model', 'groups.group_name', 'os_version', 'battery', 'last_seen'])
    ) {
      report.query_definition.columns = [...offlineInventoryColumns];
      report.updated_at = new Date().toISOString();
    }
    if (report.id === 'r_online' && report.description === 'Devices currently connected to Esper.')
      report.description = onlineDescription;
    if (report.id === 'r_offline' && report.description === 'Devices that need your attention.')
      report.description = offlineDescription;
  }
}

export function migrateCannedPresentation(db) {
  for (const report of db.reports) {
    if (report.id === 'r_groups' && report.name === 'Devices by location') {
      report.name = 'Devices by group name';
      report.description =
        'Grouped by Esper group name, not physical location. Groups with the same name are combined.';
    }
    if (report.id === 'r_trend' && report.name === 'Fleet growth') {
      report.name = 'Fleet size over time';
      const scope = report.query_definition.data_scope;
      report.description = `Distinct devices per snapshot, ${scope.from} to ${scope.to}. Saved date range.`;
    }
  }
  for (const viz of db.visualizations || []) {
    if (viz.id === 'v_groups' && viz.name === 'Devices by location')
      viz.name = 'Devices by group name';
    if (viz.id === 'v_trend' && viz.name === 'Fleet growth') viz.name = 'Fleet size over time';
    if (
      ['v_groups', 'v_os'].includes(viz.id) &&
      viz.visualization_definition.options.categoryLimit === undefined
    )
      viz.visualization_definition.options.categoryLimit = 10;
  }
}
