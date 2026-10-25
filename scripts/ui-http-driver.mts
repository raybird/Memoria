import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import Database from 'better-sqlite3'
import { MemoriaCore, resolveMemoriaPaths, closeAllConnections } from '../src/core/index.js'
import { startServer } from '../src/server.js'

const home=await mkdtemp(join(tmpdir(),'memoria-ui-http-'))
const core=new MemoriaCore(resolveMemoriaPaths(home))
let server:http.Server|undefined
const request=(port:number,path:string,headers:Record<string,string>={},method='GET',payload='')=>new Promise<{status:number,body:string,headers:http.IncomingHttpHeaders}>((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path,method,headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body,headers:res.headers}))});req.on('error',reject);req.end(payload)
})
try {
    await core.init()
    await core.remember({id:'ui-sample',project:'alpha',summary:'UI full summary',events:[
        {id:'ui-decision',type:'DecisionMade',content:{decision:'<script>window.bad=1</script>Decision',rationale:'Full reason'}},
        {id:'ui-skill',type:'SkillLearned',content:{skill_name:'Recovered skill',pattern:'Original skill body'}}
    ]})
    const db=new Database(core.paths.dbPath)
    const stamp='2026-10-25T00:00:00.000Z'
    db.prepare("INSERT INTO repositories(id,name,fingerprint,default_branch,status,created_at,updated_at) VALUES('repo-alpha','alpha','fp','main','active',?,?)").run(stamp,stamp)
    for(let n=0;n<60;n++)await core.remember({id:`project-${n}`,project:'alpha',summary:'Needle common context',events:[{id:`project-event-${n}`,type:'DecisionMade',content:{decision:'Needle common context'}}]})
    await core.remember({id:'environment',project:'preferences',summary:'Needle environment context',events:[{id:'env-hit',type:'DecisionMade',content:{decision:'Needle environment context'}}]})
    const snapshot=()=>JSON.stringify(['sessions','events','memory_attributes','memory_sources','skills','recall_telemetry'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()))
    const before=snapshot()
    const started=await startServer(0,home,{ui:true})
    server=started.server
    assert.equal((server.address() as import('node:net').AddressInfo).address,'127.0.0.1','SCN-001 UI must bind only loopback')
    const port=started.port
    assert.equal((await request(port,'/ui/')).status,200,'SCN-001 UI entry exists')
    assert.equal((await request(port,'/ui/app.js')).headers['content-type'],'text/javascript; charset=utf-8')
    assert.match((await request(port,'/ui/')).headers['content-security-policy'] as string,/default-src 'none'/)
    for(const path of ['/v1/memories','/v1/memory-facets','/v1/memories/ui-decision','/v1/brief'])assert.equal((await request(port,path)).status,200,path)
    for(const [ref,type] of [['ui-skill','skill'],['ui-sample','session']]) {
        const resolved=await request(port,`/v1/memories/${ref}`)
        assert.equal(resolved.status,200,'SCN-005/010 unknown source type must resolve without guessing')
        assert.equal(JSON.parse(resolved.body).data.type,type)
        assert.equal((await request(port,`/v1/memories/${ref}?type=decision`)).status,404,'explicit types still disambiguate')
    }
    assert.equal(snapshot(),before,'SCN-002/006/007 browsing must not mutate data or telemetry')
    await assert.rejects(startServer(port,home,{ui:true}),/in use/)
    assert.equal((await request(port,'/v1/memories?type=bad')).status,400)
    assert.equal((await request(port,'/v1/memories?page=-1')).status,400)
    assert.equal((await request(port,'/v1/memories/missing')).status,404)
    for(const path of ['/v1/remember','/v1/wiki/build','/v1/repos','/v1/sources'])assert.equal((await request(port,path,{},'POST')).status,405,path)
    assert.equal((await request(port,'/v1/memories',{Host:'evil.example'})).status,403)
    assert.equal((await request(port,'/v1/memories',{Host:`127.0.0.1:${port}`,Origin:'https://evil.example'})).status,403)
    assert.equal((await request(port,'/ui/app.js',{Origin:'null'})).status,403)
    assert.equal((await request(port,'/v1/memories',{'Sec-Fetch-Site':'cross-site'})).status,403)
    const navigation={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}
    assert.equal((await request(port,'/ui/',navigation)).status,200,'static entry permits a top-level launch from another app')
    assert.equal((await request(port,'/v1/memories',navigation)).status,403,'document launch never opens cross-site data access')
    assert.equal((await request(port,'/ui/app.js',navigation)).status,403,'entry exception does not cover scripts')
    assert.equal((await request(port,'/ui/',{...navigation,'Sec-Fetch-Dest':'iframe'})).status,403)
    for(const path of ['/ui/../../etc/passwd','/ui/%2e%2e/secret','/ui/missing.js'])assert.equal((await request(port,path)).status,404,path)
    await assert.rejects(access(join(home,'knowledge','BRIEF.md')))
    const search=JSON.parse((await request(port,'/v1/ui/search',{'Content-Type':'application/json'},'POST',JSON.stringify({query:'Needle',environment:true,mode:'keyword'}))).body)
    assert.equal(search.ok,true,JSON.stringify(search))
    assert.ok(search.data.some((h:{id:string})=>h.id==='env-hit'),'environment hit survives more than top_k project matches')
    assert.ok(search.data.every((h:{project:string})=>h.project==='preferences'))
    assert.equal((await request(port,'/v1/ui/search',{},'POST','{bad')).status,400)
    assert.equal((await request(port,'/v1/ui/search',{},'POST','x'.repeat(100000))).status,413)
    assert.equal((await request(port,'/v1/memories?environment=true&project=alpha')).status,400)
    const degraded=JSON.parse((await request(port,'/v1/ui/search',{},'POST',JSON.stringify({query:'Needle',project:'preferences',mode:'vector'}))).body)
    assert.equal(degraded.meta.fallback_used,true)
    db.close()
    await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined
    await assert.rejects(startServer(0,join(home,'uninitialized'),{ui:true}),/init/)
    const brokenHome=join(home,'broken')
    const brokenCore=new MemoriaCore(resolveMemoriaPaths(brokenHome))
    await brokenCore.init()
    const broken=new Database(brokenCore.paths.dbPath)
    broken.exec('DROP TABLE events')
    broken.close()
    await assert.rejects(startServer(0,brokenHome,{ui:true}),/schema|init/)
    const legacy=await startServer(0,home);server=legacy.server
    assert.equal((await request(legacy.port,'/v1/remember',{'Content-Type':'application/json'},'POST')).status,400,'legacy write route still exists')
    console.log('PASS UI HTTP: loopback, assets, CSP, routes, scopes, host/origin/fetch-site, read-only, missing root, legacy')
} finally {if(server)await new Promise<void>(r=>server!.close(()=>r()));closeAllConnections();await rm(home,{recursive:true,force:true})}
