// 将业务逻辑和插件界面合并为 Obsidian 可直接加载的单文件，不需要安装构建依赖。
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const logic = fs.readFileSync(path.join(root,'logic.js'),'utf8');
const plugin = fs.readFileSync(path.join(root,'plugin-source.js'),'utf8');
fs.writeFileSync(path.join(root,'main.js'),logic+'\n'+plugin,'utf8');
console.log('已生成 main.js');
