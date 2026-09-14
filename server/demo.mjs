import {
  offlineInventoryColumns,
  onlineDescription,
  offlineDescription,
} from './report-migrations.mjs';
export function makeData() {
  const data = { devices: [], groups: [], users: [], device_stats: [], device_apps: [] };
  const today = new Date().toISOString().slice(0, 10);
  const names = ['San Francisco', 'New York', 'Austin', 'Chicago', 'Seattle', 'Los Angeles'];
  for (let day = 0; day < 30; day++) {
    const date = new Date(Date.parse(today) - day * 86400000).toISOString().slice(0, 10);
    for (let g = 0; g < 6; g++)
      data.groups.push({
        group_id: `grp_${g + 1}`,
        group_name: names[g],
        region: g % 2 ? 'East' : 'West',
        report_date: date,
      });
    for (let i = 0; i < 1284 - day * 3; i++) {
      const status =
        (i + day * 3) % 29 === 0 ? 'Offline' : (i + day) % 47 === 0 ? 'Idle' : 'Online';
      data.devices.push({
        device_id: `ESP-${String(i + 1).padStart(5, '0')}`,
        name: `${['POS', 'KIOSK', 'TABLET', 'DISPLAY'][i % 4]}-${['SFO', 'NYC', 'AUS', 'CHI', 'SEA', 'LAX'][i % 6]}-${String(i + 1).padStart(3, '0')}`,
        serial: `SN${900000 + i}`,
        os_version: [
          'Android 14',
          'Android 14',
          'Android 14',
          'Android 13',
          'Android 15',
          'Android 12',
          'Android 14',
        ][i % 7],
        model: ['Samsung Galaxy Tab A9', 'Lenovo Tab M10', 'Zebra TC52', 'Samsung Galaxy Tab A8'][
          i % 4
        ],
        group_id: `grp_${(i % 6) + 1}`,
        status,
        battery: 20 + ((i * 7) % 81),
        last_seen: new Date(
          Date.parse(date) -
            (status === 'Offline' ? 48 * 3600000 : status === 'Idle' ? 2 * 3600000 : 10 * 60000),
        ).toISOString(),
        report_generation_timestamp: new Date(Date.parse(date)).toISOString(),
        report_date: date,
      });
      data.device_stats.push({
        device_id: `ESP-${String(i + 1).padStart(5, '0')}`,
        battery: 20 + ((i * 7) % 81),
        storage_used: 8 + (i % 48),
        cpu_usage: 5 + (i % 65),
        tenant_id: 'demo',
        available_ram: String(2000000000 + (i % 4) * 250000000),
        os_occupied_storage: '8000000000',
        available_internal_storage: String((64 - (8 + (i % 48))) * 1000000000),
        wifi_ssid: `Demo Wi-Fi ${(i % 6) + 1}`,
        latitude: 37.77 + (i % 10) * 0.001,
        longitude: -122.42 + (i % 10) * 0.001,
        altitude: 10 + (i % 20),
        memory_stats: JSON.stringify({
          units: 'BYTE',
          total_internal_storage: 64000000000,
          available_internal_storage: (64 - (8 + (i % 48))) * 1000000000,
        }),
        network_stats: JSON.stringify({ demo: true }),
        location_stats: JSON.stringify({ demo: true }),
        battery_stats: JSON.stringify({ battery_level: 20 + ((i * 7) % 81) }),
        report_generation_timestamp: new Date(Date.parse(date)).toISOString(),
        report_date: date,
      });
      if (i < 200)
        data.device_apps.push({
          device_id: `ESP-${String(i + 1).padStart(5, '0')}`,
          app_name: ['Esper Agent', 'Chrome', 'Retail POS', 'Teams'][i % 4],
          package_name: [
            'io.esper.agent',
            'com.android.chrome',
            'com.retail.pos',
            'com.microsoft.teams',
          ][i % 4],
          version: ['8.2.1', '128.0', '3.4.2', '5.1.0'][i % 4],
          report_date: date,
        });
    }
    for (let i = 0; i < 16; i++)
      data.users.push({
        user_id: `usr_${i}`,
        name:
          ['Alex Morgan', 'Jordan Lee', 'Sam Rivera', 'Taylor Chen'][i % 4] +
          (i > 3 ? ` ${i}` : ''),
        email: `user${i + 1}@example.com`,
        role: i === 0 ? 'Administrator' : i % 3 ? 'Analyst' : 'Viewer',
        report_date: date,
      });
  }
  return data;
}
export const baseQuery = (source = 'devices') => ({
  source,
  data_scope: { type: 'LATEST' },
  columns:
    source === 'devices'
      ? ['name', 'os_version', 'status', 'group_id']
      : source === 'groups'
        ? ['group_name', 'region']
        : source === 'users'
          ? ['name', 'email', 'role']
          : source === 'device_apps'
            ? ['app_name', 'version', 'device_id']
            : ['device_id', 'battery', 'storage_used'],
  filters: [],
  group_by: [],
  metrics: [],
  sort: [],
  related: [],
  labels: {},
  limit: 1000,
});
export function seed() {
  const now = new Date().toISOString();
  const report = (id, name, description, q) => ({
    id,
    name,
    description,
    query_definition: q,
    tenant: 'demo',
    created_by: 'Alex Morgan',
    created_at: now,
    updated_at: now,
    last_executed_at: null,
    favorite: false,
  });
  const summary = (group, filters = []) => ({
    ...baseQuery(),
    group_by: group,
    metrics: [
      { field: 'device_id', aggregation: 'count_distinct', alias: 'devices', label: 'Devices' },
    ],
    filters,
    sort: group.length ? [{ field: 'devices', direction: 'desc' }] : [],
  });
  const reports = [
    report('r_total', 'Total devices', 'All devices in your latest fleet snapshot.', summary([])),
    report(
      'r_online',
      'Online devices',
      onlineDescription,
      summary([], [{ field: 'status', operator: 'equals', value: 'Online' }]),
    ),
    report(
      'r_offline',
      'Offline devices',
      offlineDescription,
      summary([], [{ field: 'status', operator: 'equals', value: 'Offline' }]),
    ),
    report(
      'r_os',
      'Devices by OS version',
      'Understand the operating systems across your fleet.',
      summary(['os_version']),
    ),
    report(
      'r_groups',
      'Devices by group name',
      'Grouped by Esper group name, not physical location. Groups with the same name are combined.',
      {
        ...summary(['groups.group_name']),
        related: ['groups'],
      },
    ),
    report('r_recent', 'Offline device inventory', 'Review and investigate disconnected devices.', {
      ...baseQuery(),
      columns: [...offlineInventoryColumns],
      related: ['groups'],
      filters: [{ field: 'status', operator: 'equals', value: 'Offline' }],
    }),
    report(
      'r_trend',
      'Fleet size over time',
      'Distinct device count by snapshot for the saved date range.',
      {
        ...summary(['report_date']),
        data_scope: {
          type: 'DATE_RANGE',
          from: new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10),
          to: now.slice(0, 10),
        },
        sort: [{ field: 'report_date', direction: 'asc' }],
      },
    ),
  ];
  const visualizations = [
    ['v_total', 'Total devices', 'r_total', 'kpi'],
    ['v_online', 'Online devices', 'r_online', 'kpi'],
    ['v_offline', 'Offline devices', 'r_offline', 'kpi'],
    ['v_os', 'Devices by OS version', 'r_os', 'bar'],
    ['v_groups', 'Devices by group name', 'r_groups', 'donut'],
    ['v_trend', 'Fleet size over time', 'r_trend', 'area'],
  ].map(([id, name, report_id, type]) => ({
    id,
    name,
    report_id,
    tenant: 'demo',
    created_by: 'Alex Morgan',
    created_at: now,
    updated_at: now,
    visualization_definition: {
      type,
      dimension: reports.find((r) => r.id === report_id).query_definition.group_by[0],
      measures: ['devices'],
      options: {
        legend: true,
        values: false,
        grid: true,
        ...(['v_groups', 'v_os'].includes(id) ? { categoryLimit: 10 } : {}),
      },
    },
  }));
  return {
    reports,
    visualizations,
    dashboards: [
      {
        id: 'dash_fleet',
        name: 'Fleet overview',
        description: 'A clear view of your devices, wherever they are.',
        tenant: 'demo',
        created_by: 'Alex Morgan',
        created_at: now,
        updated_at: now,
        favorite: true,
        widgets: [
          {
            id: 'w1',
            type: 'visualization',
            resource_id: 'v_total',
            layout: { width: 4, height: 2 },
          },
          {
            id: 'w2',
            type: 'visualization',
            resource_id: 'v_online',
            layout: { width: 4, height: 2 },
          },
          {
            id: 'w3',
            type: 'visualization',
            resource_id: 'v_offline',
            layout: { width: 4, height: 2 },
          },
          { id: 'w4', type: 'visualization', resource_id: 'v_os', layout: { width: 7, height: 4 } },
          {
            id: 'w5',
            type: 'visualization',
            resource_id: 'v_groups',
            layout: { width: 5, height: 4 },
          },
          { id: 'w6', type: 'report', resource_id: 'r_recent', layout: { width: 12, height: 4 } },
        ],
      },
    ],
    audit_events: [],
  };
}
