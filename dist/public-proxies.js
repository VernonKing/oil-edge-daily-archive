import { normalizeObservation } from './observation-data.js';

const START = '2026-01-01';
const EIA_SOURCE = 'https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm';
const PORTWATCH_SOURCE = 'https://portwatch.imf.org/';
const PORTWATCH_API = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';

export function proxyUrls(start = START, apiKey = 'DEMO_KEY') {
  const eia = new URL('https://api.eia.gov/v2/petroleum/stoc/wstk/data/');
  for (const [key, value] of Object.entries({
    api_key: apiKey, frequency: 'weekly', 'data[0]': 'value',
    'facets[series][]': 'WCESTUS1', start, 'sort[0][column]': 'period',
    'sort[0][direction]': 'asc', length: '1000',
  })) eia.searchParams.set(key, value);
  const portwatch = new URL(PORTWATCH_API);
  for (const [key, value] of Object.entries({
    where: `portid='chokepoint6' AND date>=DATE '${start}'`,
    outFields: 'date,portid,n_tanker', orderByFields: 'date ASC',
    resultRecordCount: '1000', returnGeometry: 'false', f: 'json',
  })) portwatch.searchParams.set(key, value);
  return { eia: eia.toString(), portwatch: portwatch.toString() };
}

function dated(date, asOf) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && date >= START && date <= asOf;
}

export function parseUsCrudeStocks(payload, asOf) {
  const rows = Array.isArray(payload?.response?.data) ? payload.response.data : [];
  return rows.flatMap((row) => {
    const value = Number(row.value);
    if (row.series !== 'WCESTUS1' || !dated(row.period, asOf) || row.value == null
      || row.value === '' || !Number.isFinite(value) || value < 0) return [];
    const point = normalizeObservation({
      metric: 'usCrudeStocks', date: row.period, value: Math.round(value) / 1000,
      unit: 'million bbl', quality: 'proxy',
      basis: 'EIA U.S. commercial crude oil stocks, excluding SPR; weekly level; U.S. proxy, not global crude or total oil stocks',
      sourceUrl: EIA_SOURCE, sourceName: 'EIA WCESTUS1',
    });
    return point ? [point] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function parseHormuzTankers(payload, asOf) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return features.flatMap(({ attributes: row = {} }) => {
    const value = Number(row.n_tanker);
    if (row.portid !== 'chokepoint6' || !dated(row.date, asOf)
      || !Number.isInteger(value) || value < 0) return [];
    const point = normalizeObservation({
      metric: 'hormuzTankers', date: row.date, value, unit: 'ships/day',
      quality: 'proxy',
      basis: 'IMF PortWatch AIS tanker transits at Hormuz; vessel count, not oil flow or cargo volume',
      sourceUrl: PORTWATCH_SOURCE, sourceName: 'IMF PortWatch',
    });
    return point ? [point] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export async function collectPublicProxies(fetchText, { asOf, apiKey } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('Expected an ISO observation cutoff');
  const urls = proxyUrls(START, apiKey);
  const sources = [
    { source: 'EIA U.S. commercial crude stocks', url: urls.eia, parse: parseUsCrudeStocks },
    { source: 'IMF PortWatch Hormuz tanker transits', url: urls.portwatch, parse: parseHormuzTankers },
  ];
  const settled = await Promise.allSettled(sources.map(async ({ url, parse }) => {
    const points = parse(JSON.parse(await fetchText(url)), asOf);
    if (!points.length) throw new Error('No valid dated observations');
    return points;
  }));
  return {
    observations: settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
    errors: settled.flatMap((result, index) => result.status === 'rejected'
      ? [{ source: sources[index].source, message: result.reason?.message ?? 'Unavailable' }] : []),
  };
}
