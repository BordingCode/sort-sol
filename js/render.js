// ===== Sort Sol — rendering =====

export class Renderer {
  constructor(){ this.t = 0; this.stars = []; this.reeds = []; this.W=0; this.H=0; }

  layout(W, H){
    this.W=W; this.H=H;
    // star field (fewer near the bright horizon)
    this.stars = [];
    const n = Math.round(W*H/9000);
    for (let i=0;i<n;i++){
      const y = Math.pow(Math.random(),1.5) * H*0.8;
      this.stars.push({ x:Math.random()*W, y, r:Math.random()*1.3+0.3, ph:Math.random()*6.28, tw:0.4+Math.random()*0.6 });
    }
    // marsh reeds along the bottom
    this.reeds = [];
    const rn = Math.round(W/26);
    for (let i=0;i<rn;i++){
      this.reeds.push({ x:Math.random()*W, h:18+Math.random()*46, lean:(Math.random()-0.5)*0.5, w:1+Math.random()*1.6 });
    }
  }

  draw(ctx, world, dt){
    this.t += dt;
    const {W,H} = this;
    const calm = world.calm>0;
    const tens = world.tension;

    // ---- sky ----
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, '#0a1030');
    g.addColorStop(0.55, calm ? '#243056' : '#1a2150');
    g.addColorStop(0.82, calm ? '#7b5a8a' : '#5a4a78');
    g.addColorStop(1, calm ? '#f0b878' : '#e8a06b');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

    // glow of the setting sun near horizon
    const sun = ctx.createRadialGradient(W*0.5,H*1.02,0, W*0.5,H*1.02,H*0.6);
    sun.addColorStop(0, calm?'rgba(255,210,150,.55)':'rgba(255,180,120,.42)');
    sun.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = sun; ctx.fillRect(0,0,W,H);

    // ---- stars (parallax scroll) ----
    ctx.save();
    const sd = world.dist||0;
    for (const s of this.stars){
      const sx = ((s.x - sd*0.12) % W + W) % W;
      const a = 0.35 + 0.4*Math.sin(this.t*1.4*s.tw + s.ph);
      ctx.globalAlpha = Math.max(0, a) * (1 - s.y/(H*0.9));
      ctx.fillStyle = '#f3ecd8';
      ctx.beginPath(); ctx.arc(sx, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // ---- barriers (oncoming gauntlet) ----
    if (world.barriers) for (const ba of world.barriers) this._barrier(ctx, ba);

    // ---- lone starlings (faint warm hint so they invite gathering) ----
    if (world.lones.length){
      ctx.strokeStyle = 'rgba(245,210,150,.85)'; ctx.lineWidth=1.5; ctx.lineCap='round';
      ctx.beginPath();
      for (const l of world.lones) this._chevron(ctx, l.x, l.y, Math.atan2(l.vy,l.vx), 4.2);
      ctx.stroke();
    }

    // ---- the flock (silhouettes) ----
    ctx.strokeStyle = 'rgba(10,10,20,0.92)'; ctx.lineWidth=1.5; ctx.lineCap='round';
    ctx.beginPath();
    const B = world.birds;
    for (let i=0;i<B.length;i++){
      const b=B[i]; const sp=Math.hypot(b.vx,b.vy)||1;
      this._chevron(ctx, b.x, b.y, Math.atan2(b.vy,b.vx), 3.6 + sp*0.012);
    }
    ctx.stroke();

    // ---- falcons ----
    for (const f of world.falcons) this._falcon(ctx, f, world);

    // ---- feather puffs ----
    for (const p of world.puffs){
      const a = 1 - p.life/p.max;
      ctx.globalAlpha = a*0.9; ctx.fillStyle = '#d8cdb4';
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- burst shockwave ----
    if (world.shock){
      const s=world.shock, k=s.life/s.max;
      ctx.globalAlpha = (1-k)*0.6; ctx.strokeStyle='#f3ecd8'; ctx.lineWidth=3*(1-k)+1;
      ctx.beginPath(); ctx.arc(s.x,s.y, 20+k*180, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }

    // ---- floating score text ----
    for (const fl of world.floats){
      const a = 1 - fl.life/fl.max;
      ctx.globalAlpha = Math.max(0,a);
      ctx.fillStyle = fl.big ? '#ffe08a' : '#f3ecd8';
      ctx.font = `700 ${fl.big?24:18}px "Iowan Old Style", Georgia, serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha=1; ctx.textAlign='start'; ctx.textBaseline='alphabetic';

    // ---- dodge flash ----
    if (world.flashT>0){ ctx.fillStyle=`rgba(243,236,216,${(world.flashT/0.18)*0.22})`; ctx.fillRect(0,0,W,H); }

    // ---- lead ring (where you're guiding them) ----
    if (world.lead.active && world.state==='play' && !world.idle){
      const pulse = 7 + Math.sin(this.t*4)*2.5;
      ctx.strokeStyle='rgba(243,236,216,.35)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(world.lead.x, world.lead.y, pulse, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle='rgba(243,236,216,.15)';
      ctx.beginPath(); ctx.arc(world.lead.x, world.lead.y, pulse+7, 0, 6.2832); ctx.stroke();
    }

    // ---- marsh reeds (foreground) ----
    this._reeds(ctx, world);

    // ---- danger vignette ----
    if (tens>0.02){
      const v = ctx.createRadialGradient(W/2,H/2,H*0.3, W/2,H/2,H*0.75);
      v.addColorStop(0,'rgba(120,20,30,0)');
      v.addColorStop(1,`rgba(140,24,34,${tens*0.34})`);
      ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
    }
    // ---- calm warm wash ----
    if (calm){
      ctx.fillStyle = `rgba(255,200,130,${0.05+0.04*Math.sin(this.t*2)})`;
      ctx.fillRect(0,0,W,H);
    }
  }

  _chevron(ctx, x, y, th, s){
    const bl = th + 2.5, br = th - 2.5;     // wings sweep back ~143°
    const fx = x+Math.cos(th)*s*0.5, fy = y+Math.sin(th)*s*0.5;
    ctx.moveTo(x+Math.cos(bl)*s, y+Math.sin(bl)*s);
    ctx.lineTo(fx, fy);
    ctx.lineTo(x+Math.cos(br)*s, y+Math.sin(br)*s);
  }

  _falcon(ctx, f, world){
    const th = Math.atan2(f.vy, f.vx) || 0;
    const stoop = f.state==='stoop';
    const s = stoop ? 12 : 15;
    // lock telegraph: a thin line to the target while hunting
    if (f.state==='hunt' && f.lock>0.15 && f.target>=0 && world.birds[f.target]){
      const b=world.birds[f.target];
      ctx.strokeStyle=`rgba(230,80,70,${0.12+f.lock*0.4})`; ctx.lineWidth=1;
      ctx.setLineDash([4,6]); ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // stoop trail
    if (stoop){
      ctx.strokeStyle='rgba(20,16,28,.35)'; ctx.lineWidth=s*0.7; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(f.x-f.vx*0.06, f.y-f.vy*0.06); ctx.lineTo(f.x,f.y); ctx.stroke();
    }
    // body: swept-wing raptor silhouette
    ctx.save(); ctx.translate(f.x,f.y); ctx.rotate(th);
    ctx.fillStyle = stoop ? '#0c0a14' : '#14101e';
    ctx.beginPath();
    const wing = stoop ? 0.7 : 1.1;
    ctx.moveTo(s*0.9, 0);                         // beak/front
    ctx.quadraticCurveTo(-s*0.2, -s*0.5*wing, -s*0.9, -s*wing);  // back-left wing
    ctx.quadraticCurveTo(-s*0.3, -s*0.1, -s*0.5, 0);
    ctx.quadraticCurveTo(-s*0.3, s*0.1, -s*0.9, s*wing);         // back-right wing
    ctx.quadraticCurveTo(-s*0.2, s*0.5*wing, s*0.9, 0);
    ctx.fill();
    ctx.restore();
  }

  _reeds(ctx, world){
    const {W,H}=this; const sd=world.dist||0;
    ctx.fillStyle = '#0b0a16';
    ctx.fillRect(0, H-10, W, 10);
    ctx.strokeStyle = '#0b0a16'; ctx.lineCap='round';
    for (const r of this.reeds){
      const rx = ((r.x - sd*0.6) % W + W) % W;   // foreground parallax
      ctx.lineWidth=r.w;
      ctx.beginPath(); ctx.moveTo(rx, H);
      ctx.quadraticCurveTo(rx+r.lean*r.h*0.5, H-r.h*0.6, rx+r.lean*r.h, H-r.h);
      ctx.stroke();
    }
  }

  // an oncoming barrier with a gap to thread
  _barrier(ctx, ba){
    const {H}=this; const x=ba.x, w=ba.w, gy0=ba.gapY-ba.gapH/2, gy1=ba.gapY+ba.gapH/2;
    if (ba.kind==='trees'){
      ctx.fillStyle='#0c0b18';
      // top cluster
      this._treeColumn(ctx, x, w, 0, gy0, ba.seed);
      this._treeColumn(ctx, x, w, gy1, H, ba.seed+50);
    } else {
      // pylon: dark lattice towers from top and bottom
      ctx.fillStyle='#0e0c1c';
      ctx.fillRect(x, 0, w, gy0);
      ctx.fillRect(x, gy1, w, H-gy1);
      ctx.strokeStyle='rgba(255,255,255,.05)'; ctx.lineWidth=1;
      for (let yy=8; yy<gy0; yy+=16){ ctx.beginPath(); ctx.moveTo(x,yy); ctx.lineTo(x+w,yy+10); ctx.moveTo(x+w,yy); ctx.lineTo(x,yy+10); ctx.stroke(); }
      for (let yy=gy1+8; yy<H; yy+=16){ ctx.beginPath(); ctx.moveTo(x,yy); ctx.lineTo(x+w,yy+10); ctx.moveTo(x+w,yy); ctx.lineTo(x,yy+10); ctx.stroke(); }
    }
    // glowing gap edges so the opening reads clearly
    ctx.strokeStyle='rgba(255,210,150,.5)'; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(x-2, gy0); ctx.lineTo(x+w+2, gy0); ctx.moveTo(x-2, gy1); ctx.lineTo(x+w+2, gy1); ctx.stroke();
  }
  _treeColumn(ctx, x, w, y0, y1, seed){
    let s=seed;
    const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280; };
    for (let yy=y0; yy<y1; yy+=18){
      const r = 14 + rnd()*10;
      ctx.beginPath(); ctx.arc(x+w/2 + (rnd()-0.5)*w, yy, r, 0, 6.2832); ctx.fill();
    }
  }
}
