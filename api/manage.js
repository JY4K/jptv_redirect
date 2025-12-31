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

    // 数据清洗：移除空分组和无效频道
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

      // 1. 获取项目信息
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      if (!projectRes.ok) throw new Error('无法获取项目信息');
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) {
        throw new Error('项目未连接 Git 仓库，无法触发自动部署');
      }

      // 2. 更新环境变量 CHANNELS_DATA
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
        body { transition: background 0.5s ease, color 0.3s ease; }
        body.theme-light { background: #f3f4f6; color: #1f2937; }
        .theme-light .glass-panel { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); border: 1px solid #e5e7eb; }
        .theme-light .card { background: rgba(255, 255, 255, 0.9); border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(20px); }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .card { cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; }
        .channel-logo { height: 64px; width: auto; object-fit: contain; margin-bottom: 12px; transition: transform 0.3s; pointer-events: none; }
        
        /* 错误状态下选中文本变红 */
        #group-json-editor.has-error::selection { background: #ef4444 !important; color: #fff !important; }
        #group-json-editor.has-error::-moz-selection { background: #ef4444 !important; color: #fff !important; }
        .has-error { border-color: #ef4444 !important; ring-color: #ef4444 !important; }
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
                ${isAuth ? \`
                <div class="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                    <button onclick="exportData()" class="px-4 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-sm font-medium"><i class="fas fa-download"></i> 导出</button>
                    <button onclick="globalImport()" class="px-4 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-sm font-medium"><i class="fas fa-upload"></i> 导入</button>
                </div>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition flex items-center gap-2"><i class="fas fa-cloud-upload-alt"></i> 保存并部署</button>
                \` : ''}
            </div>
        </header>

        <div id="app" class="space-y-8 pb-12"></div>
        ${isAuth ? \`
        <div class="py-10 text-center">
             <button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-current/20 hover:border-blue-500 text-current/50 hover:text-blue-500 transition font-bold flex items-center gap-2 mx-auto text-lg"><i class="fas fa-plus-circle"></i> 添加新分组</button>
        </div>
        \` : ''}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";
        const currentVer = "${currentVersion}";
        const repoApi = "${config.repoApiUrl}";

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
                                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" value="\${g.group}" onchange="updateGroup(\${gi}, this.value)">\` 
                                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="editGroupChannels(\${gi})" class="p-2 text-green-400 hover:bg-green-500/10 rounded" title="编辑分组数据"><i class="fas fa-edit"></i></button>
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 text-blue-400 hover:bg-blue-500/10 rounded \${gi === 0 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 text-blue-400 hover:bg-blue-500/10 rounded \${gi === raw.length - 1 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-2 rounded ml-1"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl group" onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                                <i class="fas fa-tv text-4xl mb-3 opacity-20 hidden text-gray-500"></i>
                                <div class="text-center w-full px-2 z-10 pointer-events-none"><h3 class="font-bold text-sm truncate">\${ch.name}</h3></div>
                            </div>
                        \`).join('')}
                        \${isAuth ? \`<div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed bg-transparent hover:bg-current/5 text-blue-500 opacity-60"><i class="fas fa-plus text-3xl mb-2"></i><span class="font-bold text-sm">添加频道</span></div>\` : ''}
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
                width: '85%',
                padding: '2rem',
                html: \`
                    <div class="text-left">
                        <p class="text-xs opacity-60 mb-3">若格式有误，点击“保存”将自动定位并标红错误位置。</p>
                        <textarea id="group-json-editor" 
                            class="w-full h-[600px] p-5 text-sm font-mono border-2 rounded-xl bg-transparent outline-none focus:ring-4 ring-blue-500/20 transition-all leading-relaxed" 
                            spellcheck="false"
                            oninput="this.classList.remove('has-error')">\${JSON.stringify(groupData, null, 2)}</textarea>
                    </div>\`,
                showCancelButton: true,
                confirmButtonText: '保存修改',
                cancelButtonText: '取消',
                focusConfirm: false,
                preConfirm: () => {
                    const editor = document.getElementById('group-json-editor');
                    const text = editor.value;
                    
                    try {
                        const parsed = JSON.parse(text);
                        if (!parsed.group || !Array.isArray(parsed.channels)) throw new Error('缺少必要字段');
                        return parsed;
                    } catch (e) {
                        editor.classList.add('has-error');
                        
                        // 解析错误位置
                        let pos = 0;
                        const posMatch = e.message.match(/at position (\\d+)/);
                        if (posMatch) {
                            pos = parseInt(posMatch[1]);
                        } else {
                            // 针对 Firefox 等其他浏览器的行列号解析
                            const lineMatch = e.message.match(/line (\\d+) column (\\d+)/);
                            if (lineMatch) {
                                const targetLine = parseInt(lineMatch[1]) - 1;
                                const targetCol = parseInt(lineMatch[2]) - 1;
                                const lines = text.split('\\n');
                                for(let i=0; i<targetLine; i++) pos += lines[i].length + 1;
                                pos += targetCol;
                            }
                        }

                        // 执行定位：选中错误字符 + 滚动到中心
                        editor.focus();
                        editor.setSelectionRange(pos, pos + 2); // 选中错误点开始的2个字符
                        
                        const linesBefore = text.substr(0, pos).split('\\n');
                        const lineNum = linesBefore.length;
                        const lineHeight = parseInt(window.getComputedStyle(editor).lineHeight);
                        const scrollPos = (lineNum * lineHeight) - (editor.clientHeight / 2);
                        
                        editor.scrollTo({ top: scrollPos, behavior: 'smooth' });
                        
                        // 不使用默认 Swal 提示，保持界面整洁
                        return false; 
                    }
                }
            });

            if (jsonText) {
                raw[gi] = jsonText;
                render();
                Swal.fire({ icon: 'success', title: '修改已暂存', timer: 1500, showConfirmButton: false });
            }
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
                if (res.ok) Swal.fire({ icon: 'success', title: '部署已触发', text: '请等待 1-2 分钟后刷新查看效果。' });
                else throw new Error('保存失败');
            } catch (e) {
                Swal.fire({icon: 'error', title: '错误', text: e.message});
            } finally {
                btn.innerHTML = original; btn.disabled = false;
            }
        }

        function toggleTheme() {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            localStorage.setItem('jptv_theme', currentTheme);
            applyTheme();
        }
        function applyTheme() {
            document.body.className = 'theme-' + currentTheme + ' min-h-screen p-4 md:p-8';
            document.getElementById('themeIcon').className = currentTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        }
        let currentTheme = localStorage.getItem('jptv_theme') || 'light';
        applyTheme();

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }
        function updateGroup(i, v) { raw[i].group = v; }
        function moveGroup(i, dir) {
            const target = i + dir;
            if (target >= 0 && target < raw.length) { [raw[i], raw[target]] = [raw[target], raw[i]]; render(); }
        }
        function deleteGroup(i) {
            Swal.fire({ title: '确认删除?', icon: 'warning', showCancelButton: true }).then(r => { if(r.isConfirmed) { raw.splice(i, 1); render(); } });
        }
        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        function addChannel(gi) { raw[gi].channels.push({name:'', id: '', logo: '', url:[]}); render(); editChannel(gi, raw[gi].channels.length - 1, true); }
        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const isDark = currentTheme === 'dark';
            const { value, isDenied, isDismissed } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="space-y-4 text-left mt-2">
                        <input id="s-name" class="w-full p-2.5 border rounded bg-transparent" placeholder="名称" value="\${ch.name}">
                        <div class="flex gap-4">
                            <input id="s-id" class="flex-1 p-2.5 border rounded bg-transparent" placeholder="ID (EPG)" value="\${ch.id}">
                            <input id="s-logo" class="flex-1 p-2.5 border rounded bg-transparent" placeholder="Logo" value="\${ch.logo||''}">
                        </div>
                        <textarea id="s-url" class="w-full p-3 border rounded bg-transparent font-mono text-xs h-32" placeholder="直播源 (每行一个)">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
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
        function exportData() {
            const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'jptv_backup.json'; a.click();
        }
        render();
    </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
