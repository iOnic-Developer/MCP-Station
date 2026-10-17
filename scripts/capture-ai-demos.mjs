/** Real Chromium captures of an isolated Station; only the AI provider/weather API are scripted. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeather, createLab, disclosure, pause, sourceTask, testConnection } from './test-ai-first.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root,'docs/assets/assistant-first');
const python = process.env.GIF_PYTHON || '/workspace/omniforge/.venv/bin/python';
const lab = await createLab();
const evidence = {disclosure,build:'Unreleased feat/assistant-first; app reports 2.7.0',provider:'Local scripted Responses API mock; dummy key; no paid model',weather:'Loopback deterministic fixture; not real weather',recording:'Real Chromium viewport frames; accelerated waits; disclosure and explanatory captions added outside app pixels',demos:[]};
let active, recording;
async function start(name,title) {
  active = {name,title,frames:[],caption:title,started:Date.now()};
  let stopped=false;
  recording={stop:()=>{stopped=true;}};
  recording.promise=(async()=>{
    while(!stopped) {
      const file=path.join(lab.temp,`${name}-${String(active.frames.length).padStart(3,'0')}.png`);
      await lab.page.screenshot({path:file});
      active.frames.push({file,caption:active.caption});
      await pause(500);
    }
  })();
}
async function checkpoint(caption) { active.caption=caption; await pause(1700); }
async function finish() {
  while(active.frames.length<24) await pause(200);
  recording.stop(); await recording.promise;
  // At most 25 seconds at 2 fps; retain the actual last frame.
  if(active.frames.length>50) active.frames=Array.from({length:50},(_,i)=>active.frames[Math.round(i*(active.frames.length-1)/49)]);
  const metadata={...active,disclosure,output};
  const file=path.join(lab.temp,`${active.name}.json`); await writeFile(file,JSON.stringify(metadata));
  const encoder=spawn(python,['-c',String.raw`
import json,sys,os
from PIL import Image,ImageDraw,ImageFont
meta=json.load(open(sys.argv[1]))
fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font=ImageFont.truetype(fontpath,16)
small=ImageFont.truetype(fontpath,14)
frames=[]
for item in meta['frames']:
    shot=Image.open(item['file']).convert('RGB')
    canvas=Image.new('RGB',(shot.width,shot.height+112),'#102923')
    canvas.paste(shot,(0,72))
    d=ImageDraw.Draw(canvas)
    d.text((20,10),meta['disclosure'],font=font,fill='#ffffff')
    d.text((20,38),meta['title']+' · unreleased branch preview (app 2.7.0)',font=small,fill='#bee5d5')
    d.text((20,shot.height+83),item['caption'],font=small,fill='#ffffff')
    canvas=canvas.resize((1000,round(canvas.height*1000/canvas.width)),Image.Resampling.LANCZOS)
    frames.append(canvas)
# One palette avoids inter-frame palette flashing. Frames are actual screenshots, not DOM recreations.
thumb=Image.new('RGB',(200*len(frames),175))
for i,frame in enumerate(frames):
    tile=frame.copy();tile.thumbnail((200,175));thumb.paste(tile,(i*200,0))
palette=thumb.quantize(colors=128)
indexed=[frame.quantize(palette=palette,dither=Image.Dither.NONE) for frame in frames]
target=os.path.join(meta['output'],meta['name']+'.gif')
indexed[0].save(target,save_all=True,append_images=indexed[1:],duration=500,loop=0,optimize=True,disposal=2)
frames[-1].save(os.path.join(meta['output'],meta['name']+'-poster.png'),optimize=True)
with Image.open(target) as gif:
    duration=0
    for i in range(gif.n_frames):
        gif.seek(i);duration+=gif.info.get('duration',0)
    assert 12000 <= duration <= 25000,duration
    assert os.path.getsize(target)<3*1024*1024,os.path.getsize(target)
print(json.dumps({'name':meta['name'],'frames':len(frames),'durationMs':duration,'bytes':os.path.getsize(target)}))
`,file],{stdio:['ignore','pipe','inherit']});
  let stdout='';encoder.stdout.on('data',(chunk)=>stdout+=chunk);const [code]=await once(encoder,'exit');assert.equal(code,0,'GIF encoding/validation failed');
  const result=JSON.parse(stdout);evidence.demos.push(result);console.log(JSON.stringify(result));
}
try {
  await mkdir(output,{recursive:true});
  assert.equal((await lab.api('/mcps')).mcps.length,18);
  await lab.go('#/overview','[data-add]');
  await start('create','Create an MCP with AI');
  const id=await buildWeather(lab,{checkpoint});
  await testConnection(lab,id);
  await checkpoint('Local fixture test passed. Review generated code; endpoint is still disabled.');
  await lab.go(`#/integrations/${id}/tools`,'#toolList');
  await checkpoint('The real Tools view now lists forecast_echo. No live weather connection is claimed.');
  await finish();

  await lab.api(`/mcps/${id}/file`,'PUT',{path:'index.js',content:lab.sourceCode().replaceAll('/weather\'', '/weather-broken\'')});
  await lab.api('/reload','POST',{});
  await lab.go(`#/integrations/${id}/assistant`,'.chat-body textarea');
  await start('fix','Fix a broken local service');
  await testConnection(lab,id,false);
  await checkpoint('Deliberately broken fixture URL: Test connection reports a real HTTP 404.');
  await sourceTask(lab,id,'fix',checkpoint);
  await testConnection(lab,id);
  await checkpoint('Retest passed against the local fixture after the real source repair.');
  await finish();

  await start('modify','Change or extend an MCP');
  await sourceTask(lab,id,'modify',checkpoint);
  await testConnection(lab,id);
  await checkpoint('Local fixture retest passed; this is not evidence of a live weather API.');
  await lab.go(`#/integrations/${id}/tools`,'#toolList');
  const names=await lab.page.locator('#toolList summary .mono').allTextContents();
  assert.deepEqual(names.sort(),['forecast_echo','forecast_units']);
  await lab.page.locator('#toolList details').filter({hasText:'forecast_units'}).locator('summary').click();
  await checkpoint('Actual registered tools: forecast_echo retained; forecast_units added with C/F input.');
  await finish();
  const source=(await lab.api('/mcps')).mcps.find((source)=>source.id===id);
  assert.equal(source.enabled,false);assert(source.instances.every((instance)=>!instance.enabled));
  assert.deepEqual(lab.errors,[]);assert.deepEqual(lab.external,[]);
  evidence.assertions={isolatedBundledModules:18,assistantRequests:lab.requests.length,realToolCalls:lab.records,localWeatherRequests:lab.fixtureHits,endpointEnabled:false,pageErrors:0,externalBrowserRequests:0};
  await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS three real-server GIFs and static posters captured; real writes, failure/repair, tool extension and disabled endpoint verified.');
} finally {
  recording?.stop();await recording?.promise;
  await lab.close();
}
