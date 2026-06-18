// ===== Sort Sol — main =====
import { World } from './sim.js';
import { Renderer } from './render.js';
import * as A from './audio.js';

const STEP = 1/60, MAX_STEPS = 8;
const $ = (s)=>document.querySelector(s);

const canvas = $('#game');
const ctx = canvas.getContext('2d');
let dpr = 1, W = 0, H = 0;

const renderer = new Renderer();
let world = new World(window.innerWidth, window.innerHeight);
world.idle = true;                 // menu ambiance

const BEST_KEY = 'sortsol.best.v1';
let best = loadBest();

// ---------- canvas sizing ----------
function resize(){
  dpr = Math.min(window.devicePixelRatio||1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  world.W = W; world.H = H;
  renderer.layout(W, H);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', ()=> setTimeout(resize, 200));
resize();

// ---------- loop ----------
let last = performance.now(), acc = 0, running = true, paused = false, slowmo = 0;
function frame(now){
  if (!running){ requestAnimationFrame(frame); return; }
  let dt = (now - last)/1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (slowmo > 0) slowmo -= dt;
  const ts = slowmo > 0 ? 0.4 : 1;          // brief slow-mo on a dodge
  if (!paused){
    acc += dt * ts; let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS){ world.update(STEP); drainEvents(); acc -= STEP; steps++; }
    if (steps >= MAX_STEPS) acc = 0;
  }
  renderer.draw(ctx, world, dt);
  A.setTension(world.idle ? 0 : world.tension);
  if (gameState === 'play' && !world.idle) updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let lastCombo = -1, lastBurst = -1;
function updateHud(){
  $('#flockCount').textContent = world.birds.length;
  $('#score').textContent = Math.floor(world.score);
  if (world.combo !== lastCombo){
    lastCombo = world.combo;
    const c = $('#combo');
    if (world.combo >= 2){ c.hidden = false; c.textContent = 'Kæde ×'+world.combo;
      c.style.animation='none'; void c.offsetWidth; c.style.animation=''; }
    else c.hidden = true;
  }
  if (world.tuck !== lastBurst){
    lastBurst = world.tuck;
    const pips = $('#burstPips');
    pips.innerHTML = Array.from({length: world.tune.tuckMax}, (_,i)=> `<i class="${i<world.tuck?'on':''}"></i>`).join('');
    $('#burstBtn').classList.toggle('empty', world.tuck<=0);
  }
}

// ---------- events from the sim ----------
let firstFalconShown = false;
function drainEvents(){
  const ev = world.events; if (!ev.length) return;
  for (const e of ev){
    if (e.type==='stoop') A.screech();
    else if (e.type==='loss') A.loss();
    else if (e.type==='gather') A.gather();
    else if (e.type==='nearmiss'){ A.nearMiss(e.combo); slowmo = 0.18; }
    else if (e.type==='clean'){ A.nearMiss(e.combo); slowmo = 0.16; }
    else if (e.type==='tuck') A.burst();
    else if (e.type==='gameover') endRun();
  }
  ev.length = 0;
  if (!firstFalconShown && world.falcons.length>0 && gameState==='play'){
    firstFalconShown = true; banner('En vandrefalk!', 'pas på sværmens kant'); A.screech();
  }
}

// ---------- input: drag to steer ----------
let steering = false, lastTurnT = 0, lastLX = 0, lastLY = 0;
function pointer(e){ const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

canvas.addEventListener('pointerdown', (e)=>{
  if (gameState !== 'play' || world.idle) return;
  A.unlock();
  steering = true;
  try { canvas.setPointerCapture(e.pointerId); } catch(_){}
  const p = pointer(e); world.setLead(p.x, p.y, true); lastLX=p.x; lastLY=p.y;
}, {passive:true});

canvas.addEventListener('pointermove', (e)=>{
  if (!steering) return;
  const p = pointer(e); world.setLead(p.x, p.y, true);
  const moved = Math.hypot(p.x-lastLX, p.y-lastLY);
  const t = performance.now();
  if (moved > 26 && t-lastTurnT > 140){ A.wing(Math.min(1, moved/120)); lastTurnT = t; }
  lastLX=p.x; lastLY=p.y;
}, {passive:true});

function endSteer(){ steering = false; }   // keep lead at last point so you never lose control
canvas.addEventListener('pointerup', endSteer, {passive:true});
canvas.addEventListener('pointercancel', endSteer, {passive:true});

// Saml — tuck the flock tight (thread narrow gaps / shield)
function fireBurst(){ if (gameState!=='play'||world.idle) return; A.unlock(); world.doTuck(); }
$('#burstBtn').addEventListener('pointerdown', (e)=>{ e.preventDefault(); fireBurst(); });
document.addEventListener('keydown', (e)=>{ if (e.code==='Space'){ e.preventDefault(); fireBurst(); } });

// ---------- screens / run flow ----------
let gameState = 'menu';   // 'menu' | 'play' | 'paused' | 'over'

function showStartBest(){
  if (best.score>0){ const el=$('#startBest'); el.hidden=false;
    el.textContent = `Bedste: ${best.score} · største sværm ${best.flock}`; }
}
showStartBest();

$('#startBtn').addEventListener('click', startRun);
$('#againBtn').addEventListener('click', startRun);
$('#pauseBtn').addEventListener('click', pauseRun);
$('#resumeBtn').addEventListener('click', resumeRun);
$('#quitBtn').addEventListener('click', ()=>{ toMenu(); });

function startRun(){
  A.unlock(); A.startPad();
  world.reset(); world.W=W; world.H=H; world.idle=false;
  firstFalconShown = false;
  gameState = 'play'; paused = false;
  $('#start').hidden = true; $('#over').hidden = true; $('#pause').hidden = true;
  $('#hud').hidden = false; $('#pauseBtn').hidden = false; $('#burstBtn').hidden = false;
  lastCombo=-1; lastBurst=-1;
}

function pauseRun(){
  if (gameState!=='play') return;
  paused = true; gameState='paused'; $('#pause').hidden=false; $('#pauseBtn').hidden=true; $('#burstBtn').hidden=true;
}
function resumeRun(){
  if (gameState!=='paused') return;
  paused=false; gameState='play'; $('#pause').hidden=true; $('#pauseBtn').hidden=false; $('#burstBtn').hidden=false;
  last = performance.now();
}

function endRun(){
  gameState='over'; paused=false;
  $('#hud').hidden = true; $('#pauseBtn').hidden = true; $('#burstBtn').hidden = true;
  const score = Math.floor(world.score), t = Math.floor(world.time);
  const isBest = score > best.score;
  if (isBest){ best = { score, flock: world.peak, time: t }; saveBest(best); }
  const meters = Math.floor(world.dist/10);
  $('#overStats').innerHTML = `
    <div class="row${isBest?' hl':''}"><span class="k">Point</span><span class="v">${score}${isBest?' ★':''}</span></div>
    <div class="row"><span class="k">Distance</span><span class="v">${meters} m</span></div>
    <div class="row"><span class="k">Længste kæde</span><span class="v">×${world.comboBest}</span></div>
    <div class="row"><span class="k">Rene huller</span><span class="v">${world.cleanPasses}</span></div>
    <div class="row"><span class="k">Største sværm</span><span class="v">${world.peak}</span></div>
    <div class="row"><span class="k">Bedste</span><span class="v">${best.score}</span></div>`;
  $('#over').hidden = false;
  A.gameover();
}

function toMenu(){
  gameState='menu';
  world.reset(); world.idle = true;
  $('#pause').hidden=true; $('#over').hidden=true; $('#hud').hidden=true; $('#pauseBtn').hidden=true; $('#burstBtn').hidden=true;
  $('#start').hidden=false; showStartBest();
}

// auto-pause when tab/app hidden mid-game
document.addEventListener('visibilitychange', ()=>{
  if (document.hidden && gameState==='play') pauseRun();
});

// ---------- banner ----------
let bannerT = null;
function banner(text, sub){
  const el = $('#banner');
  el.innerHTML = text + (sub?`<span class="sub">${sub}</span>`:'');
  el.hidden = false;
  clearTimeout(bannerT);
  bannerT = setTimeout(()=>{ el.hidden = true; }, 2400);
}

// ---------- helpers ----------
function fmtTime(s){ const m=Math.floor(s/60), ss=s%60; return m>0?`${m}:${String(ss).padStart(2,'0')}`:`${ss}s`; }
function loadBest(){ try{ return JSON.parse(localStorage.getItem(BEST_KEY)) || {score:0,flock:0,time:0}; }catch(_){ return {score:0,flock:0,time:0}; } }
function saveBest(b){ try{ localStorage.setItem(BEST_KEY, JSON.stringify(b)); }catch(_){} }

// ---------- debug handle (harmless; handy for testing) ----------
window.__ss = { world, get state(){ return gameState; } };

// ---------- service worker ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=3').catch(()=>{});
