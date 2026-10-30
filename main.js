// 业务逻辑与界面分离，方便验证提醒、完成与恢复行为。
function pendingReminders(tasks, now) {
  return tasks.filter(t => reminderOccurrence(t, now) !== null);
}
// 天数采用本地日历日，确保跨夏令时仍是前一天的相同本地时间。
function offsetInstant(due, amount, unit) {
  const factor = {minutes:60000, hours:3600000, days:86400000}[unit];
  if (!Number.isFinite(due) || !factor || !Number.isInteger(amount) || amount <= 0) return NaN;
  if (unit === 'days') { const localDate = new Date(due); localDate.setDate(localDate.getDate() - amount); return localDate.getTime(); }
  return due - amount * factor;
}
// 每次仅返回最近一条尚未发送的计划时刻。重复规则按本机日历时间计算；错过多期只补一次。
function reminderOccurrence(task, now = Date.now()) {
  if (!task || task.completed || !Number.isFinite(now)) return null;
  if (!Object.hasOwn(task, 'reminderRule')) {
    const old = Date.parse(task.reminderAt);
    return !task.remindedAt && Number.isFinite(old) && old <= now ? new Date(old).toISOString() : null;
  }
  const rule = task.reminderRule;
  if (!rule || typeof rule !== 'object') return null;
  const due = Date.parse(task.dueAt), start = Date.parse(rule.startAt);
  if (!Number.isFinite(due) || !Number.isFinite(start) || now >= due) return null;
  let occurrence = NaN;
  if (rule.type === 'offset') {
    occurrence = offsetInstant(due, rule.amount, rule.unit);
  } else if (rule.type === 'daily' || rule.type === 'weekly') {
    if (typeof rule.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) return null;
    if (rule.type === 'weekly' && (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6)) return null;
    const [hour, minute] = rule.time.split(':').map(Number);
    const limit = Math.min(now, due - 1);
    const date = new Date(limit);
    date.setHours(12, 0, 0, 0);
    // 回看两周以覆盖夏令时跳过某个本地时刻后仍有上一周期可补发。
    for (let i = 0; i < 16; i++) {
      const candidate = new Date(date); candidate.setDate(date.getDate() - i);
      if (rule.type === 'weekly' && candidate.getDay() !== rule.weekday) continue;
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getHours() !== hour || candidate.getMinutes() !== minute) continue;
      const value = candidate.getTime();
      if (value <= now && value < due && value >= start) { occurrence = value; break; }
    }
  } else return null;
  const last = Date.parse(task.lastOccurrenceAt);
  if (!Number.isFinite(occurrence) || occurrence < start || occurrence >= due || occurrence > now || (Number.isFinite(last) && occurrence <= last)) return null;
  return new Date(occurrence).toISOString();
}
function updateTask(task, patch, now = Date.now()) {
  const updated = { ...task, ...patch };
  if (Object.hasOwn(patch, 'completed') && patch.completed !== task.completed) {
    updated.completedAt = patch.completed ? new Date(now).toISOString() : null;
    // 恢复已完成事项后，过去的提醒不重复触发；调整提醒时间可重新安排。
    if (!patch.completed && task.reminderAt && Date.parse(task.reminderAt) <= now) updated.remindedAt = task.remindedAt || new Date(now).toISOString();
    // 恢复时忽略完成期间已经过去的周期提醒，保留未来周期。
    if (!patch.completed && Object.hasOwn(task, 'reminderRule') && task.reminderRule) updated.lastOccurrenceAt = new Date(now).toISOString();
  }
  if (Object.hasOwn(patch, 'reminderAt') && patch.reminderAt !== task.reminderAt) updated.remindedAt = null;
  return updated;
}
function defaultTime(now = Date.now()) { return new Date(Math.ceil((now + 300000) / 300000) * 300000).toISOString(); }
// 时间范围仅影响显示，不修改或清理历史记录；无完成日期的旧数据仍保存在原文件中。
function recentCompleted(tasks, now=Date.now()) {
  const cutoff=now-30*24*60*60*1000;
  return tasks.filter(t=>t.completed && t.completedAt && Number.isFinite(Date.parse(t.completedAt)) && Date.parse(t.completedAt)>=cutoff && Date.parse(t.completedAt)<=now);
}
// 标签以 NFC 标准化、去除首尾空白并忽略字母大小写判重；一次写入同步更新所有任务。
function normalizeLabel(value) {
  if(typeof value!=='string')throw new Error('请输入标签名称');
  const name=value.trim().normalize('NFC');
  if(!name || Array.from(name).length>8)throw new Error('标签名称须为1至8个字符');
  return name;
}
function labelKey(name) { return normalizeLabel(name).toLowerCase(); }
function renameLabel(data, oldName, input) {
  const name=normalizeLabel(input); const index=data.labels.indexOf(oldName);
  if(index<0)throw new Error('标签已不存在');
  if(data.labels.some((x,i)=>i!==index && labelKey(x)===labelKey(name)))throw new Error('标签名称已存在');
  data.labels[index]=name;
  for(const task of data.tasks) if(Array.isArray(task.tags)) task.tags=task.tags.map(t=>t===oldName?name:t);
}
function removeLabel(data,name) {
  const index=data.labels.indexOf(name); if(index<0)throw new Error('标签已不存在');
  data.labels.splice(index,1);
  for(const task of data.tasks) if(Array.isArray(task.tags))task.tags=task.tags.filter(t=>t!==name);
}
function labelColor(name) {let hash=0;for(const c of normalizeLabel(name))hash=(Math.imul(hash,31)+c.codePointAt(0))>>>0;return hash%8;}
// 数组顺序即展示顺序；移动仅改变该事项，保留其它事项的相对顺序。
function moveTask(tasks, id, target, beforeId, now = Date.now()) {
  const result = tasks.slice(); const index = result.findIndex(t=>t.id===id);
  if(index < 0 || beforeId === id) return result;
  const original = result.splice(index,1)[0];
  const patch = target.completed ? {completed:true} : {completed:false,important:target.important,urgent:target.urgent};
  const moved=updateTask(original,patch,now);
  const inTarget = t=>target.completed ? t.completed : !t.completed && t.important===target.important && t.urgent===target.urgent;
  let insert = beforeId ? result.findIndex(t=>t.id===beforeId && inTarget(t)) : -1;
  if(insert<0) { let last=-1; result.forEach((t,i)=>{if(inTarget(t)) last=i;}); insert=last<0 ? result.length : last+1; }
  result.splice(insert,0,moved); return result;
}
if (typeof module !== 'undefined' && module.exports && !globalThis.__quadrantBundle) module.exports = {pendingReminders, reminderOccurrence, offsetInstant, updateTask,moveTask,defaultTime,recentCompleted,normalizeLabel,labelKey,renameLabel,removeLabel,labelColor};

const { Plugin, ItemView, Modal, Notice, Setting, PluginSettingTab, MarkdownRenderChild } = require('obsidian');
const VIEW = 'four-quadrant-planner-view';
const GROUPS = [
  ['重要且紧急', true, true, 'urgent-important'], ['重要但不紧急', true, false, 'important'],
  ['紧急但不重要', false, true, 'urgent'], ['不重要也不紧急', false, false, 'other']
];
const toLocal = s => { if (!s) return ''; const d = new Date(s); if (!Number.isFinite(d.getTime())) return ''; const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toISO = s => s ? new Date(s).toISOString() : null;
const showTime = s => s ? new Date(s).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
const showRule = rule => rule.type==='offset' ? `提前 ${rule.amount} ${ {minutes:'分钟',hours:'小时',days:'天'}[rule.unit] || '' }` : rule.type==='daily' ? `每天 ${rule.time}` : rule.type==='weekly' ? `每周${['日','一','二','三','四','五','六'][rule.weekday] || ''} ${rule.time}` : '已设置提醒';
// 数据异常时保持原文件不变；不得把损坏数据当成空清单再次保存。
function validTasks(tasks) {
  if (!Array.isArray(tasks)) return false;
  const ids = new Set();
  return tasks.every(t => {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.title !== 'string' || typeof t.important !== 'boolean' || typeof t.urgent !== 'boolean' || typeof t.completed !== 'boolean') return false;
    ids.add(t.id);
    if (t.note != null && typeof t.note !== 'string') return false;
    if (t.tags != null && (!Array.isArray(t.tags) || !t.tags.every(x=>typeof x==='string'))) return false;
    return ['dueAt','reminderAt','remindedAt','completedAt','createdAt'].every(k => t[k] == null || (typeof t[k] === 'string' && Number.isFinite(Date.parse(t[k]))));
  });
}

// 每次修改先串行写入，保存成功后才替换内存数据，避免连续点击或写入失败丢失事项。
class QuadrantPlugin extends Plugin {
  async onload() {
    let saved = null; let loadFailed = false;
    try { saved = await this.loadData(); } catch (err) { loadFailed = true; console.error('读取四象限日程数据失败', err); }
    const validLabels = labels => { try { return Array.isArray(labels) && labels.every(x=>normalizeLabel(x)===x) && new Set(labels.map(labelKey)).size===labels.length; } catch {return false;} };
    this.invalidData = loadFailed || (saved != null && (!saved || typeof saved !== 'object' || !validTasks(saved.tasks) || (saved.labels != null && !validLabels(saved.labels)) || saved.tasks.some(t=>t.tags?.some(tag=>!(saved.labels || []).includes(tag)))));
    const oldSettings = saved?.settings || {};
    this.data = { ...(saved && typeof saved==='object' && !Array.isArray(saved) ? saved : {}), tasks: this.invalidData ? [] : (saved?.tasks || []), labels:this.invalidData ? [] : (saved?.labels || []), settings:{ ...oldSettings, defaultQuadrant: GROUPS.some(g=>g[3]===oldSettings.defaultQuadrant) ? oldSettings.defaultQuadrant : 'urgent-important', showPressureHint: oldSettings.showPressureHint !== false } };
    if (this.invalidData) new Notice('四象限日程数据格式异常，已暂停写入。请先备份插件目录中的 data.json 并检查数据。', 0);
    this.queue = Promise.resolve(); this.checking = false; this.permissionWarned = false; this.disposed=false; this.embeddedBoards = new Set();
    this.registerView(VIEW, leaf => new QuadrantView(leaf, this));
    // 每个代码块由 Obsidian 管理生命周期；不读取或改写代码块所在的笔记。
    this.registerMarkdownCodeBlockProcessor('quadrant-planner', (_source, el, ctx) => { ctx.addChild(new QuadrantMarkdownChild(el, this)); });
    this.addRibbonIcon('layout-grid', '打开四象限日程', () => this.openView());
    this.addCommand({id:'open-quadrant',name:'打开四象限日程',callback:()=>this.openView()});
    this.addCommand({id:'quick-add-task',name:'快速新建四象限事项',hotkeys:[{modifiers:['Ctrl','Alt'],key:'N'}],callback:()=>this.quickAdd()});
    this.addSettingTab(new QuadrantSettings(this.app,this));
    this.registerInterval(window.setInterval(() => this.checkReminders(), 30000));
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) this.checkReminders(); });
    this.registerDomEvent(window, 'focus', () => this.checkReminders());
    this.app.workspace.onLayoutReady(() => this.checkReminders());
  }
  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({type:VIEW,active:true}); }
    await this.app.workspace.revealLeaf(leaf);
  }
  onunload() {
    this.disposed=true;
    for(const board of this.embeddedBoards)board.destroy();
    this.embeddedBoards.clear();
    this.app.workspace.getLeavesOfType(VIEW).forEach(leaf=>{if(leaf.view instanceof QuadrantView && leaf.view.board)leaf.view.board.destroy();});
  }
  quickAdd() { const group=GROUPS.find(g=>g[3]===this.data.settings.defaultQuadrant) || GROUPS[0]; new TaskModal(this,{important:group[1],urgent:group[2]}).open(); }
  async testNotification() {
    if(await this.permission()) { try { const n=new Notification('四象限日程', {body:'桌面提醒测试：如果看到此消息，通知已送达。'}); n.onerror=()=>new Notice('测试通知发送失败，请检查 Windows 通知设置。'); } catch(e) { console.error(e); new Notice('无法发送测试通知，请检查 Windows 通知设置。'); } }
  }
  refresh() { this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => { if (leaf.view instanceof QuadrantView) leaf.view.render(); }); for(const board of this.embeddedBoards)board.render(); }
  change(fn) {
    if(this.disposed)return Promise.reject(new Error('插件已停用'));
    if (this.invalidData) { new Notice('数据格式异常，已暂停写入。请先备份并检查插件数据。'); return Promise.reject(new Error('数据格式异常，已暂停写入')); }
    const op = this.queue.then(async () => {
      if(this.disposed)throw new Error('插件已停用');
      const next = JSON.parse(JSON.stringify(this.data));
      fn(next.tasks, next);
      await this.saveData(next);
      this.data = next; if(!this.disposed)this.refresh();
    });
    this.queue = op.catch(err => { console.error('四象限日程保存失败', err); new Notice('保存失败，请检查知识库是否可写及磁盘空间。'); });
    return op;
  }
  async permission() {
    if (typeof Notification === 'undefined') { new Notice('当前环境不支持桌面通知。'); return false; }
    try {
      const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (result !== 'granted') { new Notice('桌面通知未获允许，请在 Windows 通知设置中允许 Obsidian 通知。'); return false; }
      this.permissionWarned = false; new Notice('已获得应用内通知权限，请使用测试提醒检查 Windows 系统通知。'); this.checkReminders(); return true;
    } catch(e) { console.error(e); new Notice('无法启用通知，请检查 Windows 通知设置。'); return false; }
  }
  async checkReminders() {
    if (this.checking) return; this.checking = true;
    try {
      await this.queue;
      const due = this.data.tasks.filter(t=>reminderOccurrence(t,Date.now()));
      if (!due.length) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        if (!this.permissionWarned) { new Notice('有待提醒事项，请在四象限日程设置中启用桌面提醒。'); this.permissionWarned = true; }
        return;
      }
      for (const task of due) {
        // 在队列中再次检查，防止用户刚完成或修改事项时仍发送过期提醒。
        let shouldNotify = false; let sentOccurrence=null; let previousMark=null; let writtenMark=null; let signature='';
        await this.change(tasks => {
          const current = tasks.find(t => t.id === task.id);
          const occurrence=current && reminderOccurrence(current,Date.now());
          if (occurrence) { sentOccurrence=occurrence; signature=JSON.stringify([current.dueAt,current.reminderAt,current.reminderRule]); if(current.reminderRule){previousMark=current.lastOccurrenceAt || null;current.lastOccurrenceAt=occurrence;writtenMark=occurrence;}else{previousMark=current.remindedAt || null;current.remindedAt=new Date().toISOString();writtenMark=current.remindedAt;} shouldNotify=true; }
        });
        if (shouldNotify) {
          const rollback=async()=>{await this.change(tasks=>{const t=tasks.find(x=>x.id===task.id);if(!t || t.completed || JSON.stringify([t.dueAt,t.reminderAt,t.reminderRule])!==signature)return;if(t.reminderRule && t.lastOccurrenceAt===writtenMark)t.lastOccurrenceAt=previousMark;else if(!t.reminderRule && t.remindedAt===writtenMark)t.remindedAt=previousMark;});};
          try {
            const n = new Notification('待办提醒', {body:task.title});
            n.onclick = () => { window.focus(); this.openView(); };
            n.onerror = async () => {
              new Notice('桌面提醒发送失败，请检查 Windows 通知设置。');
              try { await rollback(); } catch(e) { console.error(e); }
            };
          }
          catch (err) {
            console.error('提醒失败', err); new Notice('桌面提醒发送失败，请检查 Windows 通知设置。');
            await rollback();
          }
        }
      }
    } catch(err) { console.error('检查提醒失败',err); } finally { this.checking = false; }
  }
}

class QuadrantView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin=plugin; this.board=null; }
  getViewType() { return VIEW; }
  getDisplayText() { return '四象限日程'; }
  getIcon() { return 'layout-grid'; }
  async onOpen() { this.board=new QuadrantBoard(this.plugin,this.contentEl); this.render(); }
  async onClose() { if(this.board)this.board.destroy(); this.board=null; }
  render() { if(this.board)this.board.render(); }
}
class QuadrantMarkdownChild extends MarkdownRenderChild {
  constructor(container,plugin){super(container);this.plugin=plugin;this.board=null;}
  onload(){if(this.plugin.disposed)return;this.containerEl.addClass('qp-embedded');this.board=new QuadrantBoard(this.plugin,this.containerEl);this.plugin.embeddedBoards.add(this.board);this.board.render();}
  onunload(){if(this.board){this.plugin.embeddedBoards.delete(this.board);this.board.destroy();this.board=null;}}
}
// 主页面和所有笔记代码块共享一套界面与交互，每个实例各自持有显示状态。
class QuadrantBoard {
  constructor(plugin,contentEl){this.plugin=plugin;this.contentEl=contentEl;this.showHistory=false;this.destroyed=false;}
  destroy(){this.destroyed=true;this.dragId=null;this.contentEl.empty();}
  render() {
    if(this.destroyed || this.plugin.disposed)return;
    const root=this.contentEl; root.empty(); root.addClass('qp-root');
    if(this.plugin.invalidData) root.createEl('p',{cls:'qp-hint',text:'数据读取失败或格式异常，已暂停写入。请备份并检查插件目录中的 data.json；当前空白界面不代表原数据已删除。'});
    const head=root.createDiv({cls:'qp-head'}); const title=head.createDiv(); title.createEl('h2',{text:'四象限日程'});
    const actions=head.createDiv({cls:'qp-actions'});
    const config=actions.createEl('button',{text:'⚙ 设置'}); config.onclick=()=>new QuadrantSettingsModal(this.plugin).open();
    const add=actions.createEl('button',{text:'＋ 新建事项',cls:'mod-cta'}); add.onclick=()=>this.plugin.quickAdd();
    if(this.plugin.data.settings.showPressureHint && this.plugin.data.tasks.filter(t=>!t.completed && t.important && t.urgent).length>=5) root.createEl('p',{cls:'qp-pressure',text:'重要且紧急事项较多，也可为重要但不紧急的事项预留时间。'});
    const grid=root.createDiv({cls:'qp-grid'});
    for (const [label,important,urgent,style] of GROUPS) {
      const section=grid.createDiv({cls:`qp-section qp-${style}`});
      const target={completed:false,important,urgent}; this.dropZone(section,target);
      const row=section.createDiv({cls:'qp-section-head'}); row.createEl('h3',{text:label});
      const list=this.plugin.data.tasks.filter(t=>!t.completed && !!t.important===important && !!t.urgent===urgent);
      row.createSpan({text:String(list.length),cls:'qp-count'});
      const plus=row.createEl('button',{text:'＋ 新增任务',cls:'qp-add'}); plus.onclick=()=>new TaskModal(this.plugin,{important,urgent}).open();
      if (!list.length) section.createEl('p',{text:'暂无事项',cls:'qp-empty'});
      list.forEach(t=>this.taskRow(section,t,target));
    }
    const completed=root.createDiv({cls:'qp-completed'}); const done=this.showHistory ? this.plugin.data.tasks.filter(t=>t.completed) : recentCompleted(this.plugin.data.tasks);
    const details=completed.createEl('details'); details.open=true; const summary=details.createEl('summary'); summary.createSpan({text:`已完成（${done.length}）`});
    const hidden=this.plugin.data.tasks.filter(t=>t.completed).length-done.length;
    const help=summary.createSpan({cls:'qp-help'}); const helpButton=help.createEl('button',{text:'?',cls:'qp-help-button',type:'button'}); helpButton.setAttribute('aria-label','已完成事项展示范围'); helpButton.setAttribute('aria-expanded','false');
    const helpText=help.createSpan({cls:'qp-help-text',text:this.showHistory?'正在查看全部已完成事项。':hidden?`仅展示近30天完成的事项，另有 ${hidden} 条历史或日期未知记录保留在数据中。`:'仅展示近30天完成的事项，历史记录仍保留。'}); helpText.setAttribute('role','tooltip');
    helpButton.onclick=e=>{e.preventDefault();e.stopPropagation();help.classList.toggle('qp-help-open');helpButton.setAttribute('aria-expanded',String(help.classList.contains('qp-help-open')));};
    const doneTarget={completed:true}; this.dropZone(details,doneTarget);
    const history=details.createEl('button',{type:'button',cls:'qp-history',text:this.showHistory?'只看近30天':'查看全部历史'}); history.onclick=()=>{this.showHistory=!this.showHistory;this.render();};
    if (!done.length) details.createEl('p',{text:'完成的事项会显示在这里',cls:'qp-empty'}); else done.forEach(t=>this.taskRow(details,t,doneTarget));
  }
  dropZone(el,target) {
    el.addEventListener('dragover',e=>{if(this.dragId){e.preventDefault();e.dataTransfer.dropEffect='move';}});
    el.addEventListener('drop',e=>{if(!this.dragId)return;e.preventDefault();e.stopPropagation();this.dropTask(target,null);});
  }
  dropTask(target,beforeId) {
    const id=this.dragId; this.dragId=null; if(!id)return;
    this.plugin.change(tasks=>{const moved=moveTask(tasks,id,target,beforeId);tasks.splice(0,tasks.length,...moved);}).catch(()=>this.render());
  }
  taskRow(parent,task,target) {
    const row=parent.createDiv({cls:'qp-task'}); row.draggable=true; const check=row.createEl('input',{type:'checkbox'}); check.checked=!!task.completed; check.setAttribute('aria-label',task.completed?'恢复事项':'完成事项');
    row.dataset.taskId=task.id;
    row.setAttribute('title','拖动事项可调整位置');
    row.addEventListener('dragstart',e=>{if(e.target.closest('button,input,textarea,select,a')){e.preventDefault();return;} this.dragId=task.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',task.id);row.addClass('qp-dragging');});
    row.addEventListener('dragend',()=>{this.dragId=null;row.removeClass('qp-dragging');});
    row.addEventListener('drop',e=>{if(!this.dragId)return;e.preventDefault();e.stopPropagation();let before=task.id;if(e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2){let next=row.nextElementSibling;while(next && !next.dataset.taskId)next=next.nextElementSibling;before=next?.dataset.taskId||null;}this.dropTask(target,before);});
    check.onchange=async()=>{ try { await this.plugin.change(tasks=>{const i=tasks.findIndex(t=>t.id===task.id); if(i>=0) tasks[i]=updateTask(tasks[i],{completed:check.checked});}); } catch { check.checked=!check.checked; } };
    const content=row.createDiv({cls:'qp-task-content'}); content.createEl('div',{text:task.title,cls:task.completed?'qp-done-title':'qp-task-title'});
    const meta=content.createDiv({cls:'qp-meta'}); if(task.dueAt) meta.createSpan({text:'完成期限 '+showTime(task.dueAt),cls:'qp-meta-due'}); if(task.reminderAt && !task.reminderRule) meta.createSpan({text:'提醒 '+showTime(task.reminderAt),cls:'qp-meta-reminder'}); if(task.reminderRule) meta.createSpan({text:showRule(task.reminderRule),cls:'qp-meta-reminder'}); if(task.completedAt) meta.createSpan({text:'完成于 '+showTime(task.completedAt),cls:'qp-meta-done'});
    if(task.tags?.length){const tags=content.createDiv({cls:'qp-tags'});task.tags.forEach(name=>tags.createSpan({text:name,cls:`qp-tag qp-tag-${labelColor(name)}`}));}
    if (task.note) content.createEl('div',{text:task.note,cls:'qp-note'});
    const edit=row.createEl('button',{text:'编辑',cls:'qp-edit'}); edit.onclick=()=>new TaskModal(this.plugin,task).open();
    const remove=row.createEl('button',{text:'删除',cls:'qp-edit'}); remove.onclick=()=>new DeleteModal(this.plugin,task).open();
  }
}
class TaskModal extends Modal {
  constructor(plugin, task) { super(plugin.app); this.plugin=plugin; this.task=task; }
  onOpen() {
    const {contentEl}=this; contentEl.empty(); contentEl.createEl('h2',{text:this.task?.id?'编辑事项':'新建事项'});
    const form=contentEl.createEl('form',{cls:'qp-form'});
    // 旧事项可能不是五分钟刻度；编辑时仍允许保留原有时间。
    form.noValidate=true;
    const label=(name,type,value)=>{const wrap=form.createEl('label'); wrap.createEl('span',{text:name}); const input=type==='textarea'?wrap.createEl('textarea'):wrap.createEl('input',{type}); input.value=value||''; return input;};
    const title=label('事项名称（必填）','text',this.task?.title); title.required=true; title.maxLength=300;
    title.addEventListener('keydown',e=>{if(e.key==='Enter' && !e.isComposing){e.preventDefault();form.requestSubmit();}});
    const notes=label('备注','textarea',this.task?.note); notes.rows=2;
    const tagSection=form.createDiv({cls:'qp-tag-editor'});tagSection.createEl('div',{text:'标签',cls:'qp-field-label'});
    const tagList=tagSection.createDiv({cls:'qp-tag-options'}); const chosen=new Set(this.task?.tags || []); const draftNew=new Set();
    const paintTags=()=>{tagList.empty(); const names=[...new Set([...this.plugin.data.labels,...draftNew])]; if(!names.length)tagList.createEl('span',{cls:'qp-empty',text:'可创建标签'}); names.forEach(name=>{const l=tagList.createEl('label',{cls:'qp-tag-choice'});const cb=l.createEl('input',{type:'checkbox'});cb.checked=chosen.has(name);l.createSpan({text:name,cls:`qp-tag qp-tag-${labelColor(name)}`});cb.onchange=()=>cb.checked?chosen.add(name):chosen.delete(name);});};paintTags();
    const newTagRow=tagSection.createDiv({cls:'qp-tag-new'});const newTag=newTagRow.createEl('input',{type:'text',placeholder:'新标签，最多8个字符'}); newTag.setAttribute('aria-label','新标签名称');
    const addTag=newTagRow.createEl('button',{text:'添加标签',type:'button'});addTag.onclick=()=>{try{const name=normalizeLabel(newTag.value);const known=[...this.plugin.data.labels,...draftNew].find(x=>labelKey(x)===labelKey(name)); const canonical=known || name; if(!known)draftNew.add(name);chosen.add(canonical);newTag.value='';paintTags();}catch(e){new Notice(e.message);}};
    newTag.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addTag.click();}};
    const toggles=form.createDiv({cls:'qp-toggles'});
    const flag=(text,value)=>{const l=toggles.createEl('label'); const c=l.createEl('input',{type:'checkbox'}); c.checked=!!value; l.createSpan({text}); return c;};
    const important=flag('重要',this.task?.important); const urgent=flag('紧急',this.task?.urgent);
    const option=(parent,text,value)=>{const el=parent.createEl('option',{text});el.value=value;return el;};
    const checkbox=(caption,checked)=>{const l=form.createEl('label',{cls:'qp-check-row'});const c=l.createEl('input',{type:'checkbox'});c.checked=checked;l.createSpan({text:caption});return c;};
    const dueEnabled=checkbox('设置完成期限',!!this.task?.dueAt);
    const due=label('完成期限','datetime-local',toLocal(this.task?.dueAt || defaultTime())); due.step='300';
    const dueRow=form.createDiv({cls:'qp-due-row'}); dueRow.appendChild(dueEnabled.parentElement); dueRow.appendChild(due.parentElement);
    // 旧版的绝对提醒可以独立于期限存在，默认保留原值，不做隐式转换。
    const legacy=!!(this.task?.reminderAt && !Object.hasOwn(this.task,'reminderRule'));
    let legacyChoice=null;
    if(legacy){
      form.createEl('p',{cls:'qp-legacy-note',text:`当前已有提醒：${showTime(this.task.reminderAt)}。默认保留原时间。`});
      const l=form.createEl('label');l.createSpan({text:'已有提醒处理'});legacyChoice=l.createEl('select');
      option(legacyChoice,'保留原有提醒','keep'); option(legacyChoice,'取消原有提醒','remove'); option(legacyChoice,'改为到期前提醒','convert');
    }
    const reminderEnabled=checkbox('启用到期前提醒',!!this.task?.reminderRule);
    const fields=form.createDiv({cls:'qp-rule-fields'});
    const selectField=(caption,items,value)=>{const l=fields.createEl('label');l.createSpan({text:caption});const input=l.createEl('select');items.forEach(([name,v])=>option(input,name,v));input.value=value;return l;};
    const textField=(caption,type,value)=>{const l=fields.createEl('label');l.createSpan({text:caption});const input=l.createEl('input',{type});input.value=String(value);return l;};
    const oldRule=this.task?.reminderRule || {};
    const kindWrap=selectField('提醒方式',[['提前指定时间','offset'],['每天固定时间','daily'],['每周指定时间','weekly']],oldRule.type || 'offset'); const kind=kindWrap.querySelector('select');
    const amountWrap=textField('提前数量','number',oldRule.amount || 15); const amount=amountWrap.querySelector('input'); amount.min='1'; amount.step='1';
    const unitWrap=selectField('时间单位',[['分钟','minutes'],['小时','hours'],['天','days']],oldRule.unit || 'minutes'); const unit=unitWrap.querySelector('select');
    const weekdayWrap=selectField('每周提醒日期',[['星期一','1'],['星期二','2'],['星期三','3'],['星期四','4'],['星期五','5'],['星期六','6'],['星期日','0']],String(oldRule.weekday ?? 1)); const weekday=weekdayWrap.querySelector('select');
    const timeWrap=textField('提醒时刻','time',oldRule.time || '09:00'); const clock=timeWrap.querySelector('input');
    const updateControls=()=>{
      due.disabled=!dueEnabled.checked;
      const converting=!legacy || legacyChoice.value==='convert';
      reminderEnabled.parentElement.hidden=!converting; reminderEnabled.disabled=!dueEnabled.checked || !converting;
      fields.hidden=!converting || !dueEnabled.checked || !reminderEnabled.checked;
      amountWrap.hidden=unitWrap.hidden=kind.value!=='offset'; weekdayWrap.hidden=kind.value!=='weekly'; timeWrap.hidden=kind.value==='offset';
    };
    dueEnabled.onchange=updateControls; reminderEnabled.onchange=updateControls; kind.onchange=updateControls; if(legacyChoice)legacyChoice.onchange=()=>{if(legacyChoice.value==='convert') reminderEnabled.checked=true;updateControls();}; updateControls();
    const footer=form.createDiv({cls:'qp-modal-actions'}); const cancel=footer.createEl('button',{text:'取消',type:'button'}); cancel.onclick=()=>this.close();
    const save=footer.createEl('button',{text:'保存事项',type:'submit',cls:'mod-cta'});
    form.onsubmit=async e=>{ e.preventDefault(); if(save.disabled)return; const name=title.value.trim(); if(!name){new Notice('请填写事项名称。');title.focus();return;} save.disabled=true;
      try {
        if(dueEnabled.checked && !due.value){new Notice('请选择完成期限。');due.focus();return;}
        const dueValue=dueEnabled.checked ? (this.task?.dueAt && due.value===toLocal(this.task.dueAt) ? this.task.dueAt : toISO(due.value)) : null;
        const patch={title:name,note:notes.value.trim(),important:important.checked,urgent:urgent.checked,dueAt:dueValue};
        const keepLegacy=legacy && legacyChoice.value==='keep';
        if(!keepLegacy) {
          const ruleEnabled=dueEnabled.checked && reminderEnabled.checked && (!legacy || legacyChoice.value==='convert');
          let rule=null;
          if(ruleEnabled) {
            if(kind.value==='offset') { const n=Number(amount.value); if(!Number.isSafeInteger(n)||n<=0){new Notice('请输入大于零的提前数量。');amount.focus();return;} rule={type:'offset',amount:n,unit:unit.value}; }
            else { if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock.value)){new Notice('请选择有效的提醒时刻。');clock.focus();return;} rule={type:kind.value,time:clock.value}; if(kind.value==='weekly')rule.weekday=Number(weekday.value); }
            const previous=this.task?.reminderRule; const oldShape=previous ? {...previous} : null; if(oldShape) delete oldShape.startAt;
            const same=oldShape && Number.isFinite(Date.parse(previous.startAt)) && dueValue===this.task?.dueAt && Object.keys(rule).every(key=>oldShape[key]===rule[key]) && Object.keys(oldShape).length===Object.keys(rule).length;
            if(!same && Date.parse(dueValue)<=Date.now()){new Notice('完成期限已过，请调整期限后设置提醒。');return;}
            if(!same && rule.type==='offset') {
              const occurrence=offsetInstant(Date.parse(dueValue),rule.amount,rule.unit);
              if(!Number.isFinite(occurrence) || occurrence<=Date.now()){new Notice('提前提醒时间已过去，请调整提前量或完成期限。');return;}
            }
            if(!same && rule.type!=='offset') {
              const now=Date.now(), [h,m]=rule.time.split(':').map(Number); let found=false;
              for(let i=0;i<16;i++){const d=new Date(now);d.setHours(12,0,0,0);d.setDate(d.getDate()+i);if(rule.type==='weekly' && d.getDay()!==rule.weekday)continue;d.setHours(h,m,0,0);if(d.getHours()===h && d.getMinutes()===m && d.getTime()>now && d.getTime()<Date.parse(dueValue)){found=true;break;}}
              if(!found){new Notice('完成期限前没有可执行的提醒时间，请调整提醒时刻或期限。');return;}
            }
            rule.startAt=same ? previous.startAt : new Date().toISOString();
            if(!same)patch.lastOccurrenceAt=null;
          } else patch.lastOccurrenceAt=null;
          patch.reminderRule=rule; patch.reminderAt=null;
        }
        // 通知授权必须由用户操作触发；仅首次设置提醒时询问。
        if((patch.reminderRule || keepLegacy) && typeof Notification!=='undefined' && Notification.permission==='default') await this.plugin.permission();
        else if((patch.reminderRule || keepLegacy) && (typeof Notification==='undefined' || Notification.permission==='denied')) new Notice('事项会正常保存，但通知尚未获允许；请在设置中检查桌面通知。');
        await this.plugin.change((tasks,data)=>{
          const tags=[];
          for(const selected of chosen){let existing=data.labels.find(x=>labelKey(x)===labelKey(selected));if(!existing){if(!draftNew.has(selected))throw new Error('标签已变更，请重新打开事项');existing=normalizeLabel(selected);data.labels.push(existing);}if(!tags.includes(existing))tags.push(existing);}
          patch.tags=tags;
          if(this.task?.id){const i=tasks.findIndex(t=>t.id===this.task.id); if(i<0) throw new Error('事项不存在'); tasks[i]=updateTask(tasks[i],patch);} else tasks.push({id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,...patch,completed:false,completedAt:null,remindedAt:null,createdAt:new Date().toISOString()});
        });
        this.close(); this.plugin.checkReminders();
      } catch(e) { console.error(e); } finally { save.disabled=false; }
    };
    setTimeout(()=>title.focus(),50);
  }
  onClose(){this.contentEl.empty();}
}
// 插件内设置窗口与 Obsidian 设置页复用相同内容与同一份设置。
function renderQuadrantSettings(containerEl,plugin,rerender){
    containerEl.empty(); containerEl.createEl('h2',{text:'四象限日程设置'});
    new Setting(containerEl).setName('快速新建默认象限').setDesc('通过顶部按钮或快捷命令新建时使用，可在事项中修改。').addDropdown(drop=>{
      GROUPS.forEach(g=>drop.addOption(g[3],g[0])); drop.setValue(plugin.data.settings.defaultQuadrant);
      drop.onChange(value=>plugin.change((tasks,data)=>{data.settings.defaultQuadrant=value;}).catch(rerender));
    });
    new Setting(containerEl).setName('重要且紧急事项过多时提示').setDesc('未完成事项达到 5 项时，在四象限页面显示简短提示。').addToggle(toggle=>toggle.setValue(plugin.data.settings.showPressureHint).onChange(value=>plugin.change((tasks,data)=>{data.settings.showPressureHint=value;}).catch(rerender)));
    new Setting(containerEl).setName('桌面提醒').setDesc('提醒需要 Obsidian 运行、电脑未休眠，并允许 Windows 通知。重新运行后会检查错过的提醒。').addButton(button=>button.setButtonText('启用桌面提醒').onClick(()=>plugin.permission())).addButton(button=>button.setButtonText('测试提醒').onClick(()=>plugin.testNotification()));
    new Setting(containerEl).setName('快速新建快捷键').setDesc('默认 Ctrl + Alt + N，可在 Obsidian 的快捷键设置中修改“快速新建四象限事项”。');
    containerEl.createEl('h3',{text:'标签管理'});
    containerEl.createEl('p',{text:'标签数量包含全部事项及历史已完成事项。',cls:'qp-legacy-note'});
    new Setting(containerEl).setName('新建标签').setDesc('名称最多8个字符，创建后可在事项中使用。').addButton(button=>button.setButtonText('新建标签').onClick(()=>new LabelCreateModal(plugin,rerender).open()));
    if(!plugin.data.labels.length)containerEl.createEl('p',{text:'尚无标签，可在新建或编辑事项时添加。',cls:'qp-empty'});
    plugin.data.labels.forEach(name=>{
      const count=plugin.data.tasks.filter(t=>Array.isArray(t.tags)&&t.tags.includes(name)).length;
      new Setting(containerEl).setName(name).setDesc(`关联 ${count} 个事项`).addButton(button=>button.setButtonText('重命名').onClick(()=>new LabelChangeModal(plugin,name,'rename',rerender).open())).addButton(button=>button.setButtonText('删除').onClick(()=>new LabelChangeModal(plugin,name,'delete',rerender).open()));
    });
}
class QuadrantSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){ renderQuadrantSettings(this.containerEl,this.plugin,()=>this.display()); }
}
class QuadrantSettingsModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;}
  onOpen(){renderQuadrantSettings(this.contentEl,this.plugin,()=>this.onOpen());}
  onClose(){this.contentEl.empty();}
}
class LabelCreateModal extends Modal {
  constructor(plugin,after){super(plugin.app);this.plugin=plugin;this.after=after;}
  onOpen(){const root=this.contentEl;root.empty();root.createEl('h2',{text:'新建标签'});const l=root.createEl('label',{cls:'qp-label-rename'});l.createSpan({text:'标签名称，最多8个字符'});const input=l.createEl('input',{type:'text'});
    const actions=root.createDiv({cls:'qp-modal-actions'});const cancel=actions.createEl('button',{text:'取消'});cancel.onclick=()=>this.close();const save=actions.createEl('button',{text:'创建标签',cls:'mod-cta'});
    save.onclick=async()=>{if(save.disabled)return;let name;try{name=normalizeLabel(input.value);if(this.plugin.data.labels.some(x=>labelKey(x)===labelKey(name)))throw new Error('标签名称已存在');}catch(e){new Notice(e.message);return;}save.disabled=true;try{await this.plugin.change((tasks,data)=>{if(data.labels.some(x=>labelKey(x)===labelKey(name)))throw new Error('标签名称已存在');data.labels.push(name);});this.close();this.after();}catch(e){console.error(e);new Notice(e.message||'标签创建失败');}finally{save.disabled=false;}};
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save.click();}};
  }
  onClose(){this.contentEl.empty();}
}
class LabelChangeModal extends Modal {
  constructor(plugin,name,mode,after){super(plugin.app);this.plugin=plugin;this.name=name;this.mode=mode;this.after=after;}
  onOpen(){
    const root=this.contentEl;root.empty();const rename=this.mode==='rename';root.createEl('h2',{text:rename?'重命名标签':'删除标签'});
    const count=this.plugin.data.tasks.filter(t=>t.tags?.includes(this.name)).length;
    root.createEl('p',{text:rename?`确认后将同步修改“${this.name}”关联的 ${count} 个事项，包含历史事项。`:`确认后将从 ${count} 个关联事项中移除“${this.name}”，不会删除事项。`});
    let input=null;if(rename){const l=root.createEl('label',{cls:'qp-label-rename'});l.createSpan({text:'新标签名称，最多8个字符'});input=l.createEl('input',{type:'text'});input.value=this.name;}
    const actions=root.createDiv({cls:'qp-modal-actions'});const cancel=actions.createEl('button',{text:'取消'});cancel.onclick=()=>this.close();
    const confirm=actions.createEl('button',{text:rename?'确认重命名':'确认删除',cls:rename?'mod-cta':'mod-warning'});
    confirm.onclick=async()=>{if(confirm.disabled)return;let name;try{if(rename){name=normalizeLabel(input.value);if(this.plugin.data.labels.some(x=>x!==this.name&&labelKey(x)===labelKey(name)))throw new Error('标签名称已存在');}}catch(e){new Notice(e.message);return;}confirm.disabled=true;
      try{await this.plugin.change((tasks,data)=>{if(rename)renameLabel(data,this.name,name);else removeLabel(data,this.name);});this.close();this.after();}catch(e){console.error(e);new Notice(e.message||'标签更新失败');}finally{confirm.disabled=false;}
    };
  }
  onClose(){this.contentEl.empty();}
}
class DeleteModal extends Modal {
  constructor(plugin,task){super(plugin.app);this.plugin=plugin;this.task=task;}
  onOpen(){
    const el=this.contentEl; el.empty(); el.createEl('h2',{text:'删除事项'}); el.createEl('p',{text:`确定删除“${this.task.title}”吗？删除后无法恢复。`});
    const actions=el.createDiv({cls:'qp-modal-actions'}); const cancel=actions.createEl('button',{text:'取消'}); cancel.onclick=()=>this.close();
    const confirm=actions.createEl('button',{text:'确认删除',cls:'mod-warning'}); confirm.onclick=async()=>{confirm.disabled=true;try{await this.plugin.change(tasks=>{const i=tasks.findIndex(t=>t.id===this.task.id);if(i>=0)tasks.splice(i,1);});this.close();}catch(e){console.error(e);}finally{confirm.disabled=false;}};
  }
  onClose(){this.contentEl.empty();}
}
module.exports = QuadrantPlugin;
