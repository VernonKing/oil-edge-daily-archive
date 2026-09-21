import { normalizeObservation } from './observation-data.js';

const ESPO_URL = 'https://commodityscope.com/prices/espo-crude-oil';
const CT1_URL = 'https://www.sse.net.cn/index/singleIndex?indexType=ctfi';
const FREIGHT_ALT_URL = 'https://commodityscope.com/freight/tankers/dirty/arabian-gulf-china';
const KOZMINO_FREIGHT_URL = 'https://commodityscope.com/freight/tankers/dirty/kozmino-north-china';
const FUTURES_URLS={brentIce:'https://commodityscope.com/prices/brent-crude-oil',
  wtiNymex:'https://commodityscope.com/prices/wti-crude-oil'};
const PRICES_URL = 'https://commodityscope.com/prices';
const DUBAI_URL = 'https://commodityscope.com/prices/dubai-crude-oil';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ABBREVIATIONS = Object.fromEntries(MONTHS.map((month, index) => [month.slice(0,3), index+1]));

function plain(html) {
  return String(html ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&mdash;|&#8212;|&#x2014;/gi,'—').replace(/&ndash;|&#8211;|&#x2013;/gi,'–')
    .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
function isoDay(day, month, year) {
  const number = ABBREVIATIONS[month.slice(0,3)];
  if (!number) return null;
  return `${year}-${String(number).padStart(2,'0')}-${String(Number(day)).padStart(2,'0')}`;
}
function round(value) { return Math.round(value*100)/100; }

function astroProps(html, component) {
  const island = [...String(html ?? '').matchAll(/<astro-island\b[^>]*>/gi)]
    .map((match) => match[0]).find((tag) => tag.includes(component));
  const encoded = island?.match(/\bprops="([^"]+)"/)?.[1];
  if (!encoded) return null;
  try {
    const decoded = encoded.replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&apos;|&#39;|&#x27;/gi, "'").replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
    return JSON.parse(decoded);
  } catch { return null; }
}

export function parseEspoPage(html) {
  const text = plain(html);
  const start = text.indexOf('ESPO Crude Oil Price Today');
  if (start < 0) return null;
  const section = text.slice(start, start+2500);
  const assessment = section.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\s*·\s*Singapore[^·]*·\s*(20\d{2}-\d{2})\s+loading/);
  const premium = section.match(/vs Dubai swap M2\s*\$?([+-]?\d+(?:\.\d+)?)\s*\/bbl/i);
  if (!assessment || !premium) return null;
  return normalizeObservation({metric:'espoPremium',date:isoDay(assessment[1],assessment[2],assessment[3]),
    value:Number(premium[1]),unit:'USD/bbl',basis:`ESPO FOB Kozmino vs Dubai swap M2; ${assessment[4]} loading`,
    quality:'observed',sourceUrl:ESPO_URL,sourceName:'CommodityScope'});
}

export function parseEspoHistoryPage(html) {
  const data = astroProps(html,'CrudeGradeView')?.data?.[1];
  const series = data?.differentials?.[1];
  if (!Array.isArray(series)) return [];
  const m1 = series.map((item) => item?.[1]).find((item) =>
    item?.code?.[1] === 'AASEU00' && item?.benchmarkLabel?.[1] === 'Dubai swap M2');
  const rows = m1?.history?.[1];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((entry) => {
    const row = entry?.[1];
    const date = row?.date?.[1];
    const value = row?.mid?.[1];
    const loadingMonth = row?.deliveryMonth?.[1];
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(value)
      || !/^20\d{2}-\d{2}$/.test(loadingMonth ?? '')) return [];
    try {
      return [normalizeObservation({metric:'espoPremium',date,value,unit:'USD/bbl',
        basis:`ESPO FOB Kozmino vs Dubai swap M2; ${loadingMonth} loading`,quality:'observed',
        sourceUrl:ESPO_URL,sourceName:'CommodityScope'})];
    } catch { return []; }
  });
}

export function parseEspoFobPage(html) {
  const text=plain(html);
  const start=text.indexOf('ESPO Crude Oil Price Today');
  if(start<0) return null;
  const section=text.slice(start,start+1200);
  const assessment=section.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\s*·\s*Singapore[^·]*·\s*(20\d{2}-\d{2})\s+loading/);
  const price=assessment?section.slice(0,assessment.index).match(/\$([\d,.]+)\s*\/bbl/):null;
  if(!price||!assessment) return null;
  const priceValue=Number(price[1].replaceAll(',',''));
  if(!Number.isFinite(priceValue)||priceValue<40||priceValue>300) return null;
  return normalizeObservation({metric:'espoFob',date:isoDay(assessment[1],assessment[2],assessment[3]),
    value:priceValue,unit:'USD/bbl',basis:`ESPO FOB Kozmino M1; ${assessment[4]} loading`,
    quality:'observed',sourceUrl:ESPO_URL,sourceName:'CommodityScope'});
}

export function parseKozminoFreightHistoryPage(html) {
  const source=String(html??'');
  if(!/Kozmino to North China Dirty Tanker Freight Rates/i.test(plain(source))) return [];
  const start=source.search(/Kozmino to North China tanker freight rate history/i);
  if(start<0) return [];
  const table=source.slice(start).match(/<table\b[\s\S]*?<\/table>/i)?.[0];
  if(!table||!/Aframax[^<]*100,000\s*mt/i.test(plain(table))) return [];
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((match)=>{
    const row=plain(match[1]);
    const quote=row.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\s+([\d,.]+)$/);
    if(!quote) return [];
    const usdPerTonne=Number(quote[4].replaceAll(',',''));
    if(!Number.isFinite(usdPerTonne)||usdPerTonne<=0) return [];
    const point=normalizeObservation({metric:'freightKozminoChina',date:isoDay(quote[1],quote[2],quote[3]),
      value:round(usdPerTonne/7.39),unit:'USD/bbl',
      basis:'Kozmino–North China Aframax 100kt indicative; USD/mt ÷ 7.39 bbl/mt; excludes insurance',
      quality:'proxy',sourceUrl:KOZMINO_FREIGHT_URL,sourceName:'CommodityScope',rawValue:usdPerTonne,rawUnit:'USD/mt'});
    return point?[point]:[];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

export function parseFuturesBenchmarkPage(html, metric) {
  const config={brentIce:{heading:'Brent Crude Oil Price Today',basis:'ICE Brent'},
    wtiNymex:{heading:'WTI Crude Oil Price Today',basis:'NYMEX WTI'}}[metric];
  if(!config) return null;
  const text=plain(html);
  const start=text.indexOf(config.heading);
  if(start<0) return null;
  const section=text.slice(start,start+700);
  const dated=section.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\s*·\s*([A-Z][a-z]{2})\s+(20\d{2})\s+contract/);
  const price=dated?section.slice(0,dated.index).match(/\$([\d,.]+)\s*\/bbl/):null;
  if(!dated||!price) return null;
  const value=Number(price[1].replaceAll(',',''));
  if(!Number.isFinite(value)||value<10||value>300) return null;
  return normalizeObservation({metric,date:isoDay(dated[1],dated[2],dated[3]),value,
    unit:'USD/bbl',basis:`${config.basis} futures settlement; ${dated[4]} ${dated[5]} contract; not EIA spot`,
    quality:'proxy',sourceUrl:FUTURES_URLS[metric],sourceName:'CommodityScope secondary quote'});
}

function productHistory(html, code) {
  const indicators = astroProps(html,'PriceChart')?.indicators?.[1];
  if (!Array.isArray(indicators)) return new Map();
  const series = indicators.map((item) => item?.[1]).find((item) => item?.code?.[1] === code
    && item?.basis?.[1] === 'FOB Singapore' && item?.currency?.[1] === 'USD'
    && item?.unit?.[1] === 'bbl');
  const rows = series?.chartData?.[1];
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.flatMap((entry) => {
    const date = entry?.[1]?.time?.[1];
    const value = entry?.[1]?.close?.[1];
    return /^20\d{2}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(value)
      ? [[date,value]] : [];
  }));
}

function dubaiCashHistory(html) {
  const series = astroProps(html,'CrudeBenchmarkView')?.data?.[1]?.series?.[1];
  if (!Array.isArray(series)) return new Map();
  const cash = series.map((item) => item?.[1]).find((item) =>
    item?.code?.[1] === 'PCAAT00' && item?.label?.[1] === 'Dubai cash M1');
  const rows = cash?.history?.[1];
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.flatMap((entry) => {
    const row = entry?.[1];
    const date = row?.date?.[1];
    const value = row?.mid?.[1];
    const loadingMonth = row?.deliveryMonth?.[1];
    return /^20\d{2}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(value)
      && /^20\d{2}-\d{2}$/.test(loadingMonth ?? '')
      ? [[date,{value,loadingMonth}]] : [];
  }));
}

function procurementCrack(date,gasolineValue,gasoilValue,espo,freight) {
  if(!espo||!freight||!Number.isFinite(gasolineValue)||!Number.isFinite(gasoilValue)) return null;
  return normalizeObservation({metric:'asiaNetMargin',date,
    value:round((2*gasolineValue+gasoilValue)/3-espo.value-freight.value),unit:'USD/bbl',
    basis:`Singapore FOB gasoline 92 and gasoil 10ppm 3-2-1 product netback − ESPO FOB Kozmino M1 (${espo.basis.split('; ')[1]}) − Kozmino–North China Aframax freight; before processing costs, taxes and product logistics`,
    quality:'estimated',sourceUrl:ESPO_URL,sourceName:'CommodityScope component assessments',
    modelVersion:'espo-procurement-crack-v2',
    components:{gasoline:gasolineValue,gasoil:gasoilValue,espoFob:espo.value,
      freightKozminoChina:freight.value,espoLoadingMonth:espo.basis.match(/20\d{2}-\d{2}/)?.[0]},
    componentSources:{gasoline:'https://commodityscope.com/prices/singapore-gasoline-92',
      gasoil:'https://commodityscope.com/prices/singapore-10ppm-gasoil',espo:ESPO_URL,freight:KOZMINO_FREIGHT_URL}});
}

export function parseAsiaMarginHistoryPages(gasolineHtml,gasoilHtml,espoHtml,freightHtml) {
  const gasoline=productHistory(gasolineHtml,'CS-SIN-MOG92');
  const gasoil=productHistory(gasoilHtml,'CS-SIN-GO10');
  const espo=parseEspoFobPage(espoHtml);
  const freight=new Map(parseKozminoFreightHistoryPage(freightHtml).map((point)=>[point.date,point]));
  return [...gasoline].flatMap(([date,gasolineValue]) => {
    const gasoilValue=gasoil.get(date);
    if(!espo||date!==espo.date) return [];
    const point=procurementCrack(date,gasolineValue,gasoilValue,espo,freight.get(date));
    return point?[point]:[];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

export function parseCt1Page(html) {
  const text = plain(html);
  const heading = text.indexOf('中国进口原油运价指数');
  const section = heading >= 0 ? text.slice(heading, heading+3500) : text;
  const date = section.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
  const routeStart = section.search(/中东湾拉斯坦努拉[—-]中国宁波\(CT1\)/);
  const route = routeStart < 0 ? '' : section.slice(routeStart, routeStart+500).split('西非马隆格')[0];
  const value = route.match(/美元\/吨\s*([\d,.]+)/);
  if (!date || !value) return null;
  const dollarsPerTonne = Number(value[1].replaceAll(',',''));
  if (!Number.isFinite(dollarsPerTonne) || dollarsPerTonne <= 0) return null;
  return normalizeObservation({metric:'freightChina',date,value:round(dollarsPerTonne/7.33),unit:'USD/bbl',
    basis:'CT1 Ras Tanura–Ningbo VLCC 270kt; USD/t ÷ approximate 7.33 bbl/t; excludes insurance',
    quality:'proxy',sourceUrl:CT1_URL,sourceName:'Shanghai Shipping Exchange',rawValue:dollarsPerTonne,rawUnit:'USD/t'});
}

export function parseFreightChinaAltPage(html) {
  const source=String(html ?? '');
  if (!/Arabian Gulf to China Dirty Tanker Freight Rates/i.test(plain(source))) return [];
  const start=source.indexOf('CommodityScope Assessment History');
  if (start<0) return [];
  const table=source.slice(start).match(/<table\b[\s\S]*?<\/table>/i)?.[0];
  if (!table || !/VLCC[^<]*270,000\s*mt/i.test(plain(table))) return [];
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((match)=>{
    const row=plain(match[1]);
    const value=row.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\s+([\d,.]+)$/);
    if (!value) return [];
    const dollarsPerTonne=Number(value[4].replaceAll(',',''));
    if (!Number.isFinite(dollarsPerTonne) || dollarsPerTonne<=0) return [];
    const point=normalizeObservation({metric:'freightChinaAlt',
      date:isoDay(value[1],value[2],value[3]),value:round(dollarsPerTonne/7.33),unit:'USD/bbl',
      basis:'Arabian Gulf to China VLCC 270kt indicative; USD/mt ÷ approx 7.33 bbl/t; not CT1 named ports; excludes insurance',
      quality:'proxy',sourceUrl:FREIGHT_ALT_URL,sourceName:'CommodityScope',
      rawValue:dollarsPerTonne,rawUnit:'USD/mt'});
    return point?[point]:[];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

export function parseAsiaMarginPage(productsHtml, espoHtml, freightHtml) {
  const products=plain(productsHtml);
  const quote=(text,label)=>{
    const match=text.match(new RegExp(`${label}[^$]{0,120}\\$([\\d,.]+)\\s*\\/bbl[\\s\\S]{0,90}?(\\d{1,2})\\s+([A-Z][a-z]{2})\\s+(20\\d{2})`,'i'));
    return match?{value:Number(match[1].replaceAll(',','')),date:isoDay(match[2],match[3],match[4])}:null;
  };
  const gasoline=quote(products,'Gasoline 92 — Singapore');
  const gasoil=quote(products,'Gasoil 10ppm — Singapore');
  const espo=parseEspoFobPage(espoHtml);
  const freight=parseKozminoFreightHistoryPage(freightHtml).find((point)=>point.date===gasoline?.date);
  if(!gasoline||!gasoil||!espo||gasoline.date!==gasoil.date||gasoline.date!==espo.date) return null;
  return procurementCrack(gasoline.date,gasoline.value,gasoil.value,espo,freight);
}

export function parseIeaStockReport(html, reportYear, reportMonth, lag = 1) {
  if (!Number.isInteger(reportYear) || !Number.isInteger(reportMonth) || reportMonth < 1 || reportMonth > 12
    || ![1,2].includes(lag)) return null;
  const stockDate = new Date(Date.UTC(reportYear,reportMonth-1-lag,1));
  const stockMonth = stockDate.getUTCMonth()+1;
  const stockYear = stockDate.getUTCFullYear();
  const monthName = MONTHS[stockMonth-1];
  const text = plain(html);
  const subject='(?:global observed (?:oil )?(?:inventories|stocks)|observed global oil (?:inventories|stocks))';
  const amount='([\\d,.]+)\\s*mb\\b';
  const datedAmountTail=`(?:,?\\s*or\\s*[\\d,.]+\\s*mb/d,?)?\\s*,?\\s*in ${monthName}\\b`;
  const patterns=[
    {sign:-1,regex:new RegExp(`${subject}[^.]{0,100}?(?:plunged|fell|declined|dropped|drew|decreased)\\s+by\\s+(?:a\\s+further\\s+)?${amount}${datedAmountTail}`,'i')},
    {sign:1,regex:new RegExp(`${subject}[^.]{0,100}?(?:rose|increased|grew|built|climbed|surged)\\s+by\\s+(?:a\\s+further\\s+)?${amount}${datedAmountTail}`,'i')},
    {sign:-1,regex:new RegExp(`${subject}[^.]{0,150}?and by (?:a further )?${amount} in ${monthName}\\b`,'i')},
    {sign:-1,regex:new RegExp(`${subject}[^.]{0,100}?(?:plunged|fell|declined|dropped|drew|decreased)[^.]{0,100}?\\bin ${monthName}\\b\\s*,?\\s*by\\s+${amount}`,'i')},
    {sign:1,regex:new RegExp(`${subject}[^.]{0,100}?(?:rose|increased|grew|built|climbed)[^.]{0,100}?\\bin ${monthName}\\b\\s*,?\\s*by\\s+${amount}`,'i')},
    {sign:-1,regex:new RegExp(`(?:decline|drawdown) in global observed (?:oil )?(?:inventories|stocks)[^.]{0,100}\\bin ${monthName}\\b\\s*,?\\s*(?:to|of)\\s+${amount}`,'i')},
    {sign:1,preliminary:true,regex:new RegExp(`Preliminary data (?:show|showed) global stocks (?:surged|rose|increased) by (?:a further )?${amount} in ${monthName}`,'i')},
    {sign:1,regex:new RegExp(`Global observed (?:oil )?inventories[^.]{0,120}\\bin ${monthName}\\b[\\s\\S]{0,220}?${monthName} saw a ${amount} build`,'i')},
  ];
  const found=patterns.map((pattern)=>({...pattern,match:text.match(pattern.regex)}))
    .find((pattern)=>pattern.match);
  if (!found) return null;
  const barrels = Number(found.match[1].replaceAll(',',''));
  if (!Number.isFinite(barrels) || barrels > 1000) return null;
  const days = new Date(Date.UTC(stockYear,stockMonth,0)).getUTCDate();
  return normalizeObservation({metric:'globalOilStockChange',date:`${stockYear}-${String(stockMonth).padStart(2,'0')}-${days}`,
    value:round(found.sign*barrels/days),unit:'million bbl/day',basis:'IEA global observed oil inventories; monthly change ÷ calendar days; includes crude, products and oil on water',
    quality:'observed',sourceUrl:`https://www.iea.org/reports/oil-market-report-${MONTHS[reportMonth-1].toLowerCase()}-${reportYear}`,
    sourceName:'IEA Oil Market Report',monthlyChangeMb:found.sign*barrels,...(found.preliminary?{preliminary:true}:{})});
}

export async function collectResearchObservations(fetchText, { asOf, reportMonths = 13 } = {}) {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '') ? asOf : new Date().toISOString().slice(0,10);
  const [year, month] = today.split('-').map(Number);
  const sources = [
    { source:'ESPO', url:ESPO_URL, parse:(html)=>{
      const history = parseEspoHistoryPage(html);
      return history.length ? history : parseEspoPage(html);
    } },
    { source:'ESPO FOB', url:ESPO_URL, parse:parseEspoFobPage },
    { source:'CT1', url:CT1_URL, parse:parseCt1Page },
    { source:'AG-China freight alternative', url:FREIGHT_ALT_URL, parse:parseFreightChinaAltPage },
    { source:'Kozmino-China freight', url:KOZMINO_FREIGHT_URL, parse:parseKozminoFreightHistoryPage },
    { source:'ICE Brent futures reference', url:FUTURES_URLS.brentIce,
      parse:(html)=>parseFuturesBenchmarkPage(html,'brentIce') },
    { source:'NYMEX WTI futures reference', url:FUTURES_URLS.wtiNymex,
      parse:(html)=>parseFuturesBenchmarkPage(html,'wtiNymex') },
    { source:'Asia margin', load:async()=>{
      const historyPages=await Promise.allSettled([
        fetchText('https://commodityscope.com/prices/singapore-gasoline-92'),
        fetchText('https://commodityscope.com/prices/singapore-10ppm-gasoil'),
        fetchText(ESPO_URL),
        fetchText(KOZMINO_FREIGHT_URL),
      ]);
      if (historyPages.every((result)=>result.status==='fulfilled')) {
        const history=parseAsiaMarginHistoryPages(...historyPages.map((result)=>result.value));
        if (history.length) return history;
      }
      const products=await fetchText(PRICES_URL);
      return parseAsiaMarginPage(products,await fetchText(ESPO_URL),await fetchText(KOZMINO_FREIGHT_URL));
    } },
  ];
  for (let offset=0; offset<reportMonths; offset++) {
    const reportDate = new Date(Date.UTC(year, month-1-offset, 1));
    const reportYear = reportDate.getUTCFullYear();
    const reportMonth = reportDate.getUTCMonth()+1;
    sources.push({source:`IEA ${reportYear}-${String(reportMonth).padStart(2,'0')}`,
      url:`https://www.iea.org/reports/oil-market-report-${MONTHS[reportMonth-1].toLowerCase()}-${reportYear}`,
      parse:(html)=>[parseIeaStockReport(html,reportYear,reportMonth,1),
        parseIeaStockReport(html,reportYear,reportMonth,2)].filter(Boolean)});
  }
  const settled = await Promise.allSettled(sources.map(async ({url,parse,load}) => {
    const point = load?await load():parse(await fetchText(url));
    if (!point || Array.isArray(point) && point.length === 0) throw new Error('No basis-matched value found');
    return point;
  }));
  return {
    observations:settled.flatMap((result)=>result.status==='fulfilled'
      ? Array.isArray(result.value)?result.value:[result.value] : []),
    errors:settled.flatMap((result,index)=>result.status==='rejected'?[{source:sources[index].source,message:result.reason?.message??'Unavailable'}]:[]),
  };
}
