const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validSource = (value) => {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
};

export function normalizeObservation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { metric, date, unit, basis, quality, sourceUrl } = raw;
  if (typeof metric !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(metric)
    || !validDate(date) || typeof raw.value !== 'number' || !Number.isFinite(raw.value)
    || typeof unit !== 'string' || !unit.trim()
    || typeof basis !== 'string' || !basis.trim()
    || !['observed', 'estimated', 'proxy'].includes(quality)
    || !validSource(sourceUrl)) return null;
  return {
    ...raw,
    metric: metric.trim(), date, value: raw.value,
    unit: unit.trim(), basis: basis.trim(), quality,
    sourceUrl: new URL(sourceUrl).toString(),
  };
}

const observationKey = ({ metric, date, basis, sourceUrl }) =>
  `${metric}\u0000${date}\u0000${basis}\u0000${sourceUrl}`;

export function mergeObservations(existing = [], incoming = []) {
  const byKey = new Map();
  for (const raw of [...existing, ...incoming]) {
    const point = normalizeObservation(raw);
    if (point) byKey.set(observationKey(point), point);
  }
  return [...byKey.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric) || a.basis.localeCompare(b.basis));
}

export function canonicalizeResearchObservations(raw = []) {
  const points=mergeObservations([],raw);
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const reportRank=(point)=>{
    const match=point.sourceUrl.match(/oil-market-report-([a-z]+)-(20\d{2})/i);
    const month=match?months.indexOf(match[1].toLowerCase()):-1;
    return month<0?0:Number(match[2])*12+month+1;
  };
  const stocks=new Map(),other=[];
  for(const point of points){
    if(point.metric==='asiaNetMargin' && point.modelVersion==='asia321-v1-fixed-cost-7') continue;
    if(point.metric!=='globalOilStockChange'){other.push(point);continue;}
    const key=`${point.date}\u0000${point.basis}`;
    const previous=stocks.get(key);
    if(!previous || reportRank(point)>reportRank(previous)) stocks.set(key,point);
  }
  return [...other,...stocks.values()].sort((a,b)=>
    a.date.localeCompare(b.date)||a.metric.localeCompare(b.metric)||a.basis.localeCompare(b.basis));
}

export function summarizeObservations(raw = []) {
  const points = mergeObservations([], raw);
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const comparable = latest && previous
    && latest.date !== previous.date
    && latest.metric === previous.metric
    && latest.unit === previous.unit
    && latest.basis === previous.basis
    && latest.quality === previous.quality
    && (latest.modelVersion ?? null) === (previous.modelVersion ?? null)
    && (latest.metric !== 'asiaNetMargin' || Boolean(latest.components?.espoLoadingMonth)
      && latest.components.espoLoadingMonth === previous.components?.espoLoadingMonth);
  return {
    latest,
    previous,
    change: comparable ? Math.round((latest.value - previous.value) * 1000) / 1000 : null,
    changeLabel: comparable ? '相邻可比观测' : null,
  };
}

export function oneYearStart(today) {
  if (!validDate(today)) throw new Error('Expected an ISO calendar date');
  const [year, month, day] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function buildResearchAlerts(raw = [], today = new Date().toISOString().slice(0,10)) {
  if (!validDate(today)) return [];
  const latestByMetric=new Map();
  for (const point of canonicalizeResearchObservations(raw)) {
    if (point.date <= today) latestByMetric.set(point.metric,point);
  }
  const fresh=(point,days)=>point && (Date.parse(today)-Date.parse(point.date))/86400000<=days;
  const alerts=[];
  const push=(point,title,detail)=>alerts.push({id:`research-${point.metric}`,severity:'critical',title,
    detail:`${point.date} · ${point.quality==='estimated'?'估算':point.quality==='proxy'?'代理':'公开观测'} ${point.value} ${point.unit}。${detail}`,
    implication:`口径：${point.basis}`,sourceUrl:point.sourceUrl,field:point.metric});
  const margin=latestByMetric.get('asiaNetMargin');
  if (fresh(margin,4) && margin.quality==='estimated' && (
    margin.modelVersion==='espo-procurement-crack-v2' && margin.value<0
    || Number.isFinite(margin.errorBand) && margin.value+margin.errorBand<0))
    push(margin,'ESPO 采购后裂解差转负','该差额尚未扣加工成本、税费和成品油物流；转负意味着完整利润更受压，需核验实际开工与采购。');
  const espo=latestByMetric.get('espoPremium');
  if (fresh(espo,4) && (espo.quality==='observed'&&espo.value>=25
    || espo.quality==='estimated'&&Number.isFinite(espo.errorBand)&&espo.value-espo.errorBand>=25))
    push(espo,'ESPO 升贴水处高压区间','与纪要 25 美元/桶参考阈值比较，注意迪拜掉期基准。');
  const ct1=latestByMetric.get('freightChina');
  const freight=fresh(ct1,4)?ct1:latestByMetric.get('freightChinaAlt');
  if (fresh(freight,4) && freight.quality==='proxy' && freight.value*0.9>=15)
    push(freight,freight.metric==='freightChina'?'中东—宁波运费代理显著偏高':'阿湾→中国替代运费显著偏高',
      '即使采用 10% 换算误差仍超过 15 美元/桶参考线；不含保险，替代航线不是 CT1。');
  const stocks=latestByMetric.get('globalOilStockChange');
  if (fresh(stocks,60) && stocks.quality==='observed' && stocks.value<=-4)
    push(stocks,'全球可观测石油库存快速去化','IEA 月度变化折算为日均；不是全球原油库存。');
  return alerts;
}
