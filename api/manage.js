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

    // 数据清洗：保留所有 URL，不进行去重处理
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
        :root {
            --glass-bg: rgba(255, 255, 255, 0.4);
            --glass-border: rgba(255, 255, 255, 0.5);
            --liquid-color: #3b82f6;
        }

        body { 
            transition: background 0.5s ease; 
            background-attachment: fixed;
            min-height: 100vh;
        }

        /* 液态玻璃背景 */
        body.theme-light { 
            background: 
                radial-gradient(at 0% 0%, rgba(191, 219, 254, 0.5) 0, transparent 50%),
                radial-gradient(at 100% 0%, rgba(254, 215, 170, 0.5) 0, transparent 50%),
                radial-gradient(at 50% 100%, rgba(221, 214, 254, 0.5) 0, transparent 50%),
                #f8fafc;
            color: #1e293b; 
        }
        
        body.theme-dark { 
            background: 
                radial-gradient(at 0% 0%, rgba(30, 58, 138, 0.3) 0, transparent 50%),
                radial-gradient(at 100% 0%, rgba(88, 28, 135, 0.3) 0, transparent 50%),
                radial-gradient(at 50% 100%, rgba(15, 23, 42, 1) 0, transparent 50%),
                #0f172a;
            color: #f1f5f9; 
            --glass-bg: rgba(30, 41, 59, 0.6);
            --glass-border: rgba(255, 255, 255, 0.1);
        }

        .glass-panel { 
            background: var(--glass-bg); 
            backdrop-filter: blur(25px) saturate(180%); 
            -webkit-backdrop-filter: blur(25px) saturate(180%);
            border: 1px solid var(--glass-border);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
        }

        .card { 
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(10px);
            transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
            height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative;
            border-radius: 1.25rem;
            overflow: hidden;
        }
        
        .card:hover {
            transform: translateY(-5px) scale(1.02);
            box-shadow: 0 15px 30px rgba(0,0,0,0.1);
            border-color: rgba(59, 130, 246, 0.5);
        }

        .card::before {
            content: "";
            position: absolute;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
            transform: rotate(45deg);
            pointer-events: none;
            transition: 0.6s;
        }
        .card:hover::before { transform: rotate(45deg) translate(10%, 10%); }

        .channel-logo { height: 60px; width: auto; object-fit: contain; margin-bottom: 12px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1)); pointer-events: none; }
        
        .text-error-red { color: #ef4444 !important; }
        .swal2-validation-message { display: none !important; }

        /* 动画 */
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.5s ease forwards; }
    </style>
</head>
<body class="theme-light p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-10 glass-panel p-6 rounded-3xl gap-6">
            <div class="flex items-center gap-5">
                <div class="w-14 h-14 bg-white/80 rounded-2xl flex items-center justify-center shadow-xl overflow-hidden border border-white/50 backdrop-blur-sm">
                    <img src="/jptv.png" class="w-10 h-10 object-contain" alt="JPTV">
                </div>
                <div>
                    <h1 class="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-500">JPTV 控制台</h1>
                    <div class="flex gap-2 text-xs font-mono mt-1 items-center">
                        <span id="version-display" class="opacity-60">v${currentVersion}</span>
                        ${isAuth ? '<span class="px-2 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-bold">Admin</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-4">
                <button onclick="toggleTheme()" class="w-12 h-12 rounded-2xl glass-panel flex items-center justify-center hover:scale-110 transition active:scale-95">
                    <i class="fas fa-sun text-xl" id="themeIcon"></i>
                </button>
                
                ${isAuth ? `
                <div class="flex items-center gap-2 glass-panel p-1.5 rounded-2xl">
                    <a href="/ipv6.m3u" target="_blank" title="原始 M3U" class="px-4 py-2 hover:bg-blue-500/10 rounded-xl transition text-sm font-bold flex items-center gap-2">
                        <i class="fas fa-list"></i> M3U
                    </a>
                    <a href="/ipv6.txt" target="_blank" title="原始 TXT" class="px-4 py-2 hover:bg-blue-500/10 rounded-xl transition text-sm font-bold flex items-center gap-2">
                        <i class="fas fa-file-alt"></i> TXT
                    </a>
                    <div class="w-px h-6 bg-current/10 mx-1"></div>
                    <button onclick="exportData()" class="px-4 py-2 hover:bg-current/5 rounded-xl transition flex items-center gap-2 text-sm font-medium">
                        <i class="fas fa-download"></i> 导出
                    </button>
                    <button onclick="globalImport()" class="px-4 py-2 hover:bg-current/5 rounded-xl transition flex items-center gap-2 text-sm font-medium">
                        <i class="fas fa-upload"></i> 导入
                    </button>
                </div>
                <button onclick="saveData()" id="saveBtn" class="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-8 py-3 rounded-2xl font-black shadow-lg shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存并部署
                </button>
                ` : `
                <div class="flex gap-3">
                    <a href="/ipv6.m3u" target="_blank" class="px-6 py-3 rounded-2xl font-bold glass-panel hover:bg-blue-500/10 transition flex items-center gap-2 text-sm"><i class="fas fa-file-code text-blue-500"></i> M3U 列表</a>
                    <a href="/ipv6.txt" target="_blank" class="px-6 py-3 rounded-2xl font-bold glass-panel hover:bg-blue-500/10 transition flex items-center gap-2 text-sm"><i class="fas fa-file-alt text-orange-500"></i> TXT 列表</a>
                </div>
                `}
            </div>
        </header>

        <div id="app" class="space-y-10 pb-16"></div>
        
        ${isAuth ? `
        <div class="py-10 text-center">
             <button onclick="addGroup()" class="px-10 py-5 rounded-3xl border-2 border-dashed border-blue-500/30 hover:border-blue-500 hover:bg-blue-500/5 text-blue-500/60 hover:text-blue-500 transition-all font-black flex items-center gap-3 mx-auto text-xl">
                <i class="fas fa-plus-circle"></i> 创建新分组
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
                        el.innerHTML = \`v\${currentVer} <span class="text-blue-500 ml-1">● Update Available</span>\`;
                    } else {
                        el.innerHTML = \`v\${currentVer} <span class="text-green-500 ml-1">● Latest</span>\`;
                    }
                }
            } catch(e) { console.log('Version check failed'); }
        }
        checkVersion();

        let currentTheme = localStorage.getItem('jptv_theme') || 'light';
        function applyTheme() {
            document.body.className = 'theme-' + currentTheme + ' p-4 md:p-8';
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
                app.innerHTML = '<div class="text-center py-32 opacity-30 text-2xl font-bold">暂无频道数据</div>';
                return;
            }

            app.innerHTML = raw.map((g, gi) => \`
                <div class="glass-panel rounded-[2.5rem] p-8 animate-fade-in" style="animation-delay: \${gi * 0.05}s">
                    <div class="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
                        <div class="flex-1 max-w-2xl">
                            \${isAuth 
                                ? \`<input class="text-2xl font-black bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition-all w-full placeholder-current/20" 
                                    value="\${g.group}" 
                                    onchange="updateGroup(\${gi}, this.value)" 
                                    placeholder="输入分组名称...">\` 
                                : \`<h2 class="text-2xl font-black flex items-center gap-3"><span class="w-2 h-8 bg-blue-500 rounded-full"></span> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-2">
                            <button onclick="editGroupChannels(\${gi})" class="p-3 text-emerald-500 hover:bg-emerald-500/10 rounded-2xl transition" title="编辑原始 JSON"><i class="fas fa-code"></i></button>
                            <div class="flex gap-1 glass-panel p-1 rounded-xl">
                                <button onclick="moveGroup(\${gi}, -1)" class="p-2 hover:bg-current/10 rounded-lg transition \${gi === 0 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-chevron-up"></i></button>
                                <button onclick="moveGroup(\${gi}, 1)" class="p-2 hover:bg-current/10 rounded-lg transition \${gi === raw.length - 1 ? 'opacity-20 pointer-events-none' : ''}"><i class="fas fa-chevron-down"></i></button>
                            </div>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-3 rounded-2xl transition"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-6">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card group" 
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
                                <i class="fas fa-tv text-4xl mb-3 opacity-10 hidden"></i>
                                
                                <div class="text-center w-full px-2 z-10 pointer-events-none">
                                    <h3 class="font-bold text-sm truncate opacity-90">\${ch.name}</h3>
                                    \${Array.isArray(ch.url) && ch.url.length > 1 ? '<span class="text-[10px] bg-blue-500/20 text-blue-500 px-1.5 rounded-md font-mono mt-1 inline-block">MULTI</span>' : ''}
                                </div>
                            </div>
                        \`).join('')}
                        
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card border-dashed bg-transparent hover:bg-blue-500/5 border-blue-500/30 text-blue-500 group">
                            <i class="fas fa-plus-circle text-3xl mb-2 group-hover:scale-110 transition"></i>
                            <span class="font-bold text-sm">新增频道</span>
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
                title: \`编辑分组: \${groupData.group}\`,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '85%',
                html: \`
                    <div class="text-left">
                        <p class="text-xs opacity-50 mb-3">支持多 URL 格式，直接编辑 JSON 内容即可。</p>
                        <textarea id="group-json-editor" 
                            class="w-full h-[550px] p-5 text-sm font-mono border rounded-2xl bg-black/5 dark:bg-black/20 outline-none focus:ring-2 ring-blue-500/30 transition-all leading-relaxed" 
                            spellcheck="false">\${JSON.stringify(groupData, null, 2)}</textarea>
                    </div>
                \`,
                showCancelButton: true,
                confirmButtonText: '立即应用',
                didOpen: () => {
                    const editor = document.getElementById('group-json-editor');
                    editor.addEventListener('input', () => editor.classList.remove('text-error-red'));
                },
                preConfirm: () => {
                    const editor = document.getElementById('group-json-editor');
                    try {
                        const parsed = JSON.parse(editor.value);
                        if (!parsed.group || !Array.isArray(parsed.channels)) throw new Error('结构不符合规范');
                        return parsed;
                    } catch (e) {
                        editor.classList.add('text-error-red');
                        Swal.showValidationMessage('JSON 语法错误或结构不完整');
                        return false;
                    }
                }
            });

            if (jsonText) {
                raw[gi] = jsonText;
                render();
            }
        }

        function exportData() {
            const dataStr = JSON.stringify(raw, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = \`jptv_data_\${new Date().toISOString().slice(0,10)}.json\`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }

        async function globalImport() {
            const isDark = currentTheme === 'dark';
            const { value: text } = await Swal.fire({
                title: '数据导入',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                html: \`
                    <div class="text-left space-y-4">
                        <textarea id="import-text" class="w-full h-48 p-4 text-xs font-mono border rounded-2xl bg-black/5 outline-none focus:ring-2 ring-blue-500" placeholder="在此粘贴 JSON 数据..."></textarea>
                        <input type="file" id="import-file" accept=".json" class="text-xs block w-full text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
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
                }
            });

            if (text) {
                try {
                    const jsonData = JSON.parse(text);
                    raw = Array.isArray(jsonData) ? jsonData : [jsonData];
                    render();
                    Swal.fire({ icon: 'success', title: '导入成功', timer: 1000 });
                } catch (e) { Swal.fire({ icon: 'error', title: '解析失败', text: '请检查 JSON 格式' }); }
            }
        }

        function dragStart(e, gi, ci) { dragSrc = { gi, ci }; e.target.classList.add('opacity-50'); }
        function dragOver(e) { if (e.preventDefault) e.preventDefault(); return false; }
        function dragEnter(e) { e.target.closest('.card')?.classList.add('bg-blue-500/10', 'border-blue-500'); }
        function dragLeave(e) { e.target.closest('.card')?.classList.remove('bg-blue-500/10', 'border-blue-500'); }
        function dragEnd(e) { e.target.classList.remove('opacity-50'); document.querySelectorAll('.card').forEach(el => el.classList.remove('bg-blue-500/10', 'border-blue-500')); }
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
            Swal.fire({ title: '确认删除?', text: '该分组下的所有频道将被移除', icon: 'warning', showCancelButton: true, confirmButtonText: '确定删除', confirmButtonColor: '#ef4444' }).then(r => {
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
                title: isNew ? '✨ 添加新频道' : '📝 编辑频道',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#fff' : '#333',
                width: '600px',
                html: \`
                    <div class="space-y-5 text-left mt-4">
                        <div>
                            <label class="text-xs font-bold opacity-50 ml-1">频道名称</label>
                            <input id="s-name" class="w-full p-3 mt-1 border rounded-2xl bg-black/5 outline-none focus:ring-2 ring-blue-500/30" value="\${ch.name}">
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-xs font-bold opacity-50 ml-1">唯一标识 ID</label>
                                <input id="s-id" class="w-full p-3 mt-1 border rounded-2xl bg-black/5 outline-none focus:ring-2 ring-blue-500/30" value="\${ch.id}">
                            </div>
                            <div class="flex-1">
                                <label class="text-xs font-bold opacity-50 ml-1">Logo 文件名/URL</label>
                                <input id="s-logo" class="w-full p-3 mt-1 border rounded-2xl bg-black/5 outline-none focus:ring-2 ring-blue-500/30" value="\${ch.logo||''}">
                            </div>
                        </div>
                        <div>
                            <label class="text-xs font-bold opacity-50 ml-1">播放源地址 (每行一个)</label>
                            <textarea id="s-url" class="w-full p-4 mt-1 border rounded-2xl bg-black/5 font-mono text-xs h-40 outline-none focus:ring-2 ring-blue-500/30" placeholder="http://...">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                        </div>
                    </div>\`,
                showDenyButton: !isNew,
                denyButtonText: '删除频道', 
                confirmButtonText: '保存更改', 
                confirmButtonColor: '#3b82f6',
                showCancelButton: true,
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const urls = document.getElementById('s-url').value.split('\\n').filter(x=>x.trim());
                    if(!name || urls.length === 0) {
                        Swal.showValidationMessage('名称和至少一个 URL 是必填项');
                        return false;
                    }
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
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 正在部署...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) Swal.fire({ icon: 'success', title: '部署已触发', text: 'Vercel 正在后台构建，预计 1 分钟后生效', confirmButtonColor: '#3b82f6' });
                else throw new Error('同步到环境变量失败');
            } catch (e) {
                Swal.fire({icon: 'error', title: '部署失败', text: e.message});
            } finally {
                btn.innerHTML = original; btn.disabled = false;
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