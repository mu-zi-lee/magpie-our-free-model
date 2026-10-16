import fs from 'node:fs';
import path from 'node:path';

const UPGRADE_FILE = 'packages/standalone/web/upgrade-magpie.js';
const PAGE = `import{j as e,d as L}from"./app.js";
export function Upgrade({summary:s}){const plugin=s?.pluginVersion??"—",ofm=s?.version??"—";
return e.jsxs("div",{className:"settings-browser","data-testid":"upgrade-ready",children:[
e.jsxs("header",{className:"dashboard-heading",children:[e.jsxs("div",{children:[
e.jsx("div",{className:"heading-eyebrow",children:"MANAGEMENT / UPGRADE"}),
e.jsx("h1",{children:"插件升级"}),
e.jsx("p",{children:"查看当前 Magpie 插件与内置 Our Free Model 运行时版本。该页独立于服务设置。"})]}),
e.jsx(L,{children:"本机"})]}),
e.jsxs("section",{className:"settings-card",children:[
e.jsx("h2",{children:"当前版本"}),
e.jsxs("p",{children:["Magpie 插件 ",e.jsx("strong",{children:plugin})]}),
e.jsxs("p",{children:["内置独立服务 / OFM 运行时 ",e.jsx("strong",{children:ofm})]}),
e.jsx("p",{className:"settings-note",children:"免费车道已迁移到 /inference/v1，会话映射保存在本插件数据目录。"})]}),
e.jsxs("section",{className:"settings-card",children:[
e.jsx("h2",{children:"如何更新"}),
e.jsx("p",{children:"Magpie 没有 DSH 应用内热升级。路径安装请在仓库目录执行 git pull --ff-only，然后完全退出并重启 Magpie。ZIP 安装请用新版文件替换旧目录，保留账号数据目录。"}),
e.jsx("p",{className:"footnote",children:"升级后重载插件或重启 Magpie 才会读取新的包入口与 vendor 快照。不要用删除数据目录或凭据的方式处理升级失败。"})]})]})}
`;

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Upstream console ${label} changed`);
  return source.replace(before, after);
}

export function patchConsoleUpgrade(directory) {
  const appFile = 'packages/standalone/web/app.js';
  const assetsFile = 'packages/standalone/web/assets.json';
  let app = fs.readFileSync(path.join(directory, appFile), 'utf8');
  app = replaceOnce(app,
    '{label:"管理",items:[{id:"settings",name:"服务设置",icon:hy}]}',
    '{label:"管理",items:[{id:"settings",name:"服务设置",icon:hy},{id:"upgrade",name:"插件升级",icon:hy}]}',
    'nav');
  app = replaceOnce(app,
    'yv=["overview","models","usage","channels","eac","settings","connection"]',
    'yv=["overview","models","usage","channels","eac","settings","upgrade","connection"]',
    'page list');
  app = replaceOnce(app,
    'settings:"服务设置",connection:"API 接入"',
    'settings:"服务设置",upgrade:"插件升级",connection:"API 接入"',
    'page titles');
  app = replaceOnce(app,
    '"settings-Cq1Y-v4k.js"])))=>i.map(i=>d[i]);',
    '"settings-Cq1Y-v4k.js","upgrade-magpie.js"])))=>i.map(i=>d[i]);',
    'asset map');
  app = replaceOnce(app,
    'c==="models"?()=>import("./models-8lE4ufFd.js"):c==="usage"?()=>import("./usage-SUrY-tWU.js"):()=>import("./settings-Cq1Y-v4k.js"),__vite__mapDeps([7,4])',
    'c==="models"?()=>import("./models-8lE4ufFd.js"):c==="usage"?()=>import("./usage-SUrY-tWU.js"):c==="upgrade"?()=>import("./upgrade-magpie.js"):()=>import("./settings-Cq1Y-v4k.js"),__vite__mapDeps(c==="upgrade"?[8]:[7,4])',
    'lazy import');
  app = replaceOnce(app,
    'c==="models"?"Models":c==="usage"?"Usage":"Settings"',
    'c==="models"?"Models":c==="usage"?"Usage":c==="upgrade"?"Upgrade":"Settings"',
    'lazy export');
  app = replaceOnce(app,
    'y&&g==="settings"&&o.jsx(Hs,{name:"settings",snapshot:y,host:ot})',
    'y&&g==="settings"&&o.jsx(Hs,{name:"settings",snapshot:y,host:ot}),y&&g==="upgrade"&&o.jsx(Hs,{name:"upgrade",snapshot:y,host:ot})',
    'page mount');
  fs.writeFileSync(path.join(directory, appFile), app);
  let assets = fs.readFileSync(path.join(directory, assetsFile), 'utf8');
  assets = replaceOnce(assets,
    '  "settings-Cq1Y-v4k.js",\n',
    '  "settings-Cq1Y-v4k.js",\n  "upgrade-magpie.js",\n',
    'assets manifest');
  fs.writeFileSync(path.join(directory, assetsFile), assets);
  fs.writeFileSync(path.join(directory, UPGRADE_FILE), PAGE);
  return { appFile, assetsFile, upgradeFile: UPGRADE_FILE };
}
