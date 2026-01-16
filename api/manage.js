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
        }

        /* 动态液态背景 */
        body {
            margin: 0; min-height: 100vh;
            background: #f0f2f5;
            overflow-x: hidden;
            background-attachment: fixed;
        }

        body.theme-light {
            background: 
                radial-gradient(circle at 0% 0%, rgba(100, 180, 255, 0.15) 0%, transparent 40%),
                radial-gradient(circle at 100% 100%, rgba(255, 150, 200, 0.15) 0%, transparent 40%),
                radial-gradient(circle at 50% 50%, rgba(200, 100, 255, 0.05) 0%, transparent 60%),
                #f8fafc;
            color: #1e293b;
        }

        body.theme-dark {
            background: 
                radial-gradient(circle at 0% 100%, rgba(30, 50, 100, 0.4) 0%, transparent 50%),
                radial-gradient(circle at 100% 0%, rgba(60, 20, 80, 0.4) 0%, transparent 50%),
                #0f172a;
            color: #f1f5f9;
            --glass-bg: rgba(30, 41, 59, 0.65);
            --glass-border: rgba(255, 255, 255, 0.08);
        }

        /* 磨砂玻璃质感升级 */
        .frosted-glass {
            background: var(--glass-bg);
            backdrop-filter: blur(20px) saturate(160%);
            -webkit-backdrop-filter: blur(20px) saturate(160%);
            border: 1px solid var(--glass-border);
            position: relative;
            overflow: hidden;
        }

        /* 增加微小磨砂颗粒感 */
        .frosted-glass::after {
            content: "";
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            opacity: 0.03;
            pointer-events: none;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
        }

        .card {
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border-radius: 1.5rem;
            cursor: pointer;
        }
        
        .card:hover {
            transform: scale(1.03) translateY(-8px);
            background: rgba(255, 255, 255, 0.6);
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }

        .theme-dark .card:hover { background: rgba(50, 60, 80, 0.8); }

        .btn-redirect {
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            color: #3b82f6;
            transition: all 0.3s;
        }
        .btn-redirect:hover {
            background: #3b82f6;
            color: white;
            box-shadow: 0 0 15px rgba(59, 130, 246, 0.4);
        }

        @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-10px); } 100% { transform: translateY(0px); } }
        .float-anim { animation: float 6s ease-in-out infinite; }
    </style>
</head>
<body class="theme-light p-4 md:p-8 font-sans">
    <div class="max-w-7xl mx-auto">
        <header class="flex flex-col lg:flex-row justify-between items-center mb-12 frosted-glass p-8 rounded-[2.5rem] shadow-2xl">
            <div class="flex items-center gap-6">
                <div class="w-16 h-16 bg-white/90 rounded-2xl flex items-center justify-center shadow-inner p-2">
                    <img src="/jptv.png" class="w-full h-full object-contain" alt="Logo">
                </div>
                <div>
                    <h1 class="text-3xl font-black tracking-tighter">JPTV 控制中心</h1>
                    <p class="text-sm opacity-50 font-mono">Build: ${currentVersion}</p>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-center gap-4 mt-6 lg:mt-0">
                <button onclick="toggleTheme()" class="w-12 h-12 rounded-2xl frosted-glass flex items-center justify-center hover:rotate-12 transition shadow-lg">
                    <i class="fas fa-palette text-xl" id="themeIcon"></i>
                </button>

                ${isAuth ? `
                <div class="flex items-center gap-2 frosted-glass p-1.5 rounded-2xl">
                    <a href="/m3u.php" target="_blank" class="btn-redirect px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2">
                        <i class="fas fa-link"></i> M3U 重定向版
                    </a>
                    <a href="/txt.php" target="_blank" class="btn-redirect px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2">
                        <i class="fas fa-external-link-alt"></i> TXT 重定向版
                    </a>
                </div>
                
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-2xl font-black shadow-lg shadow-blue-500/30 transition active:scale-95 flex items-center gap-2">
                    <i class="fas fa-rocket"></i> 保存并部署
                </button>
                ` : `
                <div class="flex gap-4">
                    <a href="/m3u.php" target="_blank" class="px-6 py-3 rounded-2xl frosted-glass font-bold text-sm hover:bg-blue-500/10 transition">M3U 列表</a>
                    <a href="/txt.php" target="_blank" class="px-6 py-3 rounded-2xl frosted-glass font-bold text-sm hover:bg-blue-500/10 transition">TXT 列表</a>
                </div>
                `}
            </div>
        </header>

        <div id="app" class="space-y-12"></div>

        ${isAuth ? `
        <div class="mt-12 text-center pb-20">
            <button onclick="addGroup()" class="frosted-glass px-12 py-6 rounded-3xl border-2 border-dashed border-blue-500/30 text-blue-500 hover:border-blue-500 hover:bg-blue-500/5 transition-all font-black text-lg">
                <i class="fas fa-plus-circle mr-2"></i> 新增频道分组
            </button>
        </div>
        ` : ''}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";

        function toggleTheme() {
            const body = document.body;
            if (body.classList.contains('theme-light')) {
                body.classList.replace('theme-light', 'theme-dark');
                localStorage.setItem('jptv_theme', 'dark');
            } else {
                body.classList.replace('theme-dark', 'theme-light');
                localStorage.setItem('jptv_theme', 'light');
            }
        }
        
        if (localStorage.getItem('jptv_theme') === 'dark') {
            document.body.classList.replace('theme-light', 'theme-dark');
        }

        function render() {
            const app = document.getElementById('app');
            app.innerHTML = raw.map((g, gi) => \`
                <section class="frosted-glass rounded-[3rem] p-8 md:p-12 shadow-xl">
                    <div class="flex items-center justify-between mb-10 border-b border-white/10 pb-6">
                        <div class="flex-1">
                            \${isAuth 
                                ? \`<input class="text-3xl font-black bg-transparent outline-none w-full focus:text-blue-500 transition-colors" value="\${g.group}" onchange="raw[\${gi}].group=this.value">\`
                                : \`<h2 class="text-3xl font-black">\${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex gap-2">
                             <button onclick="moveGroup(\${gi}, -1)" class="w-10 h-10 rounded-full frosted-glass hover:bg-white/20 transition"><i class="fas fa-arrow-up text-xs"></i></button>
                             <button onclick="moveGroup(\${gi}, 1)" class="w-10 h-10 rounded-full frosted-glass hover:bg-white/20 transition"><i class="fas fa-arrow-down text-xs"></i></button>
                             <button onclick="deleteGroup(\${gi})" class="w-10 h-10 rounded-full frosted-glass text-red-400 hover:bg-red-500/10 transition"><i class="fas fa-trash-alt text-xs"></i></button>
                        </div>
                        \` : ''}
                    </div>
                    
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card p-4 flex flex-col items-center justify-center text-center group relative h-40" onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                <div class="w-16 h-16 mb-4 flex items-center justify-center">
                                    <img src="\${getLogoUrl(ch.logo)}" class="max-w-full max-h-full object-contain filter drop-shadow-md group-hover:scale-110 transition-transform duration-500" onerror="this.src='https://raw.githubusercontent.com/youshandefeiyang/IPTV/main/logo/null.png'">
                                </div>
                                <span class="text-xs font-bold leading-tight line-clamp-2 opacity-80">\${ch.name}</span>
                                \${Array.isArray(ch.url) && ch.url.length > 1 ? \`<div class="absolute top-2 right-2 px-1.5 py-0.5 bg-blue-500/20 text-blue-500 rounded text-[8px] font-black">MULTI</div>\` : ''}
                            </div>
                        \`).join('')}
                        \${isAuth ? \`
                        <div class="card p-4 flex flex-col items-center justify-center border-dashed border-2 border-blue-500/20 text-blue-500/50 hover:text-blue-500" onclick="addChannel(\${gi})">
                            <i class="fas fa-plus text-2xl mb-2"></i>
                            <span class="text-xs font-bold">添加频道</span>
                        </div>
                        \` : ''}
                    </div>
                </section>
            \`).join('');
        }

        function getLogoUrl(logo) {
            if (!logo) return '';
            return logo.startsWith('http') ? logo : 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/' + logo + '.png';
        }

        async function editChannel(gi, ci) {
            const ch = raw[gi].channels[ci];
            const { value: formValues } = await Swal.fire({
                title: '编辑频道',
                background: document.body.classList.contains('theme-dark') ? '#1e293b' : '#fff',
                color: document.body.classList.contains('theme-dark') ? '#f1f5f9' : '#1e293b',
                html: \`
                    <div class="text-left space-y-4">
                        <label class="block text-xs font-black opacity-40 uppercase">频道名称</label>
                        <input id="swal-name" class="w-full p-4 rounded-xl border bg-black/5 outline-none focus:ring-2 ring-blue-500" value="\${ch.name}">
                        <label class="block text-xs font-black opacity-40 uppercase">标识 ID</label>
                        <input id="swal-id" class="w-full p-4 rounded-xl border bg-black/5 outline-none focus:ring-2 ring-blue-500" value="\${ch.id}">
                        <label class="block text-xs font-black opacity-40 uppercase">LOGO URL / 文件名</label>
                        <input id="swal-logo" class="w-full p-4 rounded-xl border bg-black/5 outline-none focus:ring-2 ring-blue-500" value="\${ch.logo||''}">
                        <label class="block text-xs font-black opacity-40 uppercase">播放源 (一行一个，不自动去重)</label>
                        <textarea id="swal-url" class="w-full h-32 p-4 rounded-xl border bg-black/5 font-mono text-xs outline-none focus:ring-2 ring-blue-500" placeholder="http://...">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                    </div>\`,
                showCancelButton: true,
                showDenyButton: true,
                denyButtonText: '删除频道',
                confirmButtonText: '保存',
                preConfirm: () => ({
                    name: document.getElementById('swal-name').value,
                    id: document.getElementById('swal-id').value,
                    logo: document.getElementById('swal-logo').value,
                    url: document.getElementById('swal-url').value.split('\\n').filter(u => u.trim())
                })
            });

            if (formValues) {
                raw[gi].channels[ci] = formValues;
                render();
            } else if (Swal.DismissReason.deny) {
                raw[gi].channels.splice(ci, 1);
                render();
            }
        }

        function addChannel(gi) { raw[gi].channels.push({name:'新频道', id:'', logo:'', url:[]}); render(); }
        function addGroup() { raw.push({group:'新分组', channels:[]}); render(); }
        function deleteGroup(gi) { if(confirm('确定删除该分组吗？')) { raw.splice(gi, 1); render(); } }
        function moveGroup(gi, dir) {
            const target = gi + dir;
            if(target >= 0 && target < raw.length) {
                [raw[gi], raw[target]] = [raw[target], raw[gi]];
                render();
            }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const oldHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 部署中...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                if (res.ok) Swal.fire({ icon: 'success', title: '保存成功', text: '部署指令已发出，请等待约 1 分钟生效', confirmButtonColor: '#3b82f6' });
                else throw new Error('保存失败');
            } catch (e) {
                Swal.fire({ icon: 'error', title: '保存失败', text: e.message });
            } finally {
                btn.innerHTML = oldHtml;
                btn.disabled = false;
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