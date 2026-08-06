export const DENSITY_POINT_SCHEMA_VERSION = 1;
export const DENSITY_POINT_ENCODING = 'u16le-base64';
export const DENSITY_POINT_BYTES_PER_RECORD = 4;

const validBounds = (bounds) => bounds
  && Number.isFinite(Number(bounds.minLon))
  && Number.isFinite(Number(bounds.minLat))
  && Number.isFinite(Number(bounds.maxLon))
  && Number.isFinite(Number(bounds.maxLat))
  && Number(bounds.maxLon) > Number(bounds.minLon)
  && Number(bounds.maxLat) > Number(bounds.minLat);

export const encodeDensityPointDocument = ({
  layerId,
  records,
  bounds,
  encodeBase64,
}) => {
  if (!validBounds(bounds)) throw new Error('density points bounds are invalid');
  if (!Array.isArray(records)) throw new Error('density points records must be an array');
  if (typeof encodeBase64 !== 'function') throw new Error('encodeBase64 is required');
  const bytes = new Uint8Array(records.length * DENSITY_POINT_BYTES_PER_RECORD);
  const width = Number(bounds.maxLon) - Number(bounds.minLon);
  const height = Number(bounds.maxLat) - Number(bounds.minLat);
  records.forEach((record, index) => {
    const lon = Number(record.lon);
    const lat = Number(record.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`density point ${index} has invalid lon/lat`);
    }
    const qx = Math.min(65535, Math.max(0,
      Math.round((lon - Number(bounds.minLon)) / width * 65535)));
    const qy = Math.min(65535, Math.max(0,
      Math.round((lat - Number(bounds.minLat)) / height * 65535)));
    const offset = index * DENSITY_POINT_BYTES_PER_RECORD;
    bytes[offset] = qx & 0xff;
    bytes[offset + 1] = qx >>> 8;
    bytes[offset + 2] = qy & 0xff;
    bytes[offset + 3] = qy >>> 8;
  });
  return {
    schemaVersion: DENSITY_POINT_SCHEMA_VERSION,
    layerId: String(layerId || ''),
    bounds,
    encoding: DENSITY_POINT_ENCODING,
    count: records.length,
    data: encodeBase64(bytes),
  };
};

export const decodeDensityPointDocument = (document, {
  decodeBase64,
  fallbackBounds = null,
} = {}) => {
  const bounds = document?.bounds || fallbackBounds;
  if (document?.schemaVersion !== DENSITY_POINT_SCHEMA_VERSION
    || document?.encoding !== DENSITY_POINT_ENCODING
    || !validBounds(bounds)
    || typeof document.data !== 'string'
    || typeof decodeBase64 !== 'function') return null;
  const bytes = decodeBase64(document.data);
  if (!bytes || typeof bytes.length !== 'number') return null;
  const count = Number(document.count);
  if (!Number.isInteger(count)
    || count < 0
    || bytes.length !== count * DENSITY_POINT_BYTES_PER_RECORD) return null;
  const points = new Float64Array(count * 2);
  const width = Number(bounds.maxLon) - Number(bounds.minLon);
  const height = Number(bounds.maxLat) - Number(bounds.minLat);
  for (let index = 0; index < count; index += 1) {
    const offset = index * DENSITY_POINT_BYTES_PER_RECORD;
    const qx = Number(bytes[offset]) | (Number(bytes[offset + 1]) << 8);
    const qy = Number(bytes[offset + 2]) | (Number(bytes[offset + 3]) << 8);
    points[index * 2] = Number(bounds.minLon) + qx / 65535 * width;
    points[index * 2 + 1] = Number(bounds.minLat) + qy / 65535 * height;
  }
  return points;
};

export const validateDensityPointDocument = (document, { expectedLayerId, expectedCount } = {}) => {
  const errors = [];
  if (document?.schemaVersion !== DENSITY_POINT_SCHEMA_VERSION) errors.push('schemaVersion must be 1');
  if (document?.encoding !== DENSITY_POINT_ENCODING) errors.push(`encoding must be ${DENSITY_POINT_ENCODING}`);
  if (!validBounds(document?.bounds)) errors.push('bounds are invalid');
  if (!Number.isInteger(Number(document?.count)) || Number(document?.count) < 0) errors.push('count is invalid');
  if (typeof document?.data !== 'string') errors.push('data must be a base64 string');
  if (expectedLayerId != null && document?.layerId !== expectedLayerId) errors.push('layerId does not match');
  if (expectedCount != null && Number(document?.count) !== Number(expectedCount)) errors.push('count does not match');
  return errors;
};
