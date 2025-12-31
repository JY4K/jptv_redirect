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
    if (!projectId || !vToken) return res.status(500).json({ error: '未配置 Vercel API 环境变量' });

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      const projectData = await projectRes.json();

      if (!projectData.link || !projectData.link.repoId) throw new Error('项目未连接 Git 仓库');

      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
      const listData = await listRes.json();
      const targetEnvIds = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA').map(e => e.id) : [];

      await Promise.all(targetEnvIds.map(id =>
        fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${id}`, { method: 'DELETE', headers: commonHeaders })
      ));

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
          gitSource: {
            type: projectData.link.type,
            repoId: projectData.link.repoId,
            ref: projectData.targets?.production?.gitBranch || 'main'
          }
        })
      });

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // --- UI ---
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
        .theme-light .card { background: rgba(255, 255, 255, 0.9); border: 1px solid #e5e7eb; }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .card { cursor: pointer; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; border-radius: 0.75rem; }
        .channel-logo { height: 64px; width: auto; object-fit: contain; margin-bottom: 12px; pointer-events: none; }
        
        /* 错误高亮：编辑器整体红边，选中文本红色高亮 */
        .json-editor-area { transition: all 0.2s ease; outline: none; }
        .json-error-active { border: 2px solid #ef4444 !important; background: rgba(239, 68, 68, 0.05) !important; animation: shake 0.4s; }
        .json-error-active::selection { background: #ef4444 !important; color: #fff !important; }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }
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
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70">
                        <span>v${currentVersion}</span>
                        ${isAuth ? '<span class="text-green-500">管理员模式</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center"><i class="fas fa-sun" id="themeIcon"></i></button>
                ${isAuth ? `
                <button onclick="exportData()" class="px-4 py-2 hover:bg-current/10 rounded-lg text-sm font-medium border border-current/10">导出</button>
                <button onclick="globalImport()" class="px-4 py-2 hover:bg-current/10 rounded-lg text-sm font-medium border border-current/10">导入</button>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition">保存并部署</button>
                ` : ''}
            </div>
        </header>

        <div id="app" class="space-y-8 pb-12"></div>
        ${isAuth ? \`<div class="py-10 text-center"><button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-current/20 hover:border-blue-500 text-current/50 hover:text-blue-500 transition font-bold flex items-center gap-2 mx-auto text-lg"><i class="fas fa-plus-circle"></i> 添加新分组</button></div>\` : ''}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const currentToken = "${token}";
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
            if (!raw || raw.length === 0) { app.innerHTML = '<div class="text-center py-20 opacity-50">暂无数据</div>'; return; }
            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-2xl p-6">
                    <div class="flex items-center justify-between mb-6 border-b border-current/10 pb-4">
                        <div class="flex-1">
                            \${isAuth ? \`<input class="text-xl font-bold bg-transparent outline-none w-full" value="\${g.group}" onchange="raw[\${gi}].group=this.value">\` : \`<h2 class="text-xl font-bold">\${g.group}</h2>\`}
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="editGroupChannels(\${gi})" class="p-2 text-green-500 hover:bg-green-500/10 rounded" title="编辑数据"><i class="fas fa-edit"></i></button>
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 text-blue-400 \${gi===0?'opacity-20 pointer-events-none':''}"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 text-blue-400 \${gi===raw.length-1?'opacity-20 pointer-events-none':''}"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 p-2"><i class="fas fa-trash-alt"></i></button>
                        </div>\` : ''}
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl" onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : ''}">
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                                <i class="fas fa-tv text-4xl mb-3 opacity-20 hidden"></i>
                                <h3 class="font-bold text-sm truncate w-full text-center">\${ch.name}</h3>
                            </div>
                        \`).join('')}
                        \${isAuth ? \`<div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed border-2 border-current/10 text-blue-500"><i class="fas fa-plus text-3xl"></i></div>\` : ''}
                    </div>
                </div>\`).join('');
        }

        // --- 核心优化：精确定位错误 ---
        async function editGroupChannels(gi) {
            const groupData = raw[gi];
            const isDark = currentTheme === 'dark';

            await Swal.fire({
                title: '编辑分组数据: ' + groupData.group,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '90%',
                html: \`
                    <div class="text-left">
                        <textarea id="json-editor" class="json-editor-area w-full h-[60vh] p-4 text-xs font-mono border rounded bg-transparent" spellcheck="false">\${JSON.stringify(groupData, null, 2)}</textarea>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '保存并验证',
                cancelButtonText: '取消',
                preConfirm: () => {
                    const editor = document.getElementById('json-editor');
                    const text = editor.value;
                    editor.classList.remove('json-error-active');

                    try {
                        const parsed = JSON.parse(text);
                        if (!parsed.group || !Array.isArray(parsed.channels)) throw new Error('结构非法');
                        raw[gi] = parsed;
                        return true;
                    } catch (e) {
                        const posMatch = e.message.match(/at position (\\d+)/);
                        editor.focus();
                        if (posMatch) {
                            const pos = parseInt(posMatch[1]);
                            // 高亮选中错误点（及其后一个字符）
                            editor.setSelectionRange(pos, pos + 1);
                        } else {
                            editor.select();
                        }
                        editor.classList.add('json-error-active');
                        // 强制返回 false 阻止关闭弹窗，不调用 Swal.showValidationMessage 以隐藏下方提示
                        return false;
                    }
                }
            }).then((result) => {
                if(result.isConfirmed) {
                    render();
                    Swal.fire({ icon:'success', title:'临时保存成功', timer:1500, showConfirmButton:false });
                }
            });
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }
        function moveGroup(i, dir) { const t=i+dir; if(t>=0 && t<raw.length){ [raw[i],raw[t]]=[raw[t],raw[i]]; render(); } }
        function deleteGroup(i) { Swal.fire({title:'确认删除?', icon:'warning', showCancelButton:true}).then(r=>{if(r.isConfirmed){raw.splice(i,1);render();}}); }
        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        function addChannel(gi) { raw[gi].channels.push({name:'新频道',id:'',logo:'',url:[]}); render(); }

        async function editChannel(gi, ci) {
            const ch = raw[gi].channels[ci];
            const { value, isDenied } = await Swal.fire({
                title: '编辑频道',
                html: \`<input id="n" class="swal2-input" value="\${ch.name}" placeholder="名称">
                       <input id="l" class="swal2-input" value="\${ch.logo}" placeholder="Logo">
                       <textarea id="u" class="swal2-textarea" style="height:150px" placeholder="源链接">\${ch.url.join('\\n')}</textarea>\`,
                showDenyButton: true, denyButtonText: '删除频道',
                preConfirm: () => ({ name: document.getElementById('n').value, logo: document.getElementById('l').value, url: document.getElementById('u').value.split('\\n').filter(x=>x) })
            });
            if(value) { raw[gi].channels[ci] = { ...ch, ...value }; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            btn.disabled = true;
            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({newData:raw}) });
                if(res.ok) Swal.fire('部署已触发', '请等待1-2分钟后生效', 'success');
                else throw new Error('操作失败');
            } catch(e) { Swal.fire('错误', e.message, 'error'); }
            finally { btn.disabled = false; }
        }

        function exportData() {
            const blob = new Blob([JSON.stringify(raw, null, 2)], {type:'application/json'});
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'channels.json'; a.click();
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
