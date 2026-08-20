import { emitAck, roomFromQuery, socket, setText } from '../shared/socket.js';

const E={WATCH:'tv:watch',SNAP:'room:snapshot',COUNTDOWN:'round:countdown',OPEN:'stage:open',COUNT:'stage:submission-count',REVEAL:'stage:reveal',FINISH:'round:finished',CLOSED:'room:closed'};
const roomCode=roomFromQuery();
let snapshot=null,deadlineAt=null,reveals=new Map(),submittedCount=0;
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function renderBridge(){const stages=snapshot?.settings?.stageCount||10;const active=snapshot?.round?.stageIndex??-1;let html='';for(let i=stages-1;i>=0;i--){const reveal=reveals.get(i);for(const side of ['L','R']){let cls='ice';let label=`${i+1}${side}`;if(reveal){cls+=reveal.safeSide===side?' safe':' broken';label=reveal.safeSide===side?'SAFE':'CRACK';}else if(i===active&&snapshot?.status==='stage-open'){label='?';}html+=`<div class="${cls}">${label}</div>`;}}$('bridge').innerHTML=html;}
function renderRoster(players=[]){$('roster').innerHTML=players.length?players.map(p=>`<div class="player ${p.submitted?'submitted':''}"><img src="/assets/characters/${p.characterId}.svg" alt=""><div><b>${escapeHtml(p.displayName)}</b><small>${p.connected?'online':'reconnecting'} · ${p.submitted?'locked':'choosing'}</small></div><span class="pill ${p.eliminated?'bad':'ok'}">${p.lives==null?'LOBBY':p.eliminated?'OUT':`${p.lives} ♥`}</span></div>`).join(''):'<p class="muted">Waiting for players…</p>'}
function renderRanking(ranking=[]){$('ranking').innerHTML=ranking.length?ranking.map(r=>`<div class="rank"><b>#${r.place} ${escapeHtml(snapshot?.players.find(p=>p.playerId===r.playerId)?.displayName||r.playerId)}</b><span>${r.furthestStage} stages · ${r.lives} ♥</span></div>`).join(''):'<p class="muted">No result yet.</p>'}
function applySnapshot(next){snapshot=next;setText('roomCode',next.roomCode);renderRoster(next.players);renderBridge();if(next.status==='lobby')setText('phase','Join the room');if(next.status==='countdown')setText('phase','Get ready');if(next.status==='stage-open')setText('phase',`Stage ${(next.round?.stageIndex??0)+1} · choose now`);if(next.status==='stage-reveal')setText('phase','Ice reveal');if(next.status==='finished')setText('phase','Final results');deadlineAt=next.round?.deadlineAt||deadlineAt;if(next.round?.ranking)renderRanking(next.round.ranking);}

socket.on(E.SNAP,applySnapshot);
socket.on(E.COUNTDOWN,e=>{setText('phase','Get ready…');deadlineAt=e.startsAt;});
socket.on(E.OPEN,e=>{setText('phase',`Stage ${e.stageIndex+1} · choose now`);deadlineAt=e.deadlineAt;submittedCount=0;renderBridge();});
socket.on(E.COUNT,e=>{submittedCount=e.submittedCount;setText('phase',`Stage ${e.stageIndex+1} · ${e.submittedCount}/${e.aliveCount} locked`);});
socket.on(E.REVEAL,e=>{reveals.set(e.stageIndex,e);deadlineAt=null;setText('phase',`Stage ${e.stageIndex+1} · ${e.safeSide==='L'?'LEFT':'RIGHT'} was safe`);renderBridge();});
socket.on(E.FINISH,e=>{deadlineAt=null;setText('phase','Frostbridge complete');renderRanking(e.ranking||[]);});
socket.on(E.CLOSED,e=>{if(e.roomCode===roomCode){setText('phase','Room closed');deadlineAt=null;}});
setInterval(()=>{if(!deadlineAt)return setText('timer','--');setText('timer',`${Math.max(0,(deadlineAt-Date.now())/1000).toFixed(1)}s`);},100);

(async()=>{setText('roomCode',roomCode||'-----');if(!roomCode){setText('phase','Missing room code');return;}const r=await emitAck(E.WATCH,{roomCode});if(r.ok)applySnapshot(r.roomSnapshot);else setText('phase',r.code);})();
