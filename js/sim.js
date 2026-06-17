// ===== Sort Sol — simulation (boids + falcon + progression) =====
// World units are CSS pixels. Velocities are px/second; positions integrate by `step`.

const TUNE = {
  R: 46,            // neighbour radius
  SEP: 16,          // separation radius
  MAXSPEED: 158, MINSPEED: 74, MAXFORCE: 300,
  wAlign: 1.0, wCohesion: 0.95, wSep: 1.7, wLead: 0.85, wFear: 1.25, wEdge: 2.2,
  margin: 70,
  startBirds: 80, capBirds: 240,
  // falcon — a real threat. Birds barely auto-evade (wFear low); YOU dodge by steering.
  // It commits its dive from close range with a short prediction, so it connects unless you swerve.
  FEAR_R: 80, LOCK_R: 175, STOOP_R: 175, STRIKE_R: 32, leadTime: 0.28,
  falconHunt: 150, falconStoop: 404, falconAccel: 1250,
  // spawns / pacing — threat is immediate and dense
  loneEvery: 15, falconGrace: 2, falconRamp: 22, calmEvery: 46, calmLen: 8,
  // burst ("Sus")
  burstMax: 3, burstRegen: 3.2, burstInvuln: 0.45, nearMissR: 72,
};

const rnd = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> v<a?a:v>b?b:v;

export class World {
  constructor(W, H){
    this.W = W; this.H = H;
    this.tune = TUNE;
    this.reset();
  }
  reset(){
    const {W,H} = this;
    this.birds = [];
    for (let i=0;i<TUNE.startBirds;i++){
      const a = Math.random()*Math.PI*2, r = rnd(0, 90);
      this.birds.push({ x: W*0.5 + Math.cos(a)*r, y: H*0.5 + Math.sin(a)*r,
        vx: rnd(-40,40), vy: rnd(-40,40), n: 0 });
    }
    this.falcons = [];
    this.lones = [];
    this.puffs = [];
    this.lead = { x: W*0.5, y: H*0.5, active: false };
    this.time = 0; this.score = 0;
    this.peak = this.birds.length; this.lost = 0; this.gathered = 0;
    this.combo = 0; this.comboBest = 0; this.dodges = 0;
    this.burst = TUNE.burstMax; this._burstT = 0; this.burstInvuln = 0;
    this.shock = null; this.flashT = 0; this.floats = [];
    this.calm = 0; this.calmBonusGiven = false;
    this._loneT = TUNE.loneEvery * 0.6;
    this._calmT = TUNE.calmEvery;
    this.events = [];          // consumed by main each frame: {type,...}
    this.tension = 0;
    this.state = 'play';
    this.idle = false;
    this._grid = new Map();
  }

  // ---- active dodge: a coordinated burst that scatters the flock & foils any dive ----
  doBurst(){
    if (this.state!=='play' || this.idle || this.burst<=0) return false;
    this.burst--; this.burstInvuln = TUNE.burstInvuln;
    const c = this.centroid();
    this.shock = { x:c.x, y:c.y, life:0, max:0.5 };
    // kick every bird radially outward from the flock centre
    for (const b of this.birds){
      const dx=b.x-c.x, dy=b.y-c.y, d=Math.hypot(dx,dy)||1;
      const k = 150 + 260*(1 - Math.min(1,d/160));
      b.vx += dx/d*k; b.vy += dy/d*k;
    }
    // any falcon mid-dive is thrown off → counts as a dodge
    for (const f of this.falcons){
      if (f.state==='stoop'){ f.state='recover'; f.cooldown=rnd(0.8,1.4); f.lock=0; this._nearMiss(c.x,c.y,true); }
    }
    this.emit('burst');
    return true;
  }
  _nearMiss(x,y,fromBurst){
    this.combo++; if (this.combo>this.comboBest) this.comboBest=this.combo;
    this.dodges++;
    const gain = 20 + Math.min(this.combo,12)*12;
    this.score += gain;
    this.flashT = 0.18;
    this.floats.push({ x, y:y-30, vy:-34, life:0, max:1.0, text:'+'+gain, big:this.combo>=3 });
    this.emit('nearmiss', { x, y, combo:this.combo });
  }

  setLead(x,y,active){ this.lead.x=x; this.lead.y=y; this.lead.active=active; }
  emit(type, data){ this.events.push(Object.assign({type}, data||{})); }

  // ---- spatial hash over birds ----
  _buildGrid(){
    const g = this._grid; g.clear();
    const cs = TUNE.R;
    for (let i=0;i<this.birds.length;i++){
      const b = this.birds[i];
      const key = ((b.x/cs)|0) + ',' + ((b.y/cs)|0);
      let cell = g.get(key); if (!cell){ cell=[]; g.set(key,cell); }
      cell.push(i);
    }
  }
  _eachNeighbor(b, cb){
    const cs = TUNE.R, g = this._grid;
    const cx = (b.x/cs)|0, cy = (b.y/cs)|0;
    for (let gx=cx-1; gx<=cx+1; gx++) for (let gy=cy-1; gy<=cy+1; gy++){
      const cell = g.get(gx+','+gy); if (!cell) continue;
      for (let k=0;k<cell.length;k++) cb(cell[k]);
    }
  }
  // nearest bird to an arbitrary point (for falcon strikes)
  _nearestBird(px, py){
    const cs = TUNE.R, g = this._grid;
    const cx = (px/cs)|0, cy = (py/cs)|0;
    let bd=Infinity, bi=-1, bn=0;
    for (let gx=cx-1; gx<=cx+1; gx++) for (let gy=cy-1; gy<=cy+1; gy++){
      const cell = g.get(gx+','+gy); if (!cell) continue;
      for (let k=0;k<cell.length;k++){ const j=cell[k]; const b=this.birds[j];
        if (!b || b.dead) continue;
        const d2=(b.x-px)**2+(b.y-py)**2; if (d2<bd){ bd=d2; bi=j; bn=b.n; } }
    }
    return { i:bi, d:bi<0?Infinity:Math.sqrt(bd), n:bn };
  }

  update(step){
    if (this.state !== 'play') return;

    // menu ambiance: a gentle self-swirling flock, no danger
    if (this.idle){
      this.time += step;
      const a = this.time*0.35;
      this.lead.x = this.W*0.5 + Math.cos(a)*this.W*0.20;
      this.lead.y = this.H*0.42 + Math.sin(a*1.3)*this.H*0.14;
      this.lead.active = true;
      this._buildGrid(); this._updateBirds(step); this._updatePuffs(step);
      return;
    }

    this.time += step;

    // ---- progression timers ----
    this._calmT -= step;
    if (this.calm > 0){
      this.calm -= step;
      if (this.calm <= 0){ this.calm = 0; }
    } else if (this._calmT <= 0 && this.time > 20){
      this.calm = TUNE.calmLen; this._calmT = TUNE.calmEvery; this.calmBonusGiven = false;
      this.score += 250; this.emit('roost');
    }
    // calm bonus + send falcons home
    if (this.calm > 0 && !this.calmBonusGiven){ this.calmBonusGiven = true; }

    // burst recharge + timers
    if (this.burst < TUNE.burstMax){ this._burstT += step; if (this._burstT>=TUNE.burstRegen){ this._burstT=0; this.burst++; this.emit('charge'); } }
    if (this.burstInvuln>0) this.burstInvuln -= step;
    if (this.flashT>0) this.flashT -= step;
    if (this.shock){ this.shock.life += step; if (this.shock.life>=this.shock.max) this.shock=null; }
    for (let i=this.floats.length-1;i>=0;i--){ const fl=this.floats[i]; fl.life+=step; fl.y+=fl.vy*step; if(fl.life>=fl.max) this.floats.splice(i,1); }

    // falcon spawning by difficulty — first falcon almost immediately, ramps up
    const target = (this.time > TUNE.falconGrace && this.calm <= 0)
      ? clamp(1 + Math.floor((this.time - TUNE.falconGrace)/TUNE.falconRamp), 1, 4) : 0;
    while (this.falcons.length < target){ this._spawnFalcon(); this.emit('newfalcon', {n:this.falcons.length}); }

    // lone starlings
    this._loneT -= step;
    if (this._loneT <= 0){
      this._loneT = TUNE.loneEvery * (this.calm>0 ? 0.5 : 1) * rnd(0.8,1.2);
      if (this.birds.length < TUNE.capBirds) this._spawnLones();
    }

    this._buildGrid();
    this._updateBirds(step);
    this._updateLones(step);
    this._updateFalcons(step);
    this._updatePuffs(step);

    // sweep birds the falcon took this frame (deferred so the grid stayed valid)
    for (let i=this.birds.length-1;i>=0;i--) if (this.birds[i].dead) this.birds.splice(i,1);

    // small survival trickle — most points come from dodging (near-miss combo)
    this.score += step * (2 + this.birds.length * 0.07);
    if (this.birds.length > this.peak) this.peak = this.birds.length;

    // danger/tension for audio + visuals
    let danger = 0;
    for (const f of this.falcons){ if (f.state==='stoop') danger = Math.max(danger, 1);
      else if (f.state==='hunt') danger = Math.max(danger, 0.45); }
    if (this.calm>0) danger = 0;
    this.tension += (danger - this.tension) * Math.min(1, step*3);

    if (this.birds.length === 0){ this.state = 'over'; this.emit('gameover'); }
  }

  // ---------- birds (boids) ----------
  _updateBirds(step){
    const T = TUNE, birds = this.birds;
    const lead = this.lead;
    for (let i=0;i<birds.length;i++){
      const b = birds[i];
      let aliX=0,aliY=0, cohX=0,cohY=0, sepX=0,sepY=0, count=0, sepC=0;
      this._eachNeighbor(b, (j)=>{
        if (j===i) return;
        const o = birds[j];
        const dx = o.x-b.x, dy = o.y-b.y; const d2 = dx*dx+dy*dy;
        if (d2 > T.R*T.R || d2===0) return;
        const d = Math.sqrt(d2);
        aliX+=o.vx; aliY+=o.vy; cohX+=o.x; cohY+=o.y; count++;
        if (d < T.SEP){ sepX -= dx/d; sepY -= dy/d; sepC++; }
      });
      b.n = count;

      let ax=0, ay=0;
      if (count){
        ax += this._steer(aliX/count, aliY/count, b.vx, b.vy) * T.wAlign;        // align x
        ay += this._steerY * T.wAlign;
        ax += this._steer(cohX/count - b.x, cohY/count - b.y, b.vx, b.vy, true) * T.wCohesion;
        ay += this._steerY * T.wCohesion;
      }
      if (sepC){
        ax += this._steer(sepX, sepY, b.vx, b.vy) * T.wSep;
        ay += this._steerY * T.wSep;
      }
      if (lead.active){
        ax += this._steer(lead.x - b.x, lead.y - b.y, b.vx, b.vy, true) * T.wLead;
        ay += this._steerY * T.wLead;
      }
      // falcon fear — a diving falcon violently scatters the birds it passes (→ stragglers)
      for (const f of this.falcons){
        const dx = b.x-f.x, dy = b.y-f.y, d2 = dx*dx+dy*dy;
        if (d2 < T.FEAR_R*T.FEAR_R && d2>0){
          const d = Math.sqrt(d2); const closeness = 1 - d/T.FEAR_R;
          let fw = T.wFear;
          if (f.state==='stoop' && d < 64) fw *= 3.6;
          ax += (dx/d) * T.MAXFORCE * fw * closeness;
          ay += (dy/d) * T.MAXFORCE * fw * closeness;
        }
      }
      // soft edges
      const m = T.margin;
      if (b.x < m) ax += (1 - b.x/m) * T.MAXFORCE * T.wEdge;
      else if (b.x > this.W-m) ax -= (1 - (this.W-b.x)/m) * T.MAXFORCE * T.wEdge;
      if (b.y < m) ay += (1 - b.y/m) * T.MAXFORCE * T.wEdge;
      else if (b.y > this.H-m) ay -= (1 - (this.H-b.y)/m) * T.MAXFORCE * T.wEdge;

      b.vx += ax*step; b.vy += ay*step;
      // clamp speed band (starlings never stop)
      const sp = Math.hypot(b.vx,b.vy) || 1;
      const cl = clamp(sp, T.MINSPEED, T.MAXSPEED);
      if (cl !== sp){ b.vx = b.vx/sp*cl; b.vy = b.vy/sp*cl; }
      b.x += b.vx*step; b.y += b.vy*step;
    }
  }
  // Reynolds steering: desired = unit(dx,dy)*MAXSPEED; force = clamp(desired - vel). Stashes Y in _steerY.
  _steer(dx, dy, vx, vy){
    const T = TUNE;
    const len = Math.hypot(dx,dy);
    if (len < 0.0001){ this._steerY = 0; return 0; }
    let desX = dx/len*T.MAXSPEED, desY = dy/len*T.MAXSPEED;
    let fx = desX - vx, fy = desY - vy;
    const fl = Math.hypot(fx,fy);
    if (fl > T.MAXFORCE){ fx = fx/fl*T.MAXFORCE; fy = fy/fl*T.MAXFORCE; }
    this._steerY = fy; return fx;
  }

  // ---------- lone starlings drifting in ----------
  _spawnLones(){
    const side = Math.floor(Math.random()*4);
    const n = 2 + Math.floor(Math.random()*3);
    let bx, by, vx, vy;
    if (side===0){ bx=-20; by=rnd(0,this.H); vx=rnd(40,80); vy=rnd(-30,30); }
    else if (side===1){ bx=this.W+20; by=rnd(0,this.H); vx=rnd(-80,-40); vy=rnd(-30,30); }
    else if (side===2){ bx=rnd(0,this.W); by=-20; vx=rnd(-30,30); vy=rnd(40,80); }
    else { bx=rnd(0,this.W); by=this.H+20; vx=rnd(-30,30); vy=rnd(-80,-40); }
    for (let i=0;i<n;i++) this.lones.push({ x:bx+rnd(-20,20), y:by+rnd(-20,20), vx, vy, t:0 });
  }
  _updateLones(step){
    const T = TUNE;
    // centroid of flock to drift toward
    let cx=0, cy=0; const B=this.birds;
    if (B.length){ for (const b of B){ cx+=b.x; cy+=b.y; } cx/=B.length; cy/=B.length; }
    for (let i=this.lones.length-1;i>=0;i--){
      const l = this.lones[i]; l.t += step;
      // gently curve toward the flock
      if (B.length){
        const dx=cx-l.x, dy=cy-l.y, d=Math.hypot(dx,dy)||1;
        l.vx += dx/d*40*step; l.vy += dy/d*40*step;
      }
      const sp = Math.hypot(l.vx,l.vy)||1, cl=clamp(sp,60,120);
      l.vx=l.vx/sp*cl; l.vy=l.vy/sp*cl;
      l.x+=l.vx*step; l.y+=l.vy*step;
      // join when close to any bird
      let joined=false;
      this._eachNeighbor(l, (j)=>{ if (joined) return; const b=this.birds[j];
        if ((b.x-l.x)**2+(b.y-l.y)**2 < 40*40) joined=true; });
      if (joined && this.birds.length<T.capBirds){
        this.birds.push({x:l.x,y:l.y,vx:l.vx,vy:l.vy,n:0});
        this.lones.splice(i,1); this.gathered++; this.score += 12; this.emit('gather', {x:l.x,y:l.y});
      } else if (l.t>16 || l.x<-60||l.x>this.W+60||l.y<-60||l.y>this.H+60){
        this.lones.splice(i,1);   // wandered off
      }
    }
  }

  // ---------- falcon ----------
  _spawnFalcon(){
    const fromLeft = Math.random()<0.5;
    this.falcons.push({
      x: fromLeft?-40:this.W+40, y: rnd(this.H*0.1, this.H*0.4),
      vx:0, vy:0, state:'hunt', target:-1, lock:0, cooldown:rnd(0.5,1.5),
      aimx:0, aimy:0, stoopT:0, retire:{x:rnd(0.1,0.9)*this.W, y:-60},
    });
  }
  _pickTarget(f){
    const B=this.birds; if (!B.length) return -1;
    let best=-1, bestScore=Infinity;
    const sample = Math.min(B.length, 60);
    for (let s=0;s<sample;s++){
      const i = (s*7+((this.time*30)|0)) % B.length;
      const b=B[i];
      const d=Math.hypot(b.x-f.x,b.y-f.y);
      const score = b.n*16 + d*0.05;   // prefer isolated (low n) and near
      if (score<bestScore){ bestScore=score; best=i; }
    }
    return best;
  }
  _updateFalcons(step){
    const T=TUNE;
    const aggr = clamp((this.time-T.falconGrace)/120, 0, 1);
    const huntSpeed = T.falconHunt + aggr*40;
    const stoopSpeed = T.falconStoop + aggr*70;
    for (const f of this.falcons){
      if (this.calm>0 && f.state!=='recover'){ f.state='recover'; f.cooldown=Math.max(f.cooldown,this.calm); }

      if (f.state==='hunt'){
        if (f.target<0 || f.target>=this.birds.length || (f._retT||0)<=0){
          f.target=this._pickTarget(f); f._retT=0.4;
        }
        f._retT-=step;
        const b=this.birds[f.target];
        if (!b){ f.state='recover'; f.cooldown=1; continue; }
        // approach a point slightly toward the bird
        this._accelTo(f, b.x, b.y, huntSpeed, T.falconAccel*0.5, step);
        const d=Math.hypot(b.x-f.x,b.y-f.y);
        // build lock when close & roughly isolated
        if (d<T.LOCK_R) f.lock += step*(0.8+aggr*0.7); else f.lock -= step*0.6;
        f.lock=clamp(f.lock,0,1);
        if (f.lock>=1 && d<T.STOOP_R){
          f.state='stoop'; f.stoopT=0; f.minD=Infinity; f.struck=false; this.emit('stoop');
        }
      }
      else if (f.state==='stoop'){
        f.stoopT+=step;
        // home toward the live target but with a CAPPED turn rate: a sharp swerve makes it overshoot
        const b=this.birds[f.target];
        const desH = b ? Math.atan2(b.y-f.y, b.x-f.x) : Math.atan2(f.vy,f.vx);
        let h = Math.atan2(f.vy, f.vx);
        let dh = desH - h; while(dh>Math.PI)dh-=2*Math.PI; while(dh<-Math.PI)dh+=2*Math.PI;
        const maxTurn = 3.0*step;
        dh = clamp(dh, -maxTurn, maxTurn);
        h += dh;
        const sp = Math.min(stoopSpeed, (Math.hypot(f.vx,f.vy)||T.falconHunt) + T.falconAccel*step);
        f.vx = Math.cos(h)*sp; f.vy = Math.sin(h)*sp;
        // strike the nearest bird on contact — dense neighbourhood (high n) confuses the grab
        const near = this._nearestBird(f.x, f.y);
        if (near.i>=0 && near.d<f.minD) f.minD = near.d;
        if (near.i>=0 && near.d < T.STRIKE_R && this.burstInvuln<=0){
          const killProb = clamp(0.95 - near.n*0.05, 0.35, 0.95);
          if (Math.random()<killProb){ this._kill(near.i); f.struck=true; }
          f.state='recover'; f.cooldown=rnd(0.8,1.4)-aggr*0.3; f.lock=0;
        } else if (f.stoopT>1.3 || (b && Math.hypot(b.x-f.x,b.y-f.y) > T.STOOP_R*1.25)){
          // dive ended with no kill — if it came close, that's a dodge (reward + combo)
          if (!f.struck && f.minD < T.nearMissR) this._nearMiss(f.x, f.y, false);
          f.state='recover'; f.cooldown=rnd(0.8,1.4)-aggr*0.3; f.lock=0;
        }
      }
      else { // recover — climb away and rest
        f.cooldown-=step;
        const ry = this.calm>0 ? -80 : this.H*0.18;
        this._accelTo(f, f.retire.x, ry, huntSpeed*0.8, T.falconAccel*0.5, step);
        if (f.cooldown<=0 && this.calm<=0){ f.state='hunt'; f.target=-1; f.retire.x=rnd(0.1,0.9)*this.W; }
      }
      f.x+=f.vx*step; f.y+=f.vy*step;
    }
  }
  _accelTo(f, tx, ty, maxSp, accel, step){
    const dx=tx-f.x, dy=ty-f.y, d=Math.hypot(dx,dy)||1;
    const desX=dx/d*maxSp, desY=dy/d*maxSp;
    let fx=desX-f.vx, fy=desY-f.vy; const fl=Math.hypot(fx,fy)||1;
    const cap=accel; if (fl>cap){ fx=fx/fl*cap; fy=fy/fl*cap; }
    f.vx+=fx*step; f.vy+=fy*step;
    const sp=Math.hypot(f.vx,f.vy)||1; if (sp>maxSp){ f.vx=f.vx/sp*maxSp; f.vy=f.vy/sp*maxSp; }
  }
  _kill(i){
    const b=this.birds[i]; if (!b || b.dead) return;
    b.dead = true;                       // deferred: sweep after the update so grid indices stay valid
    for (let k=0;k<10;k++) this.puffs.push({
      x:b.x, y:b.y, vx:rnd(-70,70), vy:rnd(-70,70), life:0, max:rnd(0.5,1.0), r:rnd(1.5,3) });
    this.lost++; this.combo = 0;         // losing a bird breaks your dodge streak
    this.emit('loss', { x:b.x, y:b.y });
  }
  _updatePuffs(step){
    for (let i=this.puffs.length-1;i>=0;i--){
      const p=this.puffs[i]; p.life+=step;
      p.x+=p.vx*step; p.y+=p.vy*step; p.vy+=40*step; p.vx*=0.96;
      if (p.life>=p.max) this.puffs.splice(i,1);
    }
  }

  centroid(){
    const B=this.birds; if (!B.length) return {x:this.W/2,y:this.H/2};
    let x=0,y=0; for (const b of B){ x+=b.x; y+=b.y; } return {x:x/B.length,y:y/B.length};
  }
}
