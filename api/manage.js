import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const token = req.query.token || '';
  const isAuth = token === config.adminToken;
  const currentVersion = config.currentVersion;

  // --- API: 保存数据并触发完整部署 ---
  if (req.method === 'POST') {
    if (!isAuth) return res.status(401).json({ error: '无权操作' });

    let { newData } = req.body;

    // 检测并删除空的分组或空的频道数据
    newData = newData.map(g => ({
      ...g,
      channels: g.channels.filter(ch => {
        const hasName = ch.name && ch.name.trim() !== '';
        const hasUrl = Array.isArray(ch.url) ? ch.url.length > 0 : (ch.url && ch.url.trim() !== '');
        return hasName && hasUrl;
      })
    })).filter(g => {
      return g.group && g.group.trim() !== '' && g.channels.length > 0;
    });

    const { projectId, token: vToken } = config.platform;

    if (!projectId || !vToken) {
      return res.status(500).json({ error: '未配置 Vercel API' });
    }

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      if (!projectRes.ok) throw new Error('无法获取项目信息');
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) {
        throw new Error('当前项目未连接 Git 仓库');
      }

      const { repoId, type: repoType } = projectData.link;
      const gitBranch = projectData.targets?.production?.gitBranch || 'main';

      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
      const listData = await listRes.json();
      const existingVars = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA') : [];

      await Promise.all(existingVars.map(env =>
        fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, { method: 'DELETE', headers: commonHeaders })
      ));

      const createRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          key: 'CHANNELS_DATA',
          value: JSON.stringify(newData),
          type: 'encrypted',
          target: ['production', 'preview', 'development']
        })
      });

      if (!createRes.ok) throw new Error(`变量创建失败`);

      const deployRes = await fetch(`https://api.vercel.com/v13/deployments`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          name: 'jptv-update',
          project: projectId,
          target: 'production',
          gitSource: { type: repoType, repoId: repoId, ref: gitBranch }
        })
      });

      if (!deployRes.ok) throw new Error(`部署触发失败`);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // --- UI: 页面渲染 ---
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
        body { transition: background 0.5s ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body.theme-light { background: #f8fafc; color: #1e293b; }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .glass-panel { backdrop-filter: blur(20px); border: 1px solid rgba(128,128,128,0.1); }
        .theme-light .glass-panel { background: rgba(255, 255, 255, 0.8); }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.8); }
        .card { cursor: pointer; transition: all 0.2s; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; }
        .theme-light .card { background: white; border: 1px solid #e2e8f0; }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 20px -5px rgba(0,0,0,0.1); border-color: #3b82f6; }
        .channel-logo { height: 50px; width: auto; object-fit: contain; margin-bottom: 12px; }
        .dragging { opacity: 0.4; border: 2px dashed #3b82f6 !important; }
        .drag-over { transform: scale(1.05); z-index: 10; border: 2px solid #3b82f6 !important; }
    </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col xl:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-6 shadow-sm">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                    <i class="fas fa-satellite-dish text-xl"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70 items-center">
                        <span id="version-display text-blue-500">v${currentVersion}</span>
                        ${isAuth ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-600 rounded">已授权</span>' : ''}
                    </div>
                </div>
            </div>
            
            <div class="flex flex-wrap items-center justify-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-xl bg-gray-500/10 hover:bg-gray-500/20 flex items-center justify-center transition">
                    <i class="fas fa-sun" id="themeIcon"></i>
                </button>
                
                ${isAuth ? `
                <div class="h-8 w-px bg-gray-500/20 mx-1"></div>
                <div class="flex bg-gray-500/10 p-1 rounded-xl gap-1">
                    <button onclick="importJPTV()" class="px-4 py-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition text-sm font-medium flex items-center gap-2">
                        <i class="fas fa-file-import text-blue-500"></i> 导入配置
                    </button>
                    <button onclick="exportJPTV()" class="px-4 py-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition text-sm font-medium flex items-center gap-2">
                        <i class="fas fa-file-export text-green-500"></i> 导出备份
                    </button>
                </div>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存并部署
                </button>
                ` : `
                <div class="flex gap-2">
                    <a href="/ipv6.m3u" target="_blank" class="px-4 py-2 rounded-xl bg-gray-500/10 hover:bg-gray-500/20 transition flex items-center gap-2 text-sm font-medium"><i class="fas fa-file-code"></i> M3U</a>
                    <a href="/ipv6.txt" target="_blank" class="px-4 py-2 rounded-xl bg-gray-500/10 hover:bg-gray-500/20 transition flex items-center gap-2 text-sm font-medium"><i class="fas fa-file-alt"></i> TXT</a>
                </div>
                `}
            </div>
        </header>

        <div id="app" class="space-y-8 pb-12"></div>
        
        ${isAuth ? `
        <div class="py-10 text-center">
             <button onclick="addGroup()" class="px-10 py-5 rounded-2xl border-2 border-dashed border-gray-400/30 hover:border-blue-500 hover:text-blue-500 transition-all font-bold flex items-center gap-3 mx-auto text-lg group">
                <i class="fas fa-plus-circle transition-transform group-hover:rotate-90"></i> 添加频道分组
            </button>
        </div>
        ` : `
        <footer class="mt-12 pt-8 border-t border-gray-500/10 text-center opacity-60 text-sm">
            <p>JPTV - 高性能直播重定向系统</p>
        </footer>
        `}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";
        
        let dragSrc = null;

        // --- 主题管理 ---
        let currentTheme = localStorage.getItem('jptv_theme') || 'light';
        function applyTheme() {
            document.body.className = 'theme-' + currentTheme + ' min-h-screen p-4 md:p-8';
            document.getElementById('themeIcon').className = currentTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        }
        function toggleTheme() {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            localStorage.setItem('jptv_theme', currentTheme);
            applyTheme();
        }
        applyTheme();

        // --- 核心渲染 ---
        function render() {
            const app = document.getElementById('app');
            if (!raw || raw.length === 0) {
                app.innerHTML = '<div class="text-center py-20 opacity-50 text-xl">点击下方按钮开始添加数据</div>';
                return;
            }

            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-2xl p-6 shadow-sm border border-gray-500/10">
                    <div class="flex items-center justify-between mb-6 border-b border-gray-500/10 pb-4">
                        <div class="flex-1">
                            \${isAuth 
                                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" 
                                    value="\${g.group}" 
                                    onchange="updateGroup(\${gi}, this.value)" 
                                    placeholder="分组名称">\` 
                                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 hover:bg-blue-500/10 text-blue-500 rounded-lg \${gi === 0 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 hover:bg-blue-500/10 text-blue-500 rounded-lg \${gi === raw.length - 1 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="importToGroup(\${gi})" class="p-2 hover:bg-green-500/10 text-green-500 rounded-lg ml-1" title="批量导入到此分组"><i class="fas fa-plus-square"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="p-2 hover:bg-red-500/10 text-red-400 rounded-lg ml-1"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl" 
                                 \${isAuth ? \`draggable="true" 
                                    ondragstart="dragStart(event, \${gi}, \${ci})" 
                                    ondragover="dragOver(event)" 
                                    ondragenter="dragEnter(event)" 
                                    ondragleave="dragLeave(event)" 
                                    ondrop="dragDrop(event, \${gi}, \${ci})" 
                                    ondragend="dragEnd(event)"\` : ''}
                                 onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                
                                <img src="\${getLogoUrl(ch.logo)}" 
                                     class="channel-logo" 
                                     onerror="this.src='https://api.iconify.design/material-symbols:tv-outline.svg?color=%23888888';this.style.opacity=0.3" 
                                     loading="lazy">
                                
                                <div class="text-center w-full px-2">
                                    <h3 class="font-bold text-xs truncate" title="\${ch.name}">\${ch.name}</h3>
                                </div>
                            </div>
                        \`).join('')}
                        
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed border-2 bg-transparent opacity-40 hover:opacity-100 text-blue-500 hover:bg-blue-500/5">
                            <i class="fas fa-plus text-2xl mb-2"></i>
                            <span class="text-xs font-bold">新增频道</span>
                        </div>
                        \` : ''}
                    </div>
                </div>
            \`).join('');
        }

        // --- 导入导出逻辑 ---

        async function exportJPTV() {
            const dataStr = JSON.stringify(raw, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = \`jptv_config_\${new Date().toISOString().slice(0,10)}.json\`;
            link.click();
            URL.revokeObjectURL(url);
        }

        async function importJPTV() {
            const { value: file } = await Swal.fire({
                title: '导入 JPTV 配置文件',
                input: 'file',
                inputAttributes: { 'accept': '.json', 'aria-label': '选择你的 JPTV JSON 文件' },
                showCancelButton: true,
                confirmButtonText: '上传并应用',
                background: currentTheme === 'dark' ? '#1e293b' : '#fff',
                color: currentTheme === 'dark' ? '#fff' : '#333',
            });

            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedData = JSON.parse(e.target.result);
                        if (Array.isArray(importedData) && importedData[0].hasOwnProperty('group')) {
                            Swal.fire({
                                title: '检测到有效数据',
                                text: '请选择导入模式：',
                                icon: 'question',
                                showDenyButton: true,
                                confirmButtonText: '覆盖当前',
                                denyButtonText: '合并到末尾',
                            }).then((result) => {
                                if (result.isConfirmed) {
                                    raw = importedData;
                                } else if (result.isDenied) {
                                    raw = [...raw, ...importedData];
                                }
                                render();
                                Swal.fire('完成', '数据已更新，别忘了保存部署', 'success');
                            });
                        } else {
                            throw new Error('格式不符合 JPTV 规范');
                        }
                    } catch (err) {
                        Swal.fire('导入失败', '文件格式错误: ' + err.message, 'error');
                    }
                };
                reader.readAsText(file);
            }
        }

        async function importToGroup(gi) {
            const isDark = currentTheme === 'dark';
            const { value: text } = await Swal.fire({
                title: '批量导入到 [' + raw[gi].group + ']',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="text-left space-y-4">
                        <p class="text-[11px] opacity-60">支持 TXT (名称,链接) 或标准 M3U 文本/文件。</p>
                        <textarea id="import-text" class="w-full h-48 p-3 text-xs font-mono border rounded-xl bg-gray-500/5 outline-none focus:ring-2 ring-blue-500" placeholder="CCTV-1,http://..."></textarea>
                        <div class="flex items-center gap-2">
                            <label class="text-xs font-bold">本地文件:</label>
                            <input type="file" id="import-file" accept=".txt,.m3u" class="text-xs">
                        </div>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '立即解析',
                didOpen: () => {
                    const fileInput = document.getElementById('import-file');
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => document.getElementById('import-text').value = ev.target.result;
                            reader.readAsText(file);
                        }
                    };
                },
                preConfirm: () => document.getElementById('import-text').value
            });

            if (text) {
                const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
                let added = 0;
                
                if (text.includes('#EXTM3U')) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('#EXTINF:')) {
                            const name = lines[i].split(',').pop().trim();
                            const logoMatch = lines[i].match(/tvg-logo="([^"]+)"/);
                            const idMatch = lines[i].match(/tvg-id="([^"]+)"/);
                            const nextLine = lines[i+1];
                            if (nextLine && nextLine.startsWith('http')) {
                                raw[gi].channels.push({
                                    name: name || '未知频道',
                                    id: idMatch ? idMatch[1] : '',
                                    logo: logoMatch ? logoMatch[1] : '',
                                    url: [nextLine]
                                });
                                added++;
                                i++;
                            }
                        }
                    }
                } else {
                    lines.forEach(line => {
                        const parts = line.split(/[,，#]/);
                        if (parts.length >= 2) {
                            const url = parts[parts.length - 1].trim();
                            if (url.startsWith('http')) {
                                raw[gi].channels.push({ name: parts[0].trim(), id: '', logo: '', url: [url] });
                                added++;
                            }
                        }
                    });
                }
                
                if (added > 0) { render(); Swal.fire('成功', \`成功导入 \${added} 个频道\`, 'success'); }
            }
        }

        // --- 基础操作与拖拽 ---
        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); }
        function dragOver(e) { e.preventDefault(); return false; }
        function dragEnter(e) { e.target.closest('.card')?.classList.add('drag-over'); }
        function dragLeave(e) { e.target.closest('.card')?.classList.remove('drag-over'); }
        function dragEnd(e) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); }
        function dragDrop(e, tGi, tCi) {
            if (dragSrc.gi === tGi && dragSrc.ci === tCi) return;
            const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[tGi].channels.splice(tCi, 0, item);
            render();
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        function updateGroup(i, v) { raw[i].group = v; }
        function moveGroup(i, d) { const t = i + d; [raw[i], raw[t]] = [raw[t], raw[i]]; render(); }
        function deleteGroup(i) { Swal.fire({ title: '删除分组?', text: '组内所有频道也将被删除', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444' }).then(r => { if(r.isConfirmed) { raw.splice(i, 1); render(); } }); }
        function addGroup() { raw.push({group:'新频道分组', channels:[]}); render(); }
        
        async function addChannel(gi) {
            const ch = {name:'', id: '', logo: '', url:[]};
            raw[gi].channels.push(ch);
            render();
            editChannel(gi, raw[gi].channels.length - 1, true);
        }

        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const isDark = currentTheme === 'dark';
            const { value, isDenied } = await Swal.fire({
                title: isNew ? '新增频道' : '编辑频道',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '550px',
                html: \`
                    <div class="space-y-4 text-left mt-2 px-1">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="text-[11px] font-bold opacity-50 block mb-1 uppercase">频道名称</label>
                                <input id="s-name" class="w-full p-3 border rounded-xl bg-gray-500/5 outline-none focus:ring-2 ring-blue-500" value="\${ch.name}">
                            </div>
                            <div>
                                <label class="text-[11px] font-bold opacity-50 block mb-1 uppercase">EPG ID</label>
                                <input id="s-id" class="w-full p-3 border rounded-xl bg-gray-500/5 outline-none focus:ring-2 ring-blue-500" value="\${ch.id}">
                            </div>
                        </div>
                        <div>
                            <label class="text-[11px] font-bold opacity-50 block mb-1 uppercase">Logo (文件名或URL)</label>
                            <input id="s-logo" class="w-full p-3 border rounded-xl bg-gray-500/5 outline-none focus:ring-2 ring-blue-500" placeholder="例如: CCTV1" value="\${ch.logo||''}">
                        </div>
                        <div>
                            <label class="text-[11px] font-bold opacity-50 block mb-1 uppercase">直播源地址 (一行一个)</label>
                            <textarea id="s-url" class="w-full p-3 border rounded-xl bg-gray-500/5 font-mono text-xs h-32 outline-none focus:ring-2 ring-blue-500">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                        </div>
                    </div>\`,
                showDenyButton: !isNew,
                denyButtonText: '删除', 
                confirmButtonText: '保存修改',
                showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || urls.length === 0) return Swal.showValidationMessage('名称和源不能为空');
                    return { name, id: document.getElementById('s-id').value.trim(), logo: document.getElementById('s-logo').value.trim(), url: urls };
                }
            });

            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
            else if (isNew) { raw[gi].channels.splice(ci, 1); render(); }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const old = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 部署中...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) {
                    Swal.fire({ icon: 'success', title: '部署已提交', text: 'Vercel 正在构建，请 2 分钟后访问。', timer: 3000 });
                } else {
                    const err = await res.json();
                    throw new Error(err.error);
                }
            } catch (e) {
                Swal.fire('部署失败', e.message, 'error');
            } finally {
                btn.innerHTML = old; btn.disabled = false;
            }
        }

        function copyLink(id) {
            const url = window.location.origin + '/jptv.php?id=' + id;
            navigator.clipboard.writeText(url);
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: '链接已复制', showConfirmButton: false, timer: 1500 });
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
