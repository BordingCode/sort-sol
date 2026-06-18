// ===== Sort Sol — simulation (forward-flying gauntlet) =====
// The flock hovers near anchorX; the WORLD scrolls left past it. You steer the flock
// up/down to thread gaps in oncoming barriers, gather wild starlings, and dodge the falcon.
// World units = CSS pixels. Velocities px/second; positions integrate by `step`.

const TUNE = {
  R: 40, SEP: 15,
  MAXSPEED: 270, MINSPEED: 30, MAXFORCE: 560,
  wAlign: 0.7, wCohesion: 1.35, wSep: 1.7, wLeadY: 3.8, wAnchorX: 4.2, wFear: 2.0, wEdge: 2.4,
  margin: 52,
  startBirds: 70, capBirds: 220,
  anchorFrac: 0.32,
  // scroll / difficulty — eased so gaps are always reachable in time
  speed0: 150, speedMax: 300, speedRampPer1000: 15,   // +px/s per 1000px travelled
  barrierW: 26, gap0: 300, gapMin: 200, spacing0: 430, spacingMin: 300,
  // gather + falcon (falcon is occasional punctuation, not constant)
  gatherEvery: 620, falconEvery: 3000, falconMax: 1, falconGraceDist: 1600,
  FEAR_R: 90, LOCK_R: 165, STOOP_R: 165, STRIKE_R: 30,
  falconHunt: 165, falconStoop: 430, falconAccel: 1300,
  // tuck ("Saml") — pull the flock into a tight ball to thread narrow gaps / shield
  tuckMax: 3, tuckRegen: 3.0, tuckTime: 0.7, nearMissR: 70,
};

const rnd = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> v<a?a:v>b?b:v;

export class World {
  constructor(W, H){ this.W=W; this.H=H; this.tune=TUNE; this.reset(); }

  reset(){
    const {W,H} = this;
    this.anchorX = W*TUNE.anchorFrac;
    this.birds = [];
    for (let i=0;i<TUNE.startBirds;i++){
      const a=Math.random()*6.28, r=rnd(0,70);
      this.birds.push({ x:this.anchorX+Math.cos(a)*r, y:H*0.5+Math.sin(a)*r, vx:rnd(-30,30), vy:rnd(-30,30), n:0 });
    }
    this.falcons=[]; this.lones=[]; this.barriers=[]; this.puffs=[]; this.floats=[];
    this.lead={ x:this.anchorX, y:H*0.5, active:false };
    this.dist=0; this.speed=TUNE.speed0; this.score=0; this.time=0;
    this.peak=this.birds.length; this.lost=0; this.gathered=0;
    this.combo=0; this.comboBest=0; this.cleanPasses=0;
    this.tuck=TUNE.tuckMax; this._tuckT=0; this.tucking=0; this.invuln=0;
    this.shock=null; this.flashT=0;
    this._nextBarrier=W*0.9; this._gatherD=TUNE.gatherEvery*0.7; this._falconD=TUNE.falconGraceDist;
    this.events=[]; this.tension=0; this.state='play'; this.idle=false;
    this._grid=new Map();
  }

  setLead(x,y,active){ this.lead.x=this.anchorX; this.lead.y=y; this.lead.active=active; }
  emit(type,data){ this.events.push(Object.assign({type},data||{})); }

  // ---- tuck: pull the flock tight (smaller hitbox) + brief shield ----
  doTuck(){
    if (this.state!=='play'||this.idle||this.tuck<=0) return false;
    this.tuck--; this.tucking=TUNE.tuckTime; this.invuln=TUNE.tuckTime*0.7;
    const c=this.centroid();
    this.shock={ x:c.x, y:c.y, life:0, max:0.45, ring:false };
    for (const f of this.falcons) if (f.state==='stoop'){ f.state='recover'; f.cooldown=rnd(0.7,1.2); f.lock=0; }
    this.emit('tuck');
    return true;
  }

  // ---- spatial hash ----
  _buildGrid(){ const g=this._grid; g.clear(); const cs=TUNE.R;
    for (let i=0;i<this.birds.length;i++){ const b=this.birds[i];
      const k=((b.x/cs)|0)+','+((b.y/cs)|0); let c=g.get(k); if(!c){c=[];g.set(k,c);} c.push(i);} }
  _eachNeighbor(b,cb){ const cs=TUNE.R,g=this._grid; const cx=(b.x/cs)|0,cy=(b.y/cs)|0;
    for (let gx=cx-1;gx<=cx+1;gx++) for (let gy=cy-1;gy<=cy+1;gy++){ const c=g.get(gx+','+gy); if(!c)continue;
      for (let k=0;k<c.length;k++) cb(c[k]); } }
  _nearestBird(px,py){ const cs=TUNE.R,g=this._grid; const cx=(px/cs)|0,cy=(py/cs)|0; let bd=Infinity,bi=-1,bn=0;
    for (let gx=cx-1;gx<=cx+1;gx++) for (let gy=cy-1;gy<=cy+1;gy++){ const c=g.get(gx+','+gy); if(!c)continue;
      for (let k=0;k<c.length;k++){ const j=c[k],b=this.birds[j]; if(!b||b.dead)continue;
        const d2=(b.x-px)**2+(b.y-py)**2; if(d2<bd){bd=d2;bi=j;bn=b.n;} } } }
  // (nearestBird returns below)

  update(step){
    if (this.state!=='play') return;

    if (this.idle){   // menu ambiance: a calm swirl
      this.dist += step; const a=this.dist*0.6;
      this.lead.x=this.W*0.5+Math.cos(a)*this.W*0.18; this.lead.y=this.H*0.45+Math.sin(a*1.3)*this.H*0.12;
      this.lead.active=true; this._buildGrid(); this._updateBirds(step,true); this._updatePuffs(step);
      return;
    }

    // scroll speed ramps with distance (+speedRampPer1000 px/s for every 1000px flown)
    this.speed = clamp(TUNE.speed0 + (this.dist/1000)*TUNE.speedRampPer1000, TUNE.speed0, TUNE.speedMax);
    this.time += step;
    this.dist += this.speed*step;
    this.score += step*this.speed*0.05;     // distance points

    // timers
    if (this.tuck<TUNE.tuckMax){ this._tuckT+=step; if(this._tuckT>=TUNE.tuckRegen){ this._tuckT=0; this.tuck++; this.emit('charge'); } }
    if (this.tucking>0) this.tucking-=step;
    if (this.invuln>0) this.invuln-=step;
    if (this.flashT>0) this.flashT-=step;
    if (this.shock){ this.shock.life+=step; if(this.shock.life>=this.shock.max) this.shock=null; }
    for (let i=this.floats.length-1;i>=0;i--){ const f=this.floats[i]; f.life+=step; f.y+=f.vy*step; f.x-=this.speed*step; if(f.life>=f.max) this.floats.splice(i,1); }

    // spawns (distance-driven)
    if (this.dist > this._nextBarrier){ this._spawnBarrier(); }
    if (this.dist > this._gatherD){ this._gatherD += TUNE.gatherEvery*rnd(0.8,1.3); this._spawnGather(); }
    if (this.dist > this._falconD && this.falcons.length<TUNE.falconMax){ this._falconD = this.dist + TUNE.falconEvery*rnd(0.8,1.3); this._spawnFalcon(); }

    this._buildGrid();
    this._updateBirds(step,false);
    this._updateBarriers(step);
    this._updateLones(step);
    this._updateFalcons(step);
    this._updatePuffs(step);

    for (let i=this.birds.length-1;i>=0;i--) if (this.birds[i].dead) this.birds.splice(i,1);

    if (this.birds.length>this.peak) this.peak=this.birds.length;

    // tension from nearby barrier + diving falcon
    let danger=0;
    for (const f of this.falcons){ if(f.state==='stoop') danger=Math.max(danger,1); else if(f.state==='hunt') danger=Math.max(danger,0.4); }
    for (const ba of this.barriers){ const d=ba.x-this.anchorX; if (d>0 && d<160) danger=Math.max(danger, 0.5*(1-d/160)); }
    this.tension += (danger-this.tension)*Math.min(1,step*3);

    if (this.birds.length===0){ this.state='over'; this.emit('gameover'); }
  }

  // ---------- birds ----------
  _updateBirds(step, idle){
    const T=TUNE, birds=this.birds, lead=this.lead;
    const tucking = this.tucking>0;
    for (let i=0;i<birds.length;i++){
      const b=birds[i];
      let aliX=0,aliY=0,cohX=0,cohY=0,sepX=0,sepY=0,count=0,sepC=0;
      this._eachNeighbor(b,(j)=>{ if(j===i)return; const o=birds[j];
        const dx=o.x-b.x,dy=o.y-b.y,d2=dx*dx+dy*dy; if(d2>T.R*T.R||d2===0)return; const d=Math.sqrt(d2);
        aliX+=o.vx;aliY+=o.vy;cohX+=o.x;cohY+=o.y;count++; if(d<T.SEP){sepX-=dx/d;sepY-=dy/d;sepC++;} });
      b.n=count;
      let ax=0,ay=0;
      if (count){
        ax+=this._steer(aliX/count,aliY/count,b.vx,b.vy)*T.wAlign; ay+=this._steerY*T.wAlign;
        const cohW = tucking ? T.wCohesion*3.2 : T.wCohesion;
        ax+=this._steer(cohX/count-b.x,cohY/count-b.y,b.vx,b.vy)*cohW; ay+=this._steerY*cohW;
      }
      if (sepC){ const sepW = tucking ? T.wSep*0.4 : T.wSep;
        ax+=this._steer(sepX,sepY,b.vx,b.vy)*sepW; ay+=this._steerY*sepW; }
      // horizontal anchor (keeps flock in frame) + vertical lead (player control)
      ax += clamp((this.anchorX-b.x)* (idle?2.5:T.wAnchorX), -T.MAXFORCE*2, T.MAXFORCE*2);
      if (lead.active || !idle){
        const ty = idle ? lead.y : lead.y;
        ay += clamp((ty-b.y)*T.wLeadY, -T.MAXFORCE*2.4, T.MAXFORCE*2.4);
        if (idle) ax += clamp((lead.x-b.x)*2.5,-T.MAXFORCE,T.MAXFORCE);
      }
      // falcon fear
      for (const f of this.falcons){ const dx=b.x-f.x,dy=b.y-f.y,d2=dx*dx+dy*dy;
        if (d2<T.FEAR_R*T.FEAR_R&&d2>0){ const d=Math.sqrt(d2),cl=1-d/T.FEAR_R; let fw=T.wFear; if(f.state==='stoop'&&d<60)fw*=3;
          ax+=dx/d*T.MAXFORCE*fw*cl; ay+=dy/d*T.MAXFORCE*fw*cl; } }
      // vertical edges only
      const m=T.margin;
      if (b.y<m) ay+=(1-b.y/m)*T.MAXFORCE*T.wEdge; else if (b.y>this.H-m) ay-=(1-(this.H-b.y)/m)*T.MAXFORCE*T.wEdge;

      b.vx+=ax*step; b.vy+=ay*step;
      const sp=Math.hypot(b.vx,b.vy)||1, cl=clamp(sp,T.MINSPEED,T.MAXSPEED);
      if(cl!==sp){b.vx=b.vx/sp*cl;b.vy=b.vy/sp*cl;}
      b.x+=b.vx*step; b.y+=b.vy*step;
    }
  }
  _steer(dx,dy,vx,vy){ const T=TUNE,len=Math.hypot(dx,dy);
    if(len<0.0001){this._steerY=0;return 0;}
    let dX=dx/len*T.MAXSPEED,dY=dy/len*T.MAXSPEED,fx=dX-vx,fy=dY-vy; const fl=Math.hypot(fx,fy);
    if(fl>T.MAXFORCE){fx=fx/fl*T.MAXFORCE;fy=fy/fl*T.MAXFORCE;} this._steerY=fy; return fx; }

  // ---------- barriers (the gauntlet) ----------
  _spawnBarrier(){
    const T=TUNE;
    const spacing = clamp(T.spacing0 - this.dist*0.012, T.spacingMin, T.spacing0);
    this._nextBarrier = this.dist + spacing;
    const gapH = clamp(T.gap0 - this.dist*0.010, T.gapMin, T.gap0);
    const m = T.margin + gapH/2 + 10;
    let gapY;
    const prev = this.barriers[this.barriers.length-1];
    if (prev){
      // cap the vertical jump to what the flock can actually fly in the time before it arrives
      const timeToNext = spacing / this.speed;
      const maxDelta = T.MAXSPEED * timeToNext * 0.55;
      gapY = clamp(prev.gapY + rnd(-1,1)*maxDelta, m, this.H-m);
    } else gapY = rnd(m, this.H-m);
    const kind = Math.random()<0.5 ? 'pylon' : 'trees';
    this.barriers.push({ x:this.W+30, w:T.barrierW, gapY, gapH, kind, hits:0, scored:false, seed:Math.random()*999 });
  }
  _updateBarriers(step){
    const T=TUNE;
    for (let i=this.barriers.length-1;i>=0;i--){
      const ba=this.barriers[i]; ba.x -= this.speed*step;
      // collision: birds inside the solid band & outside the gap
      const x0=ba.x, x1=ba.x+ba.w;
      if (x1 > this.anchorX-90 && x0 < this.anchorX+90 && this.invuln<=0){
        const gy0=ba.gapY-ba.gapH/2, gy1=ba.gapY+ba.gapH/2;
        for (let k=this.birds.length-1;k>=0;k--){ const b=this.birds[k]; if(b.dead)continue;
          if (b.x>x0 && b.x<x1 && (b.y<gy0 || b.y>gy1)){ this._kill(k); ba.hits++; } }
      }
      // score the pass once the barrier clears the flock plane
      if (!ba.scored && x1 < this.anchorX-60){ ba.scored=true;
        if (ba.hits===0){ this.cleanPasses++; this._reward(this.anchorX, ba.gapY, true); }
        else { this.combo=0; }
      }
      if (ba.x < -60) this.barriers.splice(i,1);
    }
  }
  _reward(x,y,clean){
    this.combo++; if(this.combo>this.comboBest)this.comboBest=this.combo;
    const gain = 25 + Math.min(this.combo,15)*15;
    this.score += gain; this.flashT=0.16;
    this.floats.push({ x:this.anchorX+60, y:y-20, vy:-30, life:0, max:1.0, text:'Ren! +'+gain, big:this.combo>=3 });
    this.emit('clean', { combo:this.combo });
  }

  // ---------- gather clusters (scroll in, join on contact) ----------
  _spawnGather(){
    const n=4+Math.floor(Math.random()*5), y=rnd(TUNE.margin, this.H-TUNE.margin);
    for (let i=0;i<n;i++) this.lones.push({ x:this.W+rnd(10,60), y:y+rnd(-26,26), vx:0, vy:rnd(-20,20), t:0 });
  }
  _updateLones(step){
    const T=TUNE;
    for (let i=this.lones.length-1;i>=0;i--){
      const l=this.lones[i]; l.t+=step;
      l.x -= this.speed*step;                       // scroll with the world
      l.y += l.vy*step; l.vy *= 0.98;
      if (l.y<T.margin||l.y>this.H-T.margin) l.vy*=-1;
      let joined=false;
      this._eachNeighbor(l,(j)=>{ if(joined)return; const b=this.birds[j]; if((b.x-l.x)**2+(b.y-l.y)**2<40*40) joined=true; });
      if (joined && this.birds.length<T.capBirds){
        this.birds.push({x:l.x,y:l.y,vx:l.vx-60,vy:l.vy,n:0}); this.lones.splice(i,1); this.gathered++;
        this.score+=10; this.emit('gather',{x:l.x,y:l.y});
      } else if (l.x<-50) this.lones.splice(i,1);
    }
  }

  // ---------- falcon ----------
  _spawnFalcon(){
    this.falcons.push({ x:this.W+40, y:rnd(this.H*0.2,this.H*0.8), vx:-TUNE.falconHunt, vy:0,
      state:'hunt', target:-1, lock:0, cooldown:rnd(0.4,1), stoopT:0, minD:Infinity, struck:false, life:0,
      retire:{x:this.W+80,y:rnd(0.2,0.8)*this.H} });
  }
  _pickTarget(f){ const B=this.birds; if(!B.length)return -1; let best=-1,bs=Infinity;
    const s=Math.min(B.length,50); for(let k=0;k<s;k++){ const i=(k*7+((this.dist)|0))%B.length; const b=B[i];
      const d=Math.hypot(b.x-f.x,b.y-f.y); const sc=b.n*16+d*0.05; if(sc<bs){bs=sc;best=i;} } return best; }
  _updateFalcons(step){
    const T=TUNE;
    for (let fi=this.falcons.length-1; fi>=0; fi--){
      const f=this.falcons[fi]; f.life+=step;
      if (f.state==='hunt'){
        if (f.target<0||f.target>=this.birds.length||(f._rt||0)<=0){ f.target=this._pickTarget(f); f._rt=0.4; }
        f._rt-=step; const b=this.birds[f.target];
        if (!b){ f.state='leave'; }
        else { this._accelTo(f,b.x,b.y,T.falconHunt,T.falconAccel*0.5,step);
          const d=Math.hypot(b.x-f.x,b.y-f.y); if(d<T.LOCK_R)f.lock+=step*1.2; else f.lock-=step*0.6; f.lock=clamp(f.lock,0,1);
          if (f.lock>=1&&d<T.STOOP_R){ f.state='stoop'; f.stoopT=0; f.minD=Infinity; f.struck=false; this.emit('stoop'); } }
        if (f.life>9) f.state='leave';
      } else if (f.state==='stoop'){
        f.stoopT+=step; const b=this.birds[f.target];
        const desH=b?Math.atan2(b.y-f.y,b.x-f.x):Math.atan2(f.vy,f.vx);
        let h=Math.atan2(f.vy,f.vx); let dh=desH-h; while(dh>Math.PI)dh-=6.2832; while(dh<-Math.PI)dh+=6.2832;
        dh=clamp(dh,-3.0*step,3.0*step); h+=dh;
        const sp=Math.min(T.falconStoop,(Math.hypot(f.vx,f.vy)||T.falconHunt)+T.falconAccel*step);
        f.vx=Math.cos(h)*sp; f.vy=Math.sin(h)*sp;
        const near=this._nearestBird(f.x,f.y);
        if(near && near.i>=0 && near.d<f.minD) f.minD=near.d;
        if(near && near.i>=0 && near.d<T.STRIKE_R && this.invuln<=0){
          if(Math.random()<clamp(0.9-near.n*0.06,0.25,0.9)){ this._kill(near.i); f.struck=true; }
          f.state='recover'; f.cooldown=rnd(0.8,1.4); f.lock=0;
        } else if (f.stoopT>1.2){ if(!f.struck&&f.minD<T.nearMissR) this._nearMiss(f.x,f.y); f.state='recover'; f.cooldown=rnd(0.8,1.4); f.lock=0; }
      } else if (f.state==='recover'){
        f.cooldown-=step; this._accelTo(f,f.x+40,this.H*0.2,T.falconHunt*0.9,T.falconAccel*0.5,step);
        if(f.cooldown<=0) f.state = f.life>9 ? 'leave':'hunt';
      } else { // leave — fly off the left
        f.vx += (-T.falconHunt*1.4 - f.vx)*Math.min(1,step*2); f.vy*=0.96;
        if (f.x<-60){ this.falcons.splice(fi,1); continue; }
      }
      f.x+=f.vx*step; f.y+=f.vy*step;
    }
  }
  _accelTo(f,tx,ty,maxSp,accel,step){ const dx=tx-f.x,dy=ty-f.y,d=Math.hypot(dx,dy)||1;
    let fx=dx/d*maxSp-f.vx, fy=dy/d*maxSp-f.vy; const fl=Math.hypot(fx,fy)||1; if(fl>accel){fx=fx/fl*accel;fy=fy/fl*accel;}
    f.vx+=fx*step; f.vy+=fy*step; const sp=Math.hypot(f.vx,f.vy)||1; if(sp>maxSp){f.vx=f.vx/sp*maxSp;f.vy=f.vy/sp*maxSp;} }
  _nearMiss(x,y){ this.combo++; if(this.combo>this.comboBest)this.comboBest=this.combo;
    const gain=15+Math.min(this.combo,12)*10; this.score+=gain; this.flashT=0.16;
    this.floats.push({x,y:y-26,vy:-30,life:0,max:1.0,text:'+'+gain,big:this.combo>=3}); this.emit('nearmiss',{combo:this.combo}); }

  _kill(i){ const b=this.birds[i]; if(!b||b.dead)return; b.dead=true;
    for(let k=0;k<9;k++) this.puffs.push({x:b.x,y:b.y,vx:rnd(-70,70),vy:rnd(-70,70),life:0,max:rnd(0.5,1),r:rnd(1.5,3)});
    this.lost++; this.combo=0; this.emit('loss',{x:b.x,y:b.y}); }
  _updatePuffs(step){ for(let i=this.puffs.length-1;i>=0;i--){ const p=this.puffs[i]; p.life+=step;
    p.x+=p.vx*step - (this.idle?0:this.speed*step*0.4); p.y+=p.vy*step; p.vy+=40*step; p.vx*=0.96;
    if(p.life>=p.max) this.puffs.splice(i,1); } }

  centroid(){ const B=this.birds; if(!B.length)return{x:this.anchorX,y:this.H/2}; let x=0,y=0;
    for(const b of B){x+=b.x;y+=b.y;} return {x:x/B.length,y:y/B.length}; }
}

// patch: _nearestBird must return its result (kept separate for readability)
World.prototype._nearestBird = function(px,py){
  const cs=TUNE.R,g=this._grid; const cx=(px/cs)|0,cy=(py/cs)|0; let bd=Infinity,bi=-1,bn=0;
  for (let gx=cx-1;gx<=cx+1;gx++) for (let gy=cy-1;gy<=cy+1;gy++){ const c=g.get(gx+','+gy); if(!c)continue;
    for (let k=0;k<c.length;k++){ const j=c[k],b=this.birds[j]; if(!b||b.dead)continue;
      const d2=(b.x-px)**2+(b.y-py)**2; if(d2<bd){bd=d2;bi=j;bn=b.n;} } }
  return { i:bi, d:bi<0?Infinity:Math.sqrt(bd), n:bn };
};
