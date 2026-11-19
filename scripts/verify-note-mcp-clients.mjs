// Controlled transport acceptance through installed client binaries; no real model or user configuration.
// Usage: node scripts/verify-note-mcp-clients.mjs claude|codex|opencode|dsh
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {SUPPORTED_HARNESS_PROFILE} from '@janus-agent/harness-node'
const target=process.argv[2]??'claude'
if(!['claude','codex','opencode','dsh'].includes(target))throw new Error(`Unsupported client: ${target}. Expected claude, codex, opencode or dsh.`)
const base=path.resolve('.cache/cli-note-acceptance');await fs.mkdir(base,{recursive:true})
const workspace=path.join(base,process.argv[2]??'claude','workspace');await fs.mkdir(path.join(workspace,'.agents/notes'),{recursive:true})
const repoId=randomUUID(),noteId=randomUUID()
await fs.writeFile(path.join(workspace,'.agents/harness.json'),JSON.stringify({schemaVersion:1,repoId,name:'Client acceptance',profile:SUPPORTED_HARNESS_PROFILE}))
const original='---\n'+JSON.stringify({schema:'harness-note/2',id:noteId,kind:'module',role:'project',moduleState:'partial',lifecycle:'accepted',created:'2026-10-10',updated:'2026-10-10T00:00:00Z'})+'\n---\n# Terminal Acceptance Marker\n\n## Responsibility\nRead the original Note through the actual client.\n'
await fs.writeFile(path.join(workspace,'.agents/notes/module.md'),original)
const production=path.resolve('artifacts/build-check/main/note-mcp.js')
const wrapper=path.join(base,'note-mcp.mjs')
await fs.writeFile(wrapper,`import {spawn} from 'node:child_process';import fs from 'node:fs';let input='';const c=spawn(process.execPath,[${JSON.stringify(production)}],{env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});process.stdin.on('data',b=>{input+=b;let i;while((i=input.indexOf('\\n'))>=0){const line=input.slice(0,i);input=input.slice(i+1);try{let x=JSON.parse(line);if(x.method==='tools/call')fs.appendFileSync(process.env.NOTE_CALL_LOG,JSON.stringify(x.params)+'\\n')}catch{}}c.stdin.write(b)});process.stdin.on('end',()=>c.stdin.end());c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);process.on('SIGTERM',()=>c.kill());c.on('exit',code=>process.exit(code??0));`)
const sessions={}
const plan=[['list',{workspacePath:workspace}],['context',{workspacePath:workspace,uris:[`note://${repoId}/${noteId}`]}],['write',{workspacePath:workspace,reason:'Acceptance fixture update',operations:[{type:'update',uri:`note://${repoId}/${noteId}`,expectedHash:createHash('sha256').update(original).digest('hex'),sections:{Responsibility:'Terminal read and write acceptance verified.'}}]}],['read',{workspacePath:workspace,uri:`note://${repoId}/${noteId}`}],['suggestions',{workspacePath:workspace,noteId}]]
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b
 let body;try{body=JSON.parse(raw)}catch{res.end('{}');return}
 if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');res.end('{"input_tokens":100}');return}
 const client=req.url.split('/')[1];const run=sessions[client]??={requests:0,tools:[],step:0};run.requests++
 const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(n=>({...n,namespace:t.name})):t);run.tools=[...new Set([...run.tools,...tools.map(t=>t.name??t.function?.name??t.type)])]
 const discovering=client==='codex'&&run.requests===1
 const step=plan[run.step]
 const chosen=discovering?tools.find(t=>t.name==='list_mcp_resources'):step?tools.find(t=>new RegExp('note[._]'+step[0]+'(?:_[a-f0-9]+)?$','i').test(t.name??t.function?.name??'')):undefined
 const tool=chosen?.name??chosen?.function?.name
 const call=!!tool; if(call&&!discovering)run.step++
 let args=discovering?{server:'janusx-note'}:step?.[1]??{};const marker='NOTE_CLIENT_ACCEPTANCE_COMPLETE'
 const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
 res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache')
 if(req.url.includes('/messages')){
  const content=call?{type:'tool_use',id:'tool_'+run.requests,name:tool,input:args}:{type:'text',text:marker}
  const msg={id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[content],stop_reason:call?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:50}}
  if(!body.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(msg));return}
  event('message_start',{type:'message_start',message:{...msg,content:[],stop_reason:null}})
  event('content_block_start',{type:'content_block_start',index:0,content_block:call?{...content,input:{}}:{type:'text',text:''}})
  event('content_block_delta',{type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:marker}})
  event('content_block_stop',{type:'content_block_stop',index:0});event('message_delta',{type:'message_delta',delta:{stop_reason:msg.stop_reason,stop_sequence:null},usage:{output_tokens:50}});event('message_stop',{type:'message_stop'})
 }else if(req.url.includes('/responses')){
  const item=call?{id:'fc_fixture_'+run.requests,type:'function_call',call_id:'call_fixture_'+run.requests,name:tool,...(chosen.namespace?{namespace:chosen.namespace}:{}),arguments:JSON.stringify(args),status:'completed'}:{id:'msg_fixture_'+run.requests,type:'message',role:'assistant',content:[{type:'output_text',text:marker,annotations:[]}],status:'completed'}
  const response={id:'resp_fixture_'+run.requests,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',model:body.model,output:[],usage:{input_tokens:100,output_tokens:50,total_tokens:150}}
  event('response.created',{type:'response.created',response})
  event('response.output_item.added',{type:'response.output_item.added',output_index:0,item:call?{...item,arguments:'',status:'in_progress'}:{...item,content:[],status:'in_progress'}})
  if(call){event('response.function_call_arguments.delta',{type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:JSON.stringify(args)});event('response.function_call_arguments.done',{type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:JSON.stringify(args)})}
  else {event('response.content_part.added',{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});event('response.output_text.delta',{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:marker});event('response.output_text.done',{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:marker})}
  event('response.output_item.done',{type:'response.output_item.done',output_index:0,item});event('response.completed',{type:'response.completed',response:{...response,status:'completed',output:[item]}})
 }else{
  const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'chat_fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n')
  chunk(call?{role:'assistant',tool_calls:[{index:0,id:'call_fixture_'+run.requests,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:marker});chunk({},call?'tool_calls':'stop');res.write('data: [DONE]\n\n')
 }
 res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
const npm=path.join(process.env.APPDATA,'npm/node_modules')
async function run(client,entry,args,extra={}){
 const home=path.join(base,client);await fs.mkdir(home,{recursive:true});const log=path.join(home,'calls.jsonl');await fs.writeFile(log,'')
 const launch={command:process.execPath,args:[wrapper],env:{JANUSX_NOTE_STATE_ROOT:path.join(base,'state'),NOTE_CALL_LOG:log}}
 const config=path.join(home,'mcp.json');await fs.writeFile(config,JSON.stringify({mcpServers:{'janusx-note':launch}}))
 const env={...process.env,...extra,NOTE_TEST_HOME:home,CLAUDE_CONFIG_DIR:home,CODEX_HOME:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:path.join(home,'data'),XDG_STATE_HOME:path.join(home,'state'),XDG_CACHE_HOME:path.join(home,'cache'),OPENCODE_CONFIG:path.join(home,'opencode/opencode.json'),ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_BASE_URL:`http://127.0.0.1:${port}/${client}`,OPENAI_API_KEY:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}
 const actual=await args({home,config,launch,port})
 for(const key of Object.keys(env))if(key.startsWith('CODEX_')&&key!=='CODEX_HOME')delete env[key]
 const child=spawn(entry.endsWith('.exe')?entry:process.execPath,entry.endsWith('.exe')?actual:[entry,...actual],{env,cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});let output=''
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b)
 const timer=setTimeout(()=>child.kill(),45000);const exit=await new Promise(r=>child.on('exit',r));clearTimeout(timer)
 await fs.writeFile(path.join(home,'output.txt'),output)
 const calls=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
 const report={client,exit,calls,sessions:sessions[client],writeVerified:(await fs.readFile(path.join(workspace,'.agents/notes/module.md'),'utf8')).includes('Terminal read and write acceptance verified.'),tail:output.slice(-1500)}
 await fs.writeFile(path.join(home,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,calls:calls.map(c=>c.name),tail:report.tail.slice(-500)}))
 if(exit!==0||!report.writeVerified||runIncomplete(report,calls))process.exitCode=1
 return report
}
function runIncomplete(report,calls){return report.sessions?.step!==plan.length||!report.tail.includes('NOTE_CLIENT_ACCEPTANCE_COMPLETE')||calls.length<plan.length}
try{
 if(target==='claude')await run('claude',path.join(npm,'@anthropic-ai/claude-code/bin/claude.exe'),async({config})=>['-p','Call the Note MCP note.list tool for workspacePath '+workspace+'. Then print NOTE_CLIENT_ACCEPTANCE_COMPLETE.','--bare','--mcp-config',config,'--strict-mcp-config','--allowedTools','mcp__janusx-note__*','--tools','','--model','claude-sonnet-4-6','--output-format','stream-json','--verbose','--no-session-persistence'])
 if(target==='codex'){
  const bin=path.join(npm,'@openai/codex/bin/codex.js')
  await run('codex',bin,async({home,launch,port})=>{
   const q=JSON.stringify;await fs.writeFile(path.join(home,'config.toml'),`model="fixture"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:${port}/codex/v1"\nwire_api="responses"\nenv_key="OPENAI_API_KEY"\n[mcp_servers.janusx-note]\ncommand=${q(launch.command)}\nargs=${q(launch.args)}\n[mcp_servers.janusx-note.env]\nJANUSX_NOTE_STATE_ROOT=${q(launch.env.JANUSX_NOTE_STATE_ROOT)}\nNOTE_CALL_LOG=${q(launch.env.NOTE_CALL_LOG)}\n`)
   await fs.appendFile(path.join(home,'config.toml'),`\n[projects.${q(workspace)}]\ntrust_level="trusted"\n`)
   return ['--ask-for-approval','never','exec','--skip-git-repo-check','--ephemeral','--json','-s','workspace-write','Call note.list through janusx-note for workspacePath '+workspace+'. Print the result.']
  })
 }
 if(target==='opencode')await run('opencode',path.join(npm,'opencode-ai/bin/opencode.exe'),async({home,launch,port})=>{
  await fs.mkdir(path.join(home,'opencode'),{recursive:true});await fs.writeFile(path.join(home,'opencode/opencode.json'),JSON.stringify({provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'fixture',options:{baseURL:`http://127.0.0.1:${port}/opencode/v1`,apiKey:'fixture-only'},models:{fixture:{name:'fixture',limit:{context:32000,output:4000}}}}},model:'fixture/fixture',permission:{'*':'deny','janusx-note*':'allow'},mcp:{'janusx-note':{type:'local',command:[launch.command,...launch.args],environment:launch.env,enabled:true}}}))
  return ['run','--pure','--format','json','-m','fixture/fixture','Call janusx-note note.list with workspacePath '+workspace+'.']
 })
 if(target==='dsh')await run('dsh',path.join(npm,'@deepseek-ai/dsh/lib/bin.js'),async({home,launch,port})=>{
  const patch=path.join(home,'fixture.patch.yml')
  await fs.writeFile(patch,JSON.stringify([{id:'llm-deepseek',config:{baseURL:`http://127.0.0.1:${port}/dsh`,apiKeyEnv:'NOTE_FIXTURE_KEY',thinking:'disabled'}},{id:'session-title-llm',disabled:true},{insert:[{id:'janusx-note',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'janusx-note',transport:'stdio',...launch}}]}]))
  return ['headless','--patch',patch,'--json','Use the Note MCP to maintain this disposable workspace fixture.']
 },{DSH_HOME:path.join(base,'dsh'),NOTE_FIXTURE_KEY:'fixture-only'})
}finally{server.close();server.closeAllConnections()}
