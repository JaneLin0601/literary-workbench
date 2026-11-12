/* 🕸️ 人物关系与档案：档案卡 + 人物切换 + 关系表 + 全局小说联动 */
(() => {
  'use strict';

  const { $, el, notify, onCorpus } = window.SW;

  const picker = $('#cast-picker');
  const profileCard = $('#profile-card');
  const relationBody = $('#relation-body');
  const hintEl = $('#cast-hint');
  const genBtn = $('#cast-gen-btn');
  const novelNameEl = $('#cast-novel-name');
  const progressEl = $('#cast-progress');

  const FIELDS = [
    ['核心欲望', 'want'],
    ['致命弱点', 'flaw'],
    ['弧光类型', 'plain'],
    ['关键抉择', 'plain'],
  ];

  let people = [];
  let relations = [];
  let arcNames = [];
  let corpusArcNames = [];
  let selected = 0;
  let novelProfile = null; // { novelName, source, people, summary }
  let readingProfile = null; // { heroName, notes: [{chapter, new_clues, relationship}] }
  let viewMode = 'corpus'; // corpus | macro | reading

  function readCast(corpus) {
    const archive = corpus.section('人物档案');
    people = archive ? archive.entries.slice() : [];

    const relSection = corpus.section('人物关系');
    relations = (relSection ? relSection.bullets : [])
      .map((line) => line.replace(/^[-*]\s+/, ''))
      .map((body) => {
        const m = body.match(/^(.+?)\s*(?:→|->)\s*(.+?)\s*[:：]\s*([\s\S]*)$/);
        if (!m) return null;
        return { from: m[1].trim(), to: m[2].trim(), text: m[3].trim() };
      })
      .filter(Boolean);

    const arc = corpus.section('情感弧光');
    corpusArcNames = arc ? [arc.fields['主角姓名'], arc.fields['反派姓名']].map((f) => (f ? f.text.trim() : '')) : [];
    if (!novelProfile) arcNames = corpusArcNames;
  }

  /* 关系描述里第一句作为短标签，其余作为补充 */
  function splitDesc(text) {
    const i = text.indexOf('。');
    if (i === -1 || i > 26) return { tag: text, detail: '' };
    return { tag: text.slice(0, i + 1), detail: text.slice(i + 1).trim() };
  }

  /* ---------- 全局小说联动 ---------- */
  function arcTypeOf(points, key) {
    const v = points.map((p) => p[key]);
    const span = Math.max(...v) - Math.min(...v);
    const trend = v[v.length - 1] - v[0];
    if (span > 70) return '跌宕型弧光';
    if (trend > 25) return '上扬型弧光';
    if (trend < -25) return '下坠型弧光';
    return '回环型弧光';
  }

  function peakText(points, key, role) {
    const v = points.map((p) => p[key]);
    const extreme = role === 'hero' ? Math.max(...v) : Math.min(...v);
    const chapter = points[v.indexOf(extreme)] ? points[v.indexOf(extreme)].chapter : '';
    return role === 'hero'
      ? `情感指数在「${chapter}」达到峰值 ${extreme}`
      : `情感指数在「${chapter}」跌至谷底 ${extreme}`;
  }

  function applyNovelProfile(data) {
    novelProfile = {
      novelName: data.novel,
      source: data.foot,
      summary: data.summary,
      people: [
        {
          name: data.hero,
          fields: {
            弧光类型: arcTypeOf(data.curve, 'hero'),
            关键抉择: peakText(data.curve, 'hero', 'hero'),
            关系总结: data.summary,
          },
        },
        {
          name: data.rival,
          fields: {
            弧光类型: arcTypeOf(data.curve, 'rival'),
            关键抉择: peakText(data.curve, 'rival', 'rival'),
            关系总结: data.summary,
          },
        },
      ],
    };
    arcNames = [data.hero, data.rival];
    selected = 0;
    renderPicker();
    renderProfile();
    renderRelations();
    hintEl.textContent = `数据来源：${data.foot}。`;
  }

  function currentPeople() {
    if (viewMode === 'macro') return novelProfile ? novelProfile.people : [];
    if (viewMode === 'reading' && readingProfile) {
      return [
        {
          name: readingProfile.heroName,
          fields: {},
          chapterNotes: readingProfile.notes,
        },
      ];
    }
    return people;
  }

  function renderPicker() {
    picker.textContent = '';
    currentPeople().forEach((p, i) => {
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.textContent = p.name;
      chip.classList.toggle('is-active', i === selected);
      chip.addEventListener('click', () => {
        selected = i;
        renderPicker();
        renderProfile();
        renderRelations();
      });
      picker.append(chip);
    });
  }

  function renderProfile() {
    const person = currentPeople()[selected];
    profileCard.textContent = '';
    if (!person) {
      profileCard.append(el('p', 'empty-hint', 'mock-data.md 中缺少「人物档案」区块。'));
      return;
    }

    profileCard.append(el('h3', 'profile-name', person.name));

    const tags = el('div', 'profile-tags');
    if (person.fields['弧光类型']) {
      const type = person.fields['弧光类型'].split(/[（(]/)[0].trim();
      tags.append(el('span', 'badge is-quiet', type));
    }
    if (tags.childNodes.length) profileCard.append(tags);

    FIELDS.forEach(([key, kind]) => {
      const value = person.fields[key];
      if (!value) return;
      const row = el('div', `profile-row is-${kind}`);
      row.append(el('span', 'profile-key', key));
      row.append(el('span', 'profile-val', value));
      profileCard.append(row);
    });

    if (person.fields['关系总结']) {
      const row = el('div', 'profile-row is-want');
      row.append(el('span', 'profile-key', '关系总结'));
      row.append(el('span', 'profile-val', person.fields['关系总结']));
      profileCard.append(row);
    }

    /* 逐章阅读模式：每分析一章，档案卡就多出「章节 · 状态 / 关系」两行 */
    (person.chapterNotes || []).forEach((note) => {
      const statusRow = el('div', 'profile-row is-note');
      statusRow.append(el('span', 'profile-key', `${note.chapter} · 状态`));
      statusRow.append(el('span', 'profile-val', note.new_clues || '（本章无新特征）'));
      profileCard.append(statusRow);
      if (note.relationship) {
        const relRow = el('div', 'profile-row is-note');
        relRow.append(el('span', 'profile-key', `${note.chapter} · 关系`));
        relRow.append(el('span', 'profile-val', note.relationship));
        profileCard.append(relRow);
      }
    });

    if (arcNames.includes(person.name)) {
      const jump = el('button', 'link-btn mt-2');
      jump.type = 'button';
      jump.textContent = `查看 ${person.name} 的情感弧光 →`;
      jump.addEventListener('click', () => window.SW.activateTab('arc'));
      profileCard.append(jump);
    }
  }

  function renderRelations() {
    relationBody.textContent = '';
    const name = currentPeople()[selected] ? currentPeople()[selected].name : '';
    let rows;
    if (viewMode === 'macro') {
      rows = novelProfile
        ? [{ from: novelProfile.people[0].name, to: novelProfile.people[1].name, text: novelProfile.summary }]
        : [];
    } else if (viewMode === 'reading' && readingProfile) {
      rows = readingProfile.notes
        .filter((n) => n.relationship)
        .map((n) => ({ from: readingProfile.heroName, to: '—', text: `「${n.chapter}」${n.relationship}` }));
    } else {
      rows = relations;
    }

    if (!rows.length) {
      const row = el('tr');
      const cell = el('td', 'empty-hint');
      cell.colSpan = 3;
      cell.textContent = 'mock-data.md 中缺少「人物关系」区块。';
      row.append(cell);
      relationBody.append(row);
      return;
    }

    rows.forEach((rel) => {
      const tr = el('tr', 'rel-row');
      if (rel.from === name) tr.classList.add('is-out');
      else if (rel.to === name) tr.classList.add('is-in');
      else tr.classList.add('is-far');

      const from = el('td', 'rel-who');
      from.append(el('span', 'rel-arrow', '→'));
      from.append(el('b', null, rel.from));

      const mid = el('td', 'rel-what');
      const { tag, detail } = splitDesc(rel.text);
      mid.append(el('div', 'rel-tag', tag));
      if (detail) mid.append(el('div', 'rel-detail', detail));

      const to = el('td', 'rel-who');
      to.append(el('b', null, rel.to));

      tr.append(from, mid, to);
      if (viewMode !== 'reading') {
        tr.addEventListener('click', () => {
          const target = currentPeople().findIndex((p) => p.name === rel.to);
          if (target === -1) {
            notify(`${rel.to} 暂无独立档案`);
            return;
          }
          selected = target;
          renderPicker();
          renderProfile();
          renderRelations();
        });
      }
      relationBody.append(tr);
    });
  }

  onCorpus((corpus) => {
    readCast(corpus);
    if (!people.length) {
      profileCard.append(el('p', 'empty-hint', '语料库未载入，无法显示人物档案。'));
      return;
    }
    renderPicker();
    renderProfile();
    renderRelations();
  });

  /* ---------- 逐章增量阅读模式（v0.7） ---------- */
  function updateProgress(snap) {
    if (!snap.novelName) {
      progressEl.hidden = true;
      progressEl.textContent = '';
      return;
    }
    progressEl.hidden = false;
    const done = snap.total > 0 && snap.analyzedChapters.length >= snap.total;
    progressEl.textContent = `当前已分析进度：${snap.analyzedChapters.length} / ${snap.total} 章（${done ? '已读完' : '阅读中...'}）`;
  }

  function applyReading(snap) {
    updateProgress(snap);

    if (!snap.emotionData.length) {
      if (viewMode === 'reading') {
        viewMode = 'corpus';
        readingProfile = null;
        arcNames = corpusArcNames;
        selected = 0;
        renderPicker();
        renderProfile();
        renderRelations();
        hintEl.textContent = '箭头方向表示主动的一方；高亮与当前档案人物相关的关系。';
      }
      return;
    }

    const heroName = (snap.analyzedChapters[0] && snap.analyzedChapters[0].protagonist_name) || '主角';
    readingProfile = {
      heroName,
      notes: snap.analyzedChapters.map((c) => ({
        chapter: c.chapter,
        new_clues: c.new_clues,
        relationship: c.relationship,
      })),
    };
    viewMode = 'reading';
    arcNames = [heroName];
    selected = 0;
    renderPicker();
    renderProfile();
    renderRelations();
    hintEl.textContent = `逐章阅读模式：已解析 ${snap.analyzedChapters.length} 章，档案随阅读实时生长，绝不剧透后续章节。`;
  }

  /* ---------- 全局小说联动 ---------- */
  window.SW.onNovelSet((novel) => {
    novelNameEl.textContent = novel ? `当前小说：《${novel.name}》` : '';
    readingProfile = null;
    const macroReset = novelProfile && (!novel || novelProfile.novelName !== novel.name);
    if (macroReset) novelProfile = null;
    if (macroReset || viewMode === 'reading') {
      viewMode = 'corpus';
      arcNames = corpusArcNames;
      selected = 0;
      renderPicker();
      renderProfile();
      renderRelations();
      hintEl.textContent = '箭头方向表示主动的一方；高亮与当前档案人物相关的关系。';
    }
  });

  window.SW.onNovelProfile((data) => {
    viewMode = 'macro';
    applyNovelProfile(data);
    notify('档案面板已同步该小说的主要人物');
  });

  window.SW.onReadingUpdate((snap) => {
    applyReading(snap);
  });

  window.SW.onProfileLoading((busy) => {
    genBtn.disabled = busy;
    genBtn.textContent = busy ? '正在生成分析…' : '📊 基于当前小说生成分析';
  });

  window.SW.onProfileError((msg) => {
    notify(msg);
    hintEl.textContent = `生成失败：${msg}`;
  });

  genBtn.addEventListener('click', () => window.SW.generateNovelProfile());
})();
