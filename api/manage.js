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

    // 【新增功能】检测并清理无效数据
    newData = newData.map(g => ({
        ...g,
        channels: g.channels.filter(ch => ch.name && ch.name.trim() !== '' && ch.url && (Array.isArray(ch.url) ? ch.url.length > 0 : ch.url.trim() !== ''))
    })).filter(g => g.group && g.group.trim() !== '' && g.channels.length > 0);

    const { projectId, token: vToken } = config.platform;

    if (!projectId || !vToken) {
      return res.status(500).json({ error: '未配置 Vercel API' });
    }

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };

      // 1. 获取项目详情
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      if (!projectRes.ok) throw new Error('无法获取项目信息，请检查 Project ID');
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) {
        throw new Error('当前项目未连接 Git 仓库，无法自动触发部署。');
      }

      const { repoId, type: repoType } = projectData.link;
      const gitBranch = projectData.targets?.production?.gitBranch || 'main';

      // 2. 获取现有环境变量
      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
      const listData = await listRes.json();
      const existingVars = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA') : [];

      // 3. 删除旧变量
      await Promise.all(existingVars.map(env =>
        fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, { method: 'DELETE', headers: commonHeaders })
      ));

      // 4. 创建新变量
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

      if (!createRes.ok) throw new Error(`变量创建失败: \${await createRes.text()}`);

      // 5. 触发重新部署
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

      if (!deployRes.ok) throw new Error(`部署触发失败: \${await deployRes.text()}`);

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
        .card:hover .channel-logo { transform: scale(1.1); }
        .footer-disclaimer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid rgba(0,0,0,0.1); text-align: center; font-size: 0.85rem; opacity: 0.7; }
        .theme-dark .footer-disclaimer { border-top-color: rgba(255,255,255,0.1); }
    </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col md:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4 shadow-sm">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                    <i class="fas fa-satellite-dish text-xl"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-bold">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70 items-center">
                        <span id="version-display">v\${currentVer}</span>
                        ${isAuth ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-600 rounded">管理员</span>' : ''}
                    </div>
                </div>
            </div>
            
            <div class="flex items-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-current/10 hover:bg-current/20 flex items-center justify-center transition">
                    <i class="fas fa-sun" id="themeIcon"></i>
                </button>
                
                ${isAuth ? `
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
            <p class="mb-2">这是一个基于 js 的直播重定向服务器，仅支持vercel部署。本项目仅为个人爱好开发，代码开源。</p>
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
                    el.innerHTML = latest !== currentVer ? \`v\${currentVer} <span class="text-blue-500 ml-1">● update available</span>\` : \`v\${currentVer} <span class="text-green-500 ml-1">● latest</span>\`;
                }
            } catch(e) {}
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
                <div class="glass-panel rounded-2xl p-6">
                    <div class="flex items-center justify-between mb-6 border-b border-current/10 pb-4">
                        <div class="flex-1">
                            \${isAuth 
                                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" 
                                    value="\${g.group}" onchange="raw[\${gi}].group=this.value" placeholder="分组名称">\` 
                                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="moveGroup(\${gi}, -1)" class="text-blue-400 hover:bg-blue-500/10 p-2 rounded transition \${gi === 0 ? 'opacity-20 pointer-events-none' : ''}" title="上移"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="text-blue-400 hover:bg-blue-500/10 p-2 rounded transition \${gi === raw.length - 1 ? 'opacity-20 pointer-events-none' : ''}" title="下移"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="importBatch(\${gi})" class="text-green-500 hover:bg-green-500/10 p-2 rounded transition ml-2" title="批量导入"><i class="fas fa-file-import"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-2 rounded transition ml-1" title="删除分组"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl group" 
                                 \${isAuth ? \`draggable="true" ondragstart="dragStart(event,\${gi},\${ci})" ondragover="dragOver(event)" ondragenter="dragEnter(event)" ondragleave="dragLeave(event)" ondrop="dragDrop(event,\${gi},\${ci})" ondragend="dragEnd(event)"\` : ''}
                                 onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                                <i class="fas fa-tv text-4xl mb-3 opacity-20 hidden text-gray-500"></i>
                                <div class="text-center w-full px-2 z-10 pointer-events-none">
                                    <h3 class="font-bold text-sm truncate">\${ch.name}</h3>
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

        // --- 移动功能 ---
        function moveGroup(index, direction) {
            const target = index + direction;
            if (target < 0 || target >= raw.length) return;
            const temp = raw[index];
            raw[index] = raw[target];
            raw[target] = temp;
            render();
        }

        // --- 批量导入逻辑 ---
        async function importBatch(gi) {
            const { value: text } = await Swal.fire({
                title: '批量导入频道',
                html: \`
                    <div class="text-left space-y-4">
                        <p class="text-xs opacity-60">支持 TXT (名称,链接) 或 M3U 格式。重复数据将自动添加。</p>
                        <textarea id="import-area" class="w-full h-48 p-2 border rounded font-mono text-xs bg-transparent" placeholder="在此粘贴数据..."></textarea>
                        <div class="flex items-center gap-2">
                            <label class="text-sm font-bold">从本地文件导入:</label>
                            <input type="file" id="import-file" accept=".txt,.m3u" class="text-xs">
                        </div>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '开始导入',
                didOpen: () => {
                    const fileInput = document.getElementById('import-file');
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        const reader = new FileReader();
                        reader.onload = (ev) => document.getElementById('import-area').value = ev.target.result;
                        reader.readAsText(file);
                    };
                },
                preConfirm: () => document.getElementById('import-area').value
            });

            if (text) {
                const lines = text.split('\\n').filter(l => l.trim());
                let addedCount = 0;
                
                if (text.includes('#EXTM3U')) {
                    // M3U 解析
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('#EXTINF:')) {
                            const info = lines[i];
                            const url = lines[i+1];
                            if (url && url.startsWith('http')) {
                                const nameMatch = info.match(/,(.*)$/);
                                const logoMatch = info.match(/tvg-logo="(.*?)"/);
                                const idMatch = info.match(/tvg-id="(.*?)"/);
                                raw[gi].channels.push({
                                    name: nameMatch ? nameMatch[1].trim() : '未知频道',
                                    logo: logoMatch ? logoMatch[1] : '',
                                    id: idMatch ? idMatch[1] : '',
                                    url: [url.trim()]
                                });
                                addedCount++;
                                i++;
                            }
                        }
                    }
                } else {
                    // TXT 解析
                    lines.forEach(line => {
                        const parts = line.split(/[,，#]/);
                        if (parts.length >= 2) {
                            const name = parts[0].trim();
                            const url = parts[parts.length - 1].trim();
                            if (url.startsWith('http')) {
                                raw[gi].channels.push({ name, id: '', logo: '', url: [url] });
                                addedCount++;
                            }
                        }
                    });
                }
                Swal.fire('导入完成', \`成功导入 \${addedCount} 个频道\`, 'success');
                render();
            }
        }

        // --- 拖拽与原有逻辑保持不变 ---
        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
        function dragOver(e) { e.preventDefault(); return false; }
        function dragEnter(e) { e.target.closest('.card')?.classList.add('drag-over'); }
        function dragLeave(e) { e.target.closest('.card')?.classList.remove('drag-over'); }
        function dragEnd(e) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); }
        function dragDrop(e, targetGi, targetCi) {
            if (dragSrc.gi === targetGi && dragSrc.ci === targetCi) return false;
            const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[targetGi].channels.splice(targetCi, 0, item);
            render();
            return false;
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        function deleteGroup(i) {
            Swal.fire({ title: '确认删除?', icon: 'warning', showCancelButton: true }).then(r => {
                if(r.isConfirmed) { raw.splice(i, 1); render(); }
            });
        }
        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        async function addChannel(gi) {
            raw[gi].channels.push({name:'', id: '', logo: '', url:[]});
            render();
            await editChannel(gi, raw[gi].channels.length - 1, true);
        }

        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const isDark = currentTheme === 'dark';
            const { value, isDenied, isDismissed } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                background: isDark ? '#1e293b' : '#fff', color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="space-y-4 text-left mt-2">
                        <input id="s-name" class="w-full p-2 border rounded bg-transparent" placeholder="名称" value="\${ch.name}">
                        <div class="flex gap-2">
                            <input id="s-id" class="flex-1 p-2 border rounded bg-transparent" placeholder="EPG ID" value="\${ch.id}">
                            <input id="s-logo" class="flex-1 p-2 border rounded bg-transparent" placeholder="Logo" value="\${ch.logo||''}">
                        </div>
                        <textarea id="s-url" class="w-full p-2 border rounded bg-transparent h-32 text-xs font-mono" placeholder="直播源 (每行一个)">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                    </div>\`,
                showDenyButton: !isNew, denyButtonText: '删除', confirmButtonText: '保存', showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    return { name, id: document.getElementById('s-id').value, logo: document.getElementById('s-logo').value, url: urls };
                }
            });
            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
            else if (isNew && isDismissed) { raw[gi].channels.splice(ci, 1); render(); }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) {
                    Swal.fire({ icon: 'success', title: '部署已触发', text: '空频道/空分组已自动清理，Vercel 正在构建。' });
                    // 重新获取一下本地展示的数据（模拟清理后的效果）
                    raw = raw.map(g => ({...g, channels: g.channels.filter(ch => ch.name && ch.url.length > 0)})).filter(g => g.group && g.channels.length > 0);
                    render();
                } else { throw new Error('保存失败'); }
            } catch (e) { Swal.fire('错误', e.message, 'error'); }
            finally { btn.innerHTML = original; btn.disabled = false; }
        }

        function copyLink(id) {
            navigator.clipboard.writeText(window.location.origin + '/jptv.php?id=' + id);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '链接已复制', showConfirmButton: false, timer: 1500 });
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
