import{j as e,d as L}from"./app.js";
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
