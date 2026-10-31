const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'evidence/home3-scripts/files');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'evidence/home3-scripts/manifest.json'),'utf8'));
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);}
const files=walk(base).filter(x=>x.includes('58eba275'));
const out=[];
for(const p of files){const s=fs.readFileSync(p,'utf8'); const urls=[...new Set([...s.matchAll(/https?:[^\s<>"'`\\)]+/g)].map(x=>x[0]))];const imports=[...new Set([...s.matchAll(/(?:from|import)\s*\(?["']([^"']+)["']/g)].map(x=>x[1]))]; const maps=[...s.matchAll(/sourceMappingURL=([^\s]+)/g)].map(x=>x[1]);const interesting=urls.filter(x=>/beconfident|framer|lenis|lottie/.test(x));out.push({path:path.relative(base,p),bytes:Buffer.byteLength(s),imports,maps,interestingURLs:interesting});}
fs.writeFileSync(path.join(__dirname,'evidence/bundle-summary.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out.map(x=>({...x,interestingURLs:x.interestingURLs.slice(0,50)})),null,2));
const c=JSON.parse(fs.readFileSync(path.join(__dirname,'evidence/home3-capture.json'),'utf8')); const es=c.normalized_result.events.items; const by=new Map();for(const x of es.filter(x=>x.kind==='request')){let u;try{u=new URL(x.url.url)}catch{continue}const key=u.origin;by.set(key,(by.get(key)||0)+1);}
console.log('Origins',JSON.stringify([...by]));
