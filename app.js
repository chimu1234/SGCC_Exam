'use strict';
(function () {
  const MANIFEST = window.__BANK_MANIFEST__;
  const app = document.getElementById('app');
  if (!MANIFEST || !Array.isArray(MANIFEST.banks) || !MANIFEST.banks.length) {
    app.innerHTML = '<div class="card"><h2>题库未加载</h2><p class="muted">请确认 data/banks/manifest.js 存在，并运行过 scripts/build_banks.py。</p></div>';
    return;
  }

  const BANK_META = MANIFEST.banks;
  const META_MAP = new Map(BANK_META.map(b => [b.id, b]));
  const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题' };
  const TYPE_ORDER = ['single', 'multiple', 'judge'];
  const LS_KEY = 'sgcc.v1';

  const DEFAULTS = {
    view: 'home',
    settings: { theme: 'auto', fontSize: 16, shuffleOptions: false, autoNext: false },
    progress: {},
    wrong: {},
    fav: {},
    history: [],
    session: null,
    lastResult: null,
    configDraft: {
      bankId: null, mode: 'practice', count: 10,
      sections: [], types: [], shuffle: false, backMode: false, timerMin: 20
    },
    searchQuery: ''
  };

  const cache = {};
  const maps = {};
  const loads = {};
  let allPromise = null;

  function loadBank(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    if (loads[id]) return loads[id];
    const meta = META_MAP.get(id);
    if (!meta) return Promise.reject(new Error('unknown bank'));
    loads[id] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = meta.file;
      s.onload = () => {
        const b = (window.__BANK_DATA__ || {})[id];
        if (!b) { delete loads[id]; reject(new Error('missing data')); return; }
        cache[id] = b;
        maps[id] = new Map(b.questions.map(q => [q.seq, q]));
        resolve(b);
      };
      s.onerror = () => { delete loads[id]; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return loads[id];
  }

  function loadAll() {
    if (!allPromise) allPromise = Promise.all(BANK_META.map(m => loadBank(m.id)));
    return allPromise;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function fmtAnswer(arr) { return arr.slice().sort().join('、'); }
  function fmtScore(n) {
    n = Math.round((n + Number.EPSILON) * 10) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function fmtDuration(sec) {
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
  }
  function scoreOf(q) {
    return (typeof q.score === 'number' && q.score > 0) ? q.score : 1;
  }
  function isCorrect(q, picks) {
    if (!picks || !picks.length) return false;
    return q.answer.slice().sort().join('') === picks.slice().sort().join('');
  }
  function splitUid(uid) {
    const i = uid.lastIndexOf(':');
    return [uid.slice(0, i), Number(uid.slice(i + 1))];
  }
  function bankName(id) {
    const m = META_MAP.get(id);
    return m ? m.shortName : id;
  }

  function mergeState(base, data) {
    const out = clone(base);
    if (!data || typeof data !== 'object') return out;
    for (const k of Object.keys(data)) {
      if (k === 'settings' || k === 'configDraft') continue;
      out[k] = data[k];
    }
    out.settings = Object.assign(clone(base.settings), data.settings || {});
    out.configDraft = Object.assign(clone(base.configDraft), data.configDraft || {});
    return out;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return clone(DEFAULTS);
      return mergeState(DEFAULTS, JSON.parse(raw));
    } catch (e) { return clone(DEFAULTS); }
  }

  let state = loadState();
  let timerId = null;
  let toastTimer = null;

  if (!['home', 'config', 'quiz', 'result', 'wrong', 'fav', 'stats', 'settings'].includes(state.view)) state.view = 'home';
  if (state.view === 'quiz' && !state.session) state.view = 'home';
  if (state.view === 'result' && !state.lastResult) state.view = 'home';

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function applyTheme() {
    const t = state.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--qfont', state.settings.fontSize + 'px');
  }
  function setView(v) {
    state.view = v;
    save();
    render();
    if (['wrong', 'fav', 'stats'].includes(v) && !allPromise) {
      loadAll().then(() => { if (state.view === v) render(); }).catch(() => {});
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------- stats ----------------

  function progressFor(prefix) {
    let done = 0, correct = 0, wrong = 0;
    const pre = prefix ? prefix + ':' : null;
    for (const uid of Object.keys(state.progress)) {
      if (pre && !uid.startsWith(pre)) continue;
      const p = state.progress[uid];
      done++; correct += p.correct || 0; wrong += p.wrong || 0;
    }
    return { done, correct, wrong };
  }
  function countFor(prefix, store) {
    const pre = prefix + ':';
    return Object.keys(store).filter(u => u.startsWith(pre)).length;
  }
  function accuracy(correct, wrong) {
    const n = correct + wrong;
    return n ? Math.round(correct / n * 100) : 0;
  }

  // ---------------- session ----------------

  function startSession(bankId, seqs, mode, cfg) {
    if (!seqs.length) { toast('没有符合条件的题目'); return; }
    const bank = cache[bankId];
    if (!bank) { toast('题库未加载'); return; }
    const optOrder = {};
    if (state.settings.shuffleOptions) {
      for (const seq of seqs) {
        const q = getQ(bankId, seq);
        if (q) optOrder[seq] = shuffle(q.options.map(o => o.key));
      }
    }
    state.session = {
      bankId, mode, ids: seqs.slice(), idx: 0,
      picks: {}, submitted: {}, correct: {}, marked: {}, optOrder,
      config: clone(cfg),
      startedAt: Date.now(),
      deadline: (mode === 'exam' && cfg.timerMin > 0) ? Date.now() + cfg.timerMin * 60000 : null,
      showCard: false
    };
    save();
    setView('quiz');
  }

  function getQ(bankId, seq) {
    return maps[bankId] ? maps[bankId].get(seq) : null;
  }
  function currentQ() {
    const s = state.session;
    return s ? getQ(s.bankId, s.ids[s.idx]) : null;
  }
  function currentBank() { return state.session ? cache[state.session.bankId] : null; }

  async function enterConfig(bankId, mode) {
    try { await loadBank(bankId); } catch (e) { toast('题库加载失败'); return; }
    const meta = META_MAP.get(bankId);
    Object.assign(state.configDraft, {
      bankId, mode,
      sections: meta.sections.map(s => s.id),
      types: TYPE_ORDER.filter(t => (meta.byType || {})[t]),
      count: 10, shuffle: false, backMode: false,
      timerMin: (meta.exam && meta.exam.durationMin) ? meta.exam.durationMin : 20
    });
    save();
    setView('config');
  }

  function startFromConfig() {
    const d = state.configDraft;
    const bank = cache[d.bankId];
    if (!bank) { toast('题库未加载'); return; }
    let pool = bank.questions.filter(q => d.sections.includes(q.sectionId) && d.types.includes(q.type));
    if (d.shuffle) pool = shuffle(pool);
    if (d.count > 0) pool = pool.slice(0, d.count);
    startSession(d.bankId, pool.map(q => q.seq), d.mode, d);
  }

  async function openSingle(bankId, seq) {
    try { await loadBank(bankId); } catch (e) { toast('题库加载失败'); return; }
    const meta = META_MAP.get(bankId);
    const cfg = {
      bankId, mode: 'practice', count: 1,
      sections: meta.sections.map(s => s.id),
      types: TYPE_ORDER.filter(t => (meta.byType || {})[t]),
      shuffle: false, backMode: false, timerMin: 20
    };
    startSession(bankId, [seq], 'practice', cfg);
  }

  function recordAnswer(uid, ok) {
    const p = state.progress[uid] || { seen: 0, correct: 0, wrong: 0 };
    p.seen = (p.seen || 0) + 1;
    p.correct = (p.correct || 0) + (ok ? 1 : 0);
    p.wrong = (p.wrong || 0) + (ok ? 0 : 1);
    p.last = Date.now();
    p.lastCorrect = !!ok;
    state.progress[uid] = p;
    if (ok) {
      if (state.wrong[uid]) delete state.wrong[uid];
    } else {
      const w = state.wrong[uid] || { count: 0, addedAt: Date.now() };
      w.count = (w.count || 0) + 1;
      w.lastAt = Date.now();
      state.wrong[uid] = w;
    }
  }

  // ---------------- actions ----------------

  function chooseKey(key) {
    const s = state.session;
    if (!s) return;
    const q = currentQ();
    const locked = s.mode === 'practice' && (s.submitted[q.seq] || s.config.backMode);
    if (locked) return;
    const picked = s.picks[q.seq] || [];
    if (q.type === 'multiple') {
      s.picks[q.seq] = picked.includes(key) ? picked.filter(k => k !== key) : picked.concat(key);
    } else {
      s.picks[q.seq] = [key];
      if (s.mode === 'practice') { submitPractice(); return; }
    }
    save(); render();
  }

  function submitPractice() {
    const s = state.session;
    const q = currentQ();
    const picked = s.picks[q.seq] || [];
    if (!picked.length) { toast('请先选择答案'); return; }
    const ok = isCorrect(q, picked);
    s.submitted[q.seq] = true;
    s.correct[q.seq] = ok;
    recordAnswer(q.uid, ok);
    save(); render();
    if (ok && state.settings.autoNext && s.idx < s.ids.length - 1) {
      setTimeout(() => { if (state.session === s) nextQuestion(); }, 700);
    }
  }

  function nextQuestion() {
    const s = state.session;
    if (!s) return;
    if (s.idx < s.ids.length - 1) {
      s.idx++; save(); render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (s.mode === 'exam') { requestSubmit(); return; }
    const seq = s.ids[s.idx];
    if (!s.config.backMode && !s.submitted[seq] && (s.picks[seq] || []).length === 0) {
      toast('请先作答当前题目'); return;
    }
    finishPractice();
  }
  function prevQuestion() {
    const s = state.session;
    if (!s || s.idx === 0) return;
    s.idx--; save(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function markCurrent() {
    const s = state.session, q = currentQ();
    if (!s || !q) return;
    if (s.marked[q.seq]) delete s.marked[q.seq]; else s.marked[q.seq] = true;
    save(); render();
  }
  function toggleFav(uid) {
    if (state.fav[uid]) { delete state.fav[uid]; toast('已取消收藏'); }
    else { state.fav[uid] = true; toast('已收藏'); }
    save(); render();
  }

  function finishPractice() {
    const s = state.session;
    let correct = 0, answered = 0, earned = 0, full = 0;
    s.ids.forEach(seq => {
      const q = getQ(s.bankId, seq);
      full += q ? scoreOf(q) : 1;
      if (s.submitted[seq] || s.config.backMode) {
        answered++;
        if (s.correct[seq]) { correct++; earned += q ? scoreOf(q) : 1; }
      }
    });
    state.lastResult = {
      bankId: s.bankId, mode: s.config.backMode ? 'back' : 'practice',
      total: s.ids.length, answered, correct, wrong: answered - correct,
      unanswered: s.ids.length - answered, earned, full,
      durationSec: Math.round((Date.now() - s.startedAt) / 1000),
      ids: s.ids.slice(), picks: clone(s.picks), correctMap: clone(s.correct),
      config: clone(s.config)
    };
    state.session = null;
    save();
    setView('result');
  }

  function requestSubmit() {
    const s = state.session;
    if (!s) return;
    const unanswered = s.ids.filter(seq => !(s.picks[seq] && s.picks[seq].length)).length;
    if (unanswered > 0) {
      askConfirm('确认交卷', '还有 ' + unanswered + ' 题未作答，确定交卷吗？', () => submitExam(false), '交卷');
    } else submitExam(false);
  }

  function submitExam(auto) {
    const s = state.session;
    if (!s) return;
    clearInterval(timerId);
    let correct = 0, wrong = 0, unanswered = 0, earned = 0, full = 0;
    const correctMap = {};
    s.ids.forEach(seq => {
      const q = getQ(s.bankId, seq);
      const sc = q ? scoreOf(q) : 1;
      full += sc;
      const picks = s.picks[seq] || [];
      if (!picks.length) { unanswered++; correctMap[seq] = false; if (q) recordAnswer(q.uid, false); }
      else if (isCorrect(q, picks)) { correct++; earned += sc; correctMap[seq] = true; recordAnswer(q.uid, true); }
      else { wrong++; correctMap[seq] = false; recordAnswer(q.uid, false); }
    });
    const durationSec = Math.round((Date.now() - s.startedAt) / 1000);
    state.lastResult = {
      bankId: s.bankId, mode: 'exam', total: s.ids.length,
      correct, wrong, unanswered, answered: s.ids.length - unanswered,
      earned, full, durationSec,
      ids: s.ids.slice(), picks: clone(s.picks), correctMap, auto: !!auto,
      config: clone(s.config)
    };
    state.history.unshift({
      date: Date.now(), bankId: s.bankId, mode: 'exam', total: s.ids.length,
      correct, wrong, unanswered, earned, full, durationSec
    });
    if (state.history.length > 50) state.history.length = 50;
    state.session = null;
    save();
    setView('result');
    if (auto) toast('时间到，已自动交卷');
  }

  function exitQuiz() {
    askConfirm('退出答题', '当前进度会保留，下次可从首页继续。', () => setView('home'), '退出');
  }
  function resetAll() {
    state = clone(DEFAULTS);
    save(); applyTheme(); setView('home'); toast('已重置');
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sgcc-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = mergeState(DEFAULTS, JSON.parse(reader.result));
        save(); applyTheme(); setView('home'); toast('导入成功');
      } catch (e) { toast('导入失败：文件格式错误'); }
    };
    reader.readAsText(file);
  }
  function askConfirm(title, msg, onYes, yesText) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal"><h3>' + esc(title) + '</h3><p class="muted">' + esc(msg) + '</p>' +
      '<div class="modal-actions"><button class="btn" data-no>取消</button>' +
      '<button class="btn primary" data-yes>' + esc(yesText || '确定') + '</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector('[data-no]').onclick = () => mask.remove();
    mask.querySelector('[data-yes]').onclick = () => { mask.remove(); onYes(); };
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
  }

  // ---------------- views ----------------

  function imagesHtml(list) {
    if (!list || !list.length) return '';
    return list.map(src => '<img class="qimg" src="' + esc(src) + '" alt="">').join('');
  }

  function bankCard(meta) {
    const pr = progressFor(meta.id);
    const pct = meta.total ? Math.round(pr.done / meta.total * 100) : 0;
    const by = meta.byType || {};
    return '<article class="bank-card" data-action="open-bank" data-bank="' + meta.id + '">' +
      '<div class="bank-name">' + esc(meta.name) + '</div>' +
      '<div class="desc">' + esc(meta.description || '') + '</div>' +
      '<div class="bank-tags">' +
        '<span class="badge">共 ' + meta.total + ' 题</span>' +
        '<span class="badge">单选 ' + (by.single || 0) + '</span>' +
        '<span class="badge">多选 ' + (by.multiple || 0) + '</span>' +
        '<span class="badge">判断 ' + (by.judge || 0) + '</span>' +
        (meta.hasAnalysis ? '<span class="badge">含解析</span>' : '') +
        (meta.hasImages ? '<span class="badge">含图片</span>' : '') +
      '</div>' +
      '<div class="mini-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="small muted">已做 ' + pr.done + ' / ' + meta.total + ' · 正确率 ' + accuracy(pr.correct, pr.wrong) + '%</div>' +
      '<div class="bank-foot">' +
        '<button class="btn sm primary" data-action="cfg" data-bank="' + meta.id + '" data-mode="practice">练习</button>' +
        '<button class="btn sm" data-action="cfg" data-bank="' + meta.id + '" data-mode="exam">考试</button>' +
        '<div class="grow"></div>' +
        '<span class="badge plain">错 ' + countFor(meta.id, state.wrong) + ' · 藏 ' + countFor(meta.id, state.fav) + '</span>' +
      '</div>' +
    '</article>';
  }

  function searchResults() {
    const q = (state.searchQuery || '').trim();
    if (!q) return '';
    if (!allPromise) {
      loadAll().then(() => {
        const box = document.getElementById('searchResults');
        if (box) box.innerHTML = searchResults();
      }).catch(() => {});
      return '<p class="muted small">正在加载题库…</p>';
    }
    const hits = [];
    for (const meta of BANK_META) {
      const bank = cache[meta.id];
      if (!bank) continue;
      for (const item of bank.questions) {
        if (item.stem.includes(q) || item.options.some(o => o.text.includes(q))) {
          hits.push(item);
          if (hits.length >= 80) break;
        }
      }
      if (hits.length >= 80) break;
    }
    if (!hits.length) return '<p class="muted small">没有匹配的题目。</p>';
    return '<div class="list">' + hits.map(item =>
      '<div class="row"><div class="row-main"><div class="row-title">' + esc(item.stem.slice(0, 90)) + (item.stem.length > 90 ? '…' : '') +
      '</div><div class="row-sub"><span class="badge plain">' + esc(bankName(item.bankId)) + '</span> ' +
      esc(item.sectionName || '') + ' · ' + TYPE_LABEL[item.type] + '</div></div>' +
      '<div class="row-actions"><button class="btn sm" data-action="open-q" data-bank="' + item.bankId + '" data-seq="' + item.seq + '">练习</button></div></div>'
    ).join('') + '</div>';
  }

  function viewHome() {
    let totalQ = 0;
    BANK_META.forEach(m => { totalQ += m.total; });
    const o = progressFor(null);
    const s = state.session;
    const resume = s ? (
      '<div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1"><b>继续上次' + (s.mode === 'exam' ? '考试' : '练习') + '</b>' +
      '<div class="small muted">' + esc(bankName(s.bankId)) + ' · 已到第 ' + (s.idx + 1) + ' / ' + s.ids.length + ' 题</div></div>' +
      '<button class="btn primary" data-action="resume">继续</button>' +
      '<button class="btn sm danger" data-action="discard-session">放弃</button></div>'
    ) : '';

    return '' +
      '<section class="hero">' +
        '<div class="card hero-main">' +
          '<h1>题库练习</h1>' +
          '<p class="lead">共 ' + BANK_META.length + ' 个题库 · ' + totalQ + ' 道题。选择题库开始练习或模拟考试。</p>' +
          '<div class="search-box"><input id="searchInput" placeholder="跨题库搜索题干关键词…" value="' + esc(state.searchQuery) + '"></div>' +
          '<div id="searchResults">' + searchResults() + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<h3>学习概览</h3>' +
          '<div class="stat-grid">' +
            '<div class="stat"><div class="num">' + BANK_META.length + '</div><div class="label">题库数量</div></div>' +
            '<div class="stat"><div class="num">' + totalQ + '</div><div class="label">题目总数</div></div>' +
            '<div class="stat"><div class="num">' + o.done + '</div><div class="label">已做题目</div></div>' +
            '<div class="stat"><div class="num">' + accuracy(o.correct, o.wrong) + '%</div><div class="label">正确率</div></div>' +
          '</div>' +
        '</div>' +
      '</section>' +
      resume +
      '<section class="bank-grid">' + BANK_META.map(bankCard).join('') + '</section>';
  }

  function viewConfig() {
    const d = state.configDraft;
    const meta = d.bankId ? META_MAP.get(d.bankId) : null;
    const bank = d.bankId ? cache[d.bankId] : null;
    if (!meta || !bank) return '<div class="card"><p class="muted">请先从首页选择题库。</p><button class="btn" data-action="go-home">返回题库</button></div>';

    let pool = bank.questions.filter(q => d.sections.includes(q.sectionId) && d.types.includes(q.type));
    const selected = d.count > 0 ? pool.slice(0, d.count) : pool;
    const byType = {};
    pool.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });

    return '<div class="card">' +
      '<div class="qcount"><span class="badge">' + esc(meta.shortName) + '</span><h1 style="margin:0;font-size:21px">' + (d.mode === 'exam' ? '模拟考试' : '练习') + '设置</h1></div>' +
      '<div class="field"><div class="label">模式</div><div class="chips">' +
        '<button class="chip ' + (d.mode === 'practice' ? 'on' : '') + '" data-action="cfg-mode" data-v="practice">练习模式</button>' +
        '<button class="chip ' + (d.mode === 'exam' ? 'on' : '') + '" data-action="cfg-mode" data-v="exam">考试模式</button>' +
      '</div></div>' +
      '<div class="field"><div class="label">章节 / 板块 <span class="hint">当前筛选可选 ' + pool.length + ' 题</span></div><div class="chips">' +
        meta.sections.map(sec =>
          '<button class="chip ' + (d.sections.includes(sec.id) ? 'on' : '') + '" data-action="cfg-section" data-v="' + sec.id + '">' +
          esc(sec.name) + ' · ' + sec.count + '</button>'
        ).join('') +
      '</div></div>' +
      '<div class="field"><div class="label">题型</div><div class="chips">' +
        TYPE_ORDER.filter(t => (meta.byType || {})[t]).map(t =>
          '<button class="chip ' + (d.types.includes(t) ? 'on' : '') + '" data-action="cfg-type" data-v="' + t + '">' +
          TYPE_LABEL[t] + ' · ' + (byType[t] || 0) + '</button>'
        ).join('') +
      '</div></div>' +
      '<div class="field"><div class="label">题量</div><div class="chips">' +
        [10, 15, 20, 30, 50, 0].map(n =>
          '<button class="chip ' + (d.count === n ? 'on' : '') + '" data-action="cfg-count" data-v="' + n + '">' + (n === 0 ? '全部' : n + ' 题') + '</button>'
        ).join('') +
      '</div></div>' +
      '<div class="field"><div class="label">顺序</div><div class="chips">' +
        '<button class="chip ' + (!d.shuffle ? 'on' : '') + '" data-action="cfg-shuffle" data-v="0">按原顺序</button>' +
        '<button class="chip ' + (d.shuffle ? 'on' : '') + '" data-action="cfg-shuffle" data-v="1">随机</button>' +
      '</div></div>' +
      (d.mode === 'practice'
        ? '<div class="field"><div class="label">背题模式 <span class="hint">直接显示答案与解析</span></div><div class="chips">' +
          '<button class="chip ' + (!d.backMode ? 'on' : '') + '" data-action="cfg-back" data-v="0">关闭</button>' +
          '<button class="chip ' + (d.backMode ? 'on' : '') + '" data-action="cfg-back" data-v="1">开启</button>' +
          '</div></div>'
        : '<div class="field"><div class="label">考试时长</div><div class="chips">' +
          [0, 10, 20, 30, 60, 120].map(m =>
            '<button class="chip ' + (d.timerMin === m ? 'on' : '') + '" data-action="cfg-timer" data-v="' + m + '">' + (m === 0 ? '不限时' : m + ' 分钟') + '</button>'
          ).join('') +
          '</div></div>') +
      '<div class="config-summary">将开始' + (d.mode === 'exam' ? '模拟考试' : '练习') + '：' +
        (d.count === 0 ? '全部 ' + pool.length + ' 题' : d.count + ' 题') +
        ' · ' + d.sections.length + ' 个章节 · ' + d.types.length + ' 种题型' +
        (d.mode === 'exam' ? ' · 本次满分 ' + fmtScore(selected.reduce((s, q) => s + scoreOf(q), 0)) : '') +
      '</div>' +
      '<div class="quiz-foot" style="margin-top:20px">' +
        '<button class="btn" data-action="go-home">返回</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-action="cfg-start" ' + (pool.length === 0 ? 'disabled' : '') + '>开始答题</button>' +
      '</div>' +
    '</div>';
  }

  function materialsHtml(bank, q) {
    const sec = bank.sections.find(x => x.id === q.sectionId);
    if (!sec || !sec.materials || !sec.materials.length) return '';
    return sec.materials.map((m, i) =>
      '<details class="material-block"' + (i === 0 ? ' open' : '') + '>' +
        '<summary>' + esc(m.title) + '</summary>' +
        (m.text ? '<div class="m-text">' + esc(m.text) + '</div>' : '') +
        imagesHtml(m.images) +
      '</details>'
    ).join('');
  }

  function optionHtml(q, picked, showAns, locked) {
    const s = state.session;
    const order = (s && s.optOrder && s.optOrder[q.seq]) ? s.optOrder[q.seq] : q.options.map(o => o.key);
    return '<div class="options">' + order.map(k => {
      const o = q.options.find(x => x.key === k) || { key: k, text: '', images: [] };
      let cls = '';
      if (showAns) {
        if (q.answer.includes(k)) cls = 'correct';
        else if (picked.includes(k)) cls = 'wrong';
      } else if (picked.includes(k)) cls = 'selected';
      return '<button class="opt ' + cls + '" data-action="opt" data-key="' + k + '" ' + (locked ? 'disabled' : '') + '>' +
        '<span class="key">' + k + '</span><span class="opt-body">' + esc(o.text) + imagesHtml(o.images) + '</span></button>';
    }).join('') + '</div>';
  }

  function analysisHtml(q) {
    if (!q.analysis) return '';
    return '<div class="analysis-block"><div class="a-title">解析</div><div class="a-text">' + esc(q.analysis) + '</div>' + imagesHtml(q.analysisImages) + '</div>';
  }

  function viewQuiz() {
    const s = state.session;
    const bank = currentBank();
    const q = currentQ();
    if (!s || !bank || !q) return '<div class="card"><p class="muted">题目加载失败。</p><button class="btn" data-action="go-home">返回题库</button></div>';

    const picked = s.picks[q.seq] || [];
    const back = s.mode === 'practice' && !!s.config.backMode;
    const submitted = s.mode === 'practice' && (!!s.submitted[q.seq] || back);
    const locked = submitted;
    const isLast = s.idx === s.ids.length - 1;
    const answeredCount = s.ids.filter(seq =>
      s.mode === 'practice' ? (s.submitted[seq] || back) : !!(s.picks[seq] && s.picks[seq].length)
    ).length;
    const pct = Math.round((s.idx + 1) / s.ids.length * 100);

    let feedback = '';
    if (back) {
      feedback = '<div class="feedback ok">背题模式 · 正确答案：<span class="ans">' + fmtAnswer(q.answer) + '</span></div>' + analysisHtml(q);
    } else if (s.mode === 'practice' && submitted) {
      const ok = s.correct[q.seq];
      feedback = '<div class="feedback ' + (ok ? 'ok' : 'bad') + '">' +
        (ok ? '回答正确' : '回答错误') + ' · 正确答案：<span class="ans">' + fmtAnswer(q.answer) + '</span></div>' + analysisHtml(q);
    }

    let multiBtn = '';
    if (s.mode === 'practice' && q.type === 'multiple' && !submitted) {
      multiBtn = '<button class="btn primary" data-action="submit" ' + (picked.length ? '' : 'disabled') + '>提交答案</button>';
    }

    let cardPanel = '';
    if (s.mode === 'exam' && s.showCard) {
      cardPanel = '<div class="card-panel"><div class="card-grid">' + s.ids.map((seq, i) => {
        const done = s.picks[seq] && s.picks[seq].length;
        return '<button class="' + (done ? 'done ' : '') + (s.marked[seq] ? 'mark ' : '') + (i === s.idx ? 'cur' : '') +
          '" data-action="jump" data-idx="' + i + '">' + (i + 1) + '</button>';
      }).join('') + '</div>' +
        '<div class="small muted" style="margin-top:10px">答题卡：已完成 ' + answeredCount + ' / ' + s.ids.length + '，黄框为标记</div></div>';
    }

    return '' +
      '<div class="quiz-top">' +
        '<button class="btn sm ghost" data-action="exit-quiz">← 退出</button>' +
        '<span class="badge">' + esc(bankName(s.bankId)) + '</span>' +
        '<span class="qmeta">' + TYPE_LABEL[q.type] + ' · ' + esc(q.sectionName || '') + '</span>' +
        (s.mode === 'exam'
          ? '<span class="timer" id="timer">--:--</span>'
          : '<span class="qmeta" style="margin-left:auto">已答 ' + answeredCount + '/' + s.ids.length + '</span>') +
      '</div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="card">' +
        '<div class="qcount">' +
          '<span class="badge">' + TYPE_LABEL[q.type] + '</span>' +
          '<span>第 ' + (s.idx + 1) + ' / ' + s.ids.length + ' 题</span>' +
          (scoreOf(q) !== 1 ? '<span class="badge plain">' + fmtScore(scoreOf(q)) + ' 分</span>' : '') +
          (s.marked[q.seq] ? '<span class="badge warn">已标记</span>' : '') +
          (state.fav[q.uid] ? '<span class="badge plain">已收藏</span>' : '') +
        '</div>' +
        materialsHtml(bank, q) +
        '<div class="stem">' + esc(q.stem) + '</div>' +
        imagesHtml(q.stemImages) +
        optionHtml(q, picked, submitted, locked) +
        feedback +
        '<div class="quiz-foot">' +
          '<button class="btn" data-action="prev" ' + (s.idx === 0 ? 'disabled' : '') + '>上一题</button>' +
          '<button class="btn ghost" data-action="fav">' + (state.fav[q.uid] ? '★ 已收藏' : '☆ 收藏') + '</button>' +
          (s.mode === 'exam' ? '<button class="btn ghost" data-action="mark">' + (s.marked[q.seq] ? '取消标记' : '标记') + '</button>' : '') +
          (s.mode === 'exam' ? '<button class="btn ghost" data-action="card">答题卡</button>' : '') +
          '<div class="spacer"></div>' +
          multiBtn +
          (s.mode === 'exam' && !isLast ? '<button class="btn" data-action="submit-exam">交卷</button>' : '') +
          '<button class="btn ' + (isLast ? 'primary' : '') + '" data-action="next">' +
            (isLast ? (s.mode === 'exam' ? '交卷' : '完成') : '下一题') + '</button>' +
        '</div>' +
      '</div>' + cardPanel;
  }

  function viewResult() {
    const r = state.lastResult;
    if (!r) return viewHome();
    const bank = cache[r.bankId];
    const isBack = r.mode === 'back';
    const pct = r.full ? Math.round(r.earned / r.full * 100) : (r.total ? Math.round(r.correct / r.total * 100) : 0);
    const title = r.mode === 'exam' ? '模拟考试结束' : (isBack ? '背题完成' : '练习完成');

    const stats =
      '<div class="result-stats" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">' +
        '<div class="stat"><div class="num">' + fmtScore(r.earned) + ' / ' + fmtScore(r.full) + '</div><div class="label">得分</div></div>' +
        '<div class="stat"><div class="num">' + r.correct + '</div><div class="label">正确</div></div>' +
        '<div class="stat"><div class="num">' + r.wrong + '</div><div class="label">错误</div></div>' +
        '<div class="stat"><div class="num">' + (r.unanswered || 0) + '</div><div class="label">未答</div></div>' +
        '<div class="stat"><div class="num">' + fmtDuration(r.durationSec) + '</div><div class="label">用时</div></div>' +
      '</div>';

    const review = (r.ids || []).map((seq, i) => {
      const q = bank ? getQ(r.bankId, seq) : null;
      if (!q) return '';
      const picks = (r.picks && r.picks[seq]) || [];
      const ok = r.correctMap ? r.correctMap[seq] : null;
      return '<div class="review-item">' +
        '<div class="small muted">第 ' + (i + 1) + ' 题 · ' + TYPE_LABEL[q.type] + ' · ' + esc(q.sectionName || '') + '</div>' +
        '<div class="stem">' + esc(q.stem) + '</div>' + imagesHtml(q.stemImages) +
        '<div class="line">你的答案：<b class="' + (ok ? 'ok' : 'bad') + '">' + (picks.length ? fmtAnswer(picks) : '未作答') + '</b>' +
        ' · 正确答案：<b class="ok">' + fmtAnswer(q.answer) + '</b></div>' +
        analysisHtml(q) +
      '</div>';
    }).join('');

    return '' +
      '<div class="card result-hero">' +
        '<div class="qcount" style="justify-content:center"><span class="badge">' + esc(bankName(r.bankId)) + '</span></div>' +
        '<h1>' + title + '</h1>' +
        '<div class="score-ring" style="--pct:' + pct + '"><div>' + pct + '</div></div>' +
        stats +
        '<div class="hero-actions" style="justify-content:center">' +
          '<button class="btn primary" data-action="retry">再来一次</button>' +
          '<button class="btn" data-action="go-wrong">查看错题本</button>' +
          '<button class="btn ghost" data-action="go-home">返回题库</button>' +
        '</div>' +
      '</div>' +
      (review ? '<div class="card" style="margin-top:16px"><details class="review"><summary>查看全部题目、答案与解析</summary>' + review + '</details></div>' : '');
  }

  function groupUids(store) {
    const groups = {};
    for (const uid of Object.keys(store)) {
      const [bankId, seq] = splitUid(uid);
      (groups[bankId] = groups[bankId] || []).push(seq);
    }
    return groups;
  }

  function listRows(bankId, seqs, kind) {
    return seqs.map(seq => {
      const q = getQ(bankId, seq);
      if (!q) return '';
      const uid = bankId + ':' + seq;
      const meta = kind === 'wrong'
        ? '错 ' + (state.wrong[uid] ? state.wrong[uid].count : 1) + ' 次 · ' + TYPE_LABEL[q.type]
        : TYPE_LABEL[q.type];
      return '<div class="row">' +
        '<div class="row-main"><div class="row-title">' + esc(q.stem.slice(0, 80)) + (q.stem.length > 80 ? '…' : '') + '</div>' +
        '<div class="row-sub">' + meta + ' · ' + esc(q.sectionName || '') + '</div></div>' +
        '<div class="row-actions">' +
          '<button class="btn sm" data-action="open-q" data-bank="' + bankId + '" data-seq="' + seq + '">练习</button>' +
          '<button class="btn sm danger" data-action="remove-' + kind + '" data-uid="' + uid + '">移除</button>' +
        '</div></div>';
    }).join('');
  }

  function viewStore(kind) {
    if (!allPromise) {
      return '<div class="card"><h1>' + (kind === 'wrong' ? '错题本' : '收藏') + '</h1><p class="muted">正在加载题库…</p></div>';
    }
    const store = kind === 'wrong' ? state.wrong : state.fav;
    const groups = groupUids(store);
    const bankIds = Object.keys(groups);
    if (!bankIds.length) {
      return '<div class="card"><h1>' + (kind === 'wrong' ? '错题本' : '收藏') + '</h1>' +
        '<div class="empty"><div class="big">' + (kind === 'wrong' ? '◎' : '☆') + '</div><p>' +
        (kind === 'wrong' ? '还没有错题，继续练习吧。' : '还没有收藏题目。') + '</p></div></div>';
    }
    return '<div class="card"><h1>' + (kind === 'wrong' ? '错题本' : '收藏') + '</h1>' +
      bankIds.map(bankId => {
        const seqs = groups[bankId];
        return '<div class="group-title">' +
          '<span class="badge">' + esc(bankName(bankId)) + '</span>' +
          '<span class="small muted">' + seqs.length + ' 题</span>' +
          '<div class="grow"></div>' +
          '<button class="btn sm primary" data-action="start-' + kind + '-bank" data-bank="' + bankId + '">重练本库</button>' +
          '<button class="btn sm danger" data-action="clear-' + kind + '-bank" data-bank="' + bankId + '">清空本库</button>' +
        '</div>' +
        '<div class="list">' + listRows(bankId, seqs, kind) + '</div>';
      }).join('') +
    '</div>';
  }

  function viewStats() {
    if (!allPromise) {
      return '<div class="card"><h1>学习统计</h1><p class="muted">正在加载题库…</p></div>';
    }
    const o = progressFor(null);
    const bankRows = BANK_META.map(meta => {
      const pr = progressFor(meta.id);
      return '<tr><td>' + esc(meta.name) + '</td><td class="num">' + meta.total + '</td><td class="num">' + pr.done +
        '</td><td class="num">' + accuracy(pr.correct, pr.wrong) + '%</td></tr>';
    }).join('');

    const typeAgg = {};
    TYPE_ORDER.forEach(t => { typeAgg[t] = { total: 0, done: 0, correct: 0, wrong: 0 }; });
    BANK_META.forEach(meta => {
      const bank = cache[meta.id];
      if (!bank) return;
      bank.questions.forEach(q => {
        const a = typeAgg[q.type];
        if (!a) return;
        a.total++;
        const p = state.progress[q.uid];
        if (p) { a.done++; a.correct += p.correct || 0; a.wrong += p.wrong || 0; }
      });
    });
    const typeRows = TYPE_ORDER.map(t => {
      const a = typeAgg[t];
      if (!a.total) return '';
      return '<tr><td>' + TYPE_LABEL[t] + '</td><td class="num">' + a.total + '</td><td class="num">' + a.done +
        '</td><td class="num">' + accuracy(a.correct, a.wrong) + '%</td></tr>';
    }).join('');

    const history = state.history.length
      ? state.history.slice(0, 20).map(h => {
          const dt = new Date(h.date);
          const dateStr = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' +
            String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
          const pct = h.full ? Math.round(h.earned / h.full * 100) : 0;
          return '<tr><td>' + dateStr + '</td><td>' + esc(bankName(h.bankId)) + '</td><td class="num">' + h.total +
            '</td><td class="num">' + fmtScore(h.earned) + '/' + fmtScore(h.full) + '</td><td class="num">' + pct + '%</td><td class="num">' + fmtDuration(h.durationSec) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="6" class="muted">暂无考试记录</td></tr>';

    return '' +
      '<div class="card"><h1>学习统计</h1>' +
        '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin:14px 0">' +
          '<div class="stat"><div class="num">' + o.done + '</div><div class="label">已做题目</div></div>' +
          '<div class="stat"><div class="num">' + (o.correct + o.wrong) + '</div><div class="label">累计作答</div></div>' +
          '<div class="stat"><div class="num">' + accuracy(o.correct, o.wrong) + '%</div><div class="label">正确率</div></div>' +
          '<div class="stat"><div class="num">' + Object.keys(state.wrong).length + '</div><div class="label">错题</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>题库</h3><table class="table"><thead><tr>' +
        '<th>题库</th><th class="num">题数</th><th class="num">已做</th><th class="num">正确率</th>' +
      '</tr></thead><tbody>' + bankRows + '</tbody></table></div>' +
      '<div class="card" style="margin-top:16px"><h3>题型</h3><table class="table"><thead><tr>' +
        '<th>题型</th><th class="num">题数</th><th class="num">已做</th><th class="num">正确率</th>' +
      '</tr></thead><tbody>' + typeRows + '</tbody></table></div>' +
      '<div class="card" style="margin-top:16px"><h3>考试记录</h3><table class="table"><thead><tr>' +
        '<th>时间</th><th>题库</th><th class="num">题数</th><th class="num">得分</th><th class="num">得分率</th><th class="num">用时</th>' +
      '</tr></thead><tbody>' + history + '</tbody></table></div>';
  }

  function viewSettings() {
    const st = state.settings;
    const themeLabel = { auto: '跟随系统', light: '浅色', dark: '深色' };
    return '<div class="card"><h1>设置</h1>' +
      '<div class="settings-row"><div class="grow"><div>主题</div><div class="desc">当前：' + themeLabel[st.theme] + '</div></div>' +
        '<select data-setting="theme">' +
          ['auto', 'light', 'dark'].map(v => '<option value="' + v + '" ' + (st.theme === v ? 'selected' : '') + '>' + themeLabel[v] + '</option>').join('') +
        '</select></div>' +
      '<div class="settings-row"><div class="grow"><div>题目字号</div><div class="desc">' + st.fontSize + 'px</div></div>' +
        '<input type="range" min="14" max="22" step="1" value="' + st.fontSize + '" data-setting="fontSize"></div>' +
      '<div class="settings-row"><div class="grow"><div>选项乱序</div><div class="desc">每次练习随机打乱选项顺序</div></div>' +
        '<label class="switch"><input type="checkbox" data-setting="shuffleOptions" ' + (st.shuffleOptions ? 'checked' : '') + '><span></span></label></div>' +
      '<div class="settings-row"><div class="grow"><div>答对自动下一题</div><div class="desc">练习模式下答对后自动跳转</div></div>' +
        '<label class="switch"><input type="checkbox" data-setting="autoNext" ' + (st.autoNext ? 'checked' : '') + '><span></span></label></div>' +
      '<div class="settings-row"><div class="grow"><div>数据</div><div class="desc">进度、错题、收藏保存在本机浏览器</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn sm" data-action="export">导出</button>' +
          '<button class="btn sm" data-action="import">导入</button>' +
          '<button class="btn sm danger" data-action="reset">重置</button>' +
        '</div></div>' +
      '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
    '</div>';
  }

  // ---------------- render ----------------

  function render() {
    clearInterval(timerId);
    timerId = null;
    applyTheme();

    const nav = document.getElementById('nav');
    if (nav) {
      Array.prototype.forEach.call(nav.children, b => {
        b.classList.toggle('active', b.dataset.view === state.view);
      });
    }

    let html = '';
    switch (state.view) {
      case 'config': html = viewConfig(); break;
      case 'quiz': html = viewQuiz(); break;
      case 'result': html = viewResult(); break;
      case 'wrong': html = viewStore('wrong'); break;
      case 'fav': html = viewStore('fav'); break;
      case 'stats': html = viewStats(); break;
      case 'settings': html = viewSettings(); break;
      default: html = viewHome();
    }
    app.innerHTML = html;
    if (state.view === 'quiz') startTimer();
  }

  function startTimer() {
    clearInterval(timerId);
    const s = state.session;
    if (!s || s.mode !== 'exam' || !s.deadline) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((s.deadline - Date.now()) / 1000));
      const el = document.getElementById('timer');
      if (el) { el.textContent = fmtTime(left); el.classList.toggle('low', left <= 60); }
      if (left <= 0) { clearInterval(timerId); timerId = null; submitExam(true); }
    };
    tick();
    timerId = setInterval(tick, 500);
  }

  // ---------------- events ----------------

  document.addEventListener('click', function (e) {
    const viewEl = e.target.closest('[data-view]');
    if (viewEl) { e.preventDefault(); setView(viewEl.dataset.view); return; }
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const a = act.dataset.action;
    const d = act.dataset;

    switch (a) {
      case 'open-bank': enterConfig(d.bank, 'practice'); break;
      case 'cfg': enterConfig(d.bank, d.mode); break;
      case 'cfg-mode': state.configDraft.mode = d.v; save(); render(); break;
      case 'cfg-count': state.configDraft.count = Number(d.v); save(); render(); break;
      case 'cfg-section': {
        const v = d.v, arr = state.configDraft.sections;
        state.configDraft.sections = arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v);
        save(); render(); break;
      }
      case 'cfg-type': {
        const v = d.v, arr = state.configDraft.types;
        if (arr.includes(v)) { if (arr.length > 1) state.configDraft.types = arr.filter(x => x !== v); }
        else state.configDraft.types = arr.concat(v);
        save(); render(); break;
      }
      case 'cfg-shuffle': state.configDraft.shuffle = d.v === '1'; save(); render(); break;
      case 'cfg-back': state.configDraft.backMode = d.v === '1'; save(); render(); break;
      case 'cfg-timer': state.configDraft.timerMin = Number(d.v); save(); render(); break;
      case 'cfg-start': startFromConfig(); break;
      case 'go-home': setView('home'); break;
      case 'open-q': openSingle(d.bank, Number(d.seq)); break;
      case 'opt': chooseKey(d.key); break;
      case 'submit': submitPractice(); break;
      case 'next': nextQuestion(); break;
      case 'prev': prevQuestion(); break;
      case 'jump': state.session.idx = Number(d.idx); state.session.showCard = false; save(); render(); break;
      case 'card': state.session.showCard = !state.session.showCard; save(); render(); break;
      case 'mark': markCurrent(); break;
      case 'fav': toggleFav(currentQ().uid); break;
      case 'exit-quiz': exitQuiz(); break;
      case 'resume': setView('quiz'); break;
      case 'discard-session':
        askConfirm('放弃进度', '确定放弃当前答题进度吗？', () => { state.session = null; save(); render(); }, '放弃');
        break;
      case 'submit-exam': requestSubmit(); break;
      case 'start-wrong-bank': startBankStore('wrong', d.bank, 'practice'); break;
      case 'start-fav-bank': startBankStore('fav', d.bank, 'practice'); break;
      case 'clear-wrong-bank': clearBankStore('wrong', d.bank); break;
      case 'clear-fav-bank': clearBankStore('fav', d.bank); break;
      case 'remove-wrong': delete state.wrong[d.uid]; save(); render(); break;
      case 'remove-fav': delete state.fav[d.uid]; save(); render(); break;
      case 'go-wrong': setView('wrong'); break;
      case 'retry': {
        const r = state.lastResult;
        if (r && cache[r.bankId]) startSession(r.bankId, r.ids.slice(), r.mode === 'exam' ? 'exam' : 'practice', r.config || state.configDraft);
        break;
      }
      case 'export': exportData(); break;
      case 'import': { const f = document.getElementById('importFile'); if (f) f.click(); break; }
      case 'reset': askConfirm('重置数据', '将清除所有进度、错题、收藏与设置，确定吗？', resetAll, '重置'); break;
    }
  });

  function startBankStore(kind, bankId, mode) {
    const store = kind === 'wrong' ? state.wrong : state.fav;
    const pre = bankId + ':';
    const seqs = Object.keys(store).filter(u => u.startsWith(pre)).map(u => splitUid(u)[1]);
    if (!seqs.length) { toast('本库暂无题目'); return; }
    const meta = META_MAP.get(bankId);
    const cfg = {
      bankId, mode, count: 0,
      sections: meta.sections.map(s => s.id),
      types: TYPE_ORDER.filter(t => (meta.byType || {})[t]),
      shuffle: false, backMode: false, timerMin: (meta.exam && meta.exam.durationMin) || 20
    };
    loadBank(bankId).then(() => startSession(bankId, seqs, mode, cfg)).catch(() => toast('题库加载失败'));
  }

  function clearBankStore(kind, bankId) {
    const store = kind === 'wrong' ? state.wrong : state.fav;
    const pre = bankId + ':';
    askConfirm('清空本库', '确定清空「' + bankName(bankId) + '」的' + (kind === 'wrong' ? '错题' : '收藏') + '吗？', () => {
      Object.keys(store).forEach(u => { if (u.startsWith(pre)) delete store[u]; });
      save(); render();
    }, '清空');
  }

  document.addEventListener('input', function (e) {
    if (e.target.id === 'searchInput') {
      state.searchQuery = e.target.value;
      const box = document.getElementById('searchResults');
      if (box) box.innerHTML = searchResults();
      return;
    }
    if (e.target.dataset.setting === 'fontSize') {
      state.settings.fontSize = Number(e.target.value);
      applyTheme();
      const row = e.target.closest('.settings-row');
      const desc = row && row.querySelector('.desc');
      if (desc) desc.textContent = state.settings.fontSize + 'px';
      save();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'importFile') {
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      return;
    }
    const k = e.target.dataset.setting;
    if (!k) return;
    if (k === 'theme') state.settings.theme = e.target.value;
    if (k === 'shuffleOptions' || k === 'autoNext') state.settings[k] = e.target.checked;
    if (k === 'fontSize') state.settings.fontSize = Number(e.target.value);
    save(); applyTheme();
    if (k !== 'fontSize') render();
  });

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
      save(); applyTheme(); render();
      toast('主题：' + ({ auto: '跟随系统', light: '浅色', dark: '深色' })[state.settings.theme]);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (document.querySelector('.modal-mask')) return;
    if (state.view !== 'quiz' || !state.session) return;
    if (e.target.matches('input,select,textarea')) return;
    const s = state.session;
    const q = currentQ();
    if (!q) return;
    const key = e.key.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(key)) {
      if (q.options.some(o => o.key === key)) { chooseKey(key); e.preventDefault(); }
      return;
    }
    if (['1', '2', '3', '4'].includes(key)) {
      const k = 'ABCD'[Number(key) - 1];
      if (q.options.some(o => o.key === k)) { chooseKey(k); e.preventDefault(); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (s.mode === 'practice' && q.type === 'multiple' && !s.submitted[q.seq] && (s.picks[q.seq] || []).length) submitPractice();
      else nextQuestion();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuestion(); return; }
    if (key === 'F') { toggleFav(q.uid); return; }
    if (key === 'M' && s.mode === 'exam') markCurrent();
  });

  // ---------------- boot ----------------

  (async function boot() {
    try {
      if (state.view === 'quiz' && state.session) await loadBank(state.session.bankId);
      if (state.view === 'config' && state.configDraft.bankId) await loadBank(state.configDraft.bankId);
      if (state.view === 'result' && state.lastResult) await loadBank(state.lastResult.bankId);
      if (['wrong', 'fav', 'stats'].includes(state.view)) await loadAll();
    } catch (e) {
      state.session = null;
      if (state.view === 'quiz') state.view = 'home';
    }
    render();
  })();
})();
