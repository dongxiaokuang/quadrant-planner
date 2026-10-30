const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let notices = [];
class Plugin {
 async loadData(){ return this.saved; }
 async saveData(value){ this.writes.push(value); }
 registerView(){} addRibbonIcon(){} addCommand(){} addSettingTab(){} registerInterval(){} registerDomEvent(){} registerMarkdownCodeBlockProcessor(){}
}
Module._load = function(name,...args){ if(name === 'obsidian') return {Plugin,ItemView:class {},Modal:class {},PluginSettingTab:class {},MarkdownRenderChild:class {},Notice:class { constructor(s){notices.push(s)} },Setting:class {}}; return originalLoad.call(this,name,...args); };
global.window = {setInterval:()=>1}; global.document = {};
const QuadrantPlugin = require('./main.js');
async function run(){
 const broken = new QuadrantPlugin(); broken.saved = {tasks:'bad'}; broken.writes=[]; broken.app={workspace:{onLayoutReady(){},getLeavesOfType(){return []}}};
 await broken.onload(); await assert.rejects(broken.change(tasks=>tasks.push({title:'不可覆盖'}))); assert.equal(broken.writes.length,0); assert.ok(notices.some(s=>s.includes('暂停写入')));
 const corrupt = new QuadrantPlugin(); corrupt.loadData=async()=>{throw new Error('JSON 无法解析');}; corrupt.writes=[]; corrupt.app=broken.app;
 const oldError=console.error; console.error=()=>{}; try {await corrupt.onload();} finally {console.error=oldError;}
 await assert.rejects(corrupt.change(tasks=>tasks.push({title:'不可覆盖损坏文件'}))); assert.equal(corrupt.writes.length,0);
 const badEntry = new QuadrantPlugin(); badEntry.saved={tasks:[null]}; badEntry.writes=[]; badEntry.app=broken.app; await badEntry.onload();
 await assert.rejects(badEntry.change(tasks=>tasks.push({title:'不可覆盖损坏事项'}))); assert.equal(badEntry.writes.length,0);
 const fresh = new QuadrantPlugin(); fresh.saved = null; fresh.writes=[]; fresh.app=broken.app; await fresh.onload(); await fresh.change(tasks=>tasks.push({title:'首次保存'})); assert.equal(fresh.writes[0].tasks[0].title,'首次保存');
 const extended=new QuadrantPlugin();extended.saved={tasks:[],custom:{preserve:true},settings:{extra:'保留'}};extended.writes=[];extended.app=broken.app;await extended.onload();await extended.change((tasks,data)=>{data.labels.push('工作');});assert.deepEqual(extended.writes[0].custom,{preserve:true});assert.equal(extended.writes[0].settings.extra,'保留');
 console.log('异常数据保护与首次初始化测试通过');
}
run().catch(e=>{console.error(e);process.exitCode=1});
