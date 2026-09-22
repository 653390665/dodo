
/**
 * Plan 261 知识谱系常驻模块：把资料包里的权威素材（逐章细纲/遗物体系/公理）
 * 解析成结构化资产并入库（伏笔台账、图谱边），提供覆盖度报告。
 *
 * 设计约束：
 * - 幂等：重复运行不产生重复行（台账按 title+plantedChapterId 去重，边按
 *   source+target+type 去重）。
 * - 提案制：写入的都是从用户资产解析出的确定性事实，不自动删除任何既有行。
 * - 可重跑：资料包文档更新后重新运行即可增量补齐。
 */

export interface XigangEntry {
  chapterNo: string;
  title: string;
  fields: Record<string, string>;
}

/** 从逐章细纲 markdown 解析每章条目（### Ch001 · 标题 + 字段行）。 */
export function extractXigangEntries(markdown: string): XigangEntry[] {
  const entries: XigangEntry[] = [];
  const lines = String(markdown || '').split('\n');
  let current: XigangEntry | null = null;
  let lastField: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^###\s+(Ch\d+(?:_\d+)?)\s*·\s*(.+)$/);
    if (heading) {
      if (current) entries.push(current);
      current = { chapterNo: heading[1], title: heading[2].trim(), fields: {} };
      lastField = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('### ')) {
      // 单元标题（"### U01 · 入队"）等非章节小节——先落袋当前条目再挂起，
      // 继续扫描后续 Ch 条目（run 首测：此处 break/丢弃导致只解析到 5 条）。
      if (current) entries.push(current);
      current = null;
      lastField = null;
      continue;
    }
    const field = line.match(/^(?:-\s*)?\*\*([^*]+)\*\*[：:]\s*(.*)$/);
    if (field) {
      const key = field[1].trim();
      current.fields[key] = field[2].trim();
      lastField = key;
      continue;
    }
    if (line && lastField && !line.startsWith('---') && !line.startsWith('|')) {
      current.fields[lastField] += `\n${line}`;
    }
  }
  if (current) entries.push(current);
  return entries;
}


export interface AffinityEdge {
  itemName: string;
  characterName: string;
}

/** 道具描述中点名的角色 → 道具与角色的关联边（description 含角色名即命中）。 */
export function extractCharacterItemAffinityEdges(
  items: Array<{ id: string; name: string; description: string }>,
  characterNames: Set<string>
): AffinityEdge[] {
  const edges: AffinityEdge[] = [];
  for (const item of items) {
    for (const name of characterNames) {
      if (name.length >= 2 && String(item.description || '').includes(name)) {
        edges.push({ itemName: item.name, characterName: name });
      }
    }
  }
  return edges;
}

/** 角色小传/当前状态中提到的地点 → 角色-地点 居住/常驻边。 */
export function extractCharacterLocationEdges(
  characters: Array<{ id: string; name: string; bio: string; current_state: string }>,
  locationNames: Set<string>
): Array<{ characterId: string; locationId: string; locationName: string }> {
  const edges: Array<{ characterId: string; locationId: string; locationName: string }> = [];
  for (const char of characters) {
    const text = `${char.bio || ''} ${char.current_state || ''}`;
    for (const loc of locationNames) {
      if (loc.length >= 2 && text.includes(loc)) {
        edges.push({ characterId: char.id, locationId: loc, locationName: loc });
      }
    }
  }
  return edges;
}

export interface ElementProposal {
  name: string;
  description: string;
  firstSeenChapter: string;
  sourceField: string;
}

/**
 * Phase2 补充：叙事元素实体化提案——从细纲条目的"关键道具/信息"与
 * "伏笔埋点"字段提取库中尚不存在的元素（如"外卖订单""便利贴"），
 * 生成提案供确认后入道具库并连边。提案制：只产出候选，不直接写库。
 */
export function extractElementProposals(
  entries: XigangEntry[],
  existingItemNames: Set<string>
): ElementProposal[] {
  const proposals: ElementProposal[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const fieldName of ['关键道具/信息', '伏笔埋点']) {
      const value = (entry.fields[fieldName] || '').trim();
      if (!value) continue;
      for (const sentence of value.split(/[。；\n]/)) {
        // "X=Y" 取 X；纯名词短语取整句
        const candidate = sentence.split(/[=＝]/)[0].trim();
        const name = candidate.split(/[，,、]/)[0].trim().replace(/^[\s-]*/, '');
        if (name.length < 2 || name.length > 24) continue;
        if (/^(?:无|待定|本场景|承接)/.test(name)) continue;
        const dedupeKey = name;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const inLibrary = [...existingItemNames].some(
          (itemName) => itemName.includes(name) || name.includes(itemName)
        );
        if (inLibrary) continue;
        seen.add(dedupeKey);
        proposals.push({
          name,
          description: sentence.slice(0, 160),
          firstSeenChapter: entry.chapterNo,
          sourceField: fieldName,
        });
      }
    }
  }
  return proposals;
}

export interface LedgerRow {
  title: string;
  description: string;
  plantedChapter: string;
  payoffChapter: string | null;
  payoffNote: string;
}

/**
 * 从细纲条目提取伏笔台账行——每条"伏笔埋点"句拆一行，
 * 回收章字段（如 "Ch005（暴走骑手首次击退）/ Ch006"）归并进行内。
 */
export function extractForeshadowingLedger(entries: XigangEntry[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const entry of entries) {
    const plant = (entry.fields['伏笔埋点'] || '').trim();
    if (!plant) continue;
    const payoffRaw = (entry.fields['回收章'] || '').trim();
    const payoffMatch = payoffRaw.match(/Ch\d+/);
    const sentences = plant
      .split(/[。；]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6);
    for (const sentence of sentences) {
      const title = sentence.split(/[=＝]/)[0].slice(0, 40);
      rows.push({
        title,
        description: sentence,
        plantedChapter: entry.chapterNo,
        payoffChapter: payoffMatch ? payoffMatch[0] : null,
        payoffNote: payoffRaw,
      });
    }
  }
  return rows;
}

export interface RelicEdge {
  no: string;
  itemName: string;
  holderName: string;
  level: string;
  note: string;
}

/** 从遗物体系档案的"完整索引表"解析 遗物→当前持有人 边。 */
export function extractRelicHolderEdges(relicDoc: string): RelicEdge[] {
  const edges: RelicEdge[] = [];
  for (const rawLine of String(relicDoc || '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || line.includes('---')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    // 标准表列序：NO. | 名称 | 等级 | 来源 | 当前持有人 | 登场单元 | 功能简述 | ...
    if (cells.length < 5 || !/^\d{3}$/.test(cells[0])) continue;
    const holder = cells[4].replace(/（[^）]*）/g, '').trim();
    if (!holder) continue;
    edges.push({
      no: cells[0],
      itemName: cells[1],
      holderName: holder,
      level: cells[2] || '',
      note: cells[6] || '',
    });
  }
  return edges;
}

export interface PowerEdge {
  powerName: string;
  holderName: string;
}

/** 从力量体系描述（"左妄持有，不锻炼"）解析 公理→持有者 边。 */
export function extractPowerHolderEdges(
  powerRows: Array<{ name: string; description: string }>,
  characterNames: Set<string>
): PowerEdge[] {
  const edges: PowerEdge[] = [];
  for (const row of powerRows) {
    const head = String(row.description || '').split(/[，,；;]/)[0].trim();
    const holder = [...characterNames].find((name) => head.startsWith(name));
    if (holder) edges.push({ powerName: row.name, holderName: holder });
  }
  return edges;
}

/** 关系类型同义归一（保守映射，只合并语义完全相同的写法）。 */
export const RELATIONSHIP_TYPE_SYNONYMS: Record<string, string> = {
  债主: '债务',
  欠债: '债务',
  债权人: '债务',
  '债主-欠债人': '债务',
  房东房客: '房东-房客',
  '租户-房东': '房东-房客',
  镜像关系: '镜像',
  专属镜像: '镜像',
  伙伴: '同伴',
  同行者: '同伴',
  旧搭档: '旧识',
  邻居: '邻里',
  友邻: '邻里',
  前同事: '旧识',
  '医患/互相需要': '医患',
  唯一电话线: '唯一通讯渠道',
};

export function normalizeRelationshipType(relationshipType: string): string {
  return RELATIONSHIP_TYPE_SYNONYMS[relationshipType] || relationshipType;
}

export interface WorldviewHints {
  redLines: string;
  axioms: string;
  bannedWords: string;
  signatureWords: string;
  voiceLines: string;
  hintsBlock: string;
}

function parseMarkdownRows(section: string): string[][] {
  return section
    .split('\n')
    .filter((line) => line.trim().startsWith('|') && !line.includes('---') && !/编号|公理\s*\|\s*内容/.test(line))
    .map((line) =>
      line
        .split('|')
        .map((c) => c.trim().replace(/\*\*/g, ''))
        .filter((c) => c.length > 0)
    );
}

function cutSection(text: string, startTitle: string, maxLen: number): string {
  const idx = text.indexOf(startTitle);
  if (idx < 0) return '';
  const rest = text.slice(idx + startTitle.length);
  const next = rest.search(/\n## /);
  return rest.slice(0, next > 0 ? Math.min(next, maxLen) : maxLen);
}

/**
 * Phase3：世界观化用提示——从元设定 D3 提取创作红线/四公理/禁忌词/
 * 推荐词/出场角色语言调性，组成 writer 的化用提示块（紧凑，防复述）。
 */
export function extractWorldviewHints(
  metaDoc: string,
  castNames: string[] = []
): WorldviewHints {
  const text = String(metaDoc || '');
  if (!text) {
    return { redLines: '', axioms: '', bannedWords: '', signatureWords: '', voiceLines: '', hintsBlock: '' };
  }

  const redRows = parseMarkdownRows(cutSection(text, '## 一、五条创作红线', 3000));
  const redLines = redRows.slice(0, 6)
    .map((cells) => '- ' + (cells[0] || '') + (cells[1] ? '（' + cells[1] + '）' : '') + ': ' + (cells[2] || '').slice(0, 90))
    .join('\n');

  const axiomRows = parseMarkdownRows(cutSection(text, '## 七、四公理', 2000));
  const axioms = axiomRows.slice(0, 5)
    .map((cells) => '- ' + (cells[0] || '') + ': ' + (cells[1] || '').slice(0, 80) + '（化用：' + (cells[2] || '').slice(0, 50) + '）')
    .join('\n');

  const bannedRaw = cutSection(text, '### 4.1 禁忌词', 300);
  const bannedMatch = bannedRaw.match(/[❌]\s*([^\n]+)/);
  const bannedWords = bannedMatch ? bannedMatch[1].trim() : '';
  const sigRaw = cutSection(text, '### 4.2 推荐词', 300);
  const sigMatch = sigRaw.match(/[✅]\s*([^\n]+)/);
  const signatureWords = sigMatch ? sigMatch[1].trim() : '';

  const voiceRows = parseMarkdownRows(cutSection(text, '### 4.3 角色语言调性速查', 3000));
  const voiceLines = voiceRows
    .filter((cells) => castNames.some((name) => (cells[0] || "").includes(name)))
    .slice(0, 6)
    .map((cells) => '- ' + (cells[0] || '') + ': ' + (cells[1] || '') + '，' + (cells[3] || '').slice(0, 40))
    .join('\n');

  const parts: string[] = ['【世界观化用提示——化用规则感与语调，禁止直白复述本块】'];
  if (redLines) parts.push('创作红线（违反即崩设定）：\n' + redLines);
  if (axioms) parts.push('深渊四公理（异象的因果规则）：\n' + axioms);
  if (bannedWords) parts.push('禁忌词（永不出现在正文）：' + bannedWords);
  if (signatureWords) parts.push('标志性用语（优先自然使用）：' + signatureWords);
  if (voiceLines) parts.push('角色语言调性：\n' + voiceLines);
  const hintsBlock = parts.join('\n');

  return { redLines, axioms, bannedWords, signatureWords, voiceLines, hintsBlock };
}
export function extractOutlineUnit(
  outlineDoc: string,
  chapterOrder: number
): { unitLine: string; unitSummary: string } | null {
  const text = String(outlineDoc || '');
  if (!text) return null;
  const unitHead = text.match(/【(卷[一二三四][^】]*Ch[\d-]+)】/);
  if (!unitHead) return null;
  const rangeMatch = unitHead[1].match(/Ch(\d+)-(\d+)/);
  if (!rangeMatch) return null;
  const lo = Number(rangeMatch[1]);
  const hi = Number(rangeMatch[2]);
  if (chapterOrder < lo || chapterOrder > hi) {
    // 章节不在卷一区间时，仍返回卷一结构信息的第一段供定位参考
  }
  const sectionStart = text.indexOf(unitHead[0]);
  const rest = text.slice(sectionStart + unitHead[0].length);
  const nextVolume = rest.search(/【卷[一二三四]/);
  const section = rest.slice(0, nextVolume > 0 ? nextVolume : 1500);
  const summary = section
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .slice(0, 4)
    .join('\n')
    .slice(0, 600);
  return { unitLine: unitHead[1], unitSummary: summary };
}
