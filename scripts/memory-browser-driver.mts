import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MemoriaCore, resolveMemoriaPaths, closeAllConnections, importSession, upsertMemoryAttributes } from '../src/core/index.js'
import { hitText } from '../src/ui/format.js'

const home = await mkdtemp(join(tmpdir(), 'memoria-browser-'))
const core = new MemoriaCore(resolveMemoriaPaths(home))
try {
    await core.init()
    assert.equal(typeof core.listMemories, 'function', 'SCN-003: Core must expose a paged memory browser')
    const time = '2026-10-25T01:00:00Z'
    importSession(core.paths.dbPath, { id:'sample', project:'alpha', timestamp:time, summary:'Parent summary', events:[
        {id:'decision-a',timestamp:time,type:'DecisionMade',content:{decision:'Alpha decision',rationale:'FULL '.repeat(1000)}},
        {id:'decision-b',timestamp:time,type:'DecisionMade',content:{decision:'Second decision'}},
        {id:'skill-a',timestamp:time,type:'SkillLearned',content:{skill_name:'A skill',pattern:'The full pattern',examples:['Example']}},
    ]})
    importSession(core.paths.dbPath, {id:'environment',project:'preferences',timestamp:time,events:[{id:'env-decision',timestamp:time,type:'DecisionMade',content:{decision:'Shared context'}}]})
    upsertMemoryAttributes(core.paths.dbPath,'decision-a',{retention:'durable'})
    upsertMemoryAttributes(core.paths.dbPath,'decision-b',{superseded_by:'missing-successor'})
    const db = new Database(core.paths.dbPath)
    db.prepare("INSERT INTO repositories(id,name,fingerprint,default_branch,status,created_at,updated_at) VALUES('repo-test','alpha','fp','main','active',?,?)").run(time,time)
    db.close()
    const list = await core.listMemories({type:'decision',project:'alpha'})
    assert.equal(list.ok,true,JSON.stringify(list))
    assert.deepEqual(list.data?.items.map(i=>i.id),['decision-a'])
    assert.ok(JSON.stringify(list).length<2000,'list never downloads full rationale')
    const full = await core.getMemory('decision-a')
    assert.equal(full.data?.rationale,'FULL '.repeat(1000))
    assert.equal(full.data?.session_id,'sample')
    assert.equal((await core.getMemory('missing')).ok,false)
    assert.equal((await core.getMemory('skill-a')).data?.body,'The full pattern')
    assert.equal((await core.listMemories({type:'decision',environment:true})).data?.items[0].id,'env-decision')
    assert.equal((await core.listMemories({type:'decision',durable:true})).data?.total,1)
    assert.equal((await core.listMemories({type:'decision',include_superseded:true})).data?.total,3)
    assert.equal((await core.listMemories({type:'session'})).data?.total,2)
    const facets = await core.memoryFacets()
    assert.deepEqual(facets.data?.repositories,['alpha'])
    assert.deepEqual(facets.data?.environment_projects,['preferences'])
    assert.equal((await core.listMemories({page:0})).ok,false)
    assert.equal((await core.listMemories({page_size:51})).ok,false)
    const provenance=new Database(core.paths.dbPath)
    provenance.prepare("INSERT INTO git_summary_ranges(id,repository_id,summary_type,head_sha,tag_name,range_fingerprint) VALUES('range-test','repo-test','release','head-sha','v-test','range-fp')").run()
    provenance.prepare("INSERT INTO git_summaries(id,repository_id,summary_range_id,summary_type,prompt_version) VALUES('sum-test','repo-test','range-test','release','test')").run()
    provenance.prepare("INSERT INTO memory_sources(id,memory_id,source_type,source_id,repository_id,head_sha) VALUES('source-test','decision-a','git_release_summary','sum-test','repo-test','head-sha')").run()
    assert.equal((await core.getMemory('decision-a')).data?.source?.tag,'v-test')
    provenance.prepare("DELETE FROM git_summaries WHERE id='sum-test'").run()
    assert.equal((await core.getMemory('decision-a')).data?.source_missing,true)
    assert.equal((await core.getMemory('decision-b')).data?.superseded_by,'missing-successor')
    provenance.close()
    assert.equal(hitText('{"decision":"Readable \\"quoted\\" text","rationale":"cut'), 'Readable "quoted" text')
    // Optional tables in pre-feature databases are never created by browsing.
    const oldPath=join(home,'legacy.db')
    const old=new Database(oldPath)
    old.exec('CREATE TABLE sessions(id TEXT,summary TEXT,timestamp TEXT,project TEXT,scope TEXT); CREATE TABLE events(id TEXT,session_id TEXT,timestamp TEXT,event_type TEXT,content TEXT);')
    old.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run('orphan','gone-session',time,'DecisionMade',JSON.stringify({decision:'Older orphan content'}))
    old.close()
    const oldCore=new MemoriaCore({...core.paths,dbPath:oldPath})
    const oldBytes=await readFile(oldPath)
    assert.equal((await oldCore.getMemory('orphan')).data?.session,null)
    assert.equal((await oldCore.getMemory('orphan')).data?.body,'Older orphan content')
    assert.equal((await oldCore.listMemories()).data?.total,1)
    assert.deepEqual((await oldCore.memoryFacets()).data,{repositories:[],environment_projects:[]})
    assert.deepEqual(await readFile(oldPath),oldBytes,'legacy browsing does not migrate or write')
    // SCN-003/012: independent fixed fixture, same timestamps and long rationale.
    const bulk = new Database(core.paths.dbPath)
    const insert = bulk.prepare('INSERT INTO events(id,session_id,timestamp,event_type,content,metadata) VALUES(?,?,?,?,?,?)')
    bulk.transaction(()=>{for(let n=0;n<10000;n++)insert.run(`bulk-${String(n).padStart(5,'0')}`,'sample',time,n%2?'SkillLearned':'DecisionMade',JSON.stringify(n%2?{skill_name:`Skill ${n}`,pattern:'p'.repeat(n===1?100000:60)}:{decision:`Decision ${n}`,rationale:'r'.repeat(n===0?100000:60)}),'{}')})()
    bulk.close()
    const first = (await core.listMemories({type:'decision',page_size:50})).data!
    const second = (await core.listMemories({type:'decision',page_size:50,page:2})).data!
    assert.equal(first.items.length,50)
    assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,100)
    assert.deepEqual(first.items.slice(0,2).map(i=>i.id),['env-decision','decision-a'])
    const samples:number[]=[]
    for(let n=0;n<22;n++){const start=performance.now();await core.listMemories({type:'decision',page_size:50});if(n>=2)samples.push(performance.now()-start)}
    const p95=[...samples].sort((a,b)=>a-b)[18]
    console.log(JSON.stringify({scenarios:'SCN-003/004/005/012',host:hostname(),node:process.version,events:10004,samples_ms:samples,p95_ms:p95}))
    assert.ok(p95<=500,`p95 ${p95} > 500ms`)
    console.log('PASS memory browser: list/detail/scopes/markers/pagination/10000 records')
} finally {closeAllConnections();await rm(home,{recursive:true,force:true})}
