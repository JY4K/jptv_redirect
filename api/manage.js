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

    if (!projectId || !vToken) {
      return res.status(500).json({ error: '未配置 Vercel API 环境变量' });
    }

    try {
      const commonHeaders = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers: commonHeaders });
      if (!projectRes.ok) throw new Error('无法获取项目信息');
      const projectData = await projectRes.json();

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
        :root {
            --glass-bg: rgba(255, 255, 255, 0.45);
            --glass-border: rgba(255, 255, 255, 0.6);
            --accent-color: #3b82f6;
        }

        body { 
            margin: 0; min-height: 100vh;
            background-attachment: fixed;
            transition: background 0.5s ease;
            font-family: 'Inter', -apple-system, system-ui, sans-serif;
        }

        body.theme-light { 
            background: 
                radial-gradient(at 0% 0%, rgba(191, 219, 254, 0.8) 0, transparent 50%),
                radial-gradient(at 100% 0%, rgba(254, 215, 170, 0.7) 0, transparent 50%),
                radial-gradient(at 50% 100%, rgba(221, 214, 254, 0.8) 0, transparent 60%),
                #f8fafc;
            color: #0f172a; 
        }
        
        body.theme-dark { 
            background: 
                radial-gradient(at 0% 0%, rgba(30, 58, 138, 0.5) 0, transparent 50%),
                radial-gradient(at 100% 100%, rgba(88, 28, 135, 0.5) 0, transparent 50%),
                #020617;
            color: #f1f5f9; 
            --glass-bg: rgba(15, 23, 42, 0.75);
            --glass-border: rgba(255, 255, 255, 0.08);
        }

        .liquid-frosted {
            background: var(--glass-bg);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border: 1px solid var(--glass-border);
            position: relative;
            overflow: hidden;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.08);
        }

        .liquid-frosted::after {
            content: "";
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            opacity: 0.03;
            pointer-events: none;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .card { 
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(20px);
            transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border-radius: 1.25rem;
        }
        
        .card:hover {
            transform: translateY(-8px) scale(1.02);
            background: rgba(255, 255, 255, 0.6);
            box-shadow: 0 20px 40px rgba(0,0,0,0.12);
            border-color: var(--accent-color);
        }
        .theme-dark .card:hover { background: rgba(255, 255, 255, 0.12); }

        .btn-raw {
            background: rgba(148, 163, 184, 0.12);
            border: 1px solid rgba(148, 163, 184, 0.2);
            transition: all 0.3s;
            cursor: pointer;
        }
        .btn-raw:hover {
            background: var(--accent-color);
            color: white !important;
            transform: scale(1.05);
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
        }

        input, textarea {
            background: rgba(0,0,0,0.05) !important;
            backdrop-filter: blur(5px);
        }
        .theme-dark input, .theme-dark textarea {
            background: rgba(255,255,255,0.05) !important;
        }
    </style>
</head>
<body class="theme-light p-4 md:p-8">
    <div class="max-w-[1400px] mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-10 liquid-frosted p-6 rounded-[2.5rem]">
            <div class="flex items-center gap-5">
                <div class="w-14 h-14 bg-white/90 rounded-2xl flex items-center justify-center shadow-inner p-2">
                    <img src="/jptv.png" class="w-full h-full object-contain" alt="Logo">
                </div>
                <div>
                    <h1 class="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-indigo-600">JPTV 管理系统</h1>
                    <span class="text-[10px] font-mono opacity-50 tracking-widest uppercase">Release v${currentVersion}</span>
                </div>
            </div>
            
            <div class="flex flex-wrap items-center justify-center gap-3 mt-4 lg:mt-0">
                <button onclick="toggleTheme()" class="w-11 h-11 rounded-xl liquid-frosted flex items-center justify-center hover:scale-110 transition shadow-sm">
                    <i class="fas fa-moon" id="themeIcon"></i>
                </button>
                
                <div class="flex items-center gap-2 liquid-frosted p-1.5 rounded-2xl">
                    <button onclick="exportData('m3u')" class="btn-raw px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                        <i class="fas fa-list-ul"></i> M3U 导出
                    </button>
                    <button onclick="exportData('txt')" class="btn-raw px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                        <i class="fas fa-file-code"></i> TXT 导出
                    </button>
                </div>
                
                ${isAuth ? `
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-500 text-white px-7 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存并部署
                </button>
                ` : ''}
            </div>
        </header>

        <div id="app" class="space-y-10 pb-20"></div>
        
        ${isAuth ? `
        <div class="fixed bottom-10 left-1/2 -translate-x-1/2 z-50">
             <button onclick="addGroup()" class="px-8 py-4 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/30 shadow-2xl text-blue-500 font-black flex items-center gap-3 hover:scale-110 transition-all active:scale-95">
                <i class="fas fa-plus-circle"></i> 新增分组
            </button>
        </div>
        ` : ''}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";

        // 主题切换
        function applyTheme() {
            const theme = localStorage.getItem('jptv_theme') || 'light';
            document.body.className = 'theme-' + theme + ' p-4 md:p-8';
            document.getElementById('themeIcon').className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
        function toggleTheme() {
            const current = localStorage.getItem('jptv_theme') === 'dark' ? 'light' : 'dark';
            localStorage.setItem('jptv_theme', current);
            applyTheme();
        }
        applyTheme();

        // 渲染逻辑
        function render() {
            const app = document.getElementById('app');
            app.innerHTML = raw.map((g, gi) => \`
                <div class="liquid-frosted rounded-[2.5rem] p-8">
                    <div class="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
                        <div class="flex-1">
                            \${isAuth 
                                ? \`<input class="text-2xl font-black bg-transparent outline-none w-full focus:text-blue-500 transition-colors" value="\${g.group}" onchange="raw[\${gi}].group=this.value">\` 
                                : \`<h2 class="text-2xl font-black flex items-center gap-3"><span class="w-1.5 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-2">
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 hover:bg-white/10 rounded-lg transition"><i class="fas fa-chevron-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 hover:bg-white/10 rounded-lg transition"><i class="fas fa-chevron-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-2 rounded-lg transition"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-5">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card p-4 flex flex-col items-center justify-center relative min-h-[140px] cursor-pointer" onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <div class="w-14 h-14 mb-3 flex items-center justify-center">
                                    <img src="\${getLogoUrl(ch.logo)}" class="max-w-full max-h-full object-contain filter drop-shadow-md" onerror="this.src='https://gcore.jsdelivr.net/gh/fanmingming/live/tv/null.png'">
                                </div>
                                <h3 class="text-xs font-bold truncate w-full text-center opacity-90">\${ch.name}</h3>
                                \${Array.isArray(ch.url) && ch.url.length > 1 ? '<span class="absolute top-2 right-2 px-1.5 py-0.5 bg-blue-500 text-white rounded text-[8px] font-black shadow-sm">MULTI</span>' : ''}
                            </div>
                        \`).join('')}
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card border-dashed bg-transparent hover:bg-blue-500/10 border-blue-500/40 text-blue-500 flex flex-col items-center justify-center min-h-[140px]">
                            <i class="fas fa-plus text-xl mb-1"></i>
                            <span class="text-[10px] font-bold uppercase tracking-wider">Add Channel</span>
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

        // 导出 M3U/TXT 核心逻辑
        function exportData(type) {
            let content = "";
            if (type === 'm3u') {
                content = "#EXTM3U\\n";
                raw.forEach(g => {
                    g.channels.forEach(ch => {
                        const urls = Array.isArray(ch.url) ? ch.url : [ch.url];
                        urls.forEach(url => {
                            content += \`#EXTINF:-1 tvg-id="\${ch.id}" tvg-name="\${ch.name}" tvg-logo="\${getLogoUrl(ch.logo)}" group-title="\${g.group}",\${ch.name}\\n\${url}\\n\`;
                        });
                    });
                });
            } else {
                raw.forEach(g => {
                    content += \`\${g.group},#genre#\\n\`;
                    g.channels.forEach(ch => {
                        const urls = Array.isArray(ch.url) ? ch.url : [ch.url];
                        urls.forEach(url => {
                            content += \`\${ch.name},\${url}\\n\`;
                        });
                    });
                });
            }

            const blob = new Blob([content], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = type === 'm3u' ? 'channels.m3u' : 'channels.txt';
            a.click();
            window.URL.revokeObjectURL(url);
        }

        async function editChannel(gi, ci) {
            const ch = raw[gi].channels[ci];
            const isDark = document.body.classList.contains('theme-dark');
            const { value: formValues } = await Swal.fire({
                title: '频道管理',
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#f1f5f9' : '#1e293b',
                html: \`
                    <div class="text-left space-y-4 pt-4">
                        <input id="sw-name" class="w-full p-4 rounded-xl border-none outline-none focus:ring-2 ring-blue-500 shadow-inner" placeholder="频道名称" value="\${ch.name}">
                        <input id="sw-id" class="w-full p-4 rounded-xl border-none outline-none focus:ring-2 ring-blue-500 shadow-inner" placeholder="唯一 ID (tvg-id)" value="\${ch.id}">
                        <input id="sw-logo" class="w-full p-4 rounded-xl border-none outline-none focus:ring-2 ring-blue-500 shadow-inner" placeholder="Logo 文件名或完整 URL" value="\${ch.logo||''}">
                        <textarea id="sw-url" class="w-full h-40 p-4 rounded-xl border-none font-mono text-xs outline-none focus:ring-2 ring-blue-500 shadow-inner" placeholder="播放源 (每行一个)">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                    </div>\`,
                showCancelButton: true,
                showDenyButton: true,
                denyButtonText: '删除频道',
                confirmButtonText: '保存修改',
                customClass: {
                    confirmButton: 'bg-blue-600 rounded-xl px-6 py-3',
                    cancelButton: 'bg-gray-500 rounded-xl px-6 py-3',
                    denyButton: 'bg-red-500 rounded-xl px-6 py-3'
                },
                preConfirm: () => ({
                    name: document.getElementById('sw-name').value,
                    id: document.getElementById('sw-id').value,
                    logo: document.getElementById('sw-logo').value,
                    url: document.getElementById('sw-url').value.split('\\n').filter(u => u.trim())
                })
            });

            if (formValues) { 
                raw[gi].channels[ci] = formValues; 
                render(); 
            } else if (Swal.DismissReason.deny || (await Swal.getDenyButton()?.clicked)) { 
                raw[gi].channels.splice(ci, 1); 
                render(); 
            }
        }

        function addChannel(gi) { raw[gi].channels.push({name:'新频道', id:'', logo:'', url:[]}); render(); }
        function addGroup() { raw.push({group:'新分组', channels:[]}); render(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
        function deleteGroup(gi) { Swal.fire({ title: '确定删除该分组吗?', icon: 'warning', showCancelButton: true }).then(r => { if(r.isConfirmed) { raw.splice(gi, 1); render(); } }); }
        
        function moveGroup(gi, dir) {
            const target = gi + dir;
            if(target >= 0 && target < raw.length) { [raw[gi], raw[target]] = [raw[target], raw[gi]]; render(); }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const old = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 部署中...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) Swal.fire({ icon: 'success', title: '保存成功', text: 'Vercel 已开始构建，请在 1 分钟后刷新查看' });
                else throw new Error('保存失败，请检查环境变量配置');
            } catch (e) {
                Swal.fire({ icon: 'error', title: '错误', text: e.message });
            } finally {
                btn.innerHTML = old; btn.disabled = false;
            }
        }

        function copyLink(id) {
            const link = window.location.origin + '/jptv.php?id=' + id;
            navigator.clipboard.writeText(link);
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: '播放链接已复制', showConfirmButton: false, timer: 1500 });
        }

        render();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}