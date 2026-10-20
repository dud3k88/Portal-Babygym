// Pure positioning of a day's lessons; overlapping clusters share horizontal lanes.
export function layoutLessons(items) {
 const minute=value=>Number(value.slice(11,13))*60+Number(value.slice(14,16));
 const events=items.map(item=>{const start=minute(item.starts_at);const end=item.ends_at?(item.ends_at.slice(0,10)>item.starts_at.slice(0,10)?1440:minute(item.ends_at)):Math.min(1440,start+30);return {item,start,end:Math.max(start+1,end),lane:0,lanes:1};}).sort((a,b)=>a.start-b.start||a.end-b.end||a.item.id-b.item.id);
 let cluster=[],ends=[],clusterEnd=-1;
 const finish=()=>{for(const event of cluster)event.lanes=ends.length;cluster=[];ends=[];};
 for(const event of events){if(event.start>=clusterEnd){finish();clusterEnd=-1;}let lane=ends.findIndex(end=>end<=event.start);if(lane===-1)lane=ends.length;event.lane=lane;ends[lane]=event.end;cluster.push(event);clusterEnd=Math.max(clusterEnd,event.end);}
 finish();return events;
}
