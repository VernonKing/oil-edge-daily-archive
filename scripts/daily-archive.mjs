import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectResearchObservations } from '../dist/research-data.js';
import { canonicalizeResearchObservations, mergeObservations } from '../dist/observation-data.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fetchedAt=new Date().toISOString();
const archiveDir=path.join(root,'data');
const dailyDir=path.join(archiveDir,'daily');
const historyPath=path.join(archiveDir,'history.json');

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
const observations=canonicalizeResearchObservations(collected.observations);
const history=canonicalizeResearchObservations(mergeObservations(prior,observations));
await mkdir(dailyDir,{recursive:true});
await writeFile(path.join(dailyDir,`${today}.json`),JSON.stringify({date:today,fetchedAt,observations,errors:collected.errors},null,2)+'\n');
await writeFile(historyPath,JSON.stringify({updatedAt:fetchedAt,observations:history},null,2)+'\n');
process.stdout.write(JSON.stringify({date:today,newObservations:observations.length,totalObservations:history.length,errors:collected.errors.length})+'\n');
if(!observations.length) process.exitCode=1;
