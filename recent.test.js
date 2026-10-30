const assert=require('node:assert/strict');
const {recentCompleted}=require('./logic');
const now=Date.parse('2026-11-30T12:00:00Z');
const all=[{id:'recent',completed:true,completedAt:'2026-11-15T12:00:00Z'},{id:'boundary',completed:true,completedAt:'2026-10-31T12:00:00Z'},{id:'old',completed:true,completedAt:'2026-10-30T12:00:00Z'},{id:'unknown',completed:true,completedAt:null},{id:'active',completed:false,completedAt:'2026-11-30T12:00:00Z'}];
assert.deepEqual(recentCompleted(all,now).map(t=>t.id),['recent','boundary']);
assert.equal(all.length,5);
console.log('近30天完成记录筛选及历史保留测试通过');
