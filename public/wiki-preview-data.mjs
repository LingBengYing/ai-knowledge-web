/**
 * Deliberately synthetic, local-only content for the Wiki UI review.
 * No record represents a live document, a verified source locator, or model output.
 */
export const sources = [
  {
    id: 'cedar-overview', title: '青榆灯塔项目说明书.pdf', kind: 'pdf',
    folder: '项目资料 / 青榆灯塔', size: '1.2 MB', updated: '2026-10-09 09:20', status: 'ready',
    summary: '合成验收资料：介绍虚构的青榆灯塔项目、计划日期与预算，不包含真实业务信息。',
    content: [
      { locator: '第 1 页 · 合成原文', text: '青榆灯塔项目（Project Cedar Beacon）是一项虚构的知识库验收项目。本文所有名称与数据仅供前端交互演示，不代表真实业务。' },
      { locator: '第 2 页 · 合成原文', text: '计划启动日期为 2026 年 11 月 18 日，计划预算为人民币 48,600 元。“计划”不表示项目已经启动，也不表示费用已经支出。' },
      { locator: '第 3 页 · 合成原文', text: '本项目名称中的“灯塔”是项目代号，与演示资料中的“灯塔设备”不是同一对象。查找时应先区分项目资料与设备指南。' },
    ],
    wikiIds: ['cedar-project', 'cedar-budget', 'evidence-guide'],
  },
  {
    id: 'cedar-english', title: 'Cedar Beacon · Project overview.md', kind: 'text',
    folder: '项目资料 / 青榆灯塔', size: '4.6 KB', updated: '2026-10-08 16:45', status: 'ready',
    summary: '合成英文概览：青榆灯塔项目的英文名称、计划启动日期和预算，与中文说明书对照。',
    content: [
      { locator: '概览 · 合成原文', text: 'SYNTHETIC ACCEPTANCE MATERIAL. Project Cedar Beacon. Planned launch date: November 18, 2026. Planned budget: CNY 48,600. All names and figures are fictional.' },
      { locator: '命名说明 · 合成原文', text: 'Project Cedar Beacon refers to the fictional project called 青榆灯塔 in the paired Chinese overview. It is not the Lighthouse demo device.' },
    ],
    wikiIds: ['cedar-project', 'cedar-budget', 'evidence-guide'],
  },
  {
    id: 'cedar-budget', title: '青榆灯塔 · 预算说明.md', kind: 'text',
    folder: '项目资料 / 青榆灯塔', size: '3.1 KB', updated: '2026-10-09 10:15', status: 'ready',
    summary: '合成预算说明：虚构项目计划预算为 48,600 元，区分计划值与实际支出。',
    content: [
      { locator: '预算口径 · 合成原文', text: '青榆灯塔项目的计划预算为人民币 48,600 元。此数值是演示用计划金额，不是已审批的真实预算，也不是实际支出。' },
      { locator: '使用提醒 · 合成原文', text: '本合成资料未列出采购明细或实际付款记录，不能据此推算付款进度。回答预算问题时应保留“计划预算”这一限定。' },
    ],
    wikiIds: ['cedar-budget', 'cedar-project'],
  },
  {
    id: 'device-guide', title: '灯塔设备 · 快速使用指南.pdf', kind: 'pdf',
    folder: '产品使用 / 灯塔设备', size: '2.4 MB', updated: '2026-10-09 08:50', status: 'ready',
    summary: '合成设备指南：虚构桌面演示设备的接电、开机、状态确认和基础排查。',
    content: [
      { locator: '第 1 页 · 合成原文', text: '本指南适用于虚构的“灯塔演示设备” LT-Demo。仅供知识库界面演示，不可作为真实设备的操作或安全说明。' },
      { locator: '第 2 页 · 合成原文', text: '演示开机步骤：1. 接入演示电源。2. 按下顶部启动键。3. 等待状态灯由闪烁变为绿色常亮，表示演示设备进入就绪状态。' },
      { locator: '第 3 页 · 合成原文', text: '若演示状态灯仍闪烁，先核对电源连接和启动步骤。本文未定义硬件维修方法；不得将这些合成步骤用于真实设备。' },
    ],
    wikiIds: ['device-start', 'device-faq'],
  },
  {
    id: 'device-video', title: '灯塔设备 · 开机演示.mp4', kind: 'video',
    folder: '产品使用 / 灯塔设备', size: '8.6 MB', updated: '2026-10-09 09:05', status: 'ready',
    summary: '合成教程片段：展示虚构演示设备接电、按键与绿色常亮确认；此预览只有文字脚本，没有实际视频。',
    content: [
      { locator: '00:00–00:12 · 合成脚本', text: '旁白：本片使用虚构的灯塔演示设备 LT-Demo，所有画面与步骤仅供界面原型展示。' },
      { locator: '00:12–00:26 · 合成脚本', text: '旁白：接入演示电源，然后按下顶部启动键。' },
      { locator: '00:26–00:40 · 合成脚本', text: '旁白：状态灯变为绿色常亮后，设备进入就绪状态。此处时间仅为合成脚本定位，不是服务器校验过的真实视频引用。' },
    ],
    wikiIds: ['device-start', 'device-faq'],
  },
  {
    id: 'device-audio', title: '灯塔设备 · 操作讲解.wav', kind: 'audio',
    folder: '产品使用 / 灯塔设备', size: '3.2 MB', updated: '2026-10-09 10:30', status: 'review',
    summary: '合成音频转录样例：补充虚构设备状态灯含义，等待知识页变更审阅；没有真实音频文件。',
    content: [
      { locator: '00:08–00:19 · 合成转录', text: '灯塔演示设备的绿色常亮表示就绪。仅看到灯亮还不足以区分闪烁和常亮，请在演示中完整观察状态变化。' },
    ],
    wikiIds: ['device-start', 'device-faq'],
  },
  {
    id: 'device-diagram', title: '灯塔设备 · 面板示意图.png', kind: 'image',
    folder: '产品使用 / 灯塔设备', size: '460 KB', updated: '2026-10-08 15:10', status: 'ready',
    summary: '合成图片说明：虚构设备顶部启动键、状态灯与电源位置；此预览以文字展示图注。',
    content: [
      { locator: '图注 · 合成文字', text: '灯塔演示设备面板示意：顶部为启动键，正面为状态灯，侧面为演示电源接口。这是合成图注，不能冒充真实图片 OCR 或视觉识别结果。' },
    ],
    wikiIds: ['device-start', 'device-faq'],
  },
];

export const pages = [
  {
    id: 'cedar-project', title: '青榆灯塔项目', type: '项目', updated: '2026-10-09 10:15',
    summary: '从中英文项目资料整理的合成知识页：项目是什么、何时计划启动，以及预算口径。',
    sourceIds: ['cedar-overview', 'cedar-english', 'cedar-budget'],
    relatedIds: ['cedar-budget', 'evidence-guide'],
    sections: [
      { heading: '项目概览', text: '青榆灯塔（Project Cedar Beacon）是用于知识库功能验收的虚构项目。名称与数据均为合成示例，不代表真实业务。', sourceIds: ['cedar-overview', 'cedar-english'] },
      { heading: '当前已知信息', text: '计划启动日期：2026 年 11 月 18 日。计划预算：人民币 48,600 元。资料未提供实际启动记录或实际支出。', sourceIds: ['cedar-overview', 'cedar-budget'] },
      { heading: '避免混淆', text: '项目代号中的“灯塔”与另一个合成主题“灯塔设备”不是同一对象。查找项目预算时不应混入设备操作内容。', sourceIds: ['cedar-overview'] },
    ],
  },
  {
    id: 'cedar-budget', title: '项目预算与时间线', type: '概念', updated: '2026-10-09 10:15',
    summary: '合成知识页：记录青榆灯塔项目的计划金额、计划日期，以及资料中没有给出的信息。',
    sourceIds: ['cedar-budget', 'cedar-overview', 'cedar-english'],
    relatedIds: ['cedar-project', 'evidence-guide'],
    sections: [
      { heading: '预算口径', text: '计划预算为人民币 48,600 元。这里保留“计划”限定，不将其表述为实际支出或真实审批结果。', sourceIds: ['cedar-budget'] },
      { heading: '计划时间线', text: '中英文合成资料均记录计划启动日期为 2026 年 11 月 18 日，没有证明项目已经启动。', sourceIds: ['cedar-overview', 'cedar-english'] },
      { heading: '尚未提供', text: '采购明细、付款进度和实际支出未出现在这些合成资料中，应回到来源补充信息，不凭概览推算。', sourceIds: ['cedar-budget'] },
    ],
  },
  {
    id: 'device-start', title: '灯塔设备开机指南', type: '指南', updated: '2026-10-09 09:05',
    summary: '合成知识页：将操作文档与教程脚本关联为可阅读的开机步骤，不适用于真实设备。',
    sourceIds: ['device-guide', 'device-video', 'device-diagram'],
    relatedIds: ['device-faq'],
    sections: [
      { heading: '适用对象', text: '以下内容仅适用于虚构 LT-Demo 灯塔演示设备，不是实际硬件的使用或安全说明。', sourceIds: ['device-guide'] },
      { heading: '开机步骤', text: '1. 接入演示电源。\n2. 按下顶部启动键。\n3. 等待状态灯由闪烁变为绿色常亮，确认进入就绪状态。', sourceIds: ['device-guide', 'device-video'] },
      { heading: '对应的阅读与观看位置', text: '操作文档第 2 页对应开机步骤；教程脚本 00:12–00:40 对应按键与就绪确认。这些均为本地合成定位，真实原件与时间回读等待后端接入。', sourceIds: ['device-guide', 'device-video'] },
    ],
  },
  {
    id: 'device-faq', title: '灯塔设备使用常见问题', type: '指南', updated: '2026-10-09 09:05',
    summary: '合成知识页：解释灯塔演示设备的就绪状态、指示灯和资料边界。',
    sourceIds: ['device-guide', 'device-video', 'device-diagram'],
    relatedIds: ['device-start'],
    sections: [
      { heading: '怎样确认已经就绪？', text: '演示指南要求观察到状态灯绿色常亮，而不是仅看到灯亮。教程脚本中也提供相应的状态确认。', sourceIds: ['device-guide', 'device-video'] },
      { heading: '找不到启动键怎么办？', text: '面板合成图注明确将启动键标在设备顶部。真实产品应以其官方说明书为准。', sourceIds: ['device-diagram'] },
      { heading: '状态灯一直闪烁怎么办？', text: '合成指南仅建议核对电源连接和启动步骤，没有硬件维修方法。知识页不能补写来源不存在的维修步骤。', sourceIds: ['device-guide'] },
    ],
  },
  {
    id: 'evidence-guide', title: '项目名称与来源对照', type: '概念', updated: '2026-10-08 16:45',
    summary: '合成概念页：对照青榆灯塔和 Project Cedar Beacon，保留不同来源文件而不把重复片段当作不同事实。',
    sourceIds: ['cedar-overview', 'cedar-english'],
    relatedIds: ['cedar-project', 'cedar-budget'],
    sections: [
      { heading: '同一对象的两个名称', text: '中文说明书与英文概览都明确将青榆灯塔对应到 Project Cedar Beacon。这一名称关联来自合成资料本身，而不是模型自行猜测。', sourceIds: ['cedar-overview', 'cedar-english'] },
      { heading: '保留文件身份', text: '内容相同不表示文件相同。查找哪些资料提到某主题时，应列出实际匹配的各份文件；综合回答则可以合并重复事实并保留对应来源。', sourceIds: ['cedar-overview', 'cedar-english'] },
    ],
  },
];

export const proposals = [
  {
    id: 'clarify-budget', title: '补充预算口径，避免把计划值当成实际支出',
    pageId: 'cedar-budget', sourceId: 'cedar-budget',
    reason: '合成审阅示例：新增预算说明强调“计划预算”，建议在页面开头保留限定。不是实际后台生成的变更。',
    before: '青榆灯塔项目预算为人民币 48,600 元。',
    after: '青榆灯塔项目的计划预算为人民币 48,600 元；资料未给出实际支出。',
  },
  {
    id: 'clarify-ready', title: '明确就绪条件是绿色常亮，而不只是灯亮',
    pageId: 'device-start', sourceId: 'device-audio',
    reason: '合成审阅示例：操作讲解提供状态灯确认细节，等待人工核对来源。不是实际 ASR 或知识编译结果。',
    before: '按下顶部启动键，看到状态灯亮后即可。',
    after: '按下顶部启动键，等待状态灯由闪烁变为绿色常亮，确认进入就绪状态。',
  },
];

const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

/** A literal catalog demonstration, not vector search or a backend contract. */
export function searchCatalog(query, { kind = 'all' } = {}) {
  const term = normalize(query);
  const pageMatch = (page) => normalize([
    page.title, page.summary, ...page.sections.map((section) => `${section.heading} ${section.text}`),
  ].join(' ')).includes(term);
  const sourceMatch = (source) => normalize([
    source.title, source.summary, ...source.content.map((part) => part.text),
  ].join(' ')).includes(term);
  const mediaKinds = ['pdf', 'video', 'audio', 'image', 'text'];
  return {
    pages: ['all', 'knowledge', 'pages'].includes(kind) ? pages.filter(pageMatch) : [],
    sources: ['all', 'sources'].includes(kind)
      ? sources.filter(sourceMatch)
      : mediaKinds.includes(kind) ? sources.filter((source) => source.kind === kind && sourceMatch(source)) : [],
  };
}

function exampleAnswer(intent, summary, paragraphs, pageIds) {
  const sourceIds = [...new Set(paragraphs.flatMap((paragraph) => paragraph.sourceIds))];
  return {
    kind: 'answer', intent, summary, paragraphs, sourceIds, pageIds,
    steps: [
      { label: '识别意图', detail: `${intent} · 固定本地示例，未调用模型` },
      { label: '查找示例资料', detail: `列出 ${sourceIds.length} 份相关合成来源，保留文件身份` },
      { label: '组织预览结果', detail: '仅展示预写内容；没有执行真实检索、重排或生成' },
    ],
  };
}

function unmatchedExampleAnswer() {
  return {
    kind: 'not_found', intent: '超出交互示例',
    summary: '这版仅用于确认前端流程，尚未连接问答后端。当前问题不在固定合成示例中，因此不生成或编造答案。可试“灯塔”“青榆灯塔项目预算是多少”或“灯塔设备怎么开机”。',
    paragraphs: [], sourceIds: [], pageIds: [],
    steps: [{ label: '停止示例匹配', detail: '未调用检索服务或模型；这不是线上 no_evidence 结果' }],
  };
}

/** Fixed examples only. Unrecognised questions must never appear remotely answered. */
export function createExampleAnswer(question) {
  const text = normalize(question).replace(/\s+/g, '');
  const exactSource = sources.find((source) => text === normalize(`${source.title}讲了什么？`).replace(/\s+/g, ''));
  if (exactSource) {
    return exampleAnswer('阅读来源概览', `合成源概览 · ${exactSource.title}：${exactSource.summary}`,
      exactSource.content.slice(0, 2).map((part) => ({
        text: `${part.locator}：${part.text}`, sourceIds: [exactSource.id],
      })), [...exactSource.wikiIds]);
  }
  const isTopic = /灯塔|青榆|cedar|beacon|lt-demo/.test(text);
  const namesDevice = /设备|lt-demo/.test(text);
  const namesProject = /青榆|cedar|beacon|项目/.test(text);
  if (isTopic && /哪些文件|哪些资料|包含灯塔|查找文件|找到.*文件/.test(text)) {
    const prefix = namesProject && !namesDevice ? 'cedar-' : namesDevice && !namesProject ? 'device-' : '';
    const matches = sources.filter((source) => source.id.startsWith(prefix));
    const topics = prefix === 'cedar-' ? '属于“青榆灯塔项目”主题' : prefix === 'device-' ? '属于“灯塔设备”主题' : '分为“青榆灯塔项目”和“灯塔设备”两类';
    const pageIds = prefix === 'cedar-' ? ['cedar-project'] : prefix === 'device-' ? ['device-start'] : ['cedar-project', 'device-start'];
    return exampleAnswer('查找资料',
      `本地合成示例中有 ${matches.length} 份资料${topics}。以下不是对线上全库的检索结果，也不代表真实资料的完整清单。`,
      matches.map((source) => ({ text: `${source.title}：${source.summary}`, sourceIds: [source.id] })),
      pageIds);
  }
  if (text.includes('讲了什么')) return unmatchedExampleAnswer();
  if (/^(灯塔|灯塔是什么|灯塔是啥)[？?。]*$/.test(text)) {
    return exampleAnswer('辨别主题', '这个合成知识库里，“灯塔”有两个含义。先区分对象，避免把项目预算与设备操作混在一起。', [
      { text: '青榆灯塔项目：虚构的 Project Cedar Beacon，资料介绍计划启动日期和计划预算。可以继续问“青榆灯塔项目预算是多少？”', sourceIds: ['cedar-overview'] },
      { text: '灯塔设备：虚构的 LT-Demo 演示设备，资料包含开机指南与教程脚本。可以继续问“灯塔设备怎么开机？”', sourceIds: ['device-guide'] },
    ], ['cedar-project', 'device-start']);
  }
  if (!namesDevice && (isTopic || /^(项目)?预算(是多少|多少|呢)[？?。]*$/.test(text)) && /预算|budget|经费|多少钱/.test(text)) {
    return exampleAnswer('查询项目事实', '合成资料中，青榆灯塔项目的计划预算为人民币 48,600 元。', [
      { text: '预算说明明确使用“计划预算”，不是实际支出；没有采购明细或付款进度，不据此推算。', sourceIds: ['cedar-budget'] },
      { text: '中文项目说明书与英文概览记录相同的计划金额，合并为同一事实，同时保留两份来源。', sourceIds: ['cedar-overview', 'cedar-english'] },
    ], ['cedar-budget', 'cedar-project']);
  }
  if (!namesProject && (isTopic || /^(怎么|如何)开机[？?。]*$/.test(text)) && /开机|使用|启动键|常亮|闪烁|就绪/.test(text)) {
    return exampleAnswer('查找操作步骤', '以下是虚构 LT-Demo 灯塔演示设备的开机示例；不是实际设备操作说明。', [
      { text: '1. 接入演示电源。\n2. 按下顶部启动键。\n3. 等待状态灯由闪烁变为绿色常亮，确认就绪。', sourceIds: ['device-guide'] },
      { text: '教程脚本 00:12–00:26 对应接电与按键，00:26–00:40 对应就绪确认。这些是合成定位，尚未接入真实视频播放。', sourceIds: ['device-video'] },
    ], ['device-start', 'device-faq']);
  }
  if (!namesDevice && isTopic && /计划.*(日期|时间)|什么时候.*启动|启动日期|launchdate/.test(text)) {
    return exampleAnswer('查询项目事实', '合成资料记录青榆灯塔项目的计划启动日期为 2026 年 11 月 18 日。', [
      { text: '中文说明书与英文概览均写的是计划启动日期，没有证明已经启动。', sourceIds: ['cedar-overview', 'cedar-english'] },
    ], ['cedar-project', 'cedar-budget']);
  }
  if (/^(project|cedarbeacon|projectcedarbeacon|青榆灯塔|青榆灯塔项目|介绍青榆灯塔项目|青榆灯塔项目是什么)[？?。]*$/.test(text)) {
    return exampleAnswer('了解项目', '青榆灯塔（Project Cedar Beacon）是合成验收资料中的虚构项目。', [
      { text: '计划启动日期为 2026 年 11 月 18 日，计划预算为人民币 48,600 元。本文不代表真实项目与业务数据。', sourceIds: ['cedar-overview', 'cedar-english'] },
    ], ['cedar-project', 'cedar-budget']);
  }
  return unmatchedExampleAnswer();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function parseRoute(hash) {
  const fallback = { view: 'home', id: null };
  let path;
  try { path = decodeURIComponent(String(hash ?? '').replace(/^#\/?/, '')); } catch { return fallback; }
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return fallback;
  const [view, id] = parts;
  if (!['home', 'knowledge', 'sources', 'ask', 'graph', 'review', 'settings'].includes(view)) return fallback;
  if (parts.length > 2 || (id && (!['knowledge', 'sources'].includes(view) || !/^[a-z0-9-]+$/.test(id)))) return fallback;
  return { view, id: id || null };
}
