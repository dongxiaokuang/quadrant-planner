const assert = require('node:assert/strict');
const { pendingReminders, updateTask } = require('./logic');
const now = Date.parse('2026-10-29T09:00:00Z');
const tasks = [
 {id:'a', title:'到期', reminderAt:'2026-10-29T08:00:00Z', completed:false},
 {id:'b', title:'完成', reminderAt:'2026-10-29T08:00:00Z', completed:true},
 {id:'c', title:'已提醒', reminderAt:'2026-10-29T08:00:00Z', remindedAt:'2026-10-29T08:01:00Z', completed:false},
 {id:'d', title:'未来', reminderAt:'2026-10-29T10:00:00Z', completed:false}
];
assert.deepEqual(pendingReminders(tasks, now).map(x=>x.id), ['a']);
assert.equal(updateTask(tasks[0], {completed:true}, now).completedAt, new Date(now).toISOString());
assert.equal(updateTask({...tasks[0], remindedAt:'2026-10-29T08:01:00Z'}, {reminderAt:'2026-10-30T08:00:00Z'}, now).remindedAt, null);
console.log('事项状态与提醒测试通过');
