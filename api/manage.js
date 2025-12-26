import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const token = req.query.token || '';
  const isAuth = token === config.adminToken;
  const currentVersion = config.currentVersion;

  // --- API 逻辑处理 ---
  if (req.method === 'POST') {
    if (!isAuth) return res.status(401).json({ error: '无权操作' });

    let { newData } = req.body;
    if (!Array.isArray(newData)) return res.status(400).json({ error: '数据格式错误' });

    // 数据清洗：剔除空分组和无效频道
    newData = newData
      .map(g => ({
        ...g,
        channels: (g.channels || []).filter(ch => {
          const hasName = ch.name?.trim();
          const hasUrl = Array.isArray(ch.url) ? ch.url.length > 0 : ch.url?.trim();
          return hasName && hasUrl;
        })
      }))
      .filter(g => g.group?.trim() && g.channels.length > 0);

    const { projectId, token: vToken } = config.platform;
    if (!projectId || !vToken) return res.status(500).json({ error: '未配置 Vercel API 参数' });

    try {
      const headers = { 'Authorization': `Bearer ${vToken}`, 'Content-Type': 'application/json' };

      // 1. 获取项目 Git 状态
      const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers });
      if (!projectRes.ok) throw new Error('无法连接 Vercel API，请检查 Project ID 或 Token');
      const projectData = await projectRes.json();

      if (!projectData.link?.repoId) {
        throw new Error('当前项目未连接 Git 仓库，无法触发自动部署');
      }

      const repoId = projectData.link.repoId;
      const repoType = projectData.link.type;
      const gitBranch = projectData.targets?.production?.gitBranch || 'main';

      // 2. 更新环境变量 (先删后增以保证唯一性)
      const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, { headers });
      const { envs } = await listRes.json();
      const existingVars = envs?.filter(e => e.key === 'CHANNELS_DATA') || [];

      await Promise.all(existingVars.map(env =>
        fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}`, { method: 'DELETE', headers })
      ));

      const createRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          key: 'CHANNELS_DATA',
          value: JSON.stringify(newData),
          type: 'encrypted',
          target: ['production', 'preview', 'development']
        })
      });

      if (!createRes.ok) throw new Error('环境变量保存失败');

      // 3. 触发重新部署
      const deployRes = await fetch(`https://api.vercel.com/v13/deployments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'jptv-update',
          project: projectId,
          target: 'production',
          gitSource: { type: repoType, repoId, ref: gitBranch }
        })
      });

      if (!deployRes.ok) throw new Error('部署指令下发失败');

      return res.json({ success: true });
    } catch (e) {
      console.error("Deploy Error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // --- UI 渲染 ---
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
        :root { --accent: #3b82f6; }
        body { transition: background 0.3s, color 0.3s; }
        body.theme-light { background: #f8fafc; color: #1e293b; }
        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .glass-panel { 
            background: rgba(var(--bg-rgb), 0.7); 
            backdrop-filter: blur(12px); 
            border: 1px solid rgba(128,128,128,0.1); 
        }
        .theme-light { --bg-rgb: 255, 255, 255; }
        .theme-dark { --bg-rgb: 30, 41, 59; }
        .card { 
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); 
            aspect-ratio: 16/10;
        }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .card.dragging { opacity: 0.5; transform: scale(0.9); border: 2px dashed var(--accent); }
        .card.drag-over { border: 2px solid var(--accent); background: rgba(59, 130, 246, 0.1); }
        .channel-logo { max-height: 50px; width: auto; object-fit: contain; }
    </style>
</head>
<body class="theme-light min-h-screen pb-12">
    <div class="max-w-7xl mx-auto px-4 pt-8">
        <header class="flex flex-col md:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                    <i class="fas fa-satellite-dish text-xl"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">JPTV 控制台</h1>
                    <div id="version-display" class="text-xs font-mono opacity-60">v${currentVersion}</div>
                </div>
            </div>
            
            <div class="flex items-center gap-3">
                <button onclick="toggleTheme()" class="p-2.5 rounded-xl bg-gray-500/10 hover:bg-gray-500/20 transition">
                    <i class="fas fa-sun" id="themeIcon"></i>
                </button>
                ${isAuth ? `
                <div class="h-8 w-[1px] bg-gray-500/20 mx-2"></div>
                <button onclick="exportData()" class="p-2.5 rounded-xl hover:bg-gray-500/10 transition" title="备份数据">
                    <i class="fas fa-download"></i>
                </button>
                <button onclick="globalImport()" class="p-2.5 rounded-xl hover:bg-gray-500/10 transition" title="导入数据">
                    <i class="fas fa-upload"></i>
                </button>
                <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition flex items-center gap-2">
                    <i class="fas fa-cloud-upload-alt"></i> 保存部署
                </button>
                ` : `
                <a href="/ipv6.m3u" class="bg-gray-500/10 hover:bg-gray-500/20 px-4 py-2 rounded-lg text-sm font-medium transition">M3U 订阅</a>
                `}
            </div>
        </header>

        <main id="app" class="space-y-8"></main>
        
        ${isAuth ? `
        <div class="mt-12 text-center">
            <button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-gray-400/30 hover:border-blue-500 hover:text-blue-500 transition-all font-bold flex items-center gap-2 mx-auto">
                <i class="fas fa-plus-circle"></i> 添加新分组
            </button>
        </div>
        ` : `
        <footer class="mt-20 pt-8 border-t border-gray-500/10 text-center text-sm opacity-50">
            <p>© JPTV - 仅供技术交流学习使用</p>
        </footer>
        `}
    </div>

    <script>
        let raw = ${JSON.stringify(channels)};
        const isAuth = ${isAuth};
        const currentToken = "${token}";
        const repoApi = "${config.repoApiUrl}";
        
        let dragSrc = null;

        // --- 核心渲染函数 ---
        function render() {
            const app = document.getElementById('app');
            if (!raw.length) {
                app.innerHTML = '<div class="text-center py-20 opacity-30 text-xl italic">暂无频道数据</div>';
                return;
            }

            app.innerHTML = raw.map((g, gi) => \`
                <section class="glass-panel rounded-2xl p-6 shadow-sm">
                    <div class="flex items-center justify-between mb-6 border-b border-gray-500/10 pb-4">
                        <div class="flex-1 max-w-md">
                            \${isAuth 
                                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" 
                                    value="\${g.group}" onchange="raw[\${gi}].group = this.value" placeholder="分组名称">\` 
                                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-folder text-blue-500"></i> \${g.group}</h2>\`
                            }
                        </div>
                        \${isAuth ? \`
                        <div class="flex items-center gap-1">
                            <button onclick="moveGroup(\${gi}, -1)" class="p-2 hover:text-blue-500 transition \${gi === 0 ? 'invisible' : ''}"><i class="fas fa-chevron-up"></i></button>
                            <button onclick="moveGroup(\${gi}, 1)" class="p-2 hover:text-blue-500 transition \${gi === raw.length - 1 ? 'invisible' : ''}"><i class="fas fa-chevron-down"></i></button>
                            <button onclick="deleteGroup(\${gi})" class="p-2 hover:text-red-500 transition ml-2"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        \` : ''}
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        \${g.channels.map((ch, ci) => \`
                            <div class="card glass-panel rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer relative"
                                \${isAuth ? \`draggable="true" ondragstart="dragStart(event,\${gi},\${ci})" ondragover="e=>e.preventDefault()" ondrop="dragDrop(event,\${gi},\${ci})" ondragend="dragEnd(event)"\` : ''}
                                onclick="\${isAuth ? \`editChannel(\${gi},\${ci})\` : \`copyLink('\${ch.id}')\`}">
                                
                                <img src="\${getLogoUrl(ch.logo)}" class="channel-logo mb-3" 
                                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImdyYXkiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIyIiB5PSI3IiB3aWR0aD0iMjAiIGhlaWdodD0iMTUiIHJ4PSIyIi8+PHBhdGggZD0iTTE3IDJMMTIgN0w3IDIiLz48L3N2Zz4='">
                                
                                <span class="text-sm font-bold truncate w-full px-1">\${ch.name}</span>
                                \${!isAuth ? '<div class="absolute inset-0 bg-blue-500/0 hover:bg-blue-500/5 transition-all rounded-xl"></div>' : ''}
                            </div>
                        \`).join('')}
                        
                        \${isAuth ? \`
                        <div onclick="addChannel(\${gi})" class="card border-2 border-dashed border-gray-400/20 hover:border-blue-500/50 flex flex-col items-center justify-center text-blue-500/60 hover:text-blue-500">
                            <i class="fas fa-plus text-2xl"></i>
                        </div>
                        \` : ''}
                    </div>
                </section>
            \`).join('');
        }

        // --- 逻辑功能 ---
        function getLogoUrl(logo) {
            if (!logo) return '';
            if (logo.startsWith('http')) return logo;
            return \`https://gcore.jsdelivr.net/gh/fanmingming/live/tv/\${logo}.png\`;
        }

        function moveGroup(index, direction) {
            const target = index + direction;
            if (target < 0 || target >= raw.length) return;
            [raw[index], raw[target]] = [raw[target], raw[index]];
            render();
        }

        function deleteGroup(i) {
            Swal.fire({
                title: '确认删除该分组?',
                text: "分组下的所有频道也将被删除",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                confirmButtonText: '确定删除'
            }).then(r => { if(r.isConfirmed) { raw.splice(i, 1); render(); } });
        }

        function addGroup() {
            raw.push({ group: '新分组', channels: [] });
            render();
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }

        async function editChannel(gi, ci, isNew = false) {
            const ch = raw[gi].channels[ci];
            const { value, isDenied } = await Swal.fire({
                title: isNew ? '添加频道' : '编辑频道',
                html: \`
                    <div class="text-left space-y-3 pt-4">
                        <input id="swal-name" class="swal2-input !m-0 w-full" placeholder="频道名称" value="\${ch.name}">
                        <div class="flex gap-2">
                            <input id="swal-id" class="swal2-input !m-0 flex-1" placeholder="EPG ID" value="\${ch.id}">
                            <input id="swal-logo" class="swal2-input !m-0 flex-1" placeholder="Logo 文件名/URL" value="\${ch.logo}">
                        </div>
                        <textarea id="swal-url" class="swal2-textarea !m-0 w-full h-32" placeholder="直播源 (一行一个)">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                    </div>\`,
                showDenyButton: !isNew,
                denyButtonText: '删除频道',
                confirmButtonText: '确定',
                showCancelButton: true,
                focusConfirm: false,
                preConfirm: () => {
                    const name = document.getElementById('swal-name').value.trim();
                    const url = document.getElementById('swal-url').value.split('\\n').filter(x => x.trim());
                    if (!name || !url.length) return Swal.showValidationMessage('名称和链接不能为空');
                    return { 
                        name, 
                        id: document.getElementById('swal-id').value.trim(), 
                        logo: document.getElementById('swal-logo').value.trim(), 
                        url 
                    };
                }
            });

            if (value) { raw[gi].channels[ci] = value; render(); }
            else if (isDenied) { raw[gi].channels.splice(ci, 1); render(); }
            else if (isNew) { raw[gi].channels.splice(ci, 1); render(); }
        }

        function addChannel(gi) {
            raw[gi].channels.push({ name: '', id: '', logo: '', url: [] });
            editChannel(gi, raw[gi].channels.length - 1, true);
        }

        // --- 拖拽排序 ---
        function dragStart(e, gi, ci) { 
            dragSrc = { gi, ci }; 
            e.target.classList.add('dragging'); 
        }
        function dragEnd(e) { 
            document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging', 'drag-over')); 
        }
        function dragDrop(e, tGi, tCi) {
            e.preventDefault();
            if (dragSrc.gi === tGi && dragSrc.ci === tCi) return;
            const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
            raw[tGi].channels.splice(tCi, 0, item);
            render();
        }

        // --- 数据交换 ---
        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 处理中...';

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newData: raw })
                });
                const data = await res.json();
                if (res.ok) {
                    Swal.fire('已触发部署', '环境更新成功，Vercel 正在重新构建，请 1-2 分钟后刷新。', 'success');
                } else {
                    throw new Error(data.error);
                }
            } catch (e) {
                Swal.fire('保存失败', e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }

        function copyLink(id) {
            const url = \`\${window.location.origin}/jptv.php?id=\${id}\`;
            navigator.clipboard.writeText(url).then(() => {
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                Toast.fire({ icon: 'success', title: '链接已复制' });
            });
        }

        // --- 导入导出 ---
        function exportData() {
            const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`jptv_backup_\${new Date().getTime()}.json\`;
            a.click();
        }

        async function globalImport() {
            const { value: text } = await Swal.fire({
                title: '导入数据',
                input: 'textarea',
                inputPlaceholder: '在此粘贴 M3U 内容或 JPTV 备份 JSON...',
                showCancelButton: true,
                confirmButtonText: '识别并导入'
            });

            if (!text) return;

            try {
                if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
                    const parsed = JSON.parse(text);
                    raw = Array.isArray(parsed) ? parsed : [parsed];
                    render();
                    Swal.fire('成功', 'JSON 数据已恢复', 'success');
                } else if (text.includes('#EXTM3U')) {
                    // 简易 M3U 解析
                    const lines = text.split('\\n');
                    const channels = [];
                    for(let i=0; i<lines.length; i++) {
                        if(lines[i].startsWith('#EXTINF')) {
                            const name = lines[i].split(',').pop().trim();
                            const logo = lines[i].match(/tvg-logo="([^"]+)"/)?.[1] || '';
                            const id = lines[i].match(/tvg-id="([^"]+)"/)?.[1] || '';
                            const url = lines[i+1]?.trim();
                            if(url && url.startsWith('http')) {
                                channels.push({ name, id, logo, url: [url] });
                                i++;
                            }
                        }
                    }
                    raw.push({ group: '导入分组', channels });
                    render();
                    Swal.fire('成功', \`已从 M3U 导入 \${channels.length} 个频道\`, 'success');
                }
            } catch(e) { Swal.fire('错误', '无效的数据格式', 'error'); }
        }

        // --- 主题控制 ---
        function toggleTheme() {
            const isDark = document.body.classList.toggle('theme-dark');
            document.body.classList.toggle('theme-light', !isDark);
            document.getElementById('themeIcon').className = isDark ? 'fas fa-moon' : 'fas fa-sun';
            localStorage.setItem('jptv_theme', isDark ? 'dark' : 'light');
        }

        // 初始化
        if (localStorage.getItem('jptv_theme') === 'dark') toggleTheme();
        render();

        // 检查版本
        (async () => {
            try {
                const res = await fetch(repoApi);
                const data = await res.json();
                const latest = data.tag_name?.replace('v', '');
                if (latest && latest !== "${currentVersion}") {
                    document.getElementById('version-display').innerHTML += \` <span class="text-blue-500 underline cursor-help" title="最新版本 v\${latest}">● 有更新</span>\`;
                }
            } catch(e){}
        })();
    </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
