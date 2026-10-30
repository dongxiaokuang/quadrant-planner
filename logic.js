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
