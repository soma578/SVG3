import { chromium } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root=process.argv[2]
const types={'.html':'text/html','.svg':'image/svg+xml','.js':'text/javascript','.json':'application/json','.png':'image/png','.css':'text/css'}
const server=http.createServer((req,res)=>{
  const p=path.join(root, decodeURIComponent(new URL(req.url,'http://x').pathname))
  const f=fs.existsSync(p)&&fs.statSync(p).isDirectory()?path.join(p,'index.html'):p
  if(!fs.existsSync(f)){res.writeHead(404).end('nf');return}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'})
  fs.createReadStream(f).pipe(res)
}).listen(4321)
const b=await chromium.launch(); const p=await b.newContext({viewport:{width:900,height:640}}).then(c=>c.newPage())
p.on('pageerror',e=>console.log('[err]',String(e).slice(0,90)))
await p.goto('http://127.0.0.1:4321/viewer.html'); await p.waitForTimeout(12000)
const r=await p.evaluate(()=>{
  const im=window.svgMap?.getSvgImages?.(); if(!im) return {svgMap:false}
  let drew=0
  for(const k of Object.keys(im)){const d=im[k]; if(d?.querySelectorAll) drew+=d.querySelectorAll('use,image,path,circle,rect').length}
  return {svgMap:true, layers:im.root.querySelectorAll('animation').length, drew}
})
console.log('viewer.html 単体起動:', JSON.stringify(r))
await p.screenshot({path:'/tmp/claude-1000/-home-somay-SVG3-variants-svgmap-app-layers-host-frontend/748c1024-0f27-45e7-b89d-77e01e2411d3/scratchpad/portable-hiroshima.png'})
await b.close(); server.close()
