const assert=require('node:assert/strict'); const {reminderOccurrence,offsetInstant}=require('./logic');
const local=(y,m,d,h=0,min=0)=>new Date(y,m-1,d,h,min).toISOString();
const leap={completed:false,dueAt:local(2024,3,2),reminderRule:{type:'daily',time:'09:30',startAt:local(2024,2,28)}};
assert.equal(reminderOccurrence(leap,Date.parse(local(2024,2,29,10))),local(2024,2,29,9,30));
const weekly={completed:false,dueAt:local(2026,3,22),reminderRule:{type:'weekly',weekday:0,time:'02:30',startAt:local(2026,2,1)}};
assert.equal(reminderOccurrence(weekly,Date.parse(local(2026,3,14,12))),local(2026,3,1,2,30));
assert.equal(new Date(offsetInstant(Date.parse(local(2026,3,9,9)),1,'days')).toISOString(),local(2026,3,8,9));
console.log('夏令时与闰日测试通过');
