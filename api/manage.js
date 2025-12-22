
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

    const { newData } = req.body;
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

      if (!createRes.ok) throw new Error(`变量创建失败: ${await createRes.text()}`);

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

  // 服务端生成的 HTML 字符串
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
        .theme-light .card:hover { border-color: #3b82f6; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }

        body.theme-dark { background: #0f172a; color: #f1f5f9; }
        .theme-dark .glass-panel { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(20px); }
        .theme-dark .card { background: #1e293b; border: 1px solid #334155; }
        .theme-dark .card:hover { border-color: #60a5fa; background: #334155; }

        .card {
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            height: 160px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            position: relative;
        }

        /* 拖拽相关样式 */
        .card.dragging {
            opacity: 0.4;
            border: 2px dashed #3b82f6;
        }
        .card.drag-over {
            border: 2px solid #3b82f6;
            transform: scale(1.05);
            z-index: 10;
        }

        .channel-logo {
            height: 64px;
            width: auto;
            object-fit: contain;
            margin-bottom: 12px;
            transition: transform 0.3s;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            pointer-events: none; /* 防止图片干扰拖拽事件 */
        }
        .card:hover .channel-logo { transform: scale(1.1); }
        
        .footer-disclaimer {
            margin-top: 4rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(0,0,0,0.1);
            text-align: center;
            font-size: 0.85rem;
            opacity: 0.7;
        }
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
                        <span id="version-display">v${currentVersion}</span>
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
            <p class="mb-2">这是一个基于 js 的直播重定向服务器，仅支持vercel部署，如有需求可将代码提交给AI进行修改。本项目仅为个人爱好开发，代码开源。如有任何侵权行为，请联系删除。</p>
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
        
        // 全局变量用于存储拖拽源信息
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

            // 注意：客户端反引号 \\ \` 和客户端变量插值 \\ \${} 必须在服务端转义
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
                        \${isAuth ? \`<button onclick="deleteGroup(\${gi})" class="text-red-400 hover:bg-red-500/10 p-2 rounded transition"><i class="fas fa-trash-alt"></i></button>\` : ''}
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

        // --- 拖拽逻辑 ---
        function dragStart(e, gi, ci) {
            dragSrc = { gi, ci };
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({gi, ci}));
        }

        function dragOver(e) {
            if (e.preventDefault) e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move';
            return false;
        }

        function dragEnter(e) {
            e.target.closest('.card').classList.add('drag-over');
        }

        function dragLeave(e) {
            e.target.closest('.card').classList.remove('drag-over');
        }

        function dragEnd(e) {
            e.target.classList.remove('dragging');
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }

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
            Swal.fire({ title: '确认删除?', icon: 'warning', showCancelButton: true, confirmButtonText: '删除', confirmButtonColor: '#ef4444' }).then(r => {
                if(r.isConfirmed) { raw.splice(i, 1); render(); }
            });
        }
        
        function addGroup() { raw.push({group:'新分组',channels:[]}); render(); }
        
        // 核心修改 1: addChannel 
        async function addChannel(gi) { 
            // 1. 创建空对象
            const newChannel = {name:'', id: '', logo: '', url:[]};
            raw[gi].channels.push(newChannel); 
            render(); 
            
            // 2. 立即打开编辑窗口，传入 isNew = true
            const ci = raw[gi].channels.length - 1;
            await editChannel(gi, ci, true);
        }

        // 核心修改 2: editChannel
        async function editChannel(gi, ci, isNew = false) {
            if(document.querySelector('.dragging')) return;

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
                            <label class="text-xs opacity-60 block mb-1">名称 <span class="text-red-500">*</span></label>
                            <input id="s-name" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" value="\${ch.name}">
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-xs opacity-60 block mb-1">ID (EPG)</label>
                                <input id="s-id" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" value="\${ch.id}">
                            </div>
                            <div class="flex-1">
                                <label class="text-xs opacity-60 block mb-1">Logo <span class="text-red-500">*</span></label>
                                <input id="s-logo" class="w-full p-2.5 border rounded bg-transparent focus:ring-2 ring-blue-500 outline-none" placeholder="文件名或URL" value="\${ch.logo||''}">
                            </div>
                        </div>
                        <div>
                            <label class="text-xs opacity-60 block mb-1">直播源 (一行一个) <span class="text-red-500">*</span></label>
                            <textarea id="s-url" class="w-full p-3 border rounded bg-transparent font-mono text-xs h-32 focus:ring-2 ring-blue-500 outline-none" placeholder="http://...">\${(Array.isArray(ch.url)?ch.url:[ch.url]).join('\\n')}</textarea>
                        </div>
                    </div>\`,
                showDenyButton: !isNew, // 新建时不要"删除"按钮，只有取消
                denyButtonText: '删除', 
                confirmButtonText: '保存', 
                showCancelButton: true,
                cancelButtonText: '取消',
                
                // 校验逻辑
                preConfirm: () => {
                    const name = document.getElementById('s-name').value.trim();
                    const id = document.getElementById('s-id').value.trim();
                    const logo = document.getElementById('s-logo').value.trim();
                    const urlStr = document.getElementById('s-url').value;
                    const urls = urlStr.split('\\n').filter(x=>x.trim());
                    
                    // 任何一个关键信息为空，阻止保存
                    if(!name || !logo || urls.length === 0) {
                        Swal.showValidationMessage('频道名、Logo 和 直播源 均为必填项');
                        return false; 
                    }

                    return {
                        name: name,
                        id: id,
                        logo: logo,
                        url: urls
                    };
                }
            });

            if (value) { 
                // 点击保存且校验通过
                raw[gi].channels[ci] = value; 
                render(); 
            } else if (isDenied) { 
                // 点击了删除（仅在编辑已有频道时出现）
                raw[gi].channels.splice(ci, 1); 
                render(); 
            } else if (isNew && isDismissed) {
                // 如果是新频道，并且被取消、关闭或点击背景，则自动删除创建的空对象
                raw[gi].channels.splice(ci, 1);
                render();
            }
        }

        async function saveData() {
            const btn = document.getElementById('saveBtn');
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在部署...';
            btn.disabled = true;

            try {
                const res = await fetch(\`/api/manage?token=\${currentToken}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ newData: raw })
                });
                
                if (res.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: '部署已触发',
                        text: 'Vercel 正在重新构建项目以应用更改。这通常需要 1-2 分钟。',
                        timer: 5000,
                        timerProgressBar: true
                    });
                } else {
                    const err = await res.json();
                    throw new Error(err.error || '保存失败');
                }
            } catch (e) {
                Swal.fire({icon: 'error', title: '错误', text: e.message});
            } finally {
                btn.innerHTML = originalContent;
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
