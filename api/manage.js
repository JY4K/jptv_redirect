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
      if (!projectRes.ok) throw new Error('无法获取项目信息，请检查 Project ID');
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) {
        throw new Error('当前项目未连接 Git 仓库，无法自动触发部署。');
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

      if (!createRes.ok) throw new Error(`变量创建失败: ${await createRes.text()}`);

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

      if (!deployRes.ok) throw new Error(`部署触发失败: ${await deployRes.text()}`);

      return res.json({ success: true });
    } catch (e) {
      console.error("Deploy Error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // --- UI: 页面渲染 ---
  let channels = [];
  try {
    channels = getChannels();
  } catch (e) {
    console.error("Data load error:", e);
  }

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
        body { transition: background 0.5s ease, color 0.3s ease; }
        body.theme-light { background: #f3f4f6; color: #1f2937; }
        .theme-light .glass-panel { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); border: 1px solid #e5e7eb; }
        .theme-light .card { background: rgba(255, 255, 255, 0.9); border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(20px); }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .card { cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; }
        .card.dragging { opacity: 0.4; border: 2px dashed #3b82f6; }
        .card.drag-over { border: 2px solid #3b82f6; transform: scale(1.05); z-index: 10; }
        .channel-logo { height: 64px; width: auto; object-fit: contain; margin-bottom: 12px; transition: transform 0.3s; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); pointer-events: none; }
        .footer-disclaimer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid rgba(0,0,0,0.1); text-align: center; font-size: 0.85rem; opacity: 0.7; }
    </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4 shadow-sm">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                    <i class="fas fa-satellite-dish text-xl"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-bold">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70 items-center">
                        <span id="version-display">v${currentVersion}</span>
                        ${isAuth ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-600 rounded">管理员</span>' : ''}
                    </div>
                </div>
            </div>
            
            <div class="flex flex-wrap items-center justify-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-current/10 hover:bg-current/20 flex items-center justify-center transition">
                    <i class="fas fa-sun" id="themeIcon"></i>
                </button>
                
                ${isAuth ? `
                <div class="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                    <button onclick="exportData()" class="px-4 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-sm font-medium">
                        <i class="fas fa-download"></i> 导出
                    </button>
                    <button onclick="globalImport()" class="px-4 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-sm font-medium">
                        <i class="fas fa-upload"></i> 导入
                    </button>
                </div>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存并部署
                </button>
                ` : `
                <div class="flex gap-2">
                    <a href="/ipv6.m3u" target="_blank" class="px-5 py-2 rounded-xl font-bold bg-current/10 hover:bg-current/20 transition flex items-center gap-2 text-sm"><i class="fas fa-file-code"></i> M3U</a>
                    <a href="/ipv6.txt" target="_blank" class="px-5 py-2 rounded-xl font-bold bg-current/10 hover:bg-current/20 transition flex items-center gap-2 text-sm"><i class="fas fa-file-alt"></i> TXT</a>
                </div>
                `}
            </div>
        </header>

        <div id="app" class="space-y-8 pb-12"></div>
        
        ${isAuth ? `
        <div class="py-10 text-center">
             <button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-current/20 hover:border-blue-500 text-current/50 hover:text-blue-500 transition font-bold flex items-center gap-2 mx-auto text-lg">
                <i class="fas fa-plus-circle"></i> 添加新分组
            </button>
        </div>
        ` : `
        <footer class="footer-disclaimer">
            <p class="mb-2">这是一个基于 JS 的直播重定向服务器，仅支持 Vercel 部署。本项目仅为个人爱好开发，代码开源。</p>
            <p class="mb-2">免责声明：本项目仅用于技术学习与交流，所有频道资源均来源于网络，本项目不存储任何视频文件。</p>
            <p>Project Address: <a href="${config.projectUrl}" target="_blank" class="text-blue-500 hover:underline">GitHub</a></p>
        </footer>
        `}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";
        const currentVer = "${currentVersion}";
        const repoApi = "${config.repoApiUrl}";
        
        let dragSrc = null;

        async function checkVersion() {
            try {
                const res = await fetch(repoApi);
                if(res.ok) {
                    const data = await res.json();
                    const latest = data.tag_name ? data.tag_name.replace('v', '') : currentVer;
                    const el = document.getElementById('version-display');
                    if (latest !== currentVer) {
                        el.innerHTML = \`v\${currentVer} <span class="text-blue-500 ml-1" title="最新版本: v\${latest}">● update available</span>\`;
                    } else {
                        el.innerHTML = \`v\${currentVer} <span class="text-green-500 ml-1">● latest</span>\`;
                    }
                }
            } catch(e) { console.log('Version check failed'); }
        }
        checkVersion();

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

        function render() {
            const app = document.getElementById('app');
            if (!raw || raw.length === 0) {
                app.innerHTML = '<div class="text-center py-20 opacity-50 text-xl">暂无数据</div>';
                return;
            }

            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-2xl p-6 animate-fade-in">
                    <div class="flex items-center justify-between mb-6 border-b border-current/10 pb-4">
                        <div class="flex-1">
                            \${isAuth 
                                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full placeholder-current/30" 
                                    value="\${g.group}" 
                                    onchange="updateGroup(\${gi}, this.value)" 
                                    placeholder="分组名称">\` 
                                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 text-blue-400 hover:bg-blue-500/10 rounded transition \${gi === 0 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 text-blue-400 hover:bg-blue-500/10 rounded transition \${gi === raw.length - 1 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-2 rounded transition ml-1"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl group" 
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
                                     onerror="this.style.display='none';this.nextElementSibling.style.display='block'" 
                                     loading="lazy">
                                <i class="fas fa-tv text-4xl mb-3 opacity-20 hidden text-gray-500"></i>
                                
                                <div class="text-center w-full px-2 z-10 pointer-events-none">
                                    <h3 class="font-bold text-sm truncate" title="\${ch.name}">\${ch.name}</h3>
                                </div>
                            </div>
                        \`).join('')}
                        
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed bg-transparent hover:bg-current/5 opacity-60 hover:opacity-100 text-blue-500">
                            <i class="fas fa-plus text-3xl mb-2"></i>
                            <span class="font-bold text-sm">添加频道</span>
                        </div>
                        \` : ''}
                    </div>
                </div>
            \`).join('');
        }

        // --- 导出 JPTV 数据 ---
        function exportData() {
            const dataStr = JSON.stringify(raw, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = \`jptv_backup_\${new Date().toISOString().slice(0,10)}.json\`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            Swal.fire({ icon: 'success', title: '数据导出成功', text: '请妥善保管备份文件', timer: 1500 });
        }

        // --- 全局导入 (支持 JPTV JSON, M3U, TXT) ---
        async function globalImport() {
            const isDark = currentTheme === 'dark';
            const { value: text } = await Swal.fire({
                title: '批量导入数据',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="text-left space-y-4">
                        <p class="text-xs opacity-60">支持 JPTV JSON 备份文件、M3U 内容或 TXT (名称,链接)。</p>
                        <textarea id="import-text" class="w-full h-48 p-2 text-xs font-mono border rounded bg-transparent outline-none focus:ring-2 ring-blue-500" placeholder="粘贴内容于此..."></textarea>
                        <div class="flex items-center gap-2">
                            <label class="text-xs font-bold">文件选择:</label>
                            <input type="file" id="import-file" accept=".json,.txt,.m3u" class="text-xs">
                        </div>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '确认导入',
                didOpen: () => {
                    const fileInput = document.getElementById('import-file');
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            document.getElementById('import-text').value = event.target.result;
                        };
                        reader.readAsText(file);
                    };
                },
                preConfirm: () => document.getElementById('import-text').value
            });

            if (!text) return;

            try {
                // 1. 尝试解析为 JPTV JSON
                if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
                    const jsonData = JSON.parse(text);
                    const list = Array.isArray(jsonData) ? jsonData : (jsonData.channels ? [jsonData] : null);
                    if (list && list[0].group) {
                        const { isConfirmed } = await Swal.fire({
                            title: '检测到 JPTV 格式',
                            text: '是否替换当前所有数据？(取消则追加)',
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonText: '替换',
                            cancelButtonText: '追加'
                        });
                        if (isConfirmed) raw = list;
                        else raw = [...raw, ...list];
                        render();
                        return;
                    }
                }

                // 2. 尝试解析为 M3U 或 TXT
                const lines = text.split('\\n').filter(l => l.trim());
                let addedChannels = [];
                
                if (text.includes('#EXTM3U')) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('#EXTINF:')) {
                            const infoLine = lines[i];
                            const urlLine = lines[i+1];
                            if (urlLine && urlLine.startsWith('http')) {
                                const name = infoLine.split(',').pop().trim();
                                const logoMatch = infoLine.match(/tvg-logo="([^"]+)"/);
                                const idMatch = infoLine.match(/tvg-id="([^"]+)"/);
                                addedChannels.push({
                                    name: name || '未知频道',
                                    id: idMatch ? idMatch[1] : '',
                                    logo: logoMatch ? logoMatch[1] : '',
                                    url: [urlLine.trim()]
                                });
                                i++;
                            }
                        }
                    }
                } else {
                    lines.forEach(line => {
                        const parts = line.split(/[,，#]/);
                        if (parts.length >= 2) {
                            const name = parts[0].trim();
                            const url = parts[parts.length - 1].trim();
                            if (url.startsWith('http')) {
                                addedChannels.push({ name, id: '', logo: '', url: [url] });
                            }
                        }
                    });
                }

                if (addedChannels.length > 0) {
                    raw.push({
                        group: '导入数据_' + new Date().toLocaleTimeString(),
                        channels: addedChannels
                    });
                    render();
                    Swal.fire({ icon: 'success', title: \`成功导入 \${addedChannels.length} 个频道\` });
                } else {
                    throw new Error('未识别到有效格式');
                }
            } catch (e) {
                Swal.fire({ icon: 'error', title: '导入失败', text: '格式不支持或数据损坏' });
            }
        }

        // --- 拖拽与常规功能 ---
        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); }
        function dragOver(e) { if (e.preventDefault) e.preventDefault(); return false; }
        function dragEnter(e) { e.target.closest('.card')?.classList.add('drag-over'); }
        function dragLeave(e) { e.target.closest('.card')?.classList.remove('drag-over'); }
        function dragEnd(e) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); }
        function dragDrop(e, targetGi, targetCi) {
            if (e.stopPropagation) e.stopPropagation();
            if (dragSrc.gi === targetGi && dragSrc.ci === targetCi) return false;
            const [movedItem] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[targetGi].channels.splice(targetCi, 0, movedItem);
            render();
            return false;
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            if (logo.startsWith('http')) return logo;
            return 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        function updateGroup(i, v) { raw[i].group = v; }
        function deleteGroup(i) {
            Swal.fire({ title: '确认删除分组?', icon: 'warning', showCancelButton: true, confirmButtonText: '删除', confirmButtonColor: '#ef4444' }).then(r => {
                if(r.isConfirmed) { raw.splice(i, 1); render(); }
            });
        }
        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        async function addChannel(gi) { 
            const newChannel = {name:'', id: '', logo: '', url:[]};
            raw[gi].channels.push(newChannel); 
            render(); 
            await editChannel(gi, raw[gi].channels.length - 1, true);
        }

        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const isDark = currentTheme === 'dark';
            const { value, isDenied, isDismissed } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '600px',
                html: \`
                    <div class="space-y-4 text-left mt-2">
                        <div>
                            <label class="text-xs opacity-60 block mb-1">名称 *</label>
                            <input id="s-name" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" value="\${ch.name}">
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-xs opacity-60 block mb-1">ID (EPG)</label>
                                <input id="s-id" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" value="\${ch.id}">
                            </div>
                            <div class="flex-1">
                                <label class="text-xs opacity-60 block mb-1">Logo *</label>
                                <input id="s-logo" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" placeholder="文件名或URL" value="\${ch.logo||''}">
                            </div>
                        </div>
                        <div>
                            <label class="text-xs opacity-60 block mb-1">直播源 (一行一个) *</label>
                            <textarea id="s-url" class="w-full p-3 border rounded bg-transparent font-mono text-xs h-32 focus:ring-2 ring-blue-500 outline-none" placeholder="http://...">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                        </div>
                    </div>\`,
                showDenyButton: !isNew,
                denyButtonText: '删除', 
                confirmButtonText: '保存', 
                showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || urls.length === 0) { Swal.showValidationMessage('必填项不能为空'); return false; }
                    return { name, id: document.getElementById('s-id').value.trim(), logo: document.getElementById('s-logo').value.trim(), url: urls };
                }
            });

            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
            else if (isNew && isDismissed) { raw[gi].channels.splice(ci, 1); render(); }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 部署中...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                
                if (res.ok) {
                    Swal.fire({ icon: 'success', title: '部署已触发', text: '请等待 1-2 分钟后刷新查看效果。', timer: 5000 });
                } else {
                    const err = await res.json();
                    throw new Error(err.error || '保存失败');
                }
            } catch (e) {
                Swal.fire({icon: 'error', title: '错误', text: e.message});
            } finally {
                btn.innerHTML = original;
                btn.disabled = false;
            }
        }

        function copyLink(id) {
            navigator.clipboard.writeText(window.location.origin + '/jptv.php?id=' + id);
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            Toast.fire({ icon: 'success', title: '链接已复制' });
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
