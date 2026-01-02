import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const token = req.query.token || '';
  const isAuth = token === config.adminToken;
  const currentVersion = config.currentVersion;

  // --- API: 保存数据并触发部署 ---
  if (req.method === 'POST') {
    if (!isAuth) return res.status(401).json({ error: '无权操作' });

    let { newData } = req.body;

    // 数据清洗
    if (Array.isArray(newData)) {
        newData = newData.map(g => ({
        ...g,
        channels: Array.isArray(g.channels) ? g.channels.filter(ch => {
            const hasName = ch.name && ch.name.trim() !== '';
            const hasUrl = Array.isArray(ch.url) ? ch.url.length > 0 : (ch.url && ch.url.trim() !== '');
            return hasName && hasUrl;
        }) : []
        })).filter(g => {
        return g.group && g.group.trim() !== '' && g.channels.length > 0;
        });
    }

    const { projectId, token: vToken } = config.platform;

    if (!projectId || !vToken) {
      return res.status(500).json({ error: '未配置 Vercel API 环境变量' });
    }

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      if (!projectRes.ok) throw new Error('无法获取项目信息');
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) {
        throw new Error('项目未连接 Git 仓库，无法触发自动部署');
      }

      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
      const listData = await listRes.json();
      const targetEnvIds = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA').map(e => e.id) : [];

      await Promise.all(targetEnvIds.map(id =>
        fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${id}`, { method: 'DELETE', headers: commonHeaders })
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

      if (!createRes.ok) throw new Error(`环境变量更新失败: ${await createRes.text()}`);

      const deployRes = await fetch(`https://api.vercel.com/v13/deployments`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          name: 'jptv-update',
          project: projectId,
          target: 'production',
          gitSource: {
            type: projectData.link.type,
            repoId: projectData.link.repoId,
            ref: projectData.targets?.production?.gitBranch || 'main'
          }
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
    <link rel="icon" href="/jptv.png" type="image/png">
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

        /* JSON 错误定位高亮样式 */
        #group-json-editor::selection {
            background: #ef4444 !important;
            color: white !important;
        }
        .json-error-highlight {
            border: 2px solid #ef4444 !important;
            box-shadow: 0 0 10px rgba(239, 68, 68, 0.3);
            animation: shake 0.4s ease-in-out;
        }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-8px); }
            50% { transform: translateX(8px); }
            75% { transform: translateX(-4px); }
        }
        /* 强制隐藏底部验证栏 */
        .swal2-validation-message { display: none !important; }
    </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4 shadow-sm">
            <div class="flex items-center gap-4">
                <!-- 修改后的控制台图标 -->
                <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 overflow-hidden border border-gray-100">
                    <img src="/jptv.png" class="w-10 h-10 object-contain" alt="JPTV">
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
        ` : ''}
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
                            <button onclick="editGroupChannels(\${gi})" class="p-2 text-green-400 hover:bg-green-500/10 rounded transition mr-1" title="编辑分组数据"><i class="fas fa-edit"></i></button>
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

        async function editGroupChannels(gi) {
            const groupData = raw[gi];
            const isDark = currentTheme === 'dark';
            const { value: jsonText } = await Swal.fire({
                title: \`编辑分组数据: \${groupData.group}\`,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '80%',
                html: \`
                    <div class="text-left">
                        <p class="text-xs opacity-60 mb-2">保存时若格式错误，系统将自动定位并红色高亮错误位置。</p>
                        <textarea id="group-json-editor" class="w-full h-[500px] p-4 text-xs font-mono border rounded bg-transparent outline-none focus:ring-1 ring-blue-500/50 transition-all" spellcheck="false">\${JSON.stringify(groupData, null, 2)}</textarea>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '保存修改',
                cancelButtonText: '取消',
                preConfirm: () => {
                    const editor = document.getElementById('group-json-editor');
                    const text = editor.value;
                    
                    // 清除旧错误状态
                    editor.classList.remove('json-error-highlight');
                    void editor.offsetWidth; // 触发重绘以重新执行动画

                    try {
                        const parsed = JSON.parse(text);
                        if (!parsed.group || !Array.isArray(parsed.channels)) throw new Error('缺少必要字段');
                        return parsed;
                    } catch (e) {
                        // 1. 提取错误位置
                        const posMatch = e.message.match(/at position (\\d+)/);
                        if (posMatch) {
                            const pos = parseInt(posMatch[1]);
                            editor.focus();
                            // 2. 红色高亮错误位置（利用 ::selection）
                            // 选中错误发生点前后各几个字符，使其非常显眼
                            editor.setSelectionRange(pos, pos + 1);
                            
                            // 3. 自动滚动到错误位置
                            const fullText = editor.value;
                            const lineNum = fullText.substr(0, pos).split("\\n").length;
                            const lineHeight = 18; 
                            editor.scrollTop = (lineNum - 10) * lineHeight;
                        }
                        
                        // 4. 视觉反馈：红色边框和震动，不显示底部提示文字
                        editor.classList.add('json-error-highlight');
                        return false; 
                    }
                }
            });

            if (jsonText) {
                raw[gi] = jsonText;
                render();
                Swal.fire({ icon: 'success', title: '修改已暂存', timer: 1000, showConfirmButton: false });
            }
        }

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
            Swal.fire({ icon: 'success', title: '数据导出成功', timer: 1500 });
        }

        async function globalImport() {
            const isDark = currentTheme === 'dark';
            const { value: text } = await Swal.fire({
                title: '批量导入数据',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="text-left space-y-4">
                        <textarea id="import-text" class="w-full h-48 p-2 text-xs font-mono border rounded bg-transparent outline-none focus:ring-2 ring-blue-500" placeholder="粘贴内容..."></textarea>
                        <input type="file" id="import-file" accept=".json,.txt,.m3u" class="text-xs">
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
                        reader.onload = (ev) => document.getElementById('import-text').value = ev.target.result;
                        reader.readAsText(file);
                    };
                },
                preConfirm: () => document.getElementById('import-text').value
            });

            if (!text) return;
            try {
                if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
                    const jsonData = JSON.parse(text);
                    const list = Array.isArray(jsonData) ? jsonData : [jsonData];
                    raw = [...raw, ...list];
                    render();
                }
            } catch (e) { Swal.fire({ icon: 'error', title: '解析失败' }); }
        }

        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); }
        function dragOver(e) { if (e.preventDefault) e.preventDefault(); return false; }
        function dragEnter(e) { e.target.closest('.card')?.classList.add('drag-over'); }
        function dragLeave(e) { e.target.closest('.card')?.classList.remove('drag-over'); }
        function dragEnd(e) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); }
        function dragDrop(e, targetGi, targetCi) {
            if (e.stopPropagation) e.stopPropagation();
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
            Swal.fire({ title: '确认删除分组?', icon: 'warning', showCancelButton: true, confirmButtonText: '删除' }).then(r => {
                if(r.isConfirmed) { raw.splice(i, 1); render(); }
            });
        }
        function moveGroup(i, dir) {
            const target = i + dir;
            if (target >= 0 && target < raw.length) {
                [raw[i], raw[target]] = [raw[target], raw[i]];
                render();
            }
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
                        <input id="s-name" placeholder="名称" class="w-full p-2.5 border rounded bg-transparent" value="\${ch.name}">
                        <div class="flex gap-4">
                            <input id="s-id" placeholder="ID" class="flex-1 p-2.5 border rounded bg-transparent" value="\${ch.id}">
                            <input id="s-logo" placeholder="Logo" class="flex-1 p-2.5 border rounded bg-transparent" value="\${ch.logo||''}">
                        </div>
                        <textarea id="s-url" class="w-full p-3 border rounded bg-transparent font-mono text-xs h-32" placeholder="http://...">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                    </div>\`,
                showDenyButton: !isNew,
                denyButtonText: '删除', confirmButtonText: '保存', showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || urls.length === 0) return false;
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
                if (res.ok) Swal.fire({ icon: 'success', title: '部署已触发', timer: 5000 });
                else throw new Error('保存失败');
            } catch (e) {
                Swal.fire({icon: 'error', title: '错误', text: e.message});
            } finally {
                btn.innerHTML = original; btn.disabled = false;
            }
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
