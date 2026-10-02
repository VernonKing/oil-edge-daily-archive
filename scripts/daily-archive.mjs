import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectResearchObservations } from '../dist/research-data.js';
import { canonicalizeResearchObservations, mergeObservations } from '../dist/observation-data.js';
import { collectNewsLeads, mergeNewsItems } from '../dist/news-data.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fetchedAt=new Date().toISOString();
const archiveDir=path.join(root,'data');
const dailyDir=path.join(archiveDir,'daily');
const historyPath=path.join(archiveDir,'history.json');
const newsDir=path.join(archiveDir,'news');
const newsLatestPath=path.join(newsDir,'latest.json');
const newsDailyPath=path.join(newsDir,`${today}.json`);

async function fetchText(url) {
  const response=await fetch(url,{headers:{'user-agent':'OilEdgeResearchMonitor/1.0'},
    signal:AbortSignal.timeout(25000),cache:'no-store'});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

let prior=[];
try { prior=JSON.parse(await readFile(historyPath,'utf8')).observations??[]; }
catch(error) { if(error.code!=='ENOENT') throw error; }

const collected=await collectResearchObservations(fetchText,{asOf:today});
const news=await collectNewsLeads(fetchText,{now:fetchedAt});
const observations=canonicalizeResearchObservations(collected.observations);
const history=canonicalizeResearchObservations(mergeObservations(prior,observations));
await mkdir(dailyDir,{recursive:true});
await writeFile(path.join(dailyDir,`${today}.json`),JSON.stringify({date:today,fetchedAt,observations,errors:collected.errors},null,2)+'\n');
await writeFile(historyPath,JSON.stringify({updatedAt:fetchedAt,observations:history},null,2)+'\n');
let earlierNews=[],priorChecks=[],priorDayItems=[];
try { earlierNews=JSON.parse(await readFile(newsLatestPath,'utf8')).items??[]; }
catch(error) { if(error.code!=='ENOENT') throw error; }
try { const priorDay=JSON.parse(await readFile(newsDailyPath,'utf8'));priorChecks=priorDay.checks??[];priorDayItems=priorDay.items??[]; }
catch(error) { if(error.code!=='ENOENT') throw error; }
const cutoff=new Date(Date.parse(fetchedAt)-4*86400000).toISOString();
const newsItems=mergeNewsItems(earlierNews,news.items).filter((item)=>item.recordedAt>=cutoff);
const beijingDay=(timestamp)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
const dayItems=mergeNewsItems(priorDayItems,news.items).filter((item)=>beijingDay(item.recordedAt)===today);
const checks=[...priorChecks,{checkedAt:fetchedAt,newItems:news.items.length,errors:news.errors}];
await mkdir(newsDir,{recursive:true});
await writeFile(newsDailyPath,JSON.stringify({date:today,items:dayItems,checks},null,2)+'\n');
await writeFile(newsLatestPath,JSON.stringify({updatedAt:fetchedAt,items:newsItems,errors:news.errors},null,2)+'\n');
process.stdout.write(JSON.stringify({date:today,newObservations:observations.length,totalObservations:history.length,errors:collected.errors.length,newsItems:newsItems.length,newsErrors:news.errors.length})+'\n');
if(!observations.length) process.exitCode=1;
