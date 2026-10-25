import type { MemoryItem, MemoryDetail, MemoryPage, MemoryFacets, MemoryKind, RecallHit, MemoriaResult, BriefData } from '../core/types.js';
import { hitText } from './format.js';
type View = 'library' | 'pinned' | 'brief';
type State = {
    invalid: boolean;
    view: View;
    type: MemoryKind;
    scope: string;
    page: number;
    query: string;
    mode: 'keyword' | 'vector';
    include: boolean;
    id: string;
    detailType: MemoryKind | undefined;
};
const $ = <T extends Element = HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element)
        throw new Error(`Missing UI element: ${selector}`);
    return element;
};
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const paths: Record<string, string> = {
    library: 'M4 4h5v16H4z M12 4h3v16h-3z M18 4l3 15', pin: 'M8 3h8l-1 6 3 3v2H6v-2l3-3z M12 14v7',
    book: 'M4 4h6c2 0 2 2 2 2s0-2 2-2h6v15h-6c-2 0-2 2-2 2s0-2-2-2H4z M12 6v15',
    search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', lock: 'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3',
    left: 'M14 6l-6 6 6 6', right: 'M10 6l6 6-6 6', arrow: 'M19 12H5 M11 6l-6 6 6 6',
    link: 'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    info: 'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    unplug: 'M9 8l-3-3 M16 15l3 3 M7 7l10 10 M7 10l-2 2a5 5 0 0 0 7 7l2-2 M10 7l2-2a5 5 0 0 1 7 7l-2 2'
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.info}"></path></svg>`;
const names: Record<MemoryKind, string> = { decision: '決策', skill: '技能', session: 'Session' };
const date = (text: string, full = false) => {
    const value = new Date(text);
    return Number.isNaN(value.getTime()) ? '日期未記錄' : new Intl.DateTimeFormat('zh-TW', full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: '2-digit', day: '2-digit' }).format(value);
};
function readState(): State {
    const p = new URLSearchParams(location.search);
    const kind = p.get('type') as MemoryKind;
    const detailKind = p.get('detail_type') as MemoryKind;
    const view = p.get('view') as View;
    const page = Number(p.get('page') || 1);
    const rawScope = p.get('scope') || 'all';
    const rawQuery = p.get('q') || '';
    const query = rawQuery.trim().slice(0, 2000);
    const validScope=rawScope==='all'||rawScope==='environment'||(rawScope.startsWith('project:')&&rawScope.length>8);
    const invalid = (p.has('view') && !['library','pinned','brief'].includes(view)) ||
        (p.has('type') && !Object.hasOwn(names,kind)) || (p.has('detail_type') && !Object.hasOwn(names,detailKind)) ||
        !Number.isInteger(page) || page<1 || page>1000000 ||
        !validScope ||
        (Boolean(rawQuery) && !query) ||
        (p.has('mode')&&!['keyword','vector'].includes(p.get('mode')!)) ||
        (p.has('include')&&!['true','false'].includes(p.get('include')!));
    return { invalid, view: ['library', 'pinned', 'brief'].includes(view) ? view : 'library', type: Object.hasOwn(names, kind) ? kind : 'decision',
        scope: view === 'brief' && rawScope === 'environment' ? 'all' : validScope ? rawScope : 'all',
        page: Number.isInteger(page) && page > 0 && page <= 1000000 ? page : 1, query: view === 'pinned' || view === 'brief' ? '' : query, mode: p.get('mode') === 'vector' ? 'vector' : 'keyword',
        include: p.get('include') === 'true', id: (p.get('id') || '').slice(0, 1024), detailType: Object.hasOwn(names, detailKind) ? detailKind : undefined };
}
let state = readState();
let mobileReading = Boolean(state.id);
let facets: MemoryFacets = { repositories: [], environment_projects: [] };
let listController: AbortController | undefined;
let detailController: AbortController | undefined;
let listSequence = 0;
let detailSequence = 0;
let sourceSequence = 0;
let sourceController: AbortController | undefined;
let rows: MemoryItem[] = [];
let total = 0;
let returnId = '';
let listScroll = 0;
let windowScroll = 0;
let jumpList = false;
let restoreList = false;
$('#app').innerHTML = `<a class="skip" href="#search">跳到搜尋</a><div class="app"><aside class="sidebar"><div class="brand"><span class="mark" aria-hidden="true">M</span>Memoria</div><p class="workspace-label">個人記憶工作區</p><nav class="nav" aria-label="主要導覽"><button data-view="library">${icon('library')}記憶庫</button><button data-view="pinned">${icon('pin')}常駐記憶</button><button data-view="brief">${icon('book')}記憶摘要</button></nav><div class="side-foot"><div class="local">${icon('lock')}本機 · 唯讀</div><p>記憶保留在你的裝置<br>搜尋使用本機服務</p><label class="theme-label"><span>外觀</span><select id="theme" aria-label="介面外觀"><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select></label></div></aside><main class="main"><div class="topbar"><div class="crumb">工作區<span>/</span><strong id="crumb">全部記憶</strong></div><div class="readonly">${icon('lock')}唯讀瀏覽，安心探索</div></div><header class="heading"><div><h1 id="title">記憶庫</h1><p id="subtitle">找到決策，也看見背後的理由。</p></div><label class="scope">記憶範圍<select id="scope" aria-label="記憶範圍"><option value="all">全部專案與共用</option><option value="environment">環境共用</option></select></label></header><section class="search-zone" aria-label="搜尋與篩選"><form class="searchbox" id="search-form">${icon('search')}<label class="sr" for="search">搜尋記憶</label><input id="search" type="search" placeholder="搜尋內容、決策與經驗…" autocomplete="off" maxlength="2000"><kbd>/</kbd><label class="sr" for="mode">搜尋方式</label><select id="mode"><option value="keyword">關鍵字</option><option value="vector">語意搜尋</option></select><button class="primary" type="submit">搜尋</button><button class="text-button" id="cancel" type="button" hidden>取消</button></form><div class="filters"><div class="segmented" aria-label="記憶類型"><button type="button" data-type="decision">決策</button><button type="button" data-type="skill">技能</button><button type="button" data-type="session">Session</button></div><label class="check"><input type="checkbox" id="include">包含已取代</label><p class="results-note" id="search-note" hidden></p></div></section><div class="content"><section class="listpane" aria-label="記憶列表"><div class="list-head"><span id="count" role="status" aria-live="polite">正在讀取…</span><span id="ordering">最近記錄</span></div><div class="list" id="list"></div><div class="pagination"><button id="previous">${icon('left')}上一頁</button><span id="page-label"></span><button id="next">下一頁${icon('right')}</button></div></section><article class="reader" aria-label="記憶詳情"></article><section class="brief-content" hidden aria-label="記憶摘要"></section></div><div class="toast" role="status" aria-live="polite" hidden></div></main></div>`;
async function api<T>(path: string, options: RequestInit = {}): Promise<MemoriaResult<T>> {
    const response = await fetch(path, { cache: 'no-store', ...options });
    const body = await response.json() as MemoriaResult<T>;
    if (!response.ok || !body.ok) {
        const error = new Error(body.error || '本機服務未完成請求') as Error & {
            status: number;
        };
        error.status = response.status;
        throw error;
    }
    return body;
}
function updateUrl(replace = false): void {
    state.invalid=false;
    $('.toast').hidden=true;
    const p = new URLSearchParams({ view: state.view, type: state.type, scope: state.scope, page: String(state.page), mode: state.mode });
    if (state.query)
        p.set('q', state.query);
    if (state.id) {
        p.set('id', state.id);
        if (state.detailType)
            p.set('detail_type', state.detailType);
    }
    if (state.include)
        p.set('include', 'true');
    const url = `/ui/?${p}`;
    if (url !== `${location.pathname}${location.search}`)
        history[replace ? 'replaceState' : 'pushState'](null, '', url);
}
function scopeParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (state.scope === 'environment')
        p.set('environment', 'true');
    if (state.scope.startsWith('project:'))
        p.set('project', state.scope.slice(8));
    return p;
}
function syncChrome(): void {
    $('.toast').hidden=!state.invalid;
    if(state.invalid)$('.toast').textContent='網址含無效條件，已套用可用的預設值。你可以重新選擇篩選條件。';
    $('.app').setAttribute('data-reading', String(mobileReading));
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
    document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    $('#search-form').toggleAttribute('hidden', state.view !== 'library');
    $<HTMLOptionElement>('#scope option[value=environment]').hidden = state.view === 'brief';
    $('#title').textContent = state.query ? '搜尋結果' : state.view === 'brief' ? '記憶摘要' : state.view === 'pinned' ? '常駐記憶' : '記憶庫';
    $('#subtitle').textContent = state.view === 'brief' ? '把近期決策與長期約束放在一起閱讀。' : state.view === 'pinned' ? '需要長期記住的約束與偏好。' : '找到決策，也看見背後的理由。';
    $('#crumb').textContent = state.scope === 'all' ? '全部記憶' : state.scope === 'environment' ? '環境共用' : state.scope.slice(8);
    $<HTMLInputElement>('#search').value = state.query;
    $<HTMLSelectElement>('#mode').value = state.mode;
    $<HTMLInputElement>('#include').checked = state.include;
    $<HTMLSelectElement>('#scope').value = state.scope;
    $('.search-zone').setAttribute('hidden', '');
    if (state.view !== 'brief')
        $('.search-zone').removeAttribute('hidden');
    $<HTMLButtonElement>('#cancel').hidden = !state.query;
    $('.segmented').toggleAttribute('hidden', Boolean(state.query));
    $('.listpane').toggleAttribute('hidden', state.view === 'brief');
    $('.reader').toggleAttribute('hidden', state.view === 'brief');
    $('.brief-content').toggleAttribute('hidden', state.view !== 'brief');
    $('.pagination').toggleAttribute('hidden', Boolean(state.query));
}
function empty(title: string, text: string, action = '', error = false): string {
    return `<div class="empty ${error ? 'error' : ''}">${icon(error ? 'unplug' : 'library')}<h3>${escape(title)}</h3><p>${escape(text)}</p>${action}</div>`;
}
function renderRows(): void {
    $('#count').textContent = state.query ? `${rows.length} 筆搜尋結果` : `${total.toLocaleString()} 筆${names[state.type]}`;
    $('#ordering').textContent = state.query ? '跨類型搜尋' : '最近記錄';
    $('#page-label').textContent = `${state.page} / ${Math.max(1, Math.ceil(total / 50))}`;
    $<HTMLButtonElement>('#previous').disabled = state.page <= 1;
    $<HTMLButtonElement>('#next').disabled = state.page * 50 >= total;
    if (!rows.length) {
        const filtered = state.query || state.scope !== 'all' || state.include || state.view === 'pinned';
        $('#list').innerHTML = filtered ? empty('沒有符合條件的記憶', '換個關鍵字，或清除篩選看看。', '<button class="primary" data-action="clear">清除搜尋與篩選</button>') :
            empty(`還沒有${names[state.type]}記錄`, '用 Memoria 記下一個決策，之後就能在這裡找到它。', '<code>memoria remember "值得記住的決策" --project &lt;專案名稱&gt;</code>');
        return;
    }
    $('#list').innerHTML = rows.map(row => `<button class="memory-row" data-id="${escape(row.id)}" data-kind="${row.type}" aria-pressed="${row.id === state.id && row.type === state.detailType}"><span class="row-meta"><span>${names[row.type]}${row.superseded_by ? ' · 已取代' : ''}</span><span class="pin">${row.retention === 'durable' ? icon('pin') + '常駐' : ''}<time>${escape(date(row.timestamp))}</time></span></span><span class="row-title">${escape(row.title)}</span>${row.snippet !== row.title ? `<span class="row-snippet">${escape(row.snippet)}</span>` : ''}<span class="row-project">${escape(row.project)}</span></button>`).join('');
    document.querySelectorAll<HTMLButtonElement>('.memory-row').forEach(b => b.onclick = () => openMemory(b.dataset.id!, b.dataset.kind as MemoryKind));
}
async function loadList(): Promise<void> {
    listController?.abort();
    listController = new AbortController();
    const signal = listController.signal, sequence = ++listSequence;
    syncChrome();
    $('#count').textContent = state.query ? '正在搜尋…' : '正在讀取…';
    $('#search-note').hidden = true;
    $('#list').innerHTML = '<div class="loading" role="status">正在讀取記憶…</div>' + Array.from({ length: 3 }, () => '<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>').join('');
    if (state.view === 'brief') {
        await loadBrief(signal, sequence);
        return;
    }
    try {
        if (state.query) {
            const p = scopeParams();
            const result = await api<RecallHit[]>('/v1/ui/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: state.query, mode: state.mode, project: p.get('project') ?? undefined, environment: state.scope === 'environment', include_superseded: state.include }), signal });
            if (sequence !== listSequence)
                return;
            rows = (result.data ?? []).map(h => ({ id: h.id, type: h.type, session_id: h.session_id, timestamp: h.timestamp, project: h.project, title: hitText(h.snippet).slice(0, 160), snippet: hitText(h.snippet), retention: h.retention ?? null, superseded_by: h.superseded_by ?? null, sensitivity: null }));
            total = rows.length;
            const degraded = Boolean(result.meta.fallback_used) || /unavailable|timeout/.test(String(result.meta.route_mode));
            $('#search-note').textContent = degraded ? '語意搜尋暫不可用，已顯示關鍵字結果。' : state.mode === 'vector' ? '語意與關鍵字結果 · 跨記憶類型' : '關鍵字結果 · 跨記憶類型';
            $('#search-note').hidden = false;
        }
        else {
            const p = scopeParams();
            p.set('type', state.type);
            p.set('page', String(state.page));
            p.set('page_size', '50');
            p.set('include_superseded', String(state.include));
            p.set('durable', String(state.view === 'pinned'));
            const result = await api<MemoryPage>(`/v1/memories?${p}`, { signal });
            if (sequence !== listSequence)
                return;
            rows = result.data!.items;
            total = result.data!.total;
        }
        renderRows();
        $('#list').scrollTop = listScroll;
        if (jumpList) {
            jumpList = false;
            if (matchMedia('(max-width:820px)').matches)
                $('.list-head').scrollIntoView({ block: 'start' });
        }
        if (restoreList) {
            restoreList = false;
            restoreListPosition();
        }
    }
    catch (error) {
        if (signal.aborted || sequence !== listSequence)
            return;
        $('#count').textContent = '無法讀取';
        $('#list').innerHTML = empty('暫時無法連線', '請確認本機 Memoria 仍在執行。重試會保留你的搜尋與篩選。', '<button class="primary" data-action="retry">重新連線</button>', true);
    }
}
async function loadDetail(): Promise<void> {
    detailController?.abort();
    detailController = new AbortController();
    const signal = detailController.signal, sequence = ++detailSequence;
    const reader = $('.reader');
    if (!state.id) {
        reader.innerHTML = empty('每一則記憶，都有來處', '選擇左側記憶，閱讀完整內容、理由與來源。');
        return;
    }
    reader.innerHTML = '<div class="loading" role="status">正在讀取完整內容…</div>';
    try {
        const typeQuery = state.detailType ? `?type=${state.detailType}` : '';
        const result = await api<MemoryDetail>(`/v1/memories/${encodeURIComponent(state.id)}${typeQuery}`, { signal });
        if (sequence !== detailSequence)
            return;
        const d = result.data!, source = d.source;
        if (!state.detailType) {
            state.detailType = d.type;
            updateUrl(true);
            document.querySelector(`.memory-row[data-id="${CSS.escape(state.id)}"][data-kind="${d.type}"]`)?.setAttribute('aria-pressed', 'true');
        }
        const sourceMarkup = source ? `<p>${escape(source.repository)} · ${escape(source.type)}</p><p>${escape(source.tag || source.branch || '未記錄分支')}</p><code>${escape(source.base_sha || '起點未記錄')} → ${escape(source.head_sha)}</code><p>摘要 ${escape(source.summary_id)}</p>` : `<p>${d.source_missing ? '原先記錄的 Git 來源已不存在' : '未記錄 Git 來源'}</p>`;
        reader.innerHTML = `<div class="reader-inner"><button class="back" data-action="back">${icon('arrow')}返回記憶列表</button><div class="eyebrow"><span>${escape(d.project)} / ${names[d.type]}</span><span class="badge">${d.retention === 'durable' ? '常駐記憶' : '一般記憶'}</span></div>${d.superseded_by ? `<div class="superseded">這則記憶已被取代。<button data-open="${escape(d.superseded_by)}">查看取代它的記憶 →</button></div>` : ''}<h2>${escape(d.title.slice(0, 160))}${d.title.length > 160 ? '…' : ''}</h2>${d.body !== d.title || d.title.length > 160 ? `<div class="body-text">${escape(d.body)}</div>` : ''}<h4>為什麼記住這件事</h4><div class="rationale ${d.rationale ? '' : 'muted'}">${escape(d.rationale || '未記錄理由')}</div>${d.note ? `<h4>備註</h4><p class="body-text">${escape(d.note)}</p>` : ''}<details class="source"><summary>查看記憶來源</summary><div class="trace"><h4>原始記憶</h4><code>${escape(d.id)}</code><h4>關聯 Session</h4>${d.session ? `<button class="text-button" data-session="${escape(d.session.id)}">${escape(d.session.id)} →</button>` : '<p>來源 Session 已不存在</p>'}<h4>Git 脈絡</h4>${sourceMarkup}</div></details><details class="raw-content"><summary>檢視原始內容</summary><pre>${escape(typeof d.content === 'string' ? d.content : JSON.stringify(d.content, null, 2))}</pre></details><div class="record-meta"><time>${escape(date(d.timestamp, true))}</time><span>${escape(d.sensitivity === 'private' ? '私人記憶' : '本機記憶')}</span></div></div>`;
        reader.scrollTop = 0;
        $<HTMLButtonElement>('.back').focus({ preventScroll: true });
        if (mobileReading && matchMedia('(max-width:820px)').matches) {
            $('.reader').scrollIntoView({ block: 'start' });
        }
    }
    catch (error) {
        if (signal.aborted || sequence !== detailSequence)
            return;
        const missing = (error as Error & {
            status?: number;
        }).status === 404;
        reader.innerHTML = empty(missing ? '這則記憶已不存在' : '無法讀取記憶', missing ? '它可能已被清理。你可以返回列表繼續探索。' : '請確認本機服務仍在執行，再試一次。', `<button class="primary" data-action="${missing ? 'back' : 'detail-retry'}">${missing ? '返回列表' : '重試'}</button>`, !missing);
    }
}
async function loadBrief(signal: AbortSignal, sequence: number): Promise<void> {
    const target = $('.brief-content');
    target.innerHTML = '<p class="loading" role="status">正在整理記憶摘要…</p>';
    try {
        const p = scopeParams();
        // Brief has its own established scope contract; environment notes accompany a project.
        const result = await api<BriefData>(`/v1/brief?${p}`, { signal });
        if (sequence !== listSequence)
            return;
        const b = result.data!;
        const section = (title: string, entries: string[], symbol: string) => `<section class="brief-section"><h3>${icon(symbol)}${title}</h3>${entries.length ? entries.join('') : '<p class="muted">這個範圍目前沒有記錄。</p>'}</section>`;
        const row = (id: string, title: string, text: string, caption: string) => `<div class="brief-row"><div class="caption">${escape(caption)}</div><button data-open="${escape(id)}">${escape(title)}</button><p>${escape(text)}</p></div>`;
        target.innerHTML = `<div class="brief-inner"><p class="brief-intro">${escape(date(b.generated_at, true))} · 近 ${b.days} 天<br>摘要沿用 Memoria 的既有範圍規則；專案摘要包含環境共用資訊。</p>${section('常駐約束', b.pinned.map(p => row(p.ref_id, p.snippet, p.note || '', p.project)), 'pin')}${section('近期決策', b.decisions.map(d => row(d.id, d.decision, d.rationale, `${d.project} · ${date(d.timestamp)}`)), 'book')}${section('環境共用', b.environment.map(d => row(d.id, d.decision, d.rationale, d.project)), 'library')}${section('Repository 狀態', b.repositories.map(r => `<div class="brief-row"><h3>${escape(r.repository)}</h3><p>${escape(r.latest_summary?.title || '尚無摘要')} · ${r.pending_summaries} 筆待增強</p></div>`), 'link')}</div>`;
    }
    catch (error) {
        if (!signal.aborted && sequence === listSequence)
            target.innerHTML = empty('無法取得摘要', '請確認本機服務仍在執行。', '<button class="primary" data-action="retry">重試</button>', true);
    }
}
function openMemory(id: string, kind?: MemoryKind): void {
    cancelSourceLookup();
    listScroll = $('#list').scrollTop;
    windowScroll = window.scrollY;
    returnId = id;
    if (state.view === 'brief') {
        state.view = 'library';
        if (kind)
            state.type = kind;
        void loadList();
    }
    state.id = id;
    state.detailType = kind;
    mobileReading = true;
    syncChrome();
    updateUrl();
    renderRows();
    void loadDetail();
}
function restoreListPosition(): void {
    $('#list').scrollTop = listScroll;
    document.querySelector<HTMLButtonElement>(`.memory-row[data-id="${CSS.escape(returnId)}"]`)?.focus({ preventScroll: true });
    if (matchMedia('(max-width:820px)').matches)
        window.scrollTo({ top: windowScroll });
}
function cancelSourceLookup(): void {sourceController?.abort();sourceSequence++;}
function refresh(): void { cancelSourceLookup();syncChrome(); void loadList(); void loadDetail(); }
function filterChange(): void { state.page = 1; state.id = ''; state.query = ''; mobileReading = false; listScroll = 0; updateUrl(); refresh(); }
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view as View; if (state.view === 'brief' && state.scope === 'environment')
    state.scope = 'all'; filterChange(); });
document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(b => b.onclick = () => { state.type = b.dataset.type as MemoryKind; filterChange(); });
$<HTMLSelectElement>('#scope').onchange = () => { state.scope = $<HTMLSelectElement>('#scope').value; filterChange(); };
$<HTMLInputElement>('#include').onchange = () => { state.include = $<HTMLInputElement>('#include').checked; state.page = 1; state.id = ''; mobileReading = false; updateUrl(); refresh(); };
$<HTMLFormElement>('#search-form').onsubmit = e => { e.preventDefault(); const query = $<HTMLInputElement>('#search').value.trim(); if (!query) {
    $<HTMLInputElement>('#search').focus();
    return;
} state.query = query; state.mode = $<HTMLSelectElement>('#mode').value as State['mode']; state.page = 1; state.id = ''; mobileReading = false; updateUrl(); refresh(); };
$<HTMLButtonElement>('#cancel').onclick = () => { state.query = ''; state.id = ''; mobileReading = false; updateUrl(); refresh(); };
for (const [id, offset] of [['previous', -1], ['next', 1]] as const)
    $<HTMLButtonElement>(`#${id}`).onclick = () => { state.page += offset; state.id = ''; listScroll = 0; jumpList = true; mobileReading = false; updateUrl(); refresh(); };
document.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action],[data-open],[data-session]');
    if (!target)
        return;
    if (target.dataset.open) {
        void resolveMemory(target.dataset.open);
        return;
    }
    if (target.dataset.session) {
        openMemory(target.dataset.session, 'session');
        return;
    }
    switch (target.dataset.action) {
        case 'clear':
            state.scope = 'all';
            state.include = false;
            state.view = 'library';
            filterChange();
            break;
        case 'retry':
            void initialize();
            break;
        case 'detail-retry':
            void loadDetail();
            break;
        case 'back':
            cancelSourceLookup();
            state.id = '';
            mobileReading = false;
            syncChrome();
            updateUrl();
            renderRows();
            void loadDetail();
            restoreListPosition();
            break;
    }
});
async function resolveMemory(id: string): Promise<void> {
    sourceController?.abort();
    sourceController=new AbortController();
    const signal=sourceController.signal,sequence=++sourceSequence;
    try {
        const result = await api<MemoryDetail>(`/v1/memories/${encodeURIComponent(id)}`,{signal});
        if(signal.aborted||sequence!==sourceSequence)return;
        openMemory(id, result.data!.type);
    }
    catch {
        if(signal.aborted||sequence!==sourceSequence)return;
        openMemory(id);
    }
}
document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName) && state.view !== 'brief') {
        event.preventDefault();
        $<HTMLInputElement>('#search').focus();
    }
    if (event.key === 'Escape' && state.id)
        document.querySelector<HTMLButtonElement>('[data-action=back]')?.click();
});
window.addEventListener('popstate', () => { state = readState(); mobileReading = Boolean(state.id); restoreList = !state.id && Boolean(returnId); refresh(); });
function applyTheme(value: string): void {
    if (value === 'system')
        document.documentElement.removeAttribute('data-theme');
    else
        document.documentElement.dataset.theme = value;
}
try {
    const saved = localStorage.getItem('memoria-theme');
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
        $<HTMLSelectElement>('#theme').value = saved;
        applyTheme(saved);
    }
}
catch { /* private browser storage may be unavailable */ }
$<HTMLSelectElement>('#theme').onchange = () => { const theme = $<HTMLSelectElement>('#theme').value; applyTheme(theme); try {
    localStorage.setItem('memoria-theme', theme);
}
catch { /* optional preference storage */ } };
async function initialize(): Promise<void> {
    try {
        const result = await api<MemoryFacets>('/v1/memory-facets');
        facets = result.data!;
        const options = [...facets.repositories, ...facets.environment_projects];
        $<HTMLSelectElement>('#scope').innerHTML = '<option value="all">全部專案與共用</option><option value="environment">環境共用</option>' + options.map(p => `<option value="project:${escape(p)}">${escape(p)}</option>`).join('');
        if (state.scope.startsWith('project:') && !options.includes(state.scope.slice(8))) {
            const option = document.createElement('option');
            option.value = state.scope;
            option.textContent = `${state.scope.slice(8)}（無資料）`;
            $<HTMLSelectElement>('#scope').append(option);
        }
        refresh();
    }
    catch {
        syncChrome();
        $('#count').textContent = '尚未連線';
        $('#list').innerHTML = empty('無法連上本機記憶庫', '確認 Memoria 正在執行，然後重試。', '<button class="primary" data-action="retry">重新連線</button>', true);
    }
}
void initialize();
