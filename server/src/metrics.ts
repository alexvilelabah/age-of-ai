// Métricas do sistema lidas SOB DEMANDA (nenhum processo/timer em background):
// só rodam quando a rota /metrics é chamada pela página /monitor. Fechou a aba,
// param os pedidos e o custo vai a zero. No celular (Linux/Termux) lê temperatura
// e disco reais; no Windows (dev) alguns campos vêm null e o painel mostra "N/A".

import os from 'node:os';
import fs from 'node:fs';

export interface Metrics {
  timeMs: number;
  cpuPct: number | null; // uso de CPU (%) desde a leitura anterior
  cores: number;
  memUsedMB: number;
  memTotalMB: number;
  memPct: number;
  tempC: number | null; // maior temperatura entre os sensores (°C)
  diskUsedGB: number | null;
  diskTotalGB: number | null;
  diskPct: number | null;
  gpuPct: number | null;
  sysUptimeS: number;
  procUptimeS: number;
}

// --- CPU: no Android o /proc/stat e o os.cpus() ficam BLOQUEADOS (sem root),
// então medimos o uso do PRÓPRIO processo do servidor via process.cpuUsage()
// (usa getrusage, não depende de /proc) — que é o que importa: "o quanto o jogo
// pesa". É a % de um núcleo (Node é ~1 thread, então ~0-100%). ---
let prevProc = process.cpuUsage();
let prevProcT = Date.now();

function cpuPercent(): number | null {
  const now = Date.now();
  const u = process.cpuUsage(); // micros acumulados (user+system)
  const dMicros = u.user + u.system - (prevProc.user + prevProc.system);
  const dMs = now - prevProcT;
  prevProc = u;
  prevProcT = now;
  if (dMs <= 0) return null;
  const pct = (dMicros / 1000 / dMs) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}

function coreCount(): number {
  const n = os.cpus().length;
  if (n > 0) return n;
  try { return (fs.readFileSync('/proc/cpuinfo', 'utf8').match(/^processor\s*:/gm) || []).length; } catch { return 0; }
}

// --- Temperatura: maior valor legível dos sensores (best-effort) ---
function readTempC(): number | null {
  let max: number | null = null;
  const consider = (raw: string): void => {
    const n = parseInt(raw.trim(), 10);
    if (!Number.isFinite(n)) return;
    let c = n;
    if (c > 1000) c = c / 1000; // milicelsius -> celsius
    else if (c > 200) c = c / 10; // décimos de grau -> celsius
    if (c > 10 && c < 130 && (max === null || c > max)) max = c;
  };
  try {
    const base = '/sys/class/thermal';
    for (const d of fs.readdirSync(base)) {
      if (!d.startsWith('thermal_zone')) continue;
      try { consider(fs.readFileSync(`${base}/${d}/temp`, 'utf8')); } catch { /* sensor ilegível */ }
    }
  } catch { /* sem /sys (Windows) */ }
  try { consider(fs.readFileSync('/sys/class/power_supply/battery/temp', 'utf8')); } catch { /* ignora */ }
  return max === null ? null : Math.round(max * 10) / 10;
}

// --- Disco: statfs da pasta do app (best-effort; N/A se indisponível) ---
type StatFsLike = { bsize: number; blocks: number; bfree: number };
function readDisk(): { usedGB: number; totalGB: number; pct: number } | null {
  try {
    const statfsSync = (fs as unknown as { statfsSync?: (p: string) => StatFsLike }).statfsSync;
    if (!statfsSync) return null;
    const st = statfsSync(process.cwd());
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const used = total - free;
    const GB = 1024 ** 3;
    if (total <= 0) return null;
    return {
      usedGB: Math.round((used / GB) * 10) / 10,
      totalGB: Math.round((total / GB) * 10) / 10,
      pct: Math.round((used / total) * 100),
    };
  } catch { return null; }
}

// --- GPU: best-effort em caminhos sysfs conhecidos (normalmente N/A no Exynos) ---
function readGpuPct(): number | null {
  try {
    const raw = fs.readFileSync('/sys/class/kgsl/kgsl-3d0/gpubusy', 'utf8').trim().split(/\s+/); // Adreno
    const busy = parseInt(raw[0], 10);
    const total = parseInt(raw[1], 10);
    if (total > 0) return Math.max(0, Math.min(100, Math.round((busy / total) * 100)));
  } catch { /* ignora */ }
  for (const p of ['/sys/class/misc/mali0/device/utilization', '/sys/kernel/gpu/gpu_busy']) {
    try {
      const n = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    } catch { /* ignora */ }
  }
  return null;
}

export function readMetrics(): Metrics {
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  const MB = 1024 * 1024;
  const disk = readDisk();
  return {
    timeMs: Date.now(),
    cpuPct: cpuPercent(),
    cores: coreCount(),
    memUsedMB: Math.round(memUsed / MB),
    memTotalMB: Math.round(memTotal / MB),
    memPct: Math.round((memUsed / memTotal) * 100),
    tempC: readTempC(),
    diskUsedGB: disk?.usedGB ?? null,
    diskTotalGB: disk?.totalGB ?? null,
    diskPct: disk?.pct ?? null,
    gpuPct: readGpuPct(),
    sysUptimeS: Math.round(os.uptime()),
    procUptimeS: Math.round(process.uptime()),
  };
}

// Página do painel — HTML autocontido. Lê a senha (?k=) da própria URL e faz
// polling do /metrics a cada 2,5s; PARA ao esconder/fechar a aba (custo zero).
export const MONITOR_HTML = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Age of AI - Sistema</title>
<style>
:root{--gold:#d9a941;--gold2:#f0c869;--panel:rgba(30,24,16,.92);--border:#6e5637;--text:#ece0c8;--muted:#a8987a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% 18%,#241c12,#100d0a 75%);color:var(--text);font-family:Georgia,'Times New Roman',serif;min-height:100vh;padding:22px}
h1{color:var(--gold2);font-variant:small-caps;letter-spacing:2px;text-align:center;margin:0 0 2px;font-size:28px}
.sub{color:var(--muted);text-align:center;margin:0 0 20px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:900px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px;box-shadow:0 4px 16px rgba(0,0,0,.5)}
.card.off{opacity:.5}
.label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:1px}
.val{font-size:30px;color:var(--gold2);margin:2px 0;line-height:1.1}
.val small{font-size:13px;color:var(--muted)}
canvas{width:100%;height:44px;display:block;margin-top:6px}
.bar{height:7px;background:#17100a;border-radius:4px;overflow:hidden;margin-top:8px;border:1px solid #100a05}
.bar>i{display:block;height:100%;background:var(--gold);width:0;transition:width .3s}
.foot{color:var(--muted);text-align:center;margin-top:18px;font-size:12px}
</style></head><body>
<h1>Age of AI &middot; Monitor</h1>
<p class="sub" id="sub">conectando...</p>
<div class="grid" id="grid"></div>
<p class="foot" id="foot"></p>
<script>
var K=new URLSearchParams(location.search).get('k')||'';
var cards=[
 {id:'tempC',label:'Temperatura',unit:'C',max:70,graph:1},
 {id:'cpuPct',label:'CPU (servidor)',unit:'%',max:100,graph:1},
 {id:'memPct',label:'Memoria (RAM)',unit:'%',max:100,graph:1,sub:function(m){return m.memUsedMB!=null?m.memUsedMB+' / '+m.memTotalMB+' MB':''}},
 {id:'diskPct',label:'Disco',unit:'%',max:100,graph:1,sub:function(m){return m.diskUsedGB!=null?m.diskUsedGB+' / '+m.diskTotalGB+' GB':''}},
 {id:'gpuPct',label:'GPU',unit:'%',max:100,graph:1},
 {id:'players',label:'Jogadores online',unit:'',max:0}
];
var hist={},el={},grid=document.getElementById('grid');
cards.forEach(function(c){
 hist[c.id]=[];
 var d=document.createElement('div');d.className='card';
 d.innerHTML='<div class="label">'+c.label+'</div><div class="val">-</div>'+(c.max?'<div class="bar"><i></i></div>':'')+(c.graph?'<canvas></canvas>':'');
 grid.appendChild(d);
 el[c.id]={card:d,val:d.querySelector('.val'),bar:d.querySelector('.bar>i'),cv:d.querySelector('canvas')};
});
function draw(cv,data,max){
 if(!cv)return;var dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
 cv.width=w*dpr;cv.height=h*dpr;var x=cv.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
 var pts=data.filter(function(v){return v!=null});if(pts.length<2)return;
 var mx=max||Math.max.apply(null,pts.concat([1]));
 x.strokeStyle='#f0c869';x.lineWidth=1.5;x.beginPath();
 data.forEach(function(v,i){if(v==null)return;var px=i/(data.length-1)*w,py=h-(v/mx)*h;i?x.lineTo(px,py):x.moveTo(px,py)});
 x.stroke();x.lineTo(w,h);x.lineTo(0,h);x.closePath();x.fillStyle='rgba(240,200,105,.10)';x.fill();
}
function up(s){if(s==null)return'-';var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return(d?d+'d ':'')+(h?h+'h ':'')+m+'m'}
var timer=null;
function tick(){
 fetch('/sistema?k='+encodeURIComponent(K)+'&data=1',{cache:'no-store'}).then(function(r){
  if(!r.ok){document.getElementById('sub').textContent='sem acesso (senha?) - HTTP '+r.status;return null}
  return r.json();
 }).then(function(m){
  if(!m)return;
  document.getElementById('sub').textContent='atualizando ao vivo'+(m.cores?' · '+m.cores+' nucleos':'');
  document.getElementById('foot').textContent='Uptime do sistema: '+up(m.sysUptimeS)+'  |  servidor: '+up(m.procUptimeS);
  cards.forEach(function(c){
   var v=m[c.id],e=el[c.id];
   e.val.innerHTML=(v==null?'N/A':(Math.round(v*10)/10)+(c.unit?'<small> '+c.unit+'</small>':''))+(c.sub?' <small>'+c.sub(m)+'</small>':'');
   if(e.bar)e.bar.style.width=(v==null?0:Math.min(100,v/c.max*100))+'%';
   hist[c.id].push(v==null?null:v);if(hist[c.id].length>60)hist[c.id].shift();
   if(e.cv)draw(e.cv,hist[c.id],c.max);
   e.card.className='card'+(v==null?' off':'');
  });
 }).catch(function(){document.getElementById('sub').textContent='erro de conexao'});
}
function start(){if(!timer){tick();timer=setInterval(tick,2500)}}
function stop(){if(timer){clearInterval(timer);timer=null}}
document.addEventListener('visibilitychange',function(){document.hidden?stop():start()});
window.addEventListener('beforeunload',stop);
start();
</script></body></html>`;
