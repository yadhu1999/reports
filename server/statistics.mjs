// DataTap stores statistics as strings/JSON. Only explicitly reported units can
// be converted; missing units or values remain null rather than becoming zero.
import { statisticsFieldSQL, jsonValue } from './statistics-fields.mjs';
const memoryNumber = (key) =>
  `TRY_CAST(get_json_object(device_stats.memory_stats, '$.${key}') AS DOUBLE)`;
export const statisticsSQL = {
  ...statisticsFieldSQL,
  ...Object.fromEntries(
    ['available_ram', 'os_occupied_storage', 'available_internal_storage'].map((id) => [
      id,
      `COALESCE(device_stats.${id}, ${jsonValue('memory_stats', id)})`,
    ]),
  ),
  wifi_ssid: `COALESCE(device_stats.wifi_ssid, ${jsonValue('network_stats', 'wifi_network_info.wifi_ssid')})`,
  latitude: 'TRY_CAST(device_stats.latitude AS DOUBLE)',
  longitude: 'TRY_CAST(device_stats.longitude AS DOUBLE)',
  altitude: 'TRY_CAST(device_stats.altitude AS DOUBLE)',
  report_generation_timestamp: 'CAST(device_stats.report_generation_timestamp AS STRING)',
  battery: 'TRY_CAST(device_stats.battery_level AS DOUBLE)',
  storage_used: `CASE WHEN get_json_object(device_stats.memory_stats, '$.units') = 'BYTE' THEN COALESCE(${memoryNumber('used_internal_storage')}, ${memoryNumber('total_internal_storage')} - ${memoryNumber('available_internal_storage')}) / 1000000000.0 ELSE NULL END`,
  // Preserve existing saved reports without pretending this snapshot has CPU data.
  cpu_usage: 'CAST(NULL AS DOUBLE)',
};
for (const id of ['latitude', 'longitude', 'altitude', 'battery']) {
  const blob = id === 'battery' ? 'battery_stats' : 'location_stats';
  const key = id === 'battery' ? 'battery_level' : id;
  statisticsSQL[id] = `COALESCE(${statisticsSQL[id]}, TRY_CAST(${jsonValue(blob, key)} AS DOUBLE))`;
}
