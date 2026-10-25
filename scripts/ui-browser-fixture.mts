// Reproducible manual browser fixture for SCN-002/006/008–012; never shipped.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import Database from 'better-sqlite3'
import { MemoriaCore, resolveMemoriaPaths, closeAllConnections } from '../src/core/index.js'
import { createUiRouter } from '../src/ui/router.js'

const home=await mkdtemp(join(tmpdir(),'memoria-browser-qa-'))
const core=new MemoriaCore(resolveMemoriaPaths(home))
await core.init()
const pinned=await core.rememberNote({text:'所有專案共用同一份記憶',project:'preferences',rationale:'跨專案保留共同約束，讓每次對話延續脈絡。',retention:'durable'})
await core.remember({id:'product-session',timestamp:'2026-10-25T10:00:00.000Z',project:'Memoria',summary:'記憶瀏覽器的產品決策與驗證經驗',events:[
    {id:'qa-sandbox',type:'DecisionMade',content:{decision:'先排除沙箱限制，再重裝依賴',rationale:'依賴快取可能原本就存在。先檢查執行權限，可以避免無效重裝與錯誤診斷。'}},
    {id:'qa-compatibility',type:'DecisionMade',content:{decision:'保留 setup --vector 的相容行為',rationale:'既有自動化需要穩定的命令契約；完整 onboarding 由明確旗標啟用。'}},
    {id:'qa-slow',type:'DecisionMade',content:{decision:'慢速搜尋也能取消',rationale:'延遲回應不能覆蓋使用者較新的查詢。'}},
    {id:'qa-unsafe',type:'DecisionMade',content:{decision:'<script>window.bad=1</script> 原文閱讀',rationale:'<img src=x onerror="window.bad=2"> javascript:alert(1)'}},
    {id:'qa-long',type:'DecisionMade',content:{decision:'中文長標題與 EnglishMixedIdentifier_'.repeat(25),rationale:'完整理由\n'.repeat(1000)}},
    {id:'qa-skill',type:'SkillLearned',content:{skill_name:'以隔離資料驗證介面',pattern:'先建立可判定的資料，再走過尋找、閱讀來源與返回列表三項核心任務。',examples:['淺色與深色','320／768／1440px']}},
]})
await core.markMemory('qa-skill',{retention:'durable'})
const db=new Database(core.paths.dbPath)
db.prepare("INSERT INTO repositories(id,name,fingerprint,default_branch,status) VALUES('qa-repo','Memoria','qa-fingerprint','main','active')").run()
const insert=db.prepare('INSERT INTO events(id,session_id,timestamp,event_type,content,metadata) VALUES(?,?,?,?,?,?)')
db.transaction(()=>{for(let n=0;n<105;n++)insert.run(`page-${String(n).padStart(3,'0')}`,'product-session','2026-10-01T00:00:00.000Z','DecisionMade',JSON.stringify({decision:`分頁範例 ${n}`,rationale:'穩定排序與返回位置驗證'}),'{}')})()
db.close()
const search=core.searchMemories.bind(core)
core.searchMemories=async input=>{if(input.query==='慢速')await new Promise(r=>setTimeout(r,5000));return search(input)}
const getMemory=core.getMemory.bind(core)
core.getMemory=async (ref,kind)=>{if(ref===pinned.data!.sessionId&&kind==null)await new Promise(r=>setTimeout(r,5000));return getMemory(ref,kind)}
const route=await createUiRouter(core)
const timing=`document.addEventListener('submit',function(){const start=performance.now();const observer=new MutationObserver(function(){const count=document.getElementById('count');if(count&&count.textContent==='正在搜尋…'){observer.disconnect();requestAnimationFrame(function(){document.documentElement.dataset.qaFeedbackMs=String(performance.now()-start)})}});observer.observe(document.getElementById('count'),{childList:true,subtree:true,characterData:true})},true);`
const server=http.createServer((req,res)=>{
    if(req.url==='/qa-timing.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(timing);return}
    if(req.url?.startsWith('/ui/')&&!req.url.startsWith('/ui/app.js')&&!req.url.startsWith('/ui/style.css')){
        const end=res.end.bind(res)
        res.end=((body:string)=>end(typeof body==='string'?body.replace('<script src="/ui/app.js"','<script src="/qa-timing.js" defer></script><script src="/ui/app.js"'):body)) as typeof res.end
    }
    if(req.url==='/ui/')console.log('QA navigation',JSON.stringify({host:req.headers.host,origin:req.headers.origin,site:req.headers['sec-fetch-site'],mode:req.headers['sec-fetch-mode'],destination:req.headers['sec-fetch-dest']}))
    void route(req,res)
})
const port=Number(process.argv[2]||48766)
server.listen(port,'127.0.0.1',()=>console.log(`QA fixture: http://127.0.0.1:${port}/ui/ (isolated; 5s delay for 慢速; DOM data-qa-feedback-ms is paint timing)`))
async function stop(){server.close();closeAllConnections();await rm(home,{recursive:true,force:true});process.exit(0)}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop())
