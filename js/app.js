/* 核心：共享命名空间、标签页、轻提示、语料加载与解析、大模型 API、全书宏观分析 */
window.SW = (() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- 轻提示 ---------- */
  const toastEl = $('#toast');
  let toastTimer = null;

  function notify(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2400);
  }

  /* ---------- 标签页 ---------- */
  const tabs = $$('.tab');
  const panels = $$('.panel');
  const tabHooks = [];

  function activateTab(name) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.hidden = !active;
      if (active) {
        panel.classList.remove('anim-in');
        void panel.offsetWidth;
        panel.classList.add('anim-in');
      }
    });

    tabHooks.forEach((fn) => fn(name));
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

  activateTab('story');

  /* ---------- 语料解析 ----------
     约定：`## 区块` 下的 `### 名称`
       - 后面跟纯文本行  -> 该区块的一个字段
       - 后面跟 `- 键：值` -> 一个条目（人物档案式）
  */
  function parseCorpus(src) {
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let section = null;
    let item = null;

    const closeItem = () => {
      if (item && section) section.items.push(item);
      item = null;
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^#\s/.test(line) || /^>/.test(line)) continue;

      if (/^##\s/.test(line)) {
        closeItem();
        section = { title: line.replace(/^##\s+/, ''), items: [], bullets: [], fields: {}, entries: [] };
        sections.push(section);
        continue;
      }

      if (/^###\s/.test(line)) {
        closeItem();
        item = { name: line.replace(/^###\s+/, ''), lines: [] };
        continue;
      }

      if (!section) continue;
      (item ? item.lines : section.bullets).push(line);
    }
    closeItem();

    sections.forEach((s) => {
      s.items.forEach((it) => {
        const bullets = it.lines.filter((l) => /^[-*]\s+/.test(l));
        if (bullets.length) {
          const fields = {};
          bullets.forEach((l) => {
            const body = l.replace(/^[-*]\s+/, '');
            const m = body.match(/^([^：:]+)[：:]\s*(.*)$/);
            if (m) fields[m[1].trim()] = m[2].trim();
          });
          s.entries.push({ name: it.name, fields });
        } else {
          s.fields[it.name] = { text: it.lines.join('\n').trim(), lines: it.lines };
        }
      });
    });

    return {
      sections,
      section: (prefix) => sections.find((s) => s.title.startsWith(prefix)) || null,
      sectionsLike: (prefix) => sections.filter((s) => s.title.startsWith(prefix))
    };
  }

  /* ---------- 语料加载 ---------- */
  let corpus = null;
  const readyHooks = [];
  const statusEl = $('#corpus-status');

  async function loadCorpus() {
    try {
      const res = await fetch('./mock-data.md', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      corpus = parseCorpus(await res.text());

      const excerpts = corpus.sectionsLike('片段');
      statusEl.textContent = `mock-data.md 已载入：${excerpts.length} 段范文 · ${corpus.section('人物档案').entries.length} 份档案 · ${corpus.section('人物关系').bullets.length} 条关系`;

      readyHooks.forEach((fn) => fn(corpus));
    } catch (err) {
      statusEl.textContent = `语料载入失败（${err.message}）：请通过 http://localhost:3000 打开`;
      notify('语料载入失败，请检查 mock-data.md');
    }
  }

  loadCorpus();

  /* ---------- 大模型 API（硅基流动） ---------- */
  const LLM_URL = 'https://api.siliconflow.cn/v1/chat/completions';
  const LLM_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
  const KEY_NAME = 'sw_llm_api_key';
  const LLM_TIMEOUT_MS = 60000;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readKey() {
    try {
      return (localStorage.getItem(KEY_NAME) || '').trim();
    } catch (err) {
      return '';
    }
  }

  function writeKey(value) {
    try {
      if (value) localStorage.setItem(KEY_NAME, value.trim());
      else localStorage.removeItem(KEY_NAME);
    } catch (err) {
      notify('浏览器禁止了 localStorage，Key 无法保存');
    }
  }

  function hasLLMKey() {
    return readKey().length > 0;
  }

  /* 宽容解析模型返回的 JSON：直接 JSON / ```json 代码块 / 首尾花括号截取 */
  function parseLLMObject(content, keys) {
    let obj = null;
    try {
      obj = JSON.parse(content);
    } catch (err) {
      const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) {
        try { obj = JSON.parse(fence[1]); } catch (e2) { /* 继续尝试截取 */ }
      }
      if (!obj) {
        const first = content.indexOf('{');
        const last = content.lastIndexOf('}');
        if (first >= 0 && last > first) {
          try { obj = JSON.parse(content.slice(first, last + 1)); } catch (e3) { /* 放弃 */ }
        }
      }
    }

    const dims = {};
    let strict = false;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      let filled = 0;
      keys.forEach((key) => {
        if (typeof obj[key] === 'string' && obj[key].trim()) {
          dims[key] = obj[key].trim();
          filled += 1;
        }
      });
      strict = filled > 0;
    }
    if (!strict) dims[keys[0]] = content.trim() || '（模型未返回内容）';
    return { dims, strict };
  }

  /* 公共请求：发往硅基流动，负责超时与错误语义化；opts.json === false 时不要求 JSON 输出 */
  async function requestLLM(messages, opts) {
    const key = readKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(LLM_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          ...(opts && opts.json === false ? {} : { response_format: { type: 'json_object' } })
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('请求超时（超过 60 秒），请稍后重试');
      }
      throw new Error('网络请求失败：可能是浏览器跨域（CORS）拦截或网络不通。请按 F12 打开控制台查看具体报错。');
    }
    clearTimeout(timer);

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = (body && body.error && body.error.message) || (body && body.message) || '';
      } catch (err) { /* 忽略响应体解析失败 */ }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`API Key 无效或无权限（HTTP ${res.status}）${detail ? '：' + detail : ''}。请点击右上角 ⚙️ 检查 Key。`);
      }
      if (res.status === 429) {
        throw new Error('请求过于频繁或账户额度不足（HTTP 429），请稍后再试。');
      }
      if (res.status === 400) {
        throw new Error(`请求参数错误（HTTP 400）${detail ? '：' + detail : ''}。`);
      }
      throw new Error(`大模型服务返回错误（HTTP ${res.status}）${detail ? '：' + detail : ''}。`);
    }

    try {
      return await res.json();
    } catch (err) {
      throw new Error('大模型返回内容无法解析为 JSON。');
    }
  }

  /* ---------- 片段四层解析 ---------- */
  const SYSTEM_PROMPT =
    '你是一位资深的文学评论家。请对以下小说片段进行四层心理分析，严格按 JSON 格式返回：' +
    '{ "表层情绪": "...", "深层动机": "...", "潜台词": "...", "心理防御机制": "..." }。' +
    '只输出 JSON 对象本身，不要输出任何解释、代码块标记或额外文字。';

  async function callLLM(prompt) {
    if (!hasLLMKey()) {
      const local = window.SW && window.SW.analyzeLocal;
      if (!local) throw new Error('本地分析器未就绪，请刷新页面');
      return local(prompt);
    }

    const payload = await requestLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]);

    const content =
      (payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
    const { dims, strict } = parseLLMObject(content, ['表层情绪', '深层动机', '潜台词', '心理防御机制']);
    const model = payload.model || LLM_MODEL;
    const tokens = payload.usage && payload.usage.total_tokens != null ? payload.usage.total_tokens : '—';

    return {
      mode: '大模型',
      title: `大模型解析 · ${model.split('/').pop()}`,
      quote: prompt,
      dims,
      foot: `模型：${model} · tokens ${tokens}${strict ? '' : ' · 模型未按 JSON 返回，已原样显示'}`
    };
  }

  /* ---------- 全书宏观分析 ---------- */
  const MACRO_SYSTEM_PROMPT =
    '你是一位资深的文学编辑。请阅读以下小说开头片段，推测整本书的风格、可能的核心人物特征和情感基调。' +
    '严格按 JSON 格式返回：{ "核心人物": "...", "情感基调": "...", "剧情推测": "..." }。' +
    '只输出 JSON 对象本身，不要输出任何解释、代码块标记或额外文字。';
  const MACRO_HEAD_CHARS = 3000;

  const MACRO_LOCAL_FIELDS = {
    核心人物群像:
      '开篇 3000 字内即完成主要人物的初次亮相：人物关系围绕一条核心冲突轴组织，主角夹在情感与身份的缝隙之间，配角各执一词，构成互相牵制的群像结构。' +
      '从称谓与对话节奏看，作者在有意铺垫一场“信任的坍塌”，主要人物大概率会在中段完成立场反转。',
    全书情感基调:
      '整体以克制的忧伤打底，间以反讽式的温情。叙述者与人物保持着有分寸的距离，情绪通过物件与天气外化（信、雨、药碗一类的意象反复出现），' +
      '暗示结局将是一场带着体面的告别，而不是大团圆。',
    核心冲突爆发点:
      '冲突的引线埋在身份与情感的错位上：表面的争端是关系中的去留，真正的引爆点是对“真实身份 / 真实心意”的一次证伪。' +
      '按长篇叙事的惯常节奏，这一爆发点约在全书三分之二处，此后人物进入清算与重建阶段。'
  };

  async function callMacroLLM(meta) {
    const title = `全书宏观分析 · ${meta.name}（${meta.sizeLabel}）`;

    if (!hasLLMKey()) {
      await delay(2000);
      return {
        mode: '全书解析',
        title,
        macro: { ...MACRO_LOCAL_FIELDS },
        foot: `本地模拟 · 已提取开头 ${meta.head.length} 字 · 接入 API Key 后将由大模型真实推断`
      };
    }

    const payload = await requestLLM([
      { role: 'system', content: MACRO_SYSTEM_PROMPT },
      { role: 'user', content: meta.head }
    ]);

    const content =
      (payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
    const { dims, strict } = parseLLMObject(content, ['核心人物', '情感基调', '剧情推测']);
    const model = payload.model || LLM_MODEL;
    const tokens = payload.usage && payload.usage.total_tokens != null ? payload.usage.total_tokens : '—';

    return {
      mode: '全书解析',
      title,
      macro: dims,
      foot: `模型：${model} · tokens ${tokens} · 上下文：开头 ${meta.head.length} 字${strict ? '' : ' · 模型未按 JSON 返回，已原样显示'}`
    };
  }

  /* ---------- 章节切分 ---------- */
  const CHAPTER_TITLE_RE =
    /(^|\n)[ \t]*((?:第[零〇一二三四五六七八九十百千万\d]{1,10}[章回节卷]|楔子|序章|番外)[^\n\r]{0,40})/g;
  const CHUNK_SPLIT_SIZE = 5000;
  const MIN_CHAPTER_CHARS = 40;

  /* 按“第X章”标题切分全书；没有标题则每 5000 字切一个片段。
     返回 { kind: '章节'|'片段', list: [{id, label, text, chars, sizeLabel}] } */
  function extractChapters(text) {
    const src = String(text || '');
    const matches = [];
    let m;
    CHAPTER_TITLE_RE.lastIndex = 0;
    while ((m = CHAPTER_TITLE_RE.exec(src))) {
      matches.push({ start: m.index + m[1].length, title: m[2].trim() });
    }

    const make = (start, end, label, id) => {
      const body = src.slice(start, end);
      const chars = body.replace(/\s/g, '').length;
      return {
        id,
        label,
        text: body,
        chars,
        sizeLabel: chars >= 10000 ? `${(chars / 10000).toFixed(1)} 万字` : `${chars} 字`
      };
    };

    if (matches.length) {
      const list = [];
      const preface = src.slice(0, matches[0].start);
      if (preface.replace(/\s/g, '').length >= MIN_CHAPTER_CHARS) {
        list.push(make(0, matches[0].start, '开篇 · 正文前内容', 1));
      }
      let id = list.length;
      for (let i = 0; i < matches.length; i += 1) {
        const end = i + 1 < matches.length ? matches[i + 1].start : src.length;
        id += 1;
        const chapter = make(matches[i].start, end, matches[i].title, id);
        if (chapter.chars >= MIN_CHAPTER_CHARS) list.push(chapter); // 过滤目录等噪声行
      }
      if (list.length) return { kind: '章节', list };
    }

    const list = [];
    for (let i = 0, k = 1; i < src.length; i += CHUNK_SPLIT_SIZE, k += 1) {
      list.push(make(i, Math.min(i + CHUNK_SPLIT_SIZE, src.length), `片段 ${k}`, k));
    }
    return { kind: '片段', list };
  }

  /* ---------- 单章深度解析 ---------- */
  const CHAPTER_HEAD_CHARS = 3000;
  const CHAPTER_SYSTEM_PROMPT =
    '你是一个资深文学分析师。请深入分析以下小说章节。必须按以下结构输出（不要返回 JSON，直接返回纯文本，用 markdown 格式分段）：\n' +
    '【时间地点】\n' +
    '【核心事件】（详细描述人物的行动和冲突）\n' +
    '【关键信息】（总结本章埋下的伏笔、人物关系的转折）\n' +
    '在分析的最后，另起一行输出一段 JSON 数据（用于读者端更新阅读状态，不要加代码块标记或任何解释）：\n' +
    '{"chapter": "本章标题", "emotion_score": 主角情感指数, "protagonist_name": "主角姓名", "new_clues": "本章揭示的人物新特征或关系进展（一句话）", "relationship": "本章主角与他人的关系变化（一句话）"}\n' +
    '其中 emotion_score 是主角在本章的情感指数，区间 -100（绝望）到 100（狂喜），必须是有明显变化的整数。';

  const CHAPTER_LOCAL_MOCK = `【时间地点】
时间：除夕夜。

【核心事件】
姜枣半夜趁郑嘉林睡着出门见黄乐怡。郑嘉林追出来，问“要去哪儿？”
郑嘉林说“我听见了一些闲话”“我以为这次你会跟我说”。姜枣说“我不能喜欢你”（外婆的阴影）。
郑嘉林说“你心里有鬼就会变得反常，特别乖，特别主动，特别像是在补偿我”。姜枣问“还能在一起吗？”郑嘉林说“当然啊，只要你允许我靠近，我会一直选择和你在一起”。
两人去饭店见黄乐怡。郑嘉林说“是我追的她，我死缠烂打不想放手”。黄乐怡说“我总要尊重我妈的意思”——赵蓝天临终前嘱咐黄乐怡“体谅”。
黄乐怡说“她让我体谅，我当时没听懂。直到那个晚上，我看见你们在楼下接吻”。黄乐怡默许。

【关键信息】
郑嘉林追出门（不再逃跑）；黄乐怡揭示赵蓝天的遗愿（外婆早已接受）；家庭线收束。`;

  async function callChapterLLM(chapter, meta) {
    const head = (chapter.text || '').slice(0, CHAPTER_HEAD_CHARS);
    const title = `章节深度解析 · ${chapter.label}`;

    if (!hasLLMKey()) {
      await delay(2000);
      const preset = LOCAL_READING_STATES[readingCursor % LOCAL_READING_STATES.length];
      readingCursor += 1;
      return {
        mode: '章节解析',
        title,
        body: CHAPTER_LOCAL_MOCK,
        state: {
          chapter: chapter.label,
          emotion_score: preset.emotion_score,
          protagonist_name: preset.protagonist_name,
          new_clues: preset.new_clues,
          relationship: preset.relationship
        },
        foot: `本地模拟 · 示例内容取自第63章（除夕夜） · 本章 ${chapter.sizeLabel}，发送开头 ${head.length} 字 · 接入 API Key 后将由大模型真实解析`
      };
    }

    const payload = await requestLLM(
      [
        { role: 'system', content: CHAPTER_SYSTEM_PROMPT },
        { role: 'user', content: `小说：${meta.name}\n章节：${chapter.label}\n\n${head}` }
      ],
      { json: false }
    );

    const content =
      (payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
    if (!content.trim()) throw new Error('模型未返回内容，请重试');
    const model = payload.model || LLM_MODEL;
    const tokens = payload.usage && payload.usage.total_tokens != null ? payload.usage.total_tokens : '—';

    /* 提取末尾的状态 JSON，并从正文中剥离，避免原样渲染到解析卡片 */
    const { obj, span } = extractJsonFromText(content);
    let body = content.trim();
    if (span) body = (content.slice(0, span.start) + content.slice(span.end)).trim();

    return {
      mode: '大模型',
      title,
      body,
      state: obj,
      foot: `模型：${model} · tokens ${tokens} · 本章 ${chapter.sizeLabel}，发送开头 ${head.length} 字${obj ? '' : ' · 模型未返回状态 JSON，仅渲染文本解析'}`
    };
  }

  /* ---------- 逐章增量：把单章解析的状态 JSON 追加到全局阅读状态 ---------- */
  function normalizeChapterState(state, chapterLabel) {
    if (!state || typeof state !== 'object') return null;
    const chapter =
      typeof state.chapter === 'string' && state.chapter.trim()
        ? state.chapter.trim()
        : chapterLabel || `第${readingState.analyzedChapters.length + 1}章`;
    const name =
      typeof state.protagonist_name === 'string' && state.protagonist_name.trim()
        ? state.protagonist_name.trim()
        : '主角';
    return {
      chapter,
      emotion_score: clampScore(state.emotion_score),
      protagonist_name: name,
      new_clues: typeof state.new_clues === 'string' ? state.new_clues.trim() : '',
      relationship: typeof state.relationship === 'string' ? state.relationship.trim() : ''
    };
  }

  function applyChapterUpdate(state, chapterLabel) {
    const item = normalizeChapterState(state, chapterLabel);
    if (!item) {
      notify('本章状态更新失败：模型未返回 JSON 数据，图表与档案本次不生长');
      return false;
    }
    if (readingState.analyzedChapters.some((c) => c.chapter === item.chapter)) {
      notify(`「${item.chapter}」已经分析过，图表不重复追加`);
      return false;
    }

    readingState.analyzedChapters.push(item);
    readingState.emotionData.push({ chapter: item.chapter, score: item.emotion_score });

    const prof =
      readingState.characterProfiles[item.protagonist_name] ||
      (readingState.characterProfiles[item.protagonist_name] = { clues: [], relationships: [] });
    if (item.new_clues) prof.clues.push({ chapter: item.chapter, text: item.new_clues });
    if (item.relationship) prof.relationships.push({ chapter: item.chapter, text: item.relationship });

    fireReadingUpdate('chapter-update');
    return true;
  }

  /* ---------- 小说文件解析 ---------- */
  const MAX_NOVEL_BYTES = 2 * 1024 * 1024;

  /* 中文 txt 常见 GBK/GB18030 编码；先按 UTF-8 解，替换符多于 GBK 解时改用 GBK */
  function decodeNovel(buf) {
    const utf8 = new TextDecoder('utf-8').decode(buf);
    let gbk = null;
    try {
      gbk = new TextDecoder('gbk').decode(buf);
    } catch (err) { /* 浏览器不支持 gbk 解码，退回 utf-8 */ }
    if (gbk === null) return utf8;
    const bad = (s) => (s.match(/\uFFFD/g) || []).length;
    return bad(gbk) < bad(utf8) ? gbk : utf8;
  }

  function parseNovelFile(file) {
    return new Promise((resolve, reject) => {
      const name = (file && file.name) || '';
      if (!/\.txt$/i.test(name) || file.size > MAX_NOVEL_BYTES) {
        reject(new Error('文件格式不支持或过大'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('文件读取失败，请重试'));
      reader.onload = () => {
        const text = decodeNovel(reader.result);
        const chars = text.replace(/\s/g, '').length;
        if (!chars) {
          reject(new Error('文件内容为空'));
          return;
        }
        const wan = (chars / 10000).toFixed(1);
        resolve({
          name,
          chars,
          wan,
          sizeLabel: chars >= 10000 ? `${wan} 万字` : `${chars} 字`,
          text,
          head: text.slice(0, MACRO_HEAD_CHARS)
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------- 全局小说状态与跨面板联动 ---------- */
  let currentNovel = null;
  let currentProfile = null;
  let profileBusy = false;
  const novelHooks = [];
  const profileHooks = [];
  const profileLoadingHooks = [];
  const profileErrorHooks = [];

  /* ---------- 逐章增量阅读状态（v0.7）：看一章、长一章 ---------- */
  const readingState = {
    analyzedChapters: [], // [{chapter, emotion_score, protagonist_name, new_clues, relationship}]
    characterProfiles: {}, // { 名字: { clues: [{chapter,text}], relationships: [{chapter,text}] } }
    emotionData: [] // [{chapter, score}]
  };
  const readingHooks = [];

  const LOCAL_READING_STATES = [
    { emotion_score: 12, protagonist_name: '主角', new_clues: '主角初登场，行事谨慎，对陌生环境保持警惕', relationship: '与反派初次交锋，彼此不知底细' },
    { emotion_score: 28, protagonist_name: '主角', new_clues: '主角显露执念，对旧事念念不忘，情绪持续上扬', relationship: '对反派生出好奇，敌意略有松动' },
    { emotion_score: 46, protagonist_name: '主角', new_clues: '主角获得关键线索，信心大增，行动变得果断', relationship: '与反派短暂联手，彼此仍有保留' },
    { emotion_score: -18, protagonist_name: '主角', new_clues: '主角遭遇背叛，信念受到冲击，开始怀疑身边人', relationship: '与反派彻底决裂，冲突公开化' },
    { emotion_score: -42, protagonist_name: '主角', new_clues: '主角跌入谷底，一度想要放弃目标', relationship: '反派步步紧逼，双方矛盾激化' },
    { emotion_score: 35, protagonist_name: '主角', new_clues: '主角重燃斗志，决定反击', relationship: '与反派迎来正面对决' }
  ];
  let readingCursor = 0;

  function resetReadingState() {
    readingState.analyzedChapters = [];
    readingState.characterProfiles = {};
    readingState.emotionData = [];
    readingCursor = 0;
  }

  function fireReadingUpdate(source) {
    readingHooks.forEach((fn) =>
      fn({
        novelName: currentNovel ? currentNovel.name : '',
        total: currentNovel ? currentNovel.chapterCount : 0,
        analyzedChapters: readingState.analyzedChapters.slice(),
        characterProfiles: readingState.characterProfiles,
        emotionData: readingState.emotionData.slice(),
        source
      })
    );
  }

  const PROFILE_HEAD_CHARS = 3000;
  const PROFILE_SYSTEM_PROMPT =
    '你是一个文学数据提取器。请阅读该小说开头。提取出 2 个核心人物（1主角，1反派）。并根据剧情推测，给出这 2 个人物在 6 个章节的情感指数（区间 -100 到 100）。' +
    '注意：情感指数应随章节有明显起伏，避免出现全部为 0 或数值雷同的情况；如果小说中没有传统意义的反派，请选择与主角立场或情感冲突最深的角色作为反派。' +
    '必须输出严格的 JSON 格式：\n' +
    '{ "characters": ["主角名", "反派名"], "emotion_curve": [ {"chapter": "第1章", "protagonist_score": 20, "villain_score": -10, "stage": "初识"} ], "relationship_summary": "一句话总结主角和反派的关系" }\n' +
    '要求 emotion_curve 恰好包含 6 个章节的数据。只输出 JSON 对象本身，不要输出任何解释、代码块标记或额外文字。';

  const LOCAL_STAGES = ['初遇', '靠近', '升温', '决裂', '低谷', '转机'];
  const LOCAL_HERO = [15, 45, 70, -20, -35, 60];
  const LOCAL_RIVAL = [55, 30, -15, -60, -30, 25];

  /* 上传成功后写入全局状态：文件名 + 前 3 章内容（用于弧光/档案面板联动） */
  function setCurrentNovel(meta, chapters) {
    const list = (chapters && chapters.list) || [];
    const firstThreeChapters = list.slice(0, 3).map((c) => c.text).join('\n\n');
    currentNovel = {
      name: meta.name,
      sizeLabel: meta.sizeLabel,
      firstThreeChapters,
      head: firstThreeChapters.slice(0, PROFILE_HEAD_CHARS),
      chapterLabels: list.slice(0, 6).map((c) => c.label),
      chapterCount: list.length
    };
    if (currentProfile && currentProfile.novelName !== meta.name) currentProfile = null;
    resetReadingState();
    novelHooks.forEach((fn) => fn(currentNovel));
    fireReadingUpdate('novel-reset');
  }

  /* 平衡括号扫描：从混有 markdown 的文本里找出所有 {...} 候选片段（忽略字符串内的括号） */
  function extractJsonSpans(src) {
    const spans = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          spans.push({ start, end: i + 1, text: src.slice(start, i + 1) });
          start = -1;
        }
      }
    }
    return spans;
  }

  /* 宽容提取 JSON 对象：直接解析 → ```json 围栏 → 平衡括号扫描；附带对象在原文中的位置 */
  function extractJsonFromText(content) {
    const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const src = String(content || '');
    try {
      const obj = asObj(JSON.parse(src));
      if (obj) return { obj, span: null };
    } catch (err) { /* 继续尝试 */ }
    const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        const obj = asObj(JSON.parse(fence[1].trim()));
        if (obj) {
          const raw = fence[1];
          const lead = raw.length - raw.trimStart().length;
          const start = fence.index + fence[0].indexOf(raw) + lead;
          const text = raw.trim();
          return { obj, span: { start, end: start + text.length, text } };
        }
      } catch (err) { /* 继续尝试 */ }
    }
    const spans = extractJsonSpans(src);
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      try {
        const obj = asObj(JSON.parse(spans[i].text));
        if (obj) return { obj, span: spans[i] };
      } catch (err) { /* 继续尝试 */ }
    }
    return { obj: null, span: null };
  }

  function extractJsonObject(content) {
    return extractJsonFromText(content).obj;
  }

  const clampScore = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-100, Math.min(100, n));
  };

  function parseNovelProfile(content) {
    const obj = extractJsonObject(content);
    if (!obj) throw new Error('模型返回内容无法解析为 JSON（可能混入了其他文字），请重试');

    const names = (Array.isArray(obj.characters) ? obj.characters : [])
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .filter(Boolean);
    const hero = names[0] || '主角';
    const rival = names[1] || '反派';

    const raw = Array.isArray(obj.emotion_curve) ? obj.emotion_curve : [];
    const curve = raw.slice(0, 6).map((p, i) => {
      const point = p && typeof p === 'object' ? p : {};
      return {
        chapter:
          typeof point.chapter === 'string' && point.chapter.trim() ? point.chapter.trim() : `第${i + 1}章`,
        stage: typeof point.stage === 'string' && point.stage.trim() ? point.stage.trim() : '',
        hero: clampScore(point.protagonist_score),
        rival: clampScore(point.villain_score)
      };
    });
    if (curve.length < 2) throw new Error('模型返回的情感曲线数据不完整，请重试');
    while (curve.length < 6) {
      const i = curve.length;
      curve.push({ chapter: `第${i + 1}章`, stage: '', hero: 0, rival: 0 });
    }

    const summary =
      typeof obj.relationship_summary === 'string' && obj.relationship_summary.trim()
        ? obj.relationship_summary.trim()
        : '（模型未返回关系总结）';

    return { hero, rival, curve, summary };
  }

  /* 本地模拟：文件名驱动标题，人物用「主角/反派」占位，章节标签取真实切分结果 */
  function localNovelProfile(novel) {
    const chapters = [];
    for (let i = 0; i < 6; i += 1) {
      const label = novel.chapterLabels[i] || `第${i + 1}章`;
      chapters.push({
        chapter: label.length > 12 ? `${label.slice(0, 12)}…` : label,
        stage: LOCAL_STAGES[i],
        hero: LOCAL_HERO[i],
        rival: LOCAL_RIVAL[i]
      });
    }
    return {
      hero: '主角',
      rival: '反派',
      curve: chapters,
      summary: `主角与反派的立场冲突贯穿全书，两人在反复拉扯中走向最终对峙（本地模拟数据，接入 API Key 后将由大模型基于《${novel.name}》真实提取）`
    };
  }

  async function analyzeNovelGlobal(novel) {
    const title = `《${novel.name}》人物情感弧光`;

    if (!hasLLMKey()) {
      await delay(2000);
      const local = localNovelProfile(novel);
      return {
        novel: novel.name,
        mode: '本地模拟',
        title,
        hero: local.hero,
        rival: local.rival,
        curve: local.curve,
        summary: local.summary,
        foot: `本地模拟 · 基于《${novel.name}》前 3 章生成 · 接入 API Key 后将由大模型真实提取`
      };
    }

    const payload = await requestLLM([
      { role: 'system', content: PROFILE_SYSTEM_PROMPT },
      { role: 'user', content: `小说：《${novel.name}》\n\n开头内容：\n${novel.head}` }
    ]);

    const content =
      (payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
    const { hero, rival, curve, summary } = parseNovelProfile(content);
    const model = payload.model || LLM_MODEL;
    const tokens = payload.usage && payload.usage.total_tokens != null ? payload.usage.total_tokens : '—';

    return {
      novel: novel.name,
      mode: '大模型',
      title,
      hero,
      rival,
      curve,
      summary,
      foot: `模型：${model} · tokens ${tokens} · 上下文：开头 ${novel.head.length} 字`
    };
  }

  async function generateNovelProfile() {
    if (!currentNovel) {
      notify('请先在「剧情深度解析」面板上传一本小说');
      return;
    }
    if (profileBusy) {
      notify('正在生成分析，请稍候');
      return;
    }
    if (currentProfile && currentProfile.novelName === currentNovel.name) {
      profileHooks.forEach((fn) => fn(currentProfile.data));
      notify(`已应用上次生成的《${currentNovel.name}》分析`);
      return;
    }

    profileBusy = true;
    profileLoadingHooks.forEach((fn) => fn(true));
    try {
      const data = await analyzeNovelGlobal(currentNovel);
      resetReadingState();
      fireReadingUpdate('macro-reset');
      currentProfile = { novelName: currentNovel.name, data };
      profileHooks.forEach((fn) => fn(data));
      notify(data.mode === '大模型' ? '全书人物分析已生成，弧光与档案面板已同步' : '本地模拟人物分析已生成，弧光与档案面板已同步');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      profileErrorHooks.forEach((fn) => fn(msg));
    } finally {
      profileBusy = false;
      profileLoadingHooks.forEach((fn) => fn(false));
    }
  }

  /* ---------- API 设置 ---------- */
  const statusBtn = $('#model-status');
  const statusText = $('#model-status-text');
  const dialogEl = $('#settings-dialog');
  const formEl = $('#settings-form');
  const keyInput = $('#api-key-input');

  function updateModelStatus() {
    const on = hasLLMKey();
    statusBtn.classList.toggle('is-on', on);
    statusBtn.classList.toggle('is-off', !on);
    statusText.textContent = on ? '在线模型' : '本地模拟';
    statusBtn.title = on ? 'API Key 已配置，点击修改' : '未配置 API Key，当前为本地模拟，点击设置';
  }

  function openSettings() {
    keyInput.value = readKey();
    dialogEl.showModal();
  }

  $('#settings-btn').addEventListener('click', openSettings);
  statusBtn.addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => dialogEl.close());
  $('#settings-cancel').addEventListener('click', () => dialogEl.close());

  $('#settings-clear').addEventListener('click', () => {
    writeKey('');
    keyInput.value = '';
    updateModelStatus();
    notify('已清除 API Key，回退本地模拟');
    dialogEl.close();
  });

  formEl.addEventListener('submit', (e) => {
    const value = keyInput.value.trim();
    if (!value) {
      e.preventDefault();
      notify('请输入 API Key，或点击「清除 Key」回退本地模拟');
      keyInput.focus();
      return;
    }
    writeKey(value);
    updateModelStatus();
    notify('API Key 已保存，模式切换为在线模型');
  });

  updateModelStatus();

  return {
    $, $$, el, notify, parseCorpus,
    state: {},
    onTab: (fn) => tabHooks.push(fn),
    activateTab,
    onCorpus: (fn) => {
      if (corpus) fn(corpus);
      else readyHooks.push(fn);
    },
    callLLM,
    callMacroLLM,
    callChapterLLM,
    parseNovelFile,
    extractChapters,
    setCurrentNovel,
    generateNovelProfile,
    applyChapterUpdate,
    onNovelSet: (fn) => novelHooks.push(fn),
    onNovelProfile: (fn) => profileHooks.push(fn),
    onProfileLoading: (fn) => profileLoadingHooks.push(fn),
    onProfileError: (fn) => profileErrorHooks.push(fn),
    onReadingUpdate: (fn) => readingHooks.push(fn),
    hasLLMKey,
    updateModelStatus
  };
})();
