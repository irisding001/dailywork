#!/usr/bin/env node
// node attendance_fetch.js  →  generates attendance_dashboard.html

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const COOKIES = 'cipher_device_id=1768982866919775; FUTUOA_LANG.sig=g0bWFGgavbFZrQE-t1DdnVOK5HU; FUTUOA_LANG=zh-cn; locale=zh-cn; locale.sig=D49jx1eEY6IVlNVetXqJUZYdM14; trip:sess=cbd29984-3c69-41a5-98a3-5e2256e91ff3';

const START_MONTH = '2026-01'; // fetch from this month to current

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: {
        accept: 'application/json', cookie: COOKIES,
        referer: 'https://duty.futuoa.com/admin/attendDaily',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d.slice(0,200))); }});
    }).on('error', reject).end();
  });
}

async function fetchAllDaily(startDate, endDate) {
  const base = `https://duty.futuoa.com/api/attendance/statistics/detail?startDate=${startDate}&endDate=${endDate}&month=&sortBy=%5B%5B%5D%5D&staffTypes=%5B%5D&region=MY`;
  const first = await get(base + '&pageIndex=1&pageSize=20');
  if (first.code !== 0) throw new Error('API error: ' + first.message);
  const total = first.data.count;
  let records = [...first.data.data];
  const pages = Math.ceil(total / 20);
  for (let p = 2; p <= pages; p++) {
    const r = await get(base + `&pageIndex=${p}&pageSize=20`);
    records = records.concat(r.data.data);
  }
  return records;
}

async function fetchMonthlyStats(month) {
  const url = `https://duty.futuoa.com/api/attendance/statistics/get?startDate=&endDate=&month=${month}&sortBy=%5B%5B%5D%5D&staffTypes=%5B%5D&region=MY&pageIndex=1&pageSize=100`;
  const r = await get(url);
  return r.code === 0 ? r.data.data : [];
}

async function fetchVacationApprove(nicks, startDate, endDate) {
  const vacMap = {};
  await Promise.all(nicks.map(async nick => {
    const url = `https://duty.futuoa.com/api/attendance/statistics/vacationApprove?startDate=${startDate}&endDate=${endDate}&nick=${nick}`;
    const r = await get(url);
    if (r.code !== 0 || !r.data.length) return;
    vacMap[nick] = {};
    r.data.forEach(item => {
      const start = item.startTime.slice(0, 10);
      const end = item.endTime.slice(0, 10);
      const cur = new Date(start + 'T00:00:00');
      const fin = new Date(end + 'T00:00:00');
      while (cur <= fin) {
        const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        vacMap[nick][ds] = item.type;
        cur.setDate(cur.getDate() + 1);
      }
    });
  }));
  return vacMap;
}

async function fetchMonthData(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${monthStr}-01`;
  const end = `${monthStr}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
  process.stdout.write(`Fetching ${monthStr}...`);
  const [daily, monthly] = await Promise.all([
    fetchAllDaily(start, end),
    fetchMonthlyStats(monthStr),
  ]);
  const nicks = [...new Set(daily.map(r => r.nick))];
  const vacationMap = await fetchVacationApprove(nicks, start, end);
  const withLeave = Object.keys(vacationMap).length;
  console.log(` ${daily.length} records, ${withLeave} with leave`);
  return { monthStr, daily, monthly, vacationMap };
}

const LEAVE_COLORS = {
  '年假': '#1565c0', '病假': '#c0392b',
  '加班转调休': '#6a1b9a', '调休': '#6a1b9a',
  '事假': '#e65100', '缺勤': '#9e9e9e',
};

const TEAMS = [
  { key: 'MY', label: 'MY 转化客服组', keyword: '马来西亚' },
  { key: 'US', label: 'US 转化客服组', keyword: '美国' },
];

function renderMonthPane(data) {
  const { monthStr, daily: dailyRecords, monthly: monthlyStats, vacationMap } = data;
  const todayStr = new Date().toLocaleString('sv-SE').slice(0, 10);
  const year = parseInt(monthStr.slice(0, 4));
  const month = parseInt(monthStr.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  const DOW = ['日', '一', '二', '三', '四', '五', '六'];

  const firstDow = new Date(year, month - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  function renderCell(d, teamRecords, dayAbsences) {
    if (!d) return `<td class="cell empty"></td>`;
    const ds = `${monthStr}-${String(d).padStart(2,'0')}`;
    const isToday = ds === todayStr;
    const isFuture = ds > todayStr;
    const dayRecs = teamRecords.filter(r => r.date === ds);
    const isRest = dayRecs.length > 0 && dayRecs.every(r => r.shiftName === '公休');
    const abs = dayAbsences[ds] || [];
    const tc = isToday ? ' today' : '';

    if (isRest) return `<td class="cell rest${tc}"><div class="dn">${d}日</div><div class="dlabel">公休</div></td>`;

    if (abs.length > 0) {
      const tags = abs.map(a => {
        const c = LEAVE_COLORS[a.leaveType] || '#555';
        return `<div class="atag"><span class="aname">${a.name}</span><span class="atype" style="color:${c}">${a.leaveType}</span></div>`;
      }).join('');
      return `<td class="cell absent${tc}"><div class="dn">${d}日</div>${tags}</td>`;
    }

    if (isFuture) return `<td class="cell future${tc}"><div class="dn">${d}日</div></td>`;
    return `<td class="cell ok${tc}"><div class="dn">${d}日</div><div class="quanqin">全勤</div></td>`;
  }

  function renderTeam(team) {
    const recs = dailyRecords.filter(r => r.department.includes(team.keyword));
    const nicks = new Set(recs.map(r => r.nick));
    const ms = monthlyStats.filter(e => nicks.has(e.nick));

    const nickName = {};
    recs.forEach(r => { nickName[r.nick] = r.name; });

    const dayAbs = {};
    [...nicks].forEach(nick => {
      if (!vacationMap[nick]) return;
      Object.entries(vacationMap[nick]).forEach(([ds, leaveType]) => {
        if (!dayAbs[ds]) dayAbs[ds] = [];
        dayAbs[ds].push({ nick, name: nickName[nick] || nick, leaveType });
      });
    });

    const stats = {
      late: ms.reduce((s,e)=>s+(e.lateCount||0),0),
      early: ms.reduce((s,e)=>s+(e.earlyCount||0),0),
      absent: Object.values(dayAbs).reduce((s,a)=>s+a.length,0),
      vacation: ms.reduce((s,e)=>s+(e.vacationDays||0),0),
      count: nicks.size,
    };

    const empNames = Object.values(nickName).sort((a,b)=>a.localeCompare(b,'zh'));
    const calRows = weeks.map(w => `<tr>${w.map(d=>renderCell(d,recs,dayAbs)).join('')}</tr>`).join('');

    return `<div class="team-section" id="tab-${team.key}-${monthStr}">
      <div class="sbar">
        <div class="si"><div class="sl">迟到</div><div class="sv orange">${stats.late}</div></div>
        <div class="si"><div class="sl">早退</div><div class="sv orange">${stats.early}</div></div>
        <div class="si"><div class="sl">缺勤</div><div class="sv red">${stats.absent}</div></div>
        <div class="si"><div class="sl">休假（人次）</div><div class="sv blue">${stats.vacation}</div></div>
        <div class="si"><div class="sl">员工人数</div><div class="sv">${stats.count}</div></div>
      </div>
      <div class="emplist">${empNames.map(n=>`<span class="echip">${n}</span>`).join('')}</div>
      <div class="calwrap">
        <table class="cal">
          <thead><tr>${DOW.map((d,i)=>`<th class="${i===0?'sun':i===6?'sat':''}">${d}</th>`).join('')}</tr></thead>
          <tbody>${calRows}</tbody>
        </table>
      </div>
    </div>`;
  }

  const teamsHTML = TEAMS.map(t => renderTeam(t)).join('');
  const teamTabsHTML = TEAMS.map((t,i) =>
    `<button class="tbtn${i===0?' active':''}" onclick="swTeam('${monthStr}','${t.key}')" id="btn-${t.key}-${monthStr}">${t.label}</button>`
  ).join('');

  return `<div class="month-pane" id="mpane-${monthStr}">
    <div class="tabs">${teamTabsHTML}</div>
    ${teamsHTML}
  </div>`;
}

function generateHTML(allMonthsData) {
  const months = allMonthsData.map(d => d.monthStr);
  const latest = months[months.length - 1];

  const monthMenuItems = months.slice().reverse().map(m =>
    `<div class="mitem" onclick="swMonth('${m}')" id="mitem-${m}">${m}</div>`
  ).join('');

  const panesHTML = allMonthsData.map(d => renderMonthPane(d)).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>出勤 Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f0f2f5;color:#333;padding:24px;min-width:760px}
h1{font-size:20px;font-weight:600;color:#1a1a2e;margin-bottom:4px}
.sub{font-size:12px;color:#aaa;margin-bottom:16px}

.header-row{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.mdropdown{position:relative;display:inline-block;margin-bottom:20px}
.mdropbtn{display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:13px;font-weight:600;color:#1565c0;background:#f0f6ff;border:1.5px solid #1565c0;border-radius:20px;cursor:pointer;user-select:none}
.mdropbtn .arrow{font-size:10px;transition:transform .15s}
.mdropdown.open .arrow{transform:rotate(180deg)}
.mdropmenu{display:none;position:absolute;top:calc(100% + 6px);left:0;background:#fff;border:1px solid #e0e0e0;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:100;min-width:110px;overflow:hidden}
.mdropdown.open .mdropmenu{display:block}
.mitem{padding:8px 16px;font-size:13px;color:#555;cursor:pointer;transition:background .1s}
.mitem:hover{background:#f5f5f5}
.mitem.active{color:#1565c0;font-weight:600;background:#f0f6ff}

.tabs{display:flex;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;width:fit-content;margin-bottom:20px}
.tbtn{padding:12px 32px;font-size:14px;font-weight:500;color:#888;cursor:pointer;border:none;background:none;border-bottom:3px solid transparent;transition:all .15s}
.tbtn.active{color:#1565c0;border-bottom-color:#1565c0;background:#f0f6ff}
.tbtn:hover:not(.active){background:#f5f5f5}

.month-pane{display:none}
.month-pane.active{display:block}
.team-section{display:none}
.team-section.active{display:block}

.sbar{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:14px 0;display:flex;margin-bottom:14px}
.si{flex:1;text-align:center;border-right:1px solid #f0f0f0}
.si:last-child{border-right:none}
.sl{font-size:12px;color:#999;margin-bottom:4px}
.sv{font-size:24px;font-weight:600;color:#1a1a2e}
.sv.red{color:#e53935}.sv.blue{color:#1565c0}.sv.orange{color:#e65100}

.emplist{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.echip{padding:4px 12px;background:#fff;border:1px solid #e0e0e0;border-radius:20px;font-size:12px;color:#555}

.calwrap{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;margin-bottom:4px}
table.cal{width:100%;border-collapse:collapse;table-layout:fixed}
table.cal thead th{padding:10px 0;font-size:13px;font-weight:500;color:#888;text-align:center;border-bottom:2px solid #f0f0f0}
thead th.sun{color:#e53935}
thead th.sat{color:#e67e22}

td.cell{vertical-align:top;padding:8px 10px;border:1px solid #f0f0f0;height:88px}
td.cell.empty,td.cell.rest,td.cell.future{background:#fafafa}
td.cell.ok{background:#fff}
td.cell.absent{background:#fff8f8}
td.cell.today{box-shadow:inset 0 0 0 2px #1976d2}

.dn{font-size:13px;font-weight:500;color:#444;margin-bottom:5px}
.dlabel{font-size:12px;color:#ccc}
.quanqin{font-size:12px;color:#43a047;font-weight:500}

.atag{display:flex;justify-content:space-between;align-items:center;margin-top:3px;padding:2px 6px;background:#fff0f0;border-radius:4px;gap:4px}
.aname{font-size:11px;color:#333;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atype{font-size:10px;white-space:nowrap;flex-shrink:0;font-weight:600}

.legend{display:flex;gap:16px;margin-top:16px;flex-wrap:wrap}
.li{display:flex;align-items:center;gap:5px;font-size:12px;color:#777}
.ld{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.note{font-size:11px;color:#ccc;margin-top:8px;text-align:right}
</style>
</head>
<body>
<div class="header-row">
  <h1>团队出勤 Dashboard</h1>
  <div class="mdropdown" id="mdropdown">
    <div class="mdropbtn" onclick="toggleDrop()">
      <span id="mdrop-label">${latest}</span><span class="arrow">▾</span>
    </div>
    <div class="mdropmenu">${monthMenuItems}</div>
  </div>
</div>
<p class="sub">数据来源：duty.futuoa.com &nbsp;·&nbsp; 生成：${new Date().toLocaleString('zh-CN')}</p>

${panesHTML}

<div class="legend">
  <div class="li"><div class="ld" style="background:#43a047"></div>全勤</div>
  <div class="li"><div class="ld" style="background:#1565c0"></div>年假</div>
  <div class="li"><div class="ld" style="background:#6a1b9a"></div>调休 / 加班转调休</div>
  <div class="li"><div class="ld" style="background:#c0392b"></div>病假</div>
  <div class="li"><div class="ld" style="background:#e65100"></div>事假</div>
  <div class="li"><div class="ld" style="background:#9e9e9e"></div>缺勤（无请假记录）</div>
  <div class="li"><div class="ld" style="background:#f0f0f0;border:1px solid #ddd"></div>公休</div>
</div>
<p class="note">* 假种由休假审批记录推算，仅供参考</p>

<script>
function toggleDrop(){document.getElementById('mdropdown').classList.toggle('open')}
document.addEventListener('click',e=>{if(!e.target.closest('#mdropdown'))document.getElementById('mdropdown').classList.remove('open')});
function swMonth(m) {
  document.querySelectorAll('.month-pane').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.mitem').forEach(e=>e.classList.remove('active'));
  document.getElementById('mpane-'+m).classList.add('active');
  document.getElementById('mitem-'+m).classList.add('active');
  document.getElementById('mdrop-label').textContent=m;
  document.getElementById('mdropdown').classList.remove('open');
}
function swTeam(m, k) {
  document.querySelectorAll('#mpane-'+m+' .team-section').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('#mpane-'+m+' .tbtn').forEach(e=>e.classList.remove('active'));
  document.getElementById('tab-'+k+'-'+m).classList.add('active');
  document.getElementById('btn-'+k+'-'+m).classList.add('active');
}
swMonth('${latest}');
${months.map(m => `swTeam('${m}','${TEAMS[0].key}');`).join('\n')}
</script>
</body>
</html>`;
}

async function main() {
  const now = new Date();
  const [sy, sm] = START_MONTH.split('-').map(Number);
  const monthsList = [];
  let cy = sy, cm = sm;
  while (cy < now.getFullYear() || (cy === now.getFullYear() && cm <= now.getMonth() + 1)) {
    monthsList.push(`${cy}-${String(cm).padStart(2,'0')}`);
    cm++; if (cm > 12) { cm = 1; cy++; }
  }

  console.log(`\nFetching ${monthsList.length} months: ${monthsList.join(', ')}`);
  const allData = await Promise.all(monthsList.map(m => fetchMonthData(m)));

  const html = generateHTML(allData);
  const out = path.join(process.env.USERPROFILE||'.', 'attendance_dashboard.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`\nSaved: ${out}`);
  exec(`start "" "${out}"`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
