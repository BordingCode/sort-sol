// ===== Sort Sol — generative audio (Web Audio, no files) =====
// Soft, musical, pentatonic. A slow evening pad + gentle event sounds.

let ctx = null, master = null, padGain = null, noiseBuf = null;
let started = false, tension = 0, muted = false;
const pad = [];

// A / C-major pentatonic across a few octaves (consonant in any order).
const PENT = [130.81, 146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23, 392.00, 440.00, 523.25];

export function unlock(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx){
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.0; master.connect(ctx.destination);
    // gentle fade-in of the whole mix
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, ctx.currentTime + 1.5);
    noiseBuf = makeNoise();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function makeNoise(){
  const len = ctx.sampleRate * 1.2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
  return b;
}

// ---- ambient pad: 3 voices on a low pentatonic chord, slow shimmer ----
export function startPad(){
  if (!ctx || started) return;
  started = true;
  padGain = ctx.createGain(); padGain.gain.value = 0.0; padGain.connect(master);
  padGain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
  const chord = [130.81, 196.00, 261.63];   // C2-ish, G2, C3
  chord.forEach((f, i)=>{
    const o = ctx.createOscillator(); o.type = i===2?'triangle':'sine'; o.frequency.value = f;
    const det = ctx.createOscillator(); det.type='sine'; det.frequency.value = f*1.005;
    const g = ctx.createGain(); g.gain.value = 0.5/(i+1);
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 600;
    // slow volume shimmer
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.04 + i*0.017;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.18;
    lfo.connect(lfoG).connect(g.gain);
    o.connect(g); det.connect(g); g.connect(lp).connect(padGain);
    o.start(); det.start(); lfo.start();
    pad.push({o,det,lfo,lp});
  });
}

// 0..1 — raises brightness/volume a touch when danger is near
export function setTension(t){
  tension = Math.max(0, Math.min(1, t));
  if (!ctx || !pad.length) return;
  const now = ctx.currentTime;
  pad.forEach((v,i)=> v.lp.frequency.setTargetAtTime(600 + tension*900, now, 0.4));
  if (padGain) padGain.gain.setTargetAtTime(0.16 + tension*0.10, now, 0.4);
}

function env(node, peak, dur, t0){
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g); return g;
}
function tone(freq, dur, type, peak, dest){
  if (!ctx || !isFinite(freq)) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator(); o.type=type||'sine'; o.frequency.value=freq;
  const g = env(o, peak ?? 0.2, dur, t0);
  g.connect(dest || master);
  o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}

// soft airy whoosh for sharp turns
export function wing(strength=1){
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
  const g = ctx.createGain();
  const peak = 0.05 + 0.06*strength;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  bp.frequency.setValueAtTime(700, t0);
  bp.frequency.exponentialRampToValueAtTime(1500, t0+0.18);
  src.connect(bp).connect(g).connect(master);
  src.start(t0); src.stop(t0 + 0.3);
}

// falcon stoop — a tense descending cry
export function screech(){
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator(); o.type='sawtooth';
  o.frequency.setValueAtTime(1300, t0);
  o.frequency.exponentialRampToValueAtTime(420, t0+0.32);
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1400; bp.Q.value=4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.12, t0+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+0.34);
  o.connect(bp).connect(g).connect(master);
  o.start(t0); o.stop(t0+0.4);
}

// a starling lost — low, soft, mournful
export function loss(){
  tone(146.83, 0.5, 'sine', 0.16);
  tone(98.00, 0.6, 'sine', 0.10);
}

// a wild starling joins — bright soft ping
export function gather(){
  const f = PENT[6 + Math.floor(Math.random()*4)];
  tone(f, 0.35, 'triangle', 0.12);
}

// dodged a dive / clean pass — bright rewarding ping, rises with combo
export function nearMiss(combo){
  if (!ctx) return;
  const base = Math.min(combo||1, 5);
  const a = PENT[Math.min(3 + base, PENT.length-1)];
  const b = PENT[Math.min(5 + base, PENT.length-1)];
  tone(a, 0.18, 'triangle', 0.13);
  setTimeout(()=> tone(b, 0.28, 'triangle', 0.13), 70);
}

// Sus burst — a big airy whoosh + soft body
export function burst(){
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=0.7;
  bp.frequency.setValueAtTime(500, t0); bp.frequency.exponentialRampToValueAtTime(2400, t0+0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+0.34);
  src.connect(bp).connect(g).connect(master);
  src.start(t0); src.stop(t0+0.4);
  tone(196, 0.22, 'sine', 0.08);
}

// reaching a roost — gentle rising pentatonic
export function chime(){
  if (!ctx) return;
  [261.63, 329.63, 392.00, 523.25].forEach((f,i)=>{
    setTimeout(()=> tone(f, 0.6, 'sine', 0.13), i*120);
  });
}

export function gameover(){
  if (!ctx) return;
  [261.63, 220.00, 174.61, 130.81].forEach((f,i)=>{
    setTimeout(()=> tone(f, 0.9, 'sine', 0.14), i*180);
  });
  if (padGain) padGain.gain.setTargetAtTime(0.04, ctx.currentTime, 1.2);
}

export function setMuted(m){
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m?0:0.9, ctx.currentTime, 0.2);
}
export function isMuted(){ return muted; }
