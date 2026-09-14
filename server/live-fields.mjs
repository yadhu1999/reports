import { connectivitySQL } from './connectivity.mjs';
import { statisticsSQL } from './statistics.mjs';

// These are server-owned expressions, never expressions supplied by a client.
export const liveExpressions = {
  devices: {
    status: connectivitySQL,
    serial: "get_json_object(devices.hardware_info, '$.serial')",
    model: "get_json_object(devices.hardware_info, '$.model')",
    battery: 'CAST(NULL AS DOUBLE)',
  },
  device_stats: statisticsSQL,
  device_apps: { version: 'device_apps.version_name' },
  groups: { region: 'CAST(NULL AS STRING)' },
  users: { name: 'CAST(NULL AS STRING)', role: 'users.role_name' },
};
export const unavailableFields = {
  devices: { battery: 'Battery is unavailable in Devices. Use Device Statistics → Battery Level.' },
  device_stats: { cpu_usage: 'DataTap does not expose CPU usage in Device Statistics.' },
  groups: { region: 'DataTap does not expose group region.' },
  users: { name: 'DataTap does not expose user display names. Use Email or User ID.' },
};

export function liveWarnings(q) {
  const missing = unavailableFields[q.source] || {};
  // Returning empty detail cells keeps saved reports usable. Using an unavailable
  // field to filter or summarize could turn missing telemetry into false totals.
  for (const id of [
    ...q.filters.map((f) => f.field),
    ...q.group_by,
    ...q.metrics.map((m) => m.field),
  ]) {
    if (Object.hasOwn(missing, id)) throw Error(missing[id]);
  }
  return (q.metrics.length ? [] : q.columns)
    .filter((id) => Object.hasOwn(missing, id))
    .map((id) => missing[id]);
}
