// SCN-013: exercise the installed CLI from a directory outside its source checkout.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [cli,home]=process.argv.slice(2)
assert.ok(cli&&home,'CLI and initialized data root are required')
const cwd=await mkdtemp(join(tmpdir(),'memoria-installed-ui-'))
const env={...process.env,MEMORIA_HOME:home}
for(const key of ['MEMORIA_DB_PATH','MEMORIA_CONFIG_PATH','MEMORIA_SESSIONS_PATH','LIBSQL_URL','LIBSQL_AUTH_TOKEN','MEMORIA_EMBED_PROVIDER'])delete env[key]
const child=spawn(cli,['serve','--ui','--port','0','--json'],{cwd,env,stdio:['ignore','pipe','pipe']})
let stderr=''
child.stderr.on('data',chunk=>stderr+=chunk)
try {
    const port=await new Promise((resolve,reject)=>{
        let text=''
        const timer=setTimeout(()=>reject(new Error(`UI did not start: ${stderr}`)),15000)
        child.on('error',error=>{clearTimeout(timer);reject(error)})
        child.on('exit',code=>{clearTimeout(timer);reject(new Error(`UI exited ${code}: ${stderr}`))})
        child.stdout.on('data',chunk=>{text+=chunk;for(const line of text.split('\n')){try{const item=JSON.parse(line);if(item.step==='serve'&&item.port){clearTimeout(timer);resolve(item.port);return}}catch{}}})
    })
    const base=`http://127.0.0.1:${port}`
    const page=await fetch(`${base}/ui/`)
    assert.equal(page.status,200)
    assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/)
    const html=await page.text()
    const assets=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])
    assert.deepEqual(assets,['/ui/style.css','/ui/app.js'],'all assets resolve locally without a CDN')
    for(const asset of assets){const response=await fetch(base+asset);assert.equal(response.status,200);assert.ok((await response.text()).length>1000)}
    const result=await (await fetch(`${base}/v1/memories`)).json()
    assert.equal(result.ok,true)
    if(result.data.items.length){const id=encodeURIComponent(result.data.items[0].id);assert.equal((await fetch(`${base}/v1/memories/${id}`)).status,200)}
    console.log('PASS installed UI: outside checkout, embedded local assets, list and detail, restrictive network CSP')
} finally {
    const stopped=new Promise(resolve=>child.once('exit',resolve))
    if(child.exitCode===null){child.kill('SIGTERM');await stopped}
    await rm(cwd,{recursive:true,force:true})
}
