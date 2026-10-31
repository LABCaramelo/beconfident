const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'evidence');
const e=JSON.parse(fs.readFileSync(path.join(dir,'plan-capture.raw.json'),'utf8'));
const redact=s=>s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'[REDACTED-ID]').replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED-TOKEN]');
fs.writeFileSync(path.join(dir,'plan-capture.redacted.json'),redact(JSON.stringify(e)));
const arts=e.normalized_result.steps.at(-1).artifacts;
fs.writeFileSync(path.join(dir,'plan.redacted.html'),redact(arts.dom.value.text));
fs.writeFileSync(path.join(dir,'plan-accessibility.json'),JSON.stringify(arts.accessibility.value,null,2));
const es=e.normalized_result.events.items;
const summary=es.filter(x=>x.kind==='request'||x.kind==='response').map(x=>{const u=new URL(x.url.url);return {kind:x.kind,id:x.transaction_id,method:x.method,origin:u.origin,path:u.pathname,queryKeys:[...u.searchParams.keys()],resource:x.resource_type,status:x.status};});
fs.writeFileSync(path.join(dir,'plan-network-summary.json'),JSON.stringify(summary,null,2));
for(const [id,name]of [['request-8','plan-diagnosis-response'],['request-11','plan-offers-response']]){const x=es.find(x=>x.kind==='network-content'&&x.transaction_id===id&&x.phase==='response');if(x?.body.content){fs.writeFileSync(path.join(dir,name+'.json'),redact(Buffer.from(x.body.content,'base64').toString('utf8')));}}
const initial=fs.readFileSync(path.join(dir,'plan-initial.raw.html'),'utf8');
fs.writeFileSync(path.join(dir,'plan-initial.redacted.html'),redact(initial));
const m=initial.match(/data-messages="([^"]+)"/);
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
if(m){const messages=JSON.parse(decode(m[1]));fs.writeFileSync(path.join(dir,'plan-messages.json'),JSON.stringify(messages,null,2));console.log(JSON.stringify({pillars:messages.pillars},null,2));}
