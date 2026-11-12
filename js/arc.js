/* 📈 情感与人物弧光：折线图 + 剧情阶段 + Python 情感分析代码 + 全局小说联动 */
(() => {
  'use strict';

  const { $, el, notify, onCorpus, onTab } = window.SW;

  const HERO_COLOR = '#b0413e';
  const RIVAL_COLOR = '#3d5a80';

  const chartBox = $('#arc-chart');
  const emptyTip = $('#arc-empty');
  const stagesRow = $('#arc-stages');
  const essayEl = $('#arc-essay');
  const noteEl = $('#arc-note');
  const hintEl = $('#arc-hint');
  const codePanel = $('#code-panel');
  const codeBlock = $('#code-block');
  const genBtn = $('#arc-gen-btn');
  const novelNameEl = $('#arc-novel-name');
  const progressEl = $('#arc-progress');

  let chart = null;
  let arcData = null;
  let corpusData = null;
  let profileApplied = false;
  let profileNovelName = null;
  let chartMode = 'corpus'; // corpus | macro | reading
  let readingSnap = null;

  const nums = (s) => (s || '').split(/[,，、\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
  const strs = (s) => (s || '').split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
  const field = (sec, name) => (sec.fields[name] ? sec.fields[name].text : '');

  function readArc(corpus) {
    const sec = corpus.section('情感弧光');
    if (!sec) return null;

    const chapters = strs(field(sec, '章节标签'));
    const hero = {
      name: field(sec, '主角姓名') || '主角',
      values: nums(field(sec, '主角数值')),
    };
    const rival = {
      name: field(sec, '反派姓名') || '反派',
      values: nums(field(sec, '反派数值')),
    };
    if (!chapters.length || !hero.values.length || !rival.values.length) return null;

    return {
      chapters,
      stages: strs(field(sec, '剧情阶段')),
      hero,
      rival,
      essay: field(sec, '弧光说明'),
    };
  }

  /* 系列名：占位名「主角/反派」不再重复加后缀 */
  const labelOf = (name, role) => (name === role || name.includes(role) ? name : `${name}（${role}）`);

  /* 找出两条曲线符号翻转的位置，用于说明"交叉点" */
  function crossings(a, b) {
    const out = [];
    for (let i = 1; i < Math.min(a.length, b.length); i += 1) {
      const prev = a[i - 1] - b[i - 1];
      const cur = a[i] - b[i];
      if (prev === 0) out.push(i);
      else if (cur !== 0 && prev * cur < 0) out.push(i);
    }
    return out;
  }

  function renderStages() {
    stagesRow.textContent = '';
    arcData.chapters.forEach((ch, i) => {
      const chip = el('span', 'stage-chip');
      chip.append(el('b', null, ch));
      if (arcData.stages[i]) chip.append(el('small', null, arcData.stages[i]));
      stagesRow.append(chip);
    });
  }

  function buildOption() {
    const marks = crossings(arcData.hero.values, arcData.rival.values)
      .map((i) => ({ xAxis: arcData.chapters[i] }));

    const option = {
      backgroundColor: 'transparent',
      color: [HERO_COLOR, RIVAL_COLOR],
      grid: { left: 52, right: 24, top: 44, bottom: 46 },
      legend: {
        top: 8,
        itemGap: 18,
        textStyle: { color: '#57534e', fontSize: 12 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#d6cbb8' } },
        borderColor: '#e5dccd',
        backgroundColor: 'rgba(255,253,247,.96)',
        textStyle: { color: '#292524' },
        formatter: (params) => {
          const idx = params[0].dataIndex;
          const stage = arcData.stages[idx] ? `<br/>剧情阶段：${arcData.stages[idx]}` : '';
          const rows = params
            .map((p) => `${p.marker}${p.seriesName}：<b>${p.data}</b>`)
            .join('<br/>');
          return `<b>${params[0].axisValue}</b>${stage}<br/>${rows}`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: arcData.chapters,
        axisLine: { lineStyle: { color: '#c9bda8' } },
        axisTick: { show: false },
        axisLabel: { color: '#57534e', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: '情感指数',
        nameTextStyle: { color: '#78716c', fontSize: 11, padding: [0, 0, 0, -28] },
        min: -100,
        max: 100,
        interval: 50,
        axisLabel: { color: '#78716c', fontSize: 11 },
        splitLine: { lineStyle: { color: '#ece3d6' } },
      },
      series: [
        {
          name: labelOf(arcData.hero.name, '主角'),
          type: 'line',
          data: arcData.hero.values,
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2.6 },
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: '中性线', color: '#a8a29e', fontSize: 10 },
            data: [{ yAxis: 0, lineStyle: { type: 'dashed', color: '#cbc4b7' } }],
          },
        },
        {
          name: labelOf(arcData.rival.name, '反派'),
          type: 'line',
          data: arcData.rival.values,
          smooth: 0.25,
          symbol: 'diamond',
          symbolSize: 9,
          lineStyle: { width: 2.6, type: 'solid' },
          areaStyle: { opacity: 0.07 },
          emphasis: { focus: 'series' },
          markLine: marks.length
            ? {
                silent: true,
                symbol: 'none',
                label: {
                  formatter: '交叉',
                  position: 'end',
                  distance: 6,
                  rotate: 0,
                  color: '#b0413e',
                  fontSize: 10,
                },
                data: marks.map((m) => ({ ...m, lineStyle: { type: 'dotted', color: '#d9a58f' } })),
              }
            : undefined,
        },
      ],
    };

    if (arcData.title) {
      option.grid.top = 58;
      option.title = {
        text: arcData.title,
        left: 'center',
        top: 6,
        textStyle: { fontSize: 13, fontWeight: 'bold', color: '#57534e' },
      };
    }
    return option;
  }

  function drawChart() {
    if (!window.echarts) {
      emptyTip.textContent = 'ECharts CDN 未加载，图表不可用。下方仍可查看剧情阶段与情感数值。';
      return;
    }
    if (!chart) {
      chart = window.echarts.init(chartBox, null, { renderer: 'canvas' });
    }
    chart.setOption(buildOption(), true);
    emptyTip.hidden = true;
    chart.resize();
  }

  const pyStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const pyList = (arr) => `[${arr.map(pyStr).join(', ')}]`;
  const pyIdent = (s) => {
    let t = String(s).replace(/[^\u4e00-\u9fa5A-Za-z0-9_]/g, '_');
    if (/^[0-9]/.test(t)) t = `_${t}`;
    return t || '人物';
  };

  function pythonCode() {
    const { chapters, stages, hero, rival } = arcData;
    const heroIdent = pyIdent(hero.name);
    const rivalIdent = pyIdent(rival.name);
    const heroLabel = labelOf(hero.name, '主角');
    const rivalLabel = labelOf(rival.name, '反派');
    return `# 情感弧光 · 章节级情绪指数计算（前端演示用的计算逻辑，数字为当前图表数据）
# 依赖：pip install snownlp matplotlib pandas
from snownlp import SnowNLP          # 中文情感极性，输出 0~1
import matplotlib.pyplot as plt
import pandas as pd

主角姓名 = "${hero.name}"
反派姓名 = "${rival.name}"
章节列表 = ${pyList(chapters)}
剧情阶段 = ${pyList(stages)}

# 真实项目里这里读入分章正文；演示时用"章节+阶段"占位，保证可复现
章节文本 = {章: f"{章}·{段}的代表正文" for 章, 段 in zip(章节列表, 剧情阶段)}


def 情感指数(文本: str) -> int:
    """把 SnowNLP 的 0~1 极性映射到 -100(绝望) ~ 100(狂喜)，并用情绪强度加权。"""
    if not 文本:
        return 0
    极性 = SnowNLP(文本).sentiments                     # 0 负面 -> 1 正面
    标点强度 = 文本.count("！") + 文本.count("？") + 文本.count("……")
    人称密度 = 文本.count("我") / max(len(文本) / 100, 1)
    强度 = min(1.5, 1 + 0.08 * 标点强度 + 0.02 * 人称密度)
    原始值 = (极性 - 0.5) * 200 * 强度                   # 以 0.5 为零点
    return int(round(max(-100, min(100, 原始值))))


def 弧光() -> list[int]:
    """逐章求情感指数：章内多段落先取均值，抑制单句噪声。"""
    return [情感指数(章节文本[章]) for 章 in 章节列表]


# 图表当前数据（线上应由 弧光() 生成，这里保证页面与图表一致）
${heroIdent}_弧光 = ${JSON.stringify(hero.values)}
${rivalIdent}_弧光 = ${JSON.stringify(rival.values)}

表 = pd.DataFrame({"章节": 章节列表, "阶段": 剧情阶段,
                   "主角": ${heroIdent}_弧光, "反派": ${rivalIdent}_弧光})
差值 = 表["主角"] - 表["反派"]
交叉章 = 表[(差值 * 差值.shift()) < 0]["章节"].tolist()   # 差值变号 = 弧光交叉
print(表.to_string(index=False))
print("弧光交叉出现在：", 交叉章)

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.plot(表["章节"], 表["主角"], marker="o", label=f"{主角姓名}（${heroLabel}）", color="#b0413e")
ax.plot(表["章节"], 表["反派"], marker="D", label=f"{反派姓名}（${rivalLabel}）", color="#3d5a80")
ax.axhline(0, ls="--", c="#b9b0a3", lw=.8)            # 情感零点
ax.set_ylim(-100, 100)
ax.set_ylabel("情感指数（-100 绝望 / 100 狂喜）")
ax.set_title(f"{主角姓名} 与 {反派姓名} 的情感弧光")
ax.legend(frameon=False, ncol=2)
fig.tight_layout()
fig.savefig("情感弧光.png", dpi=150)
`;
  }

  function bindCode() {
    $('#show-code').addEventListener('click', () => {
      if (!arcData && !(chartMode === 'reading' && readingSnap)) {
        notify('情感数据尚未载入');
        return;
      }
      const open = !codePanel.hidden;
      codePanel.hidden = open;
      if (!open) {
        codeBlock.textContent =
          chartMode === 'reading' && readingSnap ? readingCode(readingSnap) : pythonCode();
      }
    });

    $('#copy-code').addEventListener('click', async () => {
      const text = codeBlock.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        notify('Python 代码已复制');
      } catch (err) {
        const ta = el('textarea');
        ta.value = text;
        document.body.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        notify('已复制（剪贴板接口降级）');
      }
    });
  }

  function arcSummary() {
    const cross = crossings(arcData.hero.values, arcData.rival.values);
    const crossText = cross.length
      ? ` · 交叉点 ${arcData.chapters[cross[0] - 1]}–${arcData.chapters[cross[0]]}之间`
      : ' · 无交叉';
    const span = (s) => {
      const v = s.values;
      return `${s.name} ${Math.min(...v)}~${Math.max(...v)}`;
    };
    return `${arcData.chapters.length} 章 · ${span(arcData.hero)} · ${span(arcData.rival)}${crossText}`;
  }

  /* 统一的渲染入口：语料预设与小说生成共用 */
  function renderArc(data) {
    arcData = data;
    renderStages();
    drawChart();

    if (arcData.essay) {
      essayEl.textContent = arcData.essay;
      essayEl.hidden = false;
    } else {
      essayEl.hidden = true;
    }
    noteEl.textContent = arcSummary();
    if (hintEl) {
      hintEl.textContent =
        arcData.sourceHint || 'Y 轴情感指数区间 −100（绝望）至 100（狂喜），数据来自语料库预设。';
    }
    if (!codePanel.hidden) codeBlock.textContent = pythonCode();
  }

  function init(corpus) {
    corpusData = readArc(corpus);
    bindCode();

    if (!corpusData) {
      if (!profileApplied) {
        emptyTip.hidden = false;
        emptyTip.textContent = 'mock-data.md 中缺少「情感弧光」区块，无法绘制曲线。';
      }
      return;
    }
    if (!profileApplied) {
      chartMode = 'corpus';
      renderArc(corpusData);
    }
  }

  /* ---------- 逐章增量阅读模式（v0.7） ---------- */
  function buildReadingOption(snap) {
    const labels = snap.emotionData.map((p) => p.chapter);
    const scores = snap.emotionData.map((p) => p.score);
    const heroName = (snap.analyzedChapters[0] && snap.analyzedChapters[0].protagonist_name) || '主角';
    return {
      backgroundColor: 'transparent',
      color: [HERO_COLOR],
      title: {
        text: `《${snap.novelName}》逐章情感曲线（阅读中）`,
        left: 'center',
        top: 6,
        textStyle: { fontSize: 13, fontWeight: 'bold', color: '#57534e' },
      },
      grid: { left: 52, right: 24, top: 58, bottom: 46 },
      legend: {
        top: 24,
        textStyle: { color: '#57534e', fontSize: 12 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#d6cbb8' } },
        borderColor: '#e5dccd',
        backgroundColor: 'rgba(255,253,247,.96)',
        textStyle: { color: '#292524' },
        formatter: (params) => {
          const idx = params[0].dataIndex;
          const item = readingSnap && readingSnap.analyzedChapters[idx];
          const clue = item && item.new_clues ? `<br/>本章状态：${item.new_clues}` : '';
          return `<b>${params[0].axisValue}</b><br/>${params[0].marker}${params[0].seriesName}：<b>${params[0].data}</b>${clue}`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: '#c9bda8' } },
        axisTick: { show: false },
        axisLabel: { color: '#57534e', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: '情感指数',
        nameTextStyle: { color: '#78716c', fontSize: 11, padding: [0, 0, 0, -28] },
        min: -100,
        max: 100,
        interval: 50,
        axisLabel: { color: '#78716c', fontSize: 11 },
        splitLine: { lineStyle: { color: '#ece3d6' } },
      },
      series: [
        {
          name: labelOf(heroName, '主角'),
          type: 'line',
          data: scores,
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2.6 },
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: '中性线', color: '#a8a29e', fontSize: 10 },
            data: [{ yAxis: 0, lineStyle: { type: 'dashed', color: '#cbc4b7' } }],
          },
        },
      ],
    };
  }

  function renderReading(snap, first) {
    if (!window.echarts) {
      emptyTip.textContent = 'ECharts CDN 未加载，图表不可用。';
      return;
    }
    if (!chart) {
      chart = window.echarts.init(chartBox, null, { renderer: 'canvas' });
    }
    if (first) {
      chart.setOption(buildReadingOption(snap), true);
    } else {
      /* 增量追加：只替换 X 轴与系列数据，不重建图表 */
      chart.setOption({
        xAxis: { data: snap.emotionData.map((p) => p.chapter) },
        series: [{ data: snap.emotionData.map((p) => p.score) }],
      });
    }
    emptyTip.hidden = true;
    chart.resize();
  }

  function renderReadingStages(snap) {
    stagesRow.textContent = '';
    snap.analyzedChapters.forEach((c) => {
      const chip = el('span', 'stage-chip is-reading');
      chip.append(el('b', null, c.chapter));
      if (c.new_clues) {
        const short = c.new_clues.length > 14 ? `${c.new_clues.slice(0, 14)}…` : c.new_clues;
        chip.append(el('small', null, short));
      }
      stagesRow.append(chip);
    });
  }

  function readingCode(snap) {
    const rows = snap.emotionData
      .map((p) => `    { "chapter": ${pyStr(p.chapter)}, "score": ${p.score} }`)
      .join(',\n');
    return `# 逐章增量模式 · readingState（随阅读实时生长，不剧透后续章节）\nreadingState = {\n  "novel": ${pyStr(snap.novelName)},\n  "analyzedChapters": ${snap.analyzedChapters.length} / ${snap.total},\n  "emotionData": [\n${rows}\n  ]\n}\n\n# 前端追加更新的方式（不重建图表）：\n# myChart.setOption({ series: [{ data: 新增后的整条曲线 }] })`;
  }

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
    readingSnap = snap;
    updateProgress(snap);

    if (!snap.emotionData.length) {
      if (chartMode === 'reading') {
        chartMode = 'corpus';
        if (corpusData) renderArc(corpusData);
        else if (chart) {
          chart.clear();
          emptyTip.hidden = false;
        }
      }
      return;
    }

    if (chartMode !== 'reading') {
      chartMode = 'reading';
      renderReading(snap, true);
    } else {
      renderReading(snap, false);
    }

    renderReadingStages(snap);
    essayEl.hidden = true;
    const scores = snap.emotionData.map((p) => p.score);
    const heroName = (snap.analyzedChapters[0] && snap.analyzedChapters[0].protagonist_name) || '主角';
    const span = scores.length > 1 ? `${Math.min(...scores)}~${Math.max(...scores)}` : String(scores[0]);
    noteEl.textContent = `已分析 ${snap.analyzedChapters.length}/${snap.total} 章 · ${heroName} ${span}`;
    if (hintEl) {
      hintEl.textContent = '逐章阅读模式：每解析一章，曲线向右生长一点，档案同步追加状态，绝不剧透后续章节。';
    }
    if (!codePanel.hidden) codeBlock.textContent = readingCode(snap);
  }

  /* ---------- 全局小说联动 ---------- */
  window.SW.onNovelSet((novel) => {
    novelNameEl.textContent = novel ? `当前小说：《${novel.name}》` : '';
    if (profileApplied && (!novel || profileNovelName !== novel.name)) {
      profileApplied = false;
      profileNovelName = null;
    }
    if (!profileApplied) {
      chartMode = 'corpus';
      if (corpusData) {
        renderArc(corpusData);
      } else if (chart) {
        chart.clear();
        emptyTip.hidden = false;
      }
    }
  });

  window.SW.onNovelProfile((data) => {
    profileNovelName = data.novel || profileNovelName;
    profileApplied = true;
    chartMode = 'macro';
    renderArc({
      title: data.title,
      chapters: data.curve.map((p) => p.chapter),
      stages: data.curve.map((p) => p.stage),
      hero: { name: data.hero, values: data.curve.map((p) => p.hero) },
      rival: { name: data.rival, values: data.curve.map((p) => p.rival) },
      essay: `${data.summary}\n\n—— 数据来源：${data.foot}`,
      sourceHint:
        data.mode === '大模型'
          ? '数据由大模型基于当前小说开头实时提取，人物与曲线随小说变化。'
          : '当前为本地模拟数据（主角/反派为占位名），接入 API Key 后可真实提取。',
    });
  });

  window.SW.onReadingUpdate((snap) => {
    applyReading(snap);
  });

  window.SW.onProfileLoading((busy) => {
    genBtn.disabled = busy;
    genBtn.textContent = busy ? '正在生成分析…' : '📊 基于当前小说生成分析';
  });

  window.SW.onProfileError((msg) => {
    essayEl.textContent = `生成失败：${msg}`;
    essayEl.hidden = false;
  });

  genBtn.addEventListener('click', () => window.SW.generateNovelProfile());

  onCorpus(init);

  onTab((name) => {
    if (name === 'arc' && chart) chart.resize();
  });

  window.addEventListener('resize', () => {
    if (chart) chart.resize();
  });
})();
