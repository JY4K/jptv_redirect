import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const token = req.query.token || '';
  const isAuth = token === config.adminToken;
  const currentVersion = config.currentVersion;

  if (req.method === 'POST') {
    if (!isAuth) return res.status(401).json({ error: '无权操作' });

    const { newData } = req.body;
    const { projectId, token: vToken } = config.platform;

    if (!projectId || !vToken) return res.status(500).json({ error: '未配置 Vercel API' });

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      const projectData = await projectRes.json();
      const { repoId, type: repoType } = projectData.link;
      const gitBranch = projectData.targets?.production?.gitBranch || 'main';

      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
      const listData = await listRes.json();
      const existingVars = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA') : [];

      await Promise.all(existingVars.map(env => fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, { method: 'DELETE', headers: commonHeaders })));

      await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          key: 'CHANNELS_DATA',
          value: JSON.stringify(newData),
          type: 'encrypted',
          target: ['production', 'preview', 'development']
        })
      });

      await fetch(`https://api.vercel.com/v13/deployments`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          name: 'jptv-update',
          project: projectId,
          target: 'production',
          gitSource: { type: repoType, repoId: repoId, ref: gitBranch }
        })
      });

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  let channels = [];
  try { channels = getChannels(); } catch (e) {}

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JPTV 管理系统</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body { transition: background 0.5s ease; }
        body.theme-light { background: #f3f4f6; color: #1f2937; }
        .theme-light .glass-panel { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); border: 1px solid #e5e7eb; }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); }
        .card { cursor: pointer; transition: all 0.2s; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; background: rgba(255,255,255,0.05); border: 1px solid rgba(0,0,0,0.1); }
        .theme-dark .card { border-color: rgba(255,255,255,0.1); }
        .card.dragging { opacity: 0.4; border: 2px dashed #3b82f6; }
        .channel-logo { height: 60px; width: auto; object-fit: contain; margin-bottom: 8px; pointer-events: none; }
    </style>
</head>
<body class="theme-light min-h-screen p-4">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col md:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg"><i class="fas fa-satellite-dish text-xl"></i></div>
                <div>
                    <h1 class="text-2xl font-bold">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70">
                        <span>v${currentVersion}</span>
                        ${isAuth ? '<span class="text-green-500">[管理员]</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center"><i class="fas fa-sun" id="themeIcon"></i></button>
                ${isAuth ? '<button onclick="saveData()" id="saveBtn" class="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition">保存并部署</button>' : ''}
            </div>
        </header>

        <div id="app" class="space-y-8"></div>
        
        ${isAuth ? '<div class="py-10 text-center"><button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-gray-400 hover:border-blue-500 transition font-bold">+ 添加新分组</button></div>' : ''}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";
        let currentTheme = localStorage.getItem('jptv_theme') || 'light';

        function toggleTheme() {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            localStorage.setItem('jptv_theme', currentTheme);
            document.body.className = 'theme-' + currentTheme + ' min-h-screen p-4';
            document.getElementById('themeIcon').className = currentTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        }
        toggleTheme(); toggleTheme(); // 初始化主题

        function render() {
            const app = document.getElementById('app');
            if (!raw || raw.length === 0) { app.innerHTML = '<div class="text-center py-20 opacity-50">暂无数据</div>'; return; }

            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-2xl p-6">
                    <div class="flex items-center justify-between mb-6 border-b border-black/10 dark:border-white/10 pb-4">
                        <div class="flex-1 flex items-center gap-3">
                            \${isAuth ? \`
                                <div class="flex flex-col text-xs text-gray-400">
                                    <button onclick="moveGroup(\${gi}, -1)" class="hover:text-blue-500 \${gi===0?'invisible':''}"><i class="fas fa-chevron-up"></i></button>
                                    <button onclick="moveGroup(\${gi}, 1)" class="hover:text-blue-500 \${gi===raw.length-1?'invisible':''}"><i class="fas fa-chevron-down"></i></button>
                                </div>
                                <input class="text-xl font-bold bg-transparent outline-none focus:border-b-2 border-blue-500" value="\${g.group}" onchange="raw[\${gi}].group=this.value">
                            \` : \`<h2 class="text-xl font-bold"><i class="fas fa-layer-group text-blue-500 mr-2"></i>\${g.group}</h2>\`}
                        </div>
                        <div class="flex gap-2">
                            \${isAuth ? \`
                                <button onclick="importBatch(\${gi})" class="text-blue-500 text-sm font-bold px-3 py-1 hover:bg-blue-500/10 rounded">批量导入</button>
                                <button onclick="deleteGroup(\${gi})" class="text-red-400 p-2 hover:bg-red-500/10 rounded"><i class="fas fa-trash-alt"></i></button>
                            \` : ''}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl" \${isAuth ? \`draggable="true" ondragstart="dragStart(event,\${gi},\${ci})" ondragover="event.preventDefault()" ondrop="dragDrop(event,\${gi},\${ci})"\` : ''} onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo" onerror="this.src='https://placehold.co/100x60?text=TV'">
                                <div class="text-center w-full px-2"><h3 class="font-bold text-sm truncate">\${ch.name}</h3></div>
                            </div>
                        \`).join('')}
                        \${isAuth ? \`<div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed border-2 text-blue-500 font-bold hover:bg-blue-500/5">+ 频道</div>\` : ''}
                    </div>
                </div>
            \`).join('');
        }

        function getLogoUrl(logo) {
            if(!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        function moveGroup(index, dir) {
            const target = index + dir;
            if (target < 0 || target >= raw.length) return;
            [raw[index], raw[target]] = [raw[target], raw[index]];
            render();
        }

        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const { value } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                html: \`
                    <input id="swal-name" class="swal2-input" placeholder="名称" value="\${ch.name}">
                    <input id="swal-id" class="swal2-input" placeholder="ID (EPG)" value="\${ch.id}">
                    <input id="swal-logo" class="swal2-input" placeholder="Logo URL或文件名" value="\${ch.logo}">
                    <textarea id="swal-url" class="swal2-textarea" placeholder="直播源(每行一个)">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                \`,
                showDenyButton: !isNew, denyButtonText: '删除频道',
                preConfirm: () => {
                    const name = document.getElementById('swal-name').value.trim();
                    const url = document.getElementById('swal-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || url.length === 0) { Swal.showValidationMessage('名称和链接必填'); return false; }
                    return { name, id: document.getElementById('swal-id').value.trim(), logo: document.getElementById('swal-logo').value.trim(), url };
                }
            });
            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (Swal.getContent() && isNew) { raw[gi].channels.splice(ci, 1); render(); }
            else if (Swal.getDenyButton() && !isNew) { raw[gi].channels.splice(ci, 1); render(); }
        }

        async function importBatch(gi) {
            const { value: text } = await Swal.fire({
                title: '批量导入',
                input: 'textarea',
                inputPlaceholder: '粘贴 TXT (名称,链接) 或 M3U 内容...',
                footer: '<div class="text-sm">本地文件：<input type="file" id="f-imp" accept=".txt,.m3u"></div>',
                didOpen: () => {
                    document.getElementById('f-imp').onchange = (e) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => Swal.getInput().value = ev.target.result;
                        reader.readAsText(e.target.files[0]);
                    };
                }
            });

            if (text) {
                const lines = text.split('\\n');
                let count = 0;
                if (text.includes('#EXTM3U')) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes('#EXTINF')) {
                            const name = lines[i].split(',').pop().trim();
                            const url = lines[i+1]?.trim();
                            if(url && url.startsWith('http')) {
                                raw[gi].channels.push({ name, id: '', logo: '', url: [url] });
                                count++; i++;
                            }
                        }
                    }
                } else {
                    lines.forEach(l => {
                        const p = l.split(/[,，#]/);
                        if(p.length >= 2 && p[p.length-1].includes('://')) {
                            raw[gi].channels.push({ name: p[0].trim(), id: '', logo: '', url: [p[p.length-1].trim()] });
                            count++;
                        }
                    });
                }
                Swal.fire('成功', '已导入 ' + count + ' 个频道', 'success');
                render();
            }
        }

        async function saveData() {
            // 过滤无效数据：无名/无链接的频道，以及空的分组
            const cleanData = raw.map(g => ({
                ...g,
                channels: g.channels.filter(ch => ch.name && (Array.isArray(ch.url)?ch.url.length > 0 : ch.url))
            })).filter(g => g.group && g.channels.length > 0);

            if (cleanData.length === 0) return Swal.fire('错误', '没有有效数据可保存', 'error');

            const btn = document.getElementById('saveBtn');
            btn.disabled = true; btn.innerText = '保存中...';
            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: cleanData })
                });
                if (res.ok) Swal.fire('成功', '部署已触发，预计1-2分钟生效', 'success');
                else throw new Error('保存失败');
            } catch (e) { Swal.fire('错误', e.message, 'error'); }
            btn.disabled = false; btn.innerText = '保存并部署';
        }

        let dragSrc = null;
        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); }
        function dragDrop(e, tgi, tci) {
            if (dragSrc.gi === tgi && dragSrc.ci === tci) return;
            const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[tgi].channels.splice(tci, 0, item);
            render();
        }

        function addGroup() { raw.push({group: '新分组', channels: []}); render(); }
        function addChannel(gi) { raw[gi].channels.push({name:'', id:'', logo:'', url:[]}); editChannel(gi, raw[gi].channels.length-1, true); }
        function deleteGroup(gi) { if(confirm('确定删除分组？')) { raw.splice(gi, 1); render(); } }
        function copyLink(id) {
            const url = window.location.origin + '/jptv.php?id=' + id;
            navigator.clipboard.writeText(url);
            Swal.fire({ toast: true, position: 'top-end', title: '链接已复制', showConfirmButton: false, timer: 1000 });
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

