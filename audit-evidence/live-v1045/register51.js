/* register51.js — heat now reaches the DECISION. The question this answers
   is not "is the photo lit differently" (v10.48 did that) but "does she
   CHOOSE a different picture", which is what the owner actually meant by
   heat. Same thread, same ask, only the state differs. */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT='/home/user/frenz';
const KEY=(process.env.XAI_API_KEY||'').trim();
const ctx={console,Date,Math,JSON,URL,fetch,AbortController,setTimeout,clearTimeout,
  localStorage:{getItem:()=>null,setItem:()=>{}},navigator:{},window:{}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'js/personas.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'js/api.js'),'utf8'),ctx);
const API=vm.runInContext('ClaudeAPI',ctx),P=vm.runInContext('Personas',ctx);
API._swSpeaks=async()=>false;
const settings={pool:[{id:'x1',enabled:true,kind:'openai',label:'grok',apiKey:KEY,
  baseUrl:'https://api.x.ai/v1',model:'grok-4-fast-non-reasoning',imageModel:'grok-imagine-image-quality'}]};
ctx.Settings={get:()=>settings};
function mk(heat){
  const t=P.byId('bre');const profile=JSON.parse(JSON.stringify(t));
  profile.userName='Jon';profile.world=P.WORLD;
  const createdAt=Date.now()-90*86400000;
  const f={id:'bre-r51',profile,createdAt,state:P.seedState(t,t.sliders,createdAt),memories:[],vibeSeed:7};
  f.state.floors=API.initFloors(f);
  if(heat===2){f.state.attraction=85;f.state.comfort=85;f.state.closeness=80;f.state.tension=8;}
  else {f.state.attraction=0;f.state.comfort=30;f.state.closeness=40;f.state.tension=0;}
  return f;
}
const ASK=[{role:'assistant',text:"just got in, feet are done"},
  {role:'user',text:"send me a pic of your evening"}];
(async()=>{
  for(const h of [0,2]){
    const f=mk(h);
    console.log(`\n===== heat ${API._imageHeat(f)} — what she CHOOSES to send =====`);
    for(let i=1;i<=3;i++){
      try{
        const r=await API.chat(f,ASK,settings,Date.now()-900000);
        if(r.refusal){console.log(`  ${i}: PROVIDER REFUSED`);continue;}
        const p=(r.bubbles||[]).filter(x=>/^\s*\[\s*photo\s*\]/i.test(x));
        console.log('  '+i+': '+(p.length?p[0].slice(0,120):'(no photo) '+(r.bubbles||[]).map(s=>s.slice(0,40)).join(' / ')));
      }catch(e){console.log(`  ${i}: ERROR ${String(e&&e.message).slice(0,110)}`);}
    }
  }
})();
