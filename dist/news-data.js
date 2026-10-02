// Headlines are research leads. They never become numeric observations or alerts.
export const GDELT_NEWS_URL = 'https://api.gdeltproject.org/api/v2/doc/doc?query=%28%22Strait%20of%20Hormuz%22%20OR%20%22oil%20tanker%22%20OR%20%22Kozmino%22%20OR%20%22Ras%20Tanura%22%20OR%20%22oil%20refinery%22%20OR%20%22OPEC%2B%22%29&mode=artlist&format=json&sort=datedesc&timespan=2d&maxrecords=100';
export const EIA_NEWS_URL = 'https://www.eia.gov/rss/todayinenergy.xml';
export const EIA_RELEASE_URL = 'https://www.eia.gov/about/new/WNtest3.php';

const PUBLISHERS = [
  ['reuters.com','Reuters'],['apnews.com','AP'],['bloomberg.com','Bloomberg'],
  ['ft.com','Financial Times'],['spglobal.com','S&P Global'],['argusmedia.com','Argus'],
  ['eia.gov','EIA'],['iea.org','IEA'],['opec.org','OPEC'],['ukmto.org','UKMTO'],
  ['imo.org','IMO'],['cnbc.com','CNBC'],
];
const OIL_WORDS = /\b(oil|crude|petroleum|diesel|gasoline|tanker|refiner(?:y|ies)?|opec|hormuz|kozmino|ras tanura|vlcc|aframax)\b/i;

function publisher(url) {
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:') return null;
    return PUBLISHERS.find(([host])=>parsed.hostname===host||parsed.hostname.endsWith('.'+host))?.[1]??null;
  } catch { return null; }
}
function cleanText(value) {
  return String(value??'').replace(/<!\[CDATA\[|\]\]>/g,'')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
function recentIso(value,now,maxAgeDays=4) {
  const date=new Date(value);
  const age=new Date(now).getTime()-date.getTime();
  return Number.isFinite(age)&&age>=0&&age<=maxAgeDays*86400000?date.toISOString():null;
}
function rssField(item,field) { return item.match(new RegExp('<'+field+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+field+'>','i'))?.[1]??''; }

export function parseGdeltArticles(payload,now=new Date().toISOString()) {
  if(!Array.isArray(payload?.articles)) return [];
  return payload.articles.flatMap((article)=>{
    const url=article?.url;
    const source=publisher(url);
    const title=cleanText(article?.title).slice(0,260);
    const match=String(article?.seendate??'').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const recordedAt=match?recentIso(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,now):null;
    if(!source||!title||!OIL_WORDS.test(title)||!recordedAt) return [];
    return [{title,url,source,recordedAt,timeBasis:'GDELT 收录',kind:'news-lead'}];
  });
}

export function parseEiaRss(xml,now=new Date().toISOString()) {
  return [...String(xml??'').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap((match)=>{
    const title=cleanText(rssField(match[1],'title')).slice(0,260);
    const rawUrl=cleanText(rssField(match[1],'link'));
    const url=rawUrl.replace(/^http:\/\/(?:www\.)?eia\.gov\//i,'https://www.eia.gov/');
    const recordedAt=recentIso(rssField(match[1],'pubDate'),now);
    if(publisher(url)!=='EIA'||!OIL_WORDS.test(title)||!recordedAt) return [];
    return [{title,url,source:'EIA',recordedAt,timeBasis:'EIA 发布',kind:'news-lead'}];
  });
}

export function mergeNewsItems(...groups) {
  const byUrl=new Map();
  for(const item of groups.flat()) {
    if(item?.kind!=='news-lead'||!publisher(item.url)||!item.recordedAt) continue;
    if(!byUrl.has(item.url)||item.recordedAt>byUrl.get(item.url).recordedAt) byUrl.set(item.url,item);
  }
  return [...byUrl.values()].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).slice(0,80);
}

export async function collectNewsLeads(fetchText,{now=new Date().toISOString()}={}) {
  const [gdelt,eia,releases]=await Promise.allSettled([
    fetchText(GDELT_NEWS_URL),fetchText(EIA_NEWS_URL),fetchText(EIA_RELEASE_URL),
  ]);
  const errors=[];
  let gdeltItems=[],eiaItems=[],releaseItems=[];
  if(gdelt.status==='fulfilled') {
    try { gdeltItems=parseGdeltArticles(JSON.parse(gdelt.value),now); }
    catch(error) { errors.push(`GDELT: ${error.message}`); }
  } else errors.push(`GDELT: ${gdelt.reason?.message??'unavailable'}`);
  if(eia.status==='fulfilled') eiaItems=parseEiaRss(eia.value,now);
  else errors.push(`EIA RSS: ${eia.reason?.message??'unavailable'}`);
  if(releases.status==='fulfilled') releaseItems=parseEiaRss(releases.value,now);
  else errors.push(`EIA releases: ${releases.reason?.message??'unavailable'}`);
  return {items:mergeNewsItems(gdeltItems,eiaItems,releaseItems),errors,checkedAt:now};
}
