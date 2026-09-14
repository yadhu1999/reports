import { connectivityDescription } from './connectivity.mjs';
import { statisticsFields } from './statistics-fields.mjs';
const field = (id, label, type = 'string', category = 'Identity') => ({
  id,
  label,
  type,
  category,
  description: `${label} recorded in the daily snapshot.`,
});
export const catalog = [
  {
    id: 'devices',
    label: 'Devices',
    description: 'Device information and current status',
    fields: [
      field('device_id', 'Device ID'),
      field('name', 'Device Name'),
      {
        ...field('serial', 'Serial Number'),
        description: 'Serial number from hardware information; empty when not reported.',
        derived: true,
      },
      field('os_version', 'OS Version', 'string', 'Operating System'),
      {
        ...field('model', 'Device Model', 'string', 'Operating System'),
        description: 'Model from hardware information; empty when not reported.',
        derived: true,
      },
      field('group_id', 'Group ID', 'string', 'Organization'),
      {
        ...field('status', 'Status at Snapshot', 'string', 'Status'),
        description: connectivityDescription,
        derived: true,
      },
      {
        ...field('battery', 'Battery Level · Unavailable in Devices', 'number', 'Status'),
        description: 'Live battery data is available in Device Statistics, not Devices.',
        derived: true,
      },
      field('last_seen', 'Last Seen', 'date', 'Status'),
      field('report_date', 'Snapshot Date', 'date', 'Snapshot'),
    ],
    relationships: [
      {
        id: 'groups',
        label: 'Groups',
        left: 'group_id',
        right: 'group_id',
        fields: [field('groups.group_name', 'Group Name', 'string', 'Related · Groups')],
      },
    ],
  },
  {
    id: 'device_stats',
    label: 'Device Statistics',
    description: 'Battery, memory, storage, network, and location statistics',
    fields: [
      field('device_id', 'Device ID'),
      {
        ...field('battery', 'Battery Level', 'number', 'System'),
        description: 'Battery level reported by DataTap; empty when unavailable.',
        derived: true,
      },
      {
        ...field('storage_used', 'Storage Used (GB)', 'number', 'System'),
        description:
          'Used internal storage in decimal GB, calculated from memory statistics. Empty when values or supported units are missing.',
        derived: true,
      },
      {
        ...field('cpu_usage', 'CPU Usage (%) · Unavailable live', 'number', 'System'),
        description:
          'DataTap device statistics do not expose CPU usage. Live reports return empty values; demo data is simulated.',
        derived: true,
      },
      field('report_date', 'Snapshot Date', 'date', 'Snapshot'),
      ...['available_ram', 'os_occupied_storage', 'available_internal_storage'].map((id, i) => ({
        ...field(
          id,
          [
            'Available RAM (reported value)',
            'OS Occupied Storage (reported value)',
            'Available Internal Storage (reported value)',
          ][i],
          'string',
          'Memory and Storage',
        ),
        description:
          'Original DataTap value. Units are not standardized here; retained as text to avoid misleading numeric totals.',
      })),
      field('wifi_ssid', 'Wi-Fi SSID', 'string', 'Network'),
      ...['latitude', 'longitude', 'altitude'].map((id, i) => ({
        ...field(
          id,
          ['Latitude', 'Longitude', 'Altitude (reported units)'][i],
          'number',
          'Location',
        ),
        description:
          'Reported location value converted to a number. Missing or nonnumeric values remain empty; no unit conversion is applied.',
        derived: true,
      })),
      ...['memory_stats', 'network_stats', 'location_stats', 'battery_stats'].map((id, i) => ({
        ...field(
          id,
          [
            'Memory Details (JSON)',
            'Network Details (JSON)',
            'Location Details (JSON)',
            'Battery Details (JSON)',
          ][i],
          'string',
          'Detailed Statistics',
        ),
        legacy: true,
        description:
          'Original JSON details reported by DataTap. Keys and availability vary by device; displayed and exported as text.',
      })),
      ...statisticsFields,
      {
        ...field('report_generation_timestamp', 'Snapshot Timestamp', 'string', 'Snapshot'),
        description:
          'Full DataTap snapshot generation timestamp, displayed as text. Use Snapshot Date for date-range filters.',
      },
      field('tenant_id', 'Tenant ID', 'string', 'Identity'),
    ],
  },
  {
    id: 'device_apps',
    label: 'Applications',
    description: 'Applications installed across your fleet',
    fields: [
      field('device_id', 'Device ID'),
      field('app_name', 'Application Name'),
      field('package_name', 'Package Name'),
      field('version', 'App Version'),
      field('report_date', 'Snapshot Date', 'date', 'Snapshot'),
    ],
  },
  {
    id: 'groups',
    label: 'Groups',
    description: 'Organize and understand device groups',
    fields: [
      field('group_id', 'Group ID'),
      field('group_name', 'Group Name'),
      {
        ...field('region', 'Region · Unavailable live', 'string', 'Organization'),
        description: 'DataTap groups do not expose region. Live results are empty.',
        derived: true,
      },
      field('report_date', 'Snapshot Date', 'date', 'Snapshot'),
    ],
  },
  {
    id: 'users',
    label: 'Users',
    description: 'People and their assigned roles',
    fields: [
      field('user_id', 'User ID'),
      {
        ...field('name', 'Name · Unavailable live'),
        description: 'DataTap users do not expose display names. Use Email or User ID.',
        derived: true,
      },
      field('email', 'Email'),
      field('role', 'Role', 'string', 'Organization'),
      field('report_date', 'Snapshot Date', 'date', 'Snapshot'),
    ],
  },
];
export function dataset(id) {
  const d = catalog.find((d) => d.id === id);
  if (!d) throw Error('The selected dataset is not available.');
  return d;
}
export function fieldsFor(q) {
  const d = dataset(q.source);
  return [
    ...d.fields,
    ...(q.related || []).flatMap((id) => {
      const r = d.relationships?.find((r) => r.id === id);
      if (!r) throw Error('Related data is not available.');
      return r.fields;
    }),
  ];
}
export const operators = {
  string: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
    'in',
    'not_in',
  ],
  number: [
    'equals',
    'not_equals',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal',
    'between',
    'is_empty',
    'is_not_empty',
  ],
  date: ['equals', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['equals'],
};
export const aggregateOptions = (type) =>
  type === 'number'
    ? ['count', 'count_distinct', 'sum', 'avg', 'min', 'max']
    : ['count', 'count_distinct', 'min', 'max'];
