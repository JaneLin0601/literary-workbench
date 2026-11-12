/* 📖 剧情深度解析：语料范文匹配 + 文本信号泛化分析 */
(() => {
  'use strict';

  const { $, el, notify } = SW;

  const DIMS = ['表层情绪', '深层动机', '潜台词', '心理防御机制'];
  const FOCUS = { motive: '深层动机', subtext: '潜台词' };

  const inputEl = $('#story-input');
  const logEl = $('#result-log');
  const countEl = $('#story-count');
  const resultCountEl = $('#result-count');
  const topicsEl = $('#corpus-topics');
  const dropzoneEl = $('#dropzone');
  const novelFileEl = $('#novel-file');
  const novelInfoEl = $('#novel-info');
  const novelToolsEl = $('#novel-tools');
  const macroBtnEl = $('#macro-btn');
  const chaptersBtnEl = $('#chapters-btn');
  const chapterPickerEl = $('#chapter-picker');
  const chapterSelectEl = $('#chapter-select');
  const chapterAnalyzeBtnEl = $('#chapter-analyze-btn');
  const chapterHintEl = $('#chapter-hint');

  let excerpts = [];
  let results = 0;

  /* ---------- 语料 ---------- */
  function fieldText(section, name) {
    return (section.fields[name] || {}).text || '';
  }

  function buildExcerpts(corpus) {
    excerpts = corpus.sectionsLike('片段').map((s) => ({
      title: s.title.replace(/^片段[一二三四五六七八九十]+：/, ''),
      label: s.title,
      person: fieldText(s, '人物'),
      quote: fieldText(s, '原文'),
      keywords: fieldText(s, '关键词').split(/[,，、\s]+/).filter(Boolean),
      dims: DIMS.reduce((acc, d) => {
        acc[d] = fieldText(s, d);
        return acc;
      }, {})
    }));

    topicsEl.textContent = '';
    excerpts.forEach((e) => {
      const chip = el('button', 'chip', e.title);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        inputEl.value = e.quote;
        refreshCount();
        inputEl.focus();
        notify('已载入示例片段');
      });
      topicsEl.append(chip);
    });
  }

  function matchExcerpt(text) {
    let best = null;
    let bestScore = 0;
    let hits = [];

    excerpts.forEach((e) => {
      const found = e.keywords.filter((k) => k && text.includes(k));
      const score = found.length + (e.person && text.includes(e.person) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
        hits = found;
      }
    });

    return { best, score: bestScore, hits };
  }

  /* ---------- 文本信号 ---------- */
  function signals(text) {
    const count = (re) => (text.match(re) || []).length;
    return {
      sentences: text.split(/[。！？!?…；;\n]+/).map((s) => s.trim()).filter(Boolean).length,
      chars: text.replace(/\s/g, '').length,
      questions: count(/[？?]/g),
      pauses: count(/[…]|——|\.\.\./g),
      negations: count(/不|没|别|无|非/g),
      first: count(/我|臣妾|咱|自己/g),
      second: count(/你|您|皇上|陛下/g),
      absolutes: count(/从来|永远|一切|所有|根本|彻底/g),
      emotion: count(/爱|恨|怕|悔|疼|累|罢了|算了|可惜|值得|甘心/g),
      quoted: count(/[“"][^”"]*[”"]/g),
      maxims: count(/失去.*失去|宁可.*也不|不是.*而是|与其.*不如/g)
    };
  }

  function genericAnalysis(text) {
    const s = signals(text);

    let tone = '表面平静';
    if (s.pauses && s.negations) tone = '欲言又止的压抑';
    else if (s.absolutes) tone = '决绝';
    else if (s.questions && s.negations) tone = '克制的焦躁';
    else if (s.pauses) tone = '未说完的迟疑';

    const 表层情绪 = `全段 ${s.sentences} 句、${s.chars} 字，出现 ${s.questions} 处问句、${s.negations} 处否定、${s.pauses} 处省略或破折。情绪外壳偏「${tone}」：说出来的部分被收拾得很整齐，越整齐越说明底下有东西在顶着。`;

    let 深层动机;
    if (s.second > s.first * 1.5) {
      深层动机 = `叙述重心压在对方身上（第二人称 ${s.second} 次，第一人称 ${s.first} 次）。他要的不是信息，而是一个确认——确认自己对那个人仍然重要，或者仍然有威胁。`;
    } else if (s.first > s.second * 1.5) {
      深层动机 = `自我指涉密集（第一人称 ${s.first} 次）。这是一段用来重建掌控感的独白：把已经失控的遭遇，重新叙述成自己选择的结局。`;
    } else {
      深层动机 = `人称分布均衡（我 ${s.first} / 你 ${s.second}），动机更接近"被听见"而不是"被满足"：他在试探对方还在不在场。`;
    }

    let 潜台词;
    if (s.pauses) {
      const 引语 = s.quoted
        ? `${s.quoted} 处直接引语里，说出口的部分越完整，越说明没说出口的那半句更重。`
        : '全段没有直接引语，这段是只说给自己听的独白：真正的话一旦出声就收不回来。';
      潜台词 = `${s.pauses} 处省略号或破折号，真正的话被留在了句子中间。${引语}`;
    } else if (s.questions) {
      潜台词 = `${s.questions} 个问句没有一个是真的在提问，它们是指控的委婉形式。问号在这里代替了"你怎么敢"。`;
    } else if (s.maxims) {
      潜台词 = `出现了格言式对偶句。把处境压缩成可以背诵的句子，本身就是一种立场声明：他已经在为自己的行为准备辩护词。`;
    } else {
      潜台词 = `句式完整、没有停顿标记，说明情绪已经被整理过一遍。整理过的语言里，潜台词不在词里，在被删掉的那部分。`;
    }

    let 心理防御机制;
    if (s.absolutes) {
      心理防御机制 = `合理化叠加泛化：${s.absolutes} 处「从来／永远／一切／根本」把一次具体的受伤，扩展成对整个人格的判决。普遍结论更好承受，具体疼痛才真正要命。`;
    } else if (s.negations >= 3) {
      心理防御机制 = `否认与情感隔离：${s.negations} 处高频否定通常不是在拒绝事实，而是在拒绝承认事实对自己造成的影响——知道，但不让它进到心里。`;
    } else if (s.maxims) {
      心理防御机制 = `理智化：用抽象命题替代情绪体验。说出漂亮句子的那一刻，痛苦被转交给了语言本身。`;
    } else {
      心理防御机制 = `克制与升华的雏形：情绪被转写成可叙述的材料。${s.emotion} 处情感词没有直接呼号，而是被安放在句子的次要位置上。`;
    }

    return {
      title: '泛化分析（未命中语料范文）',
      quote: '',
      dims: { 表层情绪, 深层动机, 潜台词, 心理防御机制 },
      foot: `文本信号：问句 ${s.questions} · 否定 ${s.negations} · 省略 ${s.pauses} · 绝对化 ${s.absolutes} · 引语 ${s.quoted}`
    };
  }

  /* ---------- 本地分析（无 Key 时的回退路径） ---------- */
  function analyzeLocal(text) {
    const { best, score, hits } = matchExcerpt(text);
    if (score >= 2 && best) {
      return {
        mode: '语料范文',
        title: best.label,
        quote: best.quote,
        dims: best.dims,
        foot: `命中关键词：${hits.join('、')} · 匹配度 ${score}/${best.keywords.length + 1} · 分析人物：${best.person}`
      };
    }
    return { mode: '文本信号', ...genericAnalysis(text) };
  }

  SW.analyzeLocal = analyzeLocal;

  /* ---------- 渲染 ---------- */
  function renderCard(data, focusDim) {
    const card = el('div', data.mode === '大模型' ? 'analysis-card is-llm' : 'analysis-card');

    const head = el('div', 'analysis-head');
    head.append(el('span', 'analysis-title', data.title));
    head.append(el('span', 'analysis-mode', data.mode || '文本信号'));
    card.append(head);

    if (data.quote) card.append(el('p', 'analysis-quote', data.quote));

    DIMS.forEach((dim) => {
      const row = el('div', dim === focusDim ? 'dim is-focus' : 'dim');
      row.append(el('span', 'dim-tag', dim));
      row.append(el('div', 'dim-body', data.dims[dim] || '（模型未返回该维度）'));
      card.append(row);
    });

    if (data.foot) card.append(el('p', 'analysis-foot', data.foot));
    return card;
  }

  function appendResultItem(node, note) {
    $('.empty-hint', logEl)?.remove();
    const wrap = el('div', 'result-item');
    wrap.append(node);
    logEl.append(wrap);
    logEl.scrollTop = logEl.scrollHeight;
    results += 1;
    resultCountEl.textContent = `${results} 条`;
    if (note) notify(note);
  }

  function appendResult(data, focusDim, note) {
    appendResultItem(renderCard(data, focusDim), note);
  }

  function renderLoadingCard(text, hint) {
    const card = el('div', 'analysis-card is-loading');
    const row = el('div', 'loading-row');
    row.append(el('span', 'spinner'));
    row.append(el('span', null, text || '正在通过大模型深度解析...'));
    card.append(row);
    card.append(el('p', 'loading-hint', hint || '模型：Qwen/Qwen2.5-7B-Instruct · 通常需要几秒到二十秒'));
    return card;
  }

  function renderErrorCard(message) {
    const card = el('div', 'analysis-card is-error');
    const head = el('div', 'analysis-head');
    head.append(el('span', 'analysis-title', '解析失败'));
    head.append(el('span', 'analysis-mode', '大模型'));
    card.append(head);
    card.append(el('p', 'error-msg', message));
    return card;
  }

  let busy = false;

  async function analyze(focusDim) {
    const text = inputEl.value.trim();
    if (text.length < 10) {
      notify('请先粘贴一段小说片段（至少 10 字）');
      return;
    }
    if (busy) {
      notify('正在解析中，请稍候');
      return;
    }
    busy = true;

    const useLLM = SW.hasLLMKey();
    const loading = useLLM ? renderLoadingCard() : null;
    if (loading) {
      $('.empty-hint', logEl)?.remove();
      logEl.append(loading);
      logEl.scrollTop = logEl.scrollHeight;
    }

    try {
      const data = await SW.callLLM(text);
      if (loading) loading.remove();
      const note =
        data.mode === '大模型' ? '大模型解析完成'
          : data.mode === '语料范文' ? '匹配到语料范文'
            : '未命中范文，已按文本信号生成分析';
      appendResult(data, focusDim, note);
    } catch (err) {
      if (loading) loading.remove();
      const card = renderErrorCard(err && err.message ? err.message : String(err));
      logEl.append(card);
      logEl.scrollTop = logEl.scrollHeight;
      notify('解析失败，详见卡片说明');
    } finally {
      busy = false;
    }
  }

  function refreshCount() {
    const n = inputEl.value.replace(/\s/g, '').length;
    countEl.textContent = `${n} 字`;
  }

  /* ---------- 全书宏观分析与章节解析 ---------- */
  let novelBusy = false;
  let chapterBusy = false;
  let novelState = null; // { meta, chapters: { kind, list } }

  function renderMacroCard(data) {
    const card = el('div', 'analysis-card is-macro');

    const head = el('div', 'analysis-head');
    head.append(el('span', 'analysis-title', data.title));
    head.append(el('span', 'analysis-mode', '全书解析'));
    card.append(head);

    Object.entries(data.macro).forEach(([key, value]) => {
      const row = el('div', 'macro-row');
      row.append(el('span', 'macro-key', key));
      row.append(el('div', 'dim-body', value || '（模型未返回该内容）'));
      card.append(row);
    });

    if (data.foot) card.append(el('p', 'analysis-foot', data.foot));
    return card;
  }

  /* 轻量 markdown：转义 → 【标题】/ # 标题 / 列表 / 段落 / **加粗** */
  function renderMarkdownLite(raw) {
    const esc = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bold = (s) => s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const root = el('div', 'chapter-body');
    let list = null;
    const flushList = () => { list = null; };

    String(raw || '').split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        return;
      }

      const hashHead = line.match(/^#{1,4}\s+(.*)$/);
      const secHead = line.match(/^【([^】]+)】(.*)$/);
      if (hashHead || secHead) {
        flushList();
        const h = el('h4', 'chapter-sec', hashHead ? hashHead[1] : `【${secHead[1]}】`);
        root.append(h);
        const rest = secHead ? secHead[2].trim() : '';
        if (rest) {
          const p = el('p');
          p.innerHTML = bold(esc(rest));
          root.append(p);
        }
        return;
      }

      if (/^[-*•]\s+/.test(line)) {
        if (!list) {
          list = el('ul');
          root.append(list);
        }
        const li = el('li');
        li.innerHTML = bold(esc(line.replace(/^[-*•]\s+/, '')));
        list.append(li);
        return;
      }

      flushList();
      const p = el('p');
      p.innerHTML = bold(esc(line));
      root.append(p);
    });

    return root;
  }

  function renderChapterCard(data) {
    const card = el(
      'div',
      data.mode === '大模型' ? 'analysis-card is-chapter is-llm' : 'analysis-card is-chapter'
    );

    const head = el('div', 'analysis-head');
    head.append(el('span', 'analysis-title', data.title));
    head.append(el('span', 'analysis-mode', '章节解析'));
    card.append(head);

    card.append(renderMarkdownLite(data.body));

    if (data.foot) card.append(el('p', 'analysis-foot', data.foot));
    return card;
  }

  function currentChapter() {
    if (!novelState) return null;
    const id = Number(chapterSelectEl.value);
    return novelState.chapters.list.find((c) => c.id === id) || novelState.chapters.list[0];
  }

  function updateChapterHint() {
    const ch = currentChapter();
    chapterHintEl.textContent = ch
      ? `本章 ${ch.sizeLabel} · 解析时发送开头 ${Math.min(ch.text.length, 3000)} 字给大模型`
      : '';
  }

  async function handleNovelFile(file) {
    if (novelBusy) {
      notify('正在处理上一本小说，请稍候');
      return;
    }
    novelBusy = true;

    let meta;
    try {
      meta = await SW.parseNovelFile(file);
    } catch (err) {
      novelBusy = false;
      notify(err && err.message ? err.message : '文件格式不支持或过大');
      return;
    }

    const t0 = performance.now();
    novelState = { meta, chapters: SW.extractChapters(meta.text) };
    const splitMs = Math.round(performance.now() - t0);
    const { kind, list } = novelState.chapters;
    SW.setCurrentNovel(meta, novelState.chapters);

    inputEl.value = '';
    refreshCount();
    novelInfoEl.textContent = `已加载：${meta.name}（${meta.sizeLabel} · 检出 ${list.length} ${kind}）`;
    novelInfoEl.hidden = false;
    novelToolsEl.hidden = false;
    chapterPickerEl.hidden = true;
    chapterSelectEl.textContent = '';
    chapterHintEl.textContent = '';
    novelBusy = false;

    notify(`小说加载完成（切分 ${list.length} ${kind}耗时 ${splitMs}ms），弧光与档案面板可基于本书生成分析`);
  }

  async function runMacro() {
    if (!novelState) {
      notify('请先上传小说');
      return;
    }
    if (novelBusy) {
      notify('正在分析中，请稍候');
      return;
    }
    novelBusy = true;

    const { meta } = novelState;
    $('.empty-hint', logEl)?.remove();
    const loading = renderLoadingCard(
      '正在生成全书宏观分析...',
      `已提取开头 ${meta.head.length} 字作为上下文 · ${meta.sizeLabel}`
    );
    logEl.append(loading);
    logEl.scrollTop = logEl.scrollHeight;

    try {
      const data = await SW.callMacroLLM(meta);
      loading.remove();
      appendResultItem(renderMacroCard(data), '全书宏观分析完成');
    } catch (err) {
      loading.remove();
      const card = renderErrorCard(err && err.message ? err.message : String(err));
      logEl.append(card);
      logEl.scrollTop = logEl.scrollHeight;
      notify('全书解析失败，详见卡片说明');
    } finally {
      novelBusy = false;
    }
  }

  function showChapterPicker() {
    if (!novelState) {
      notify('请先上传小说');
      return;
    }
    const { kind, list } = novelState.chapters;

    chapterSelectEl.textContent = '';
    list.forEach((ch) => {
      const opt = el('option', null, `${ch.label}（${ch.sizeLabel}）`);
      opt.value = String(ch.id);
      chapterSelectEl.append(opt);
    });

    chapterPickerEl.hidden = false;
    updateChapterHint();
    notify(
      kind === '章节'
        ? `已提取 ${list.length} 个章节，请选择要解析的章节`
        : `未检测到章节标题，已按 5000 字切分为 ${list.length} 个片段`
    );
  }

  async function analyzeChapter() {
    if (!novelState) {
      notify('请先上传小说');
      return;
    }
    const chapter = currentChapter();
    if (!chapter) {
      notify('没有可分析的章节');
      return;
    }
    if (chapterBusy) {
      notify('正在解析中，请稍候');
      return;
    }
    chapterBusy = true;

    $('.empty-hint', logEl)?.remove();
    const loading = renderLoadingCard(
      `正在逐字拆解「${chapter.label}」...`,
      `本章 ${chapter.sizeLabel} · 发送开头 ${Math.min(chapter.text.length, 3000)} 字作为上下文`
    );
    logEl.append(loading);
    logEl.scrollTop = logEl.scrollHeight;

    try {
      const data = await SW.callChapterLLM(chapter, novelState.meta);
      loading.remove();
      let note = '章节解析完成';
      if (data.state) {
        note = SW.applyChapterUpdate(data.state, chapter.label)
          ? '章节解析完成 · 弧光与档案已随本章生长'
          : '章节解析完成 · 本章已分析过，未重复追加';
      } else if (data.mode === '大模型') {
        SW.applyChapterUpdate(null, chapter.label);
      }
      appendResultItem(renderChapterCard(data), note);
    } catch (err) {
      loading.remove();
      const card = renderErrorCard(err && err.message ? err.message : String(err));
      logEl.append(card);
      logEl.scrollTop = logEl.scrollHeight;
      notify('章节解析失败，详见卡片说明');
    } finally {
      chapterBusy = false;
    }
  }

  macroBtnEl.addEventListener('click', runMacro);
  chaptersBtnEl.addEventListener('click', showChapterPicker);
  chapterSelectEl.addEventListener('change', updateChapterHint);
  chapterAnalyzeBtnEl.addEventListener('click', analyzeChapter);

  dropzoneEl.addEventListener('click', () => novelFileEl.click());
  dropzoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      novelFileEl.click();
    }
  });
  ['dragenter', 'dragover'].forEach((type) => {
    dropzoneEl.addEventListener(type, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzoneEl.addEventListener(type, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove('is-dragging');
    });
  });
  dropzoneEl.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleNovelFile(file);
  });
  novelFileEl.addEventListener('change', () => {
    const file = novelFileEl.files && novelFileEl.files[0];
    if (file) handleNovelFile(file);
    novelFileEl.value = '';
  });

  $('#analyze-motive').addEventListener('click', () => analyze(FOCUS.motive));
  $('#analyze-subtext').addEventListener('click', () => analyze(FOCUS.subtext));
  inputEl.addEventListener('input', refreshCount);

  $('#story-clear').addEventListener('click', () => {
    logEl.textContent = '';
    logEl.append(el('p', 'empty-hint', '还没有分析记录。左侧贴入片段，或点下方语料示例一键载入。'));
    inputEl.value = '';
    results = 0;
    refreshCount();
    resultCountEl.textContent = '0 条';
  });

  refreshCount();

  SW.onCorpus(buildExcerpts);
})();
