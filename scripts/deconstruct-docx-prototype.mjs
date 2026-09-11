#!/usr/bin/env node
/**
 * scripts/deconstruct-docx-prototype.mjs
 *
 * Plan 193（direction spike）最小链路验证：
 *   自造最小 docx（临时目录，用后清理）
 *     → mammoth extractRawText 抽取纯文本
 *     → 章节边界优先 / 段落边界兜底的两层切分（设计见 docs/prd/2026-09-deconstruction-doc-pipeline.md §5.2）
 *     → 以资料续写同款方式组装输入（buildContinuationPackPrompt，不真实调用 LLM）
 *     → 断言每块满足 extractSkillSchema 的 text 约束（直接 import 真实 schema）并能通过
 *       /api/extract-skill 的 Layer-1 输入门禁（validateExtractSkillInput）。
 *
 * 不触网络、不触 data.db、不修改任何仓库文件。
 * 运行：node --import tsx scripts/deconstruct-docx-prototype.mjs   （预期 exit 0）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  buildContinuationPackPrompt,
  buildContinuationPackParseAttempts,
} from '../shared/lib/continuation-pack-parse.ts';
import { extractSkillSchema } from '../server/validation.ts';
import { buildBookEvidenceSegments } from '../shared/lib/book-skill-segmentation.ts';
import { validateExtractSkillInput } from '../shared/lib/quality-gates.ts';

// extractSkillSchema.text 上限（server/validation.ts:310）。切分预算必须低于它；
// 真正的断言使用从源码 import 的真实 zod schema，而不是这里抄的数字。
const SCHEMA_TEXT_MAX = 150_000;
// 建议生产预算（PRD §5.3）；验证脚本用环境变量覆盖以演示两种切分形态。
const DEFAULT_CHUNK_BUDGET = 60_000;
const MAX_CHUNKS = 100; // 对齐 shared/lib/sync-extraction-chunks.ts 的 SYNC_EXTRACTION_MAX_CHUNKS 先例

let passed = 0;
function assert(cond, message) {
  if (!cond) throw new Error(`断言失败: ${message}`);
  passed += 1;
}

/* ------------------------------------------------------------------ */
/* 1. 自造测试 docx：2 卷 × 6 章，每章 34 段叙事文本（确定性伪随机生成）  */
/* ------------------------------------------------------------------ */

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ACTORS = ['陈焕', '老霍', '七姨', '哑巴张', '裴照', '小满', '盐枭头目', '驿丞'];
const PLACES = [
  '漠北荒原',
  '青石长街',
  '旧渡口',
  '废弃盐矿',
  '烽燧下',
  '马厩后院',
  '冰封河道',
  '山神庙',
];
const OBJECTS = ['半块虎符', '淬毒短刀', '油纸包', '铜哨', '账册', '酒葫芦'];

const SENTENCE_TEMPLATES = [
  (a, b, place, obj) => `${a}沿着${place}走了半里地，靴底碾过碎冰，怀里那${obj}硌得肋骨发疼。`,
  (a, b, place, _obj) => `${b}没有回头，只把缰绳往${a}手里一塞：“马留给你，${place}的路自己挑。”`,
  (a, b, place, obj) => `风从${place}的豁口灌进来，${a}把${obj}往袖中又藏深了一寸。`,
  (a, b, place, _obj) => `${a}数到第三声，${b}仍旧站在${place}的阴影里，既不应答，也不离开。`,
  (a, b, place, obj) =>
    `“${obj}若是假的，你我现在就该翻脸。”${a}说这话时，眼睛一直盯着${place}的方向。`,
  (a, b, place, _obj) => `${b}蹲下身，用刀尖拨开积雪，露出底下一行朝${place}去的马蹄印。`,
  (a, b, place, _obj) => `火把熄了又燃。${a}终于开口：“过了今夜，${place}的人都得换个活法。”`,
  (a, b, place, _obj) => `${b}的咳嗽声压得很低，像是从${place}的地底下渗出来的。`,
  (a, b, place, obj) =>
    `${a}记着师父的话：越是临近${place}，越要慢；越是要紧的${obj}，越要松着手拿。`,
  (a, b, _place, _obj) => `马蹄声停在十步之外。${b}掀开斗篷，露出里头驿站官服的滚边。`,
  (a, b, place, obj) => `${a}把${obj}在掌心颠了颠，忽然笑了：“原来${place}的规矩，是拿人命算账。”`,
  (a, b, place, _obj) => `三十年来，${place}只认两条规矩：不问来路，不欠旧账。${b}偏要问。`,
  (a, b, place, _obj) => `更鼓敲过三巡，${a}吹熄了灯，听${place}外的脚步声由远及近，又由近及远。`,
  (a, b, place, _obj) => `${b}递过来半张饼：“先吃。骂人的力气，留到过了${place}再使。”`,
  (a, b, place, _obj) => `刀出鞘只有一寸，${a}就停住了——${place}那头，有人先一步吹响了铜哨。`,
  (a, b, place, _obj) => `${a}后来才知道，那晚${place}上多出来的三口棺材，口口都钉着官家的封条。`,
  (a, b, place, obj) => `雪停的时候，${b}把${obj}埋进${place}的老槐树下，动作快得像在销一桩旧罪。`,
  (a, b, place, _obj) => `“你信人，还是信账？”${a}问。${b}望着${place}：“我信利钱，它最诚实。”`,
  (a, b, place, _obj) =>
    `${b}一路沉默，直到${place}的轮廓在暮色里显出来，才说了句：“待会儿见机行事。”`,
  (a, b, place, _obj) => `${a}把最后一枚铜钱押在桌角。骰盅未开，${place}的门先被人从外面踹开了。`,
];

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function buildBookParagraphs() {
  const paragraphs = [];
  const volumes = [
    { title: '第一卷 漠北风起', chapterOffset: 0 },
    { title: '第二卷 冰河暗涌', chapterOffset: 6 },
  ];
  for (const volume of volumes) {
    paragraphs.push(volume.title);
    for (let c = 0; c < 6; c++) {
      const chapterNo = volume.chapterOffset + c + 1;
      paragraphs.push(`第${CN_NUM[chapterNo - 1]}章 ${PLACES[c % PLACES.length]}惊变`);
      const rng = makeRng(chapterNo * 7919 + volume.chapterOffset);
      for (let p = 0; p < 34; p++) {
        const sentences = [];
        const count = 4 + Math.floor(rng() * 3); // 每段 4-6 句
        for (let s = 0; s < count; s++) {
          const tpl = SENTENCE_TEMPLATES[Math.floor(rng() * SENTENCE_TEMPLATES.length)];
          sentences.push(
            tpl(
              ACTORS[Math.floor(rng() * ACTORS.length)],
              ACTORS[Math.floor(rng() * ACTORS.length)],
              PLACES[Math.floor(rng() * PLACES.length)],
              OBJECTS[Math.floor(rng() * OBJECTS.length)]
            )
          );
        }
        paragraphs.push(sentences.join(''));
      }
    }
  }
  return paragraphs;
}

function buildMinimalDocx(paragraphs) {
  const esc = (s) => s; // 句池不含 XML 特殊字符（< > &）
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ------------------------------------------------------------------ */
/* 2. 两层切分：章节边界优先，段落边界兜底，超长段落安全阀              */
/* ------------------------------------------------------------------ */

const HEADING_RE = /^第[0-9一二三四五六七八九十百千万零两]+[章卷回节]/;

function isHeading(paragraph) {
  return paragraph.length <= 30 && HEADING_RE.test(paragraph);
}

// 回退标题边界时，标题前的内容至少要这么多字，避免「卷标题 + 紧跟章标题」
// 被切成只有几个字的碎块（这类碎块会被 extract-skill 输入门禁正确拒绝）。
const MIN_CHUNK_CHARS = 500;

/**
 * @returns {string[]} 每块 ≤ chunkBudget 的文本块
 *
 * 策略（PRD §5.2）：按段落贪心装箱；仅在装不下时切分，切分点优先回退到块内
 * 最后一个章节标题（章节对齐），标题前内容过薄则直接段前切（段落边界兜底）。
 * 单段超预算是唯一句中硬切的例外（安全阀）。
 * 注：生产版按 PRD §5.2 还会在块间保留 ≤200 字重叠窗（budget + overlap ≪ 15 万
 * schema 上限，不影响 schema 合规），原型为让对齐断言保持清晰，未启用重叠。
 */
function splitIntoDeconstructionChunks(text, chunkBudget, maxChunks = MAX_CHUNKS) {
  if (chunkBudget < 1 || chunkBudget > SCHEMA_TEXT_MAX) {
    throw new Error(`切分预算必须在 1..${SCHEMA_TEXT_MAX} 之间，收到 ${chunkBudget}`);
  }
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current = [];

  const packedLen = (list) => list.reduce((n, p) => n + p.length + 2, 0);
  const flush = (upTo = current.length) => {
    if (upTo <= 0) return;
    chunks.push(current.slice(0, upTo).join('\n\n'));
    current = current.slice(upTo);
    if (chunks.length > maxChunks)
      throw new Error(`DECONSTRUCTION_CHUNK_LIMIT: 超过 ${maxChunks} 块上限`);
  };

  for (const para of paragraphs) {
    // 超长单段安全阀：句中硬切是唯一允许的例外
    if (para.length > chunkBudget) {
      flush();
      for (let offset = 0; offset < para.length; offset += chunkBudget) {
        chunks.push(para.slice(offset, offset + chunkBudget));
      }
      continue;
    }
    // 装不下才切：优先回退到块内最后一个章节标题，否则在当前段前切
    if (current.length > 0 && packedLen(current) + para.length + 2 > chunkBudget) {
      let headingIdx = -1;
      for (let i = current.length - 1; i > 0; i--) {
        if (isHeading(current[i])) {
          headingIdx = i;
          break;
        }
      }
      if (headingIdx > 0 && packedLen(current.slice(0, headingIdx)) >= MIN_CHUNK_CHARS) {
        flush(headingIdx);
      } else {
        flush();
      }
    }
    current.push(para);
  }
  flush();
  return chunks;
}

/* ------------------------------------------------------------------ */
/* 3. 输入组装（与 /api/continuation-packs/parse 的 buildDocumentsForPrompt */
/*    同款形态：【文件名】+ 正文分节，再交给 buildContinuationPackPrompt） */
/* ------------------------------------------------------------------ */

function assembleContinuationStylePrompt(chunks) {
  const attempt = buildContinuationPackParseAttempts('')[0]; // 常规 provider 首档：15000 字/文档
  const documentsForPrompt = chunks
    .map(
      (text, i) =>
        `【deconstruction-chunk-${i + 1}.docx】\n${text.slice(0, attempt.maxCharsPerDocument)}\n`
    )
    .join('\n---\n');
  return buildContinuationPackPrompt(documentsForPrompt, attempt.compactMode);
}

/* ------------------------------------------------------------------ */
/* 4. 验证主体                                                          */
/* ------------------------------------------------------------------ */

function assertChunkIsAcceptable(chunk, label) {
  // (a) 真实 extractSkillSchema 的 text 约束 + 完整请求体（novelId 用占位）
  const bodyParse = extractSkillSchema.safeParse({ text: chunk, novelId: 'prototype-novel-id' });
  assert(
    bodyParse.success,
    `${label} 未通过 extractSkillSchema：${JSON.stringify(bodyParse.error?.issues ?? [])}`
  );
  // (b) /api/extract-skill 的 Layer-1 输入门禁（中文字数/刷屏/多样性/虚词检查）
  const gate = validateExtractSkillInput(chunk);
  assert(gate.accepted, `${label} 未通过输入门禁：${gate.rejectedReason}`);
  // (c) 该块能产出非空的五段窗证据段（extract-skill 的段级输入组装）。
  //     摘录的 12000 字上限在 skills.ts:116 组装 prompt 时施加（excerpt.substring(0, 12000)），
  //     buildBookEvidenceSegments 本身不截断，故此处只断言摘录非空。
  const segments = buildBookEvidenceSegments(chunk);
  assert(segments.length >= 1, `${label} 未能产出任何证据段`);
  assert(
    segments.every((s) => s.excerpt.length > 0),
    `${label} 存在空摘录的证据段`
  );
}

async function main() {
  console.log('== Plan 193 拆书文档管线原型 ==');

  // 1) 生成最小 docx，写入临时目录再读回（模拟真实上传文件路径），用后清理
  const paragraphs = buildBookParagraphs();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-deconstruct-proto-'));
  let extractedText;
  try {
    const docxPath = path.join(dir, 'sample-book.docx');
    fs.writeFileSync(docxPath, await buildMinimalDocx(paragraphs));
    const mammoth = await import('mammoth');
    const result = await mammoth.default.extractRawText({ buffer: fs.readFileSync(docxPath) });
    extractedText = result.value;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const chapterCount = paragraphs
    .filter(isHeading)
    .filter((p) => p.startsWith('第') && p.includes('章')).length;
  console.log(`docx 抽取完成：${extractedText.length} 字符，${chapterCount} 个章节标题`);
  assert(extractedText.length > 60_000, '抽取文本应超过单块预算，否则演示不出切分');
  assert(
    extractedText.includes('第一卷') && extractedText.includes('第十二章'),
    '抽取文本应包含卷/章标题'
  );
  assert(
    fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('inkflow-deconstruct-proto-')).length ===
      0,
    '临时目录应已清理'
  );

  // 2) 形态 A：生产预算 60,000 字 —— 整本 7 万+ 字切为少数大块
  const bigChunks = splitIntoDeconstructionChunks(extractedText, DEFAULT_CHUNK_BUDGET);
  console.log(
    `形态 A（budget=${DEFAULT_CHUNK_BUDGET}）：切分出 ${bigChunks.length} 块，长度 [${bigChunks.map((c) => c.length).join(', ')}]`
  );
  assert(bigChunks.length >= 2, '应切出至少 2 块');
  bigChunks.forEach((chunk, i) => {
    assert(chunk.length <= DEFAULT_CHUNK_BUDGET, `块 ${i + 1} 超出预算 ${DEFAULT_CHUNK_BUDGET}`);
    assertChunkIsAcceptable(chunk, `形态 A 块 ${i + 1}`);
  });
  assert(
    bigChunks.every((c) => HEADING_RE.test(c)),
    '每块都应至少覆盖一个章节标题（无章节被整块丢失）'
  );
  const chaptersInChunks = bigChunks.reduce(
    (acc, c) => acc + (c.match(/第[一二三四五六七八九十]+章/g) ?? []).length,
    0
  );
  assert(chaptersInChunks >= chapterCount - 1, '各块标题计数应接近原章节数（允许边界截断误差 ≤1）');

  // 3) 形态 B：小预算 9,000 字 —— 每章一块，验证章节边界对齐
  const chapterBudget = 9_000;
  const alignedChunks = splitIntoDeconstructionChunks(extractedText, chapterBudget);
  console.log(
    `形态 B（budget=${chapterBudget}）：切分出 ${alignedChunks.length} 块（期望每章一块 = ${chapterCount} 块）`
  );
  assert(alignedChunks.length === chapterCount, '章节对齐切分应恰好每章一块');
  alignedChunks.forEach((chunk, i) => {
    assert(isHeading(chunk.split('\n\n')[0]), `对齐块 ${i + 1} 未以章节标题开头`);
    assertChunkIsAcceptable(chunk, `形态 B 块 ${i + 1}`);
  });

  // 4) 输入组装：与资料续写 buildDocumentsForPrompt 同款，buildContinuationPackPrompt 不调 LLM
  const prompt = assembleContinuationStylePrompt(alignedChunks);
  console.log(`组装 prompt：${prompt.length} 字符（含系统指令 + ${alignedChunks.length} 个分节）`);
  assert(
    typeof prompt === 'string' && prompt.includes('输出结构'),
    'prompt 应由 buildContinuationPackPrompt 生成'
  );
  alignedChunks.forEach((chunk, i) => {
    assert(
      prompt.includes(`【deconstruction-chunk-${i + 1}.docx】`),
      `prompt 应包含块 ${i + 1} 的分节标题`
    );
  });

  console.log(`\n全部通过：${passed} 项断言，exit 0。`);
  console.log('结论：docx → mammoth 抽取 → 章节切分 → extract-skill 可接受输入 的最小链路成立。');
}

main().catch((error) => {
  console.error(`\n原型验证失败：${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
