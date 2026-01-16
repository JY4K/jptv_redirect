import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';
import fetch from 'node-fetch';

/**
 * 格式化 M3U 内容 (支持多 URL)
 */
function generateM3U(channels) {
    let m3u = "#EXTM3U\n";
    channels.forEach(g => {
        g.channels.forEach(ch => {
            const urls = Array.isArray(ch.url) ? ch.url : [ch.url];
            const logo = ch.logo ? (ch.logo.startsWith('http') ? ch.logo : `https://gcore.jsdelivr.net/gh/fanmingming/live/tv/${ch.logo}.png`) : '';
            urls.forEach(url => {
                m3u += `#EXTINF:-1 tvg-id="${ch.id || ''}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${g.group}",${ch.name}\n${url}\n`;
            });
        });
    });
    return m3u;
}

/**
 * 格式化 TXT 内容 (支持多 URL)
 */
function generateTXT(channels) {
    let txt = "";
    channels.forEach(g => {
        txt += `${g.group},#genre#\n`;
        g.channels.forEach(ch => {
            const urls = Array.isArray(ch.url) ? ch.url : [ch.url];
            urls.forEach(url => {
                txt += `${ch.name},${url}\n`;
            });
        });
        txt += "\n";
    });
    return txt;
}

export default async function handler(req, res) {
    const { url, method, query } = req;
    const token = query.token || '';
    const isAuth = token === config.adminToken;
    const currentVersion = config.currentVersion;

    // 获取数据源
    let channels = [];
    try {
        channels = getChannels();
    } catch (e) {
        console.error("Data load error:", e);
    }

    // --- 1. 处理 M3U / TXT 纯文本访问 (仅限管理员 Token) ---
    const isM3UReq = url.includes('ipv6.m3u') || query.format === 'm3u';
    const isTXTReq = url.includes('ipv6.txt') || query.format === 'txt';

    if (isM3UReq || isTXTReq) {
        if (!isAuth) return res.status(401).send('Unauthorized: Invalid Admin Token');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(isM3UReq ? generateM3U(channels) : generateTXT(channels));
    }

    // --- 2. 处理管理员数据保存 (POST) ---
    if (method === 'POST') {
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
            })).filter(g => g.group && g.group.trim() !== '' && g.channels.length > 0);
        }

        const { projectId, token: vToken } = config.platform;
        if (!projectId || !vToken) return res.status(500).json({ error: '未配置 Vercel 环境变量' });

        try {
            const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
            const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
            const projectData = await projectRes.json();

            const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers: commonHeaders });
            const listData = await listRes.json();
            const targetEnvIds = listData.envs ? listData.envs.filter(e => e.key === 'CHANNELS_DATA').map(e => e.id) : [];

            for (const id of targetEnvIds) {
                await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${id}`, { method: 'DELETE', headers: commonHeaders });
            }

            await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
                method: 'POST', headers: commonHeaders,
                body: JSON.stringify({ key: 'CHANNELS_DATA', value: JSON.stringify(newData), type: 'encrypted', target: ['production', 'preview', 'development'] })
            });

            await fetch(`https://api.vercel.com/v13/deployments`, {
                method: 'POST', headers: commonHeaders,
                body: JSON.stringify({
                    name: 'jptv-update', project: projectId, target: 'production',
                    gitSource: { type: projectData.link.type, repoId: projectData.link.repoId, ref: projectData.targets?.production?.gitBranch || 'main' }
                })
            });
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- 3. 渲染界面 (支持管理员模式与只读模式) ---
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
        .theme-light .card { background: rgba(255, 255, 255, 0.9); border: 1px solid #e5e7eb; }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(20px); }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .card { cursor: pointer; transition: all 0.2s ease; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
        .channel-logo { height: 64px; width: auto; object-fit: contain; margin-bottom: 12px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); pointer-events: none; }
        .dragging { opacity: 0.4; border: 2px dashed #3b82f6 !important; }
        .drag-over { border: 2px solid #3b82f6 !important; transform: scale(1.02); }
    </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg overflow-hidden border border-gray-100">
                    <img src="/jptv.png" class="w-10 h-10 object-contain" alt="JPTV">
                </div>
                <div>
                    <h1 class="text-2xl font-bold">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 opacity-70">
                        <span id="version-display">v${currentVersion}</span>
                        ${isAuth ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-600 rounded">管理员</span>' : '<span class="px-2 py-0.5 bg-gray-500/20 text-gray-500 rounded">只读模式</span>'}
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-3">
                <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-current/10 hover:bg-current/20 flex items-center justify-center transition">
                    <i class="fas fa-sun" id="themeIcon"></i>
                </button>
                
                ${isAuth ? `
                <div class="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                    <a href="/api/manage?token=${token}&format=m3u" target="_blank" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium">
                        <i class="fas fa-list"></i> M3U 订阅
                    </a>
                    <a href="/api/manage?token=${token}&format=txt" target="_blank" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium">
                        <i class="fas fa-file-lines"></i> TXT 订阅
                    </a>
                    <div class="w-px h-4 bg-current/10 mx-1"></div>
                    <button onclick="exportData()" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium"><i class="fas fa-download"></i> 备份</button>
                    <button onclick="globalImport()" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium"><i class="fas fa-upload"></i> 导入</button>
                </div>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存并部署
                </button>
                ` : `
                <div class="flex gap-2">
                    <a href="/ipv6.m3u" target="_blank" class="px-5 py-2 rounded-xl font-bold bg-current/10 hover:bg-current/20 transition flex items-center gap-2 text-sm"><i class="fas fa-file-code"></i> 公开 M3U</a>
                    <a href="/ipv6.txt" target="_blank" class="px-5 py-2 rounded-xl font-bold bg-current/10 hover:bg-current/20 transition flex items-center gap-2 text-sm"><i class="fas fa-file-alt"></i> 公开 TXT</a>
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
        const repoApi = "${config.repoApiUrl}";
        let dragSrc = null;

        // 主题管理
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

        // 渲染页面
        function render() {
            const app = document.getElementById('app');
            if (!raw.length) { app.innerHTML = '<div class="text-center py-20 opacity-50">暂无数据</div>'; return; }

            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-2xl p-6">
                    <div class="flex items-center justify-between mb-6 border-b border-current/10 pb-4">
                        \${isAuth 
                            ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" 
                                      value="\${g.group}" onchange="raw[\${gi}].group=this.value" placeholder="分组名称">\`
                            : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${g.group}</h2>\`
                        }
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 text-blue-400 \${gi===0?'opacity-20':''}"><i class="fas fa-arrow-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 text-blue-400 \${gi===raw.length-1?'opacity-20':''}"><i class="fas fa-arrow-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 p-2"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card rounded-xl" 
                                 \${isAuth ? \`draggable="true" ondragstart="dragStart(event,\${gi},\${ci})" ondragover="event.preventDefault()" ondrop="dragDrop(event,\${gi},\${ci})"\` : ''}
                                 onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo" onerror="this.src='/jptv.png'">
                                <div class="text-center w-full px-2"><h3 class="font-bold text-sm truncate">\${ch.name}</h3></div>
                            </div>
                        \`).join('')}
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed border-2 opacity-50 hover:opacity-100 text-blue-500">
                            <i class="fas fa-plus text-3xl mb-2"></i><span class="font-bold text-sm">添加频道</span>
                        </div>
                        \` : ''}
                    </div>
                </div>
            \`).join('');
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        function copyLink(id) {
            const link = window.location.origin + '/jptv.php?id=' + id;
            navigator.clipboard.writeText(link);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '链接已复制', showConfirmButton: false, timer: 1500 });
        }

        // 管理员专用函数
        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci] || {name:'', id:'', logo:'', url:[]};
            const { value, isDenied } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                background: currentTheme === 'dark' ? '#1e293b' : '#fff', color: currentTheme === 'dark' ? '#fff' : '#333',
                html: \`<div class="space-y-4 text-left">
                        <input id="s-name" placeholder="名称" class="w-full p-2 border rounded bg-transparent" value="\${ch.name}">
                        <div class="flex gap-2">
                            <input id="s-id" placeholder="ID" class="flex-1 p-2 border rounded bg-transparent" value="\${ch.id}">
                            <input id="s-logo" placeholder="Logo" class="flex-1 p-2 border rounded bg-transparent" value="\${ch.logo}">
                        </div>
                        <textarea id="s-url" class="w-full p-2 border rounded bg-transparent font-mono text-xs h-32" placeholder="每行一个URL">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                      </div>\`,
                showDenyButton: !isNew, denyButtonText: '删除', confirmButtonText: '保存', showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || !urls.length) return Swal.showValidationMessage('名称和 URL 不能为空');
                    return { name, id: document.getElementById('s-id').value, logo: document.getElementById('s-logo').value, url: urls };
                }
            });
            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
        }

        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('dragging'); }
        function dragDrop(e, tgi, tci) {
            const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[tgi].channels.splice(tci, 0, item);
            render();
        }

        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        function addChannel(gi) { editChannel(gi, raw[gi].channels.length, true); }
        function moveGroup(i, d) { if(raw[i+d]) { [raw[i], raw[i+d]] = [raw[i+d], raw[i]]; render(); } }
        function deleteGroup(i) { Swal.fire({title:'删除分组?', icon:'warning', showCancelButton:true}).then(r => { if(r.isConfirmed) { raw.splice(i, 1); render(); } }); }

        function exportData() {
            const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = "jptv_backup.json"; a.click();
        }
        async function globalImport() {
            const { value: text } = await Swal.fire({ title: '导入 JSON', input: 'textarea' });
            if (text) { try { raw = JSON.parse(text); render(); } catch(e) { Swal.fire('解析失败'); } }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 部署中...'; btn.disabled = true;
            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) Swal.fire({ icon: 'success', title: '部署已触发' });
                else throw new Error('保存失败');
            } catch (e) { Swal.fire('错误', e.message, 'error'); } 
            finally { btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> 保存并部署'; btn.disabled = false; }
        }

        render();
    </script>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}