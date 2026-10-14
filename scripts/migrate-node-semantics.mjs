#!/usr/bin/env node
/**
 * 老画布「节点语义」迁移：把历史上编码在节点 id 字符串里的语义，搬到节点 data 字段上。
 *
 * 背景：代码过去靠解析 id 判断「这个节点是什么」——
 *   - 资产图节点 id 形如 `角色-南方-script-123`，删节点时 split('-') 反解资产类型/名称/脚本节点；
 *     资产名里带 '-' 就会切错，线上已有实例（`道具-折子-带血痕--script-…` 解析出的
 *     scriptNodeId 是 `带血痕--script-…`，找不到脚本节点 → 清理静默失效、留下悬空 nodeId）
 *   - 分镜节点 id 形如 `shot-image-{shotId}-script-{ts}[-refN]`，靠拼 id 找已存在的槽位
 *   - 后端按 `style-` / `角色-` 前缀判断风格图与资产图
 * 现在改为：id 只做标识符，语义一律读 data（见 web/src/types/canvas.ts 的 BaseNodeFields）。
 *
 * 本脚本一次性补齐老数据里可恢复的字段：
 *   1. 资产图节点：**从脚本资产的 nodeId 反查**（结构化方向，不解析 id）→ assetType/assetName/scriptNodeId
 *   2. 分镜节点：按旧 id 格式重建（迁移期允许读旧格式，运行期代码不再解析）→ shotId/refIndex（image）/scriptNodeId
 *   3. 顺手清掉已废弃、全仓无读者的 script.assetImageMapping
 * 风格节点不需要迁移：线上 2 个 style- 节点本来就带 data.styleId（后端现在只认这个字段）。
 * 多图派生节点线上 0 个，无需迁移。
 *
 * 不重写任何老节点 id：provider_tasks.node_id / charge_key 记的是同一个 id，
 * 改 id 会切断历史扣费与对账的关联。
 *
 * 用法：
 *   node scripts/migrate-node-semantics.mjs --dry-run            # 本地库，只看会改什么
 *   node scripts/migrate-node-semantics.mjs                      # 本地库，实际写入
 *   node scripts/migrate-node-semantics.mjs --prod --dry-run     # 线上库（走部署私钥 ssh）
 *   node scripts/migrate-node-semantics.mjs --prod               # 线上库，实际写入
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const PROD = argv.includes('--prod');

/** psql 传输层：本地直连 / 线上走部署私钥进容器 */
const TRANSPORT = PROD
  ? {
      label: '线上 libtv-db-1',
      cmd: 'ssh',
      args: [
        '-i', '.ssh-deploy/libtv_ecs',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        'root@60.188.49.208',
        'docker exec -i libtv-db-1 psql -U libtv -d libtv -X -q -t -A -F \'\t\'',
      ],
      env: {},
    }
  : {
      label: '本地 libtv',
      cmd: 'psql',
      args: ['-h', 'localhost', '-U', 'libtv', '-d', 'libtv', '-X', '-q', '-t', '-A', '-F', '\t'],
      env: { PGPASSWORD: 'libtv123' },
    };

function psql(sql) {
  return execFileSync(TRANSPORT.cmd, TRANSPORT.args, {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, ...TRANSPORT.env },
  });
}

const ASSET_FIELDS = [
  { dataType: 'characters', assetType: 'character' },
  { dataType: 'scenes', assetType: 'scene' },
  { dataType: 'props', assetType: 'prop' },
];

/**
 * 旧分镜节点 id：`shot-image-{shotId}-script-{ts}` / `-ref{N}` / `shot-video-{shotId}-script-{ts}`。
 * 只在迁移里读一次；运行期代码不再解析 id。
 */
const LEGACY_SHOT_ID = /^shot-(image|video)-(.+)-script-(\d+?)(?:-ref(\d+))?$/;

/** 对单个画布内容做迁移，返回 { content, stats } */
function migrateCanvas(rawContent) {
  const content = JSON.parse(JSON.stringify(rawContent));
  const nodes = content.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stats = { asset: 0, shot: 0, mapping: 0, orphanShot: 0, dangling: 0, assetSamples: [], shotSamples: [] };

  // ---- 1) 资产图节点：从脚本资产的 nodeId 反查（唯一的结构化方向） ----
  for (const scriptNode of nodes) {
    if (scriptNode.type !== 'script') continue;
    const scriptData = scriptNode.data || {};
    for (const { dataType, assetType } of ASSET_FIELDS) {
      const assets = scriptData[dataType];
      if (!Array.isArray(assets)) continue;
      for (const asset of assets) {
        if (!asset || !asset.nodeId) continue;
        const imageNode = byId.get(asset.nodeId);
        if (!imageNode) {
          // 资产指向的节点已不存在（历史遗留的悬空引用）：没有可迁移的对象
          stats.dangling += 1;
          continue;
        }
        const d = imageNode.data || {};
        const same =
          d.assetType === assetType && d.assetName === asset.name && d.scriptNodeId === scriptNode.id;
        if (same) continue;
        imageNode.data = { ...d, assetType, assetName: asset.name, scriptNodeId: scriptNode.id };
        stats.asset += 1;
        if (stats.assetSamples.length < 3) {
          stats.assetSamples.push(`${asset.nodeId} → assetType=${assetType} assetName=${asset.name}`);
        }
      }
    }
    // 已废弃字段：全仓已无读者（迁移后 type 里也不再声明）
    if (scriptData.assetImageMapping) {
      delete scriptData.assetImageMapping;
      stats.mapping += 1;
    }
  }

  // ---- 2) 分镜节点：按旧 id 格式重建归属 ----
  for (const node of nodes) {
    const m = LEGACY_SHOT_ID.exec(node.id);
    if (!m) continue;
    const [, kind, shotId, ts, refN] = m;
    const scriptNodeId = `script-${ts}`;
    const scriptNode = byId.get(scriptNodeId);
    if (!scriptNode || scriptNode.type !== 'script') {
      stats.orphanShot += 1;
      continue;
    }
    const d = node.data || {};
    const next = { ...d, scriptNodeId, shotId };
    // 只有图片节点是「分镜参考图槽位」，视频节点不带 refIndex
    if (kind === 'image') next.refIndex = refN ? Number(refN) : 1;
    const same = d.scriptNodeId === next.scriptNodeId && d.shotId === shotId && d.refIndex === next.refIndex;
    if (same) continue;
    const shotKnown = (scriptNode.data?.shots || []).some((s) => s.id === shotId);
    if (!shotKnown) stats.orphanShot += 1; // 分镜已从脚本里删掉，但节点还在：补字段但记一笔
    node.data = next;
    stats.shot += 1;
    if (stats.shotSamples.length < 3) {
      stats.shotSamples.push(`${node.id} → shotId=${shotId} refIndex=${next.refIndex ?? '-'} script=${scriptNodeId}`);
    }
  }

  return { content, stats };
}

// ---------------- 主流程 ----------------
console.log(`目标：${TRANSPORT.label}${DRY_RUN ? '（dry-run，不写库）' : ''}\n`);

const rows = psql('SELECT id, content::text FROM canvases ORDER BY id;')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((line) => {
    const tab = line.indexOf('\t');
    return { id: line.slice(0, tab), content: JSON.parse(line.slice(tab + 1)) };
  });

const total = { canvas: rows.length, changedCanvas: 0, asset: 0, shot: 0, mapping: 0, orphanShot: 0, dangling: 0 };
const updates = [];
const backup = {};

for (const row of rows) {
  const before = JSON.stringify(row.content);
  const { content, stats } = migrateCanvas(row.content);
  const after = JSON.stringify(content);
  total.asset += stats.asset;
  total.shot += stats.shot;
  total.mapping += stats.mapping;
  total.orphanShot += stats.orphanShot;
  total.dangling += stats.dangling;
  if (before !== after) {
    total.changedCanvas += 1;
    updates.push({ id: row.id, content });
    backup[row.id] = row.content;
    console.log(
      `画布 ${row.id}: 资产图 ${stats.asset} 个、分镜 ${stats.shot} 个` +
        `${stats.mapping ? `、清理 assetImageMapping ${stats.mapping} 处` : ''}` +
        `${stats.orphanShot ? `、⚠ 分镜归属存疑 ${stats.orphanShot} 个` : ''}` +
        `${stats.dangling ? `、⚠ 资产悬空引用 ${stats.dangling} 处` : ''}`
    );
    for (const s of [...stats.assetSamples, ...stats.shotSamples]) console.log(`    · ${s}`);
  }
}

console.log(
  `\n合计：画布 ${total.canvas} 个，需要改写 ${total.changedCanvas} 个；` +
    `资产图补字段 ${total.asset} 个、分镜补字段 ${total.shot} 个、` +
    `清理 assetImageMapping ${total.mapping} 处；` +
    `⚠ 分镜归属存疑 ${total.orphanShot} 个、⚠ 资产悬空引用 ${total.dangling} 处`
);

if (updates.length === 0) {
  console.log('\n无需改动（已迁移过）。');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('\ndry-run 结束，未写库。');
  process.exit(0);
}

// 备份 + 写入
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `/tmp/libtv-canvas-backup-${PROD ? 'prod' : 'local'}-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`\n已备份被改写的 ${Object.keys(backup).length} 个画布原始内容：${backupPath}`);

const escape = (s) => s.replace(/'/g, "''");
const sql = [
  'BEGIN;',
  ...updates.map((u) => `UPDATE canvases SET content = '${escape(JSON.stringify(u.content))}'::jsonb WHERE id = ${u.id};`),
  'COMMIT;',
].join('\n');
psql(sql);
console.log(`已写入 ${updates.length} 个画布（单事务提交）。`);

// 回读校验
const verify = psql(`
SELECT
  count(*) FILTER (WHERE n->'data' ? 'assetType') AS 带assetType,
  count(*) FILTER (WHERE n->'data' ? 'shotId') AS 带shotId,
  count(*) FILTER (WHERE n->'data' ? 'refIndex') AS 带refIndex,
  count(*) FILTER (WHERE n->'data' ? 'assetImageMapping') AS 残留mapping
FROM canvases, jsonb_array_elements(content->'nodes') n;`);
console.log(`回读校验（全库节点字段计数）：${verify.trim()}`);