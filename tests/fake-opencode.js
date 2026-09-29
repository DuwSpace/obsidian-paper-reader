#!/usr/bin/env node
'use strict';
const http = require('node:http');
let output, permission, promptBody;
const emit = event => output?.write('data: '+JSON.stringify(event)+'\r\n\r\n');
const info = { id:'msg_a', sessionID:'ses_a',role:'assistant',providerID:'fake',modelID:'model',time:{completed:1},tokens:{input:10,output:5,reasoning:2,cache:{read:3,write:1}} };
http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')) {res.writeHead(401).end();return;}
 let raw='';for await (const c of req) raw+=c;const body=raw?JSON.parse(raw):{};
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(req.url==='/provider')return json({connected:['fake'],all:[{id:'fake',models:{model:{id:'model',variants:{high:{}},capabilities:{input:{image:true}}},text:{id:'text',variants:{},capabilities:{input:{image:false}}}}}]});
 if(req.url==='/config')return json({model:'fake/model'});
 if(req.url==='/session') {permission=body.permission;return json({id:'ses_a'});}
 if(req.url==='/event'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': ready\n\n');output=res;return;}
 if(req.url==='/session/ses_a/message')return json([{info,parts:[{type:'text',text:'中文回答'}]}]);
 if(req.url==='/session/ses_a/prompt_async'){
  promptBody=body;res.writeHead(204).end();const text=body.parts[0].text;
  if(text==='wait')return;
  if(text==='assert-image' && (!body.parts[1]?.url.startsWith('data:image/png;base64,')||body.variant!=='high'))process.exit(5);
  if(text==='assert-readonly' && permission.some(p=>['edit','bash'].includes(p.permission)&&p.action==='allow'))process.exit(6);
  emit({type:'message.updated',properties:{info:{...info,time:{}}}});
  emit({type:'message.part.updated',properties:{part:{id:'prt_a',messageID:'msg_a',sessionID:'ses_a',type:'text',text:''}}});
  emit({type:'message.part.delta',properties:{sessionID:'ses_a',messageID:'msg_a',partID:'prt_a',field:'text',delta:'中文'}});
  setTimeout(()=>{
   if(text==='disconnect'){output.end();return;}
   emit({type:'message.part.delta',properties:{sessionID:'ses_a',messageID:'msg_a',partID:'prt_a',field:'text',delta:'回答'}});
   if(text==='fail'){emit({type:'session.error',properties:{sessionID:'ses_a',error:{data:{message:'fixture failure'}}}});return;}
   emit({type:'session.idle',properties:{sessionID:'ses_a'}});
  },50);return;
 }
 res.writeHead(404).end();
}).listen(0,'127.0.0.1',function(){console.log('opencode server listening on http://127.0.0.1:'+this.address().port);});
