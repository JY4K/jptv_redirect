import { buildLogoUrl, formatChannelTitle, getChannelSources, getChannels, getRequestOrigin, normalizeChannels } from '../utils/helpers.js';
import config from '../utils/config.js';

const SYSTEM_ENV_KEYS = [
  { key: 'CHANNELS_DATA', label: '频道数据', description: '频道数据缓存，通常由频道保存功能自动维护。', multiline: true },
  { key: 'TOKEN', label: 'TOKEN', description: '订阅链接密码。' },
  { key: 'ADMIN_TOKEN', label: 'ADMIN_TOKEN', description: '管理后台登录密码。' },
  { key: 'DEPLOY_PLATFROM_TOKEN', label: 'DEPLOY_PLATFROM_TOKEN', description: '用于调用 Vercel API 的访问令牌。' },
  { key: 'DEPLOY_PLATFROM_PROJECT', label: 'DEPLOY_PLATFROM_PROJECT', description: 'Vercel 项目 ID。' }
];

function escapeText(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function generateM3U(channels, baseUrl = '') {
  let m3u = '#EXTM3U\n';
  channels.forEach((group) => {
    group.channels.forEach((channel) => {
      const logo = buildLogoUrl(channel.logo, baseUrl);
      getChannelSources(channel).forEach((source) => {
        m3u += `#EXTINF:-1 tvg-id="${channel.id || channel.name}" tvg-name="${channel.name}" tvg-logo="${logo}" group-title="${group.group}",${formatChannelTitle(channel.name, source.note)}\n${source.url}\n`;
      });
    });
    if (group.channels.length) m3u += '\n';
  });
  return m3u;
}

function generateTXT(channels) {
  const lines = [];
  channels.forEach((group) => {
    if (!group.channels.length) return;
    lines.push(`${group.group},#genre#`);
    group.channels.forEach((channel) => {
      getChannelSources(channel).forEach((source) => {
        lines.push(`${formatChannelTitle(channel.name, source.note)},${source.url}`);
      });
    });
    lines.push('');
  });
  return lines.join('\n');
}

function getVercelHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getVercelProject(projectId, token) {
  const headers = getVercelHeaders(token);
  const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, { headers });
  const projectData = await projectRes.json();
  if (!projectRes.ok) throw new Error(projectData.error?.message || '读取 Vercel 项目信息失败');
  return { projectData, headers };
}

async function listVercelEnvironments(projectId, token, decrypt = false) {
  const query = decrypt ? '?decrypt=1' : '';
  const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${query}`, {
    headers: getVercelHeaders(token)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '读取 Vercel 环境变量失败');
  return data.envs || [];
}

async function saveEnvironmentVariables(values) {
  const { projectId, token } = config.platform;
  if (!projectId || !token) throw new Error('未配置 Vercel 环境变量 DEPLOY_PLATFROM_PROJECT / DEPLOY_PLATFROM_TOKEN');

  const envs = await listVercelEnvironments(projectId, token);
  const headers = getVercelHeaders(token);
  const allowedKeys = new Set(SYSTEM_ENV_KEYS.map((item) => item.key));
  const entries = Object.entries(values || {}).filter(([key, value]) => allowedKeys.has(key) && typeof value === 'string' && value.trim());

  for (const [key] of entries) {
    const targetEnvIds = envs.filter((env) => env.key === key).map((env) => env.id);
    for (const id of targetEnvIds) {
    const deleteRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${id}`, { method: 'DELETE', headers });
    if (!deleteRes.ok) {
      const deleteData = await deleteRes.json().catch(() => ({}));
        throw new Error(deleteData.error?.message || `删除旧环境变量 ${key} 失败`);
      }
    }

    const envRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
        key,
        value: values[key].trim(),
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    })
    });
    const envData = await envRes.json();
    if (!envRes.ok) throw new Error(envData.error?.message || `保存环境变量 ${key} 失败`);
  }
}

async function deployToVercel() {
  const { projectId, token } = config.platform;
  if (!projectId || !token) throw new Error('未配置 Vercel 环境变量 DEPLOY_PLATFROM_PROJECT / DEPLOY_PLATFROM_TOKEN');

  const { projectData, headers } = await getVercelProject(projectId, token);

  const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'jptv-update',
      project: projectId,
      target: 'production',
      gitSource: {
        type: projectData.link?.type,
        repoId: projectData.link?.repoId,
        ref: projectData.targets?.production?.gitBranch || 'main'
      }
    })
  });
  const deployData = await deployRes.json().catch(() => ({}));
  if (!deployRes.ok) throw new Error(deployData.error?.message || '触发 Vercel 部署失败');

  return {
    deploymentId: deployData.id || '',
    deploymentUrl: deployData.url || ''
  };
}

async function saveToVercel(newData) {
  await saveEnvironmentVariables({ CHANNELS_DATA: JSON.stringify(newData) });
  return deployToVercel();
}

async function readEnvironmentVariables() {
  const { projectId, token } = config.platform;
  if (!projectId || !token) throw new Error('未配置 Vercel 环境变量 DEPLOY_PLATFROM_PROJECT / DEPLOY_PLATFROM_TOKEN');

  const envs = await listVercelEnvironments(projectId, token, true);
  return SYSTEM_ENV_KEYS.reduce((result, item) => {
    const matches = envs.filter((env) => env.key === item.key);
    const value = matches.find((env) => typeof env.value === 'string' && env.value)?.value || '';
    result[item.key] = {
      configured: matches.length > 0,
      value,
      targets: [...new Set(matches.flatMap((env) => env.target || []))]
    };
    return result;
  }, {});
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  const token = req.query.token || '';
  const isAuth = token === config.adminToken;
  const isListAuth = Boolean(config.listToken) && token === config.listToken;
  const currentVersion = config.currentVersion;
  const requestOrigin = getRequestOrigin(req);
  const logoBaseUrl = requestOrigin ? `${requestOrigin}/data/logo` : '/data/logo';
  const fallbackLogo = `${logoBaseUrl}/jptv.png`;
  let channels = getChannels();

  const isJSONReq = req.url.includes('ipv6.json') || req.query.format === 'json';
  const isM3UReq = req.url.includes('ipv6.m3u') || req.query.format === 'm3u';
  const isTXTReq = req.url.includes('ipv6.txt') || req.query.format === 'txt';

  if (isJSONReq) {
    if (!isListAuth) return res.status(401).send('Unauthorized: Invalid List Token');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(channels, null, 2));
  }

  if (isM3UReq || isTXTReq) {
    if (!isListAuth) return res.status(401).send('Unauthorized: Invalid List Token');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(isM3UReq ? generateM3U(channels, requestOrigin) : generateTXT(channels));
  }

  if (req.method === 'POST') {
    if (!isAuth) return res.status(401).json({ error: '无权操作' });

    try {
      const newData = normalizeChannels(req.body?.newData || []);
      const deployment = await saveToVercel(newData);
      return res.json({ success: true, deployment });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JPTV 管理系统</title>
  <link rel="icon" href="${escapeText(fallbackLogo)}" type="image/png">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    body { transition: background 0.55s ease, color 0.32s ease; }
    body.theme-switching, body.theme-switching * { transition-duration: 0.38s !important; transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1) !important; }
    body.theme-light {
      --glass-bg: rgba(255, 255, 255, 0.58);
      --glass-bg-strong: rgba(255, 255, 255, 0.72);
      --glass-border: rgba(148, 163, 184, 0.28);
      --glass-highlight: rgba(255, 255, 255, 0.72);
      --glass-shadow: rgba(15, 23, 42, 0.12);
      --source-bg: rgba(255, 255, 255, 0.68);
      --source-bar: rgba(248, 250, 252, 0.78);
      --source-code: #1f2937;
      --source-muted: #94a3b8;
      background:
        radial-gradient(circle at 12% 10%, rgba(59, 130, 246, 0.18), transparent 28rem),
        radial-gradient(circle at 84% 0%, rgba(20, 184, 166, 0.14), transparent 26rem),
        radial-gradient(circle at 50% 92%, rgba(244, 114, 182, 0.10), transparent 24rem),
        linear-gradient(135deg, #f8fafc 0%, #eef2f7 44%, #e8edf4 100%);
      color: #1f2937;
    }
    body.theme-dark {
      --glass-bg: rgba(17, 24, 39, 0.56);
      --glass-bg-strong: rgba(24, 31, 46, 0.72);
      --glass-border: rgba(148, 163, 184, 0.18);
      --glass-highlight: rgba(255, 255, 255, 0.10);
      --glass-shadow: rgba(0, 0, 0, 0.34);
      --source-bg: rgba(24, 31, 46, 0.78);
      --source-bar: rgba(30, 41, 59, 0.82);
      --source-code: #d4d4d4;
      --source-muted: #858585;
      background:
        radial-gradient(circle at 16% 8%, rgba(59, 130, 246, 0.20), transparent 30rem),
        radial-gradient(circle at 86% 6%, rgba(20, 184, 166, 0.13), transparent 28rem),
        radial-gradient(circle at 50% 100%, rgba(99, 102, 241, 0.12), transparent 34rem),
        linear-gradient(135deg, #0b1020 0%, #111827 42%, #171717 100%);
      color: #f1f5f9;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent 78%);
    }
    .glass-panel {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(22px) saturate(145%);
      -webkit-backdrop-filter: blur(22px) saturate(145%);
      box-shadow: 0 20px 56px var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
      transition: background 0.38s ease, border-color 0.38s ease, box-shadow 0.38s ease, color 0.28s ease;
    }
    .card {
      background: var(--glass-bg-strong);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(16px) saturate(135%);
      -webkit-backdrop-filter: blur(16px) saturate(135%);
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08), inset 0 1px 0 var(--glass-highlight);
      transition: background 0.38s ease, border-color 0.38s ease, box-shadow 0.38s ease, transform 0.2s ease, color 0.28s ease;
    }
    .card { cursor: pointer; transition: all 0.2s ease; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; position: relative; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 18px 36px var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); border-color: rgba(96, 165, 250, 0.34); }
    .channel-logo { height: 64px; width: auto; max-width: 100%; object-fit: contain; margin-bottom: 12px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); pointer-events: none; }
    .dragging { opacity: 0.4; border: 2px dashed #3b82f6 !important; }
    .source-editor {
      height: var(--source-height, 360px);
      min-height: 220px;
      max-height: 560px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--source-bg);
      color: var(--source-code);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(22px) saturate(145%);
      -webkit-backdrop-filter: blur(22px) saturate(145%);
      box-shadow: inset 0 1px 0 var(--glass-highlight), 0 18px 42px var(--glass-shadow);
    }
    .source-titlebar { background: var(--source-bar); border-bottom: 1px solid var(--glass-border); color: var(--source-code); backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%); }
    .source-tabs button { border-right: 1px solid currentColor; border-color: rgba(127,127,127,0.24); }
    .source-tabs button { color: var(--source-muted); }
    .source-tabs button.active { background: var(--source-bg); color: var(--source-code); font-weight: 700; }
    .source-codewrap { flex: 1; min-height: 0; overflow: hidden; overscroll-behavior: contain; }
    .source-textarea { width: calc(100% - 44px); min-width: 0; height: 100%; background: transparent; color: inherit; border: 0; outline: none; resize: none; tab-size: 2; line-height: 1.55; overflow: auto; white-space: pre; }
    .source-gutter { width: 44px; min-width: 44px; height: 100%; overflow: hidden; user-select: none; border-right: 1px solid rgba(127,127,127,0.24); }
    .source-gutter { background: var(--source-bg); color: var(--source-muted); }
    .source-action { height: 30px; min-width: 34px; border-radius: 0.5rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; font-weight: 700; border: 1px solid transparent; transition: all 0.15s ease; }
    .source-action.apply { background: #2563eb; color: #ffffff; border-color: rgba(255,255,255,0.18); box-shadow: 0 6px 14px rgba(37, 99, 235, 0.28); }
    .source-action.apply:hover { background: #1d4ed8; }
    .source-action.close { background: rgba(148, 163, 184, 0.18); color: var(--source-code); border-color: var(--glass-border); }
    .source-action.close:hover { background: rgba(239, 68, 68, 0.14); color: #ef4444; border-color: rgba(239, 68, 68, 0.28); }
    .icon-btn { width: 34px; height: 34px; border-radius: 0.65rem; display: inline-flex; align-items: center; justify-content: center; background: rgba(148, 163, 184, 0.14); border: 1px solid var(--glass-border); color: #2563eb; transition: all 0.15s ease; }
    .icon-btn:hover { background: rgba(37, 99, 235, 0.14); color: #1d4ed8; transform: translateY(-1px); }
    .theme-dark .icon-btn { color: #93c5fd; background: rgba(255, 255, 255, 0.08); }
    .theme-dark .icon-btn:hover { color: #bfdbfe; background: rgba(96, 165, 250, 0.16); }
    .icon-btn.danger { color: #ef4444; }
    .icon-btn.danger:hover { background: rgba(239, 68, 68, 0.14); color: #dc2626; }
    .source-card { display: grid; grid-template-columns: 34px 1fr 38px; gap: 0.65rem; align-items: center; padding: 0.75rem; border-radius: 0.9rem; background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); box-shadow: inset 0 1px 0 var(--glass-highlight); transition: transform 0.15s ease, border-color 0.15s ease, opacity 0.15s ease; }
    .source-card.dragging { opacity: 0.48; transform: scale(0.985); border-color: rgba(59, 130, 246, 0.55); }
    .source-card.drag-over { border-color: rgba(59, 130, 246, 0.65); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.14), inset 0 1px 0 var(--glass-highlight); }
    .source-drag-handle { width: 34px; height: 64px; border-radius: 0.7rem; display: inline-flex; align-items: center; justify-content: center; cursor: grab; color: var(--source-muted); background: rgba(148, 163, 184, 0.12); border: 1px solid var(--glass-border); touch-action: none; }
    .source-drag-handle:active { cursor: grabbing; }
    .source-card-fields { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 0.55rem; }
    .channel-logo-preview { width: 58px; height: 58px; min-width: 58px; border-radius: 0.95rem; object-fit: contain; padding: 0.45rem; background: linear-gradient(145deg, rgba(255,255,255,0.42), rgba(148,163,184,0.12)); border: 1px solid var(--glass-border); backdrop-filter: blur(16px) saturate(145%); -webkit-backdrop-filter: blur(16px) saturate(145%); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255,255,255,0.26); }
    .theme-dark .channel-logo-preview { background: linear-gradient(145deg, rgba(255,255,255,0.12), rgba(15,23,42,0.28)); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255,255,255,0.12); }
    .format-choice { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.5rem; }
    .format-choice label { cursor: pointer; border: 1px solid var(--glass-border); border-radius: 0.75rem; padding: 0.75rem; display: flex; align-items: center; gap: 0.5rem; background: var(--glass-bg); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); box-shadow: inset 0 1px 0 var(--glass-highlight); }
    .format-choice input { accent-color: #2563eb; }
    .swal2-popup { background: var(--glass-bg-strong) !important; color: inherit !important; border: 1px solid var(--glass-border) !important; backdrop-filter: blur(24px) saturate(150%) !important; -webkit-backdrop-filter: blur(24px) saturate(150%) !important; box-shadow: 0 24px 70px var(--glass-shadow), inset 0 1px 0 var(--glass-highlight) !important; }
    .swal2-close.channel-modal-close { width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; top: 0.9rem !important; right: 0.9rem !important; border-radius: 0.65rem !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; background: rgba(148, 163, 184, 0.14) !important; border: 1px solid var(--glass-border) !important; color: #64748b !important; font-size: 1rem !important; line-height: 1 !important; transition: all 0.15s ease !important; }
    .swal2-close.channel-modal-close:hover { background: rgba(239, 68, 68, 0.14) !important; color: #dc2626 !important; transform: translateY(-1px); }
    .swal2-close.channel-modal-close:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18) !important; }
    .theme-dark .swal2-close.channel-modal-close { color: #cbd5e1 !important; background: rgba(255, 255, 255, 0.08) !important; }
    .swal2-html-container input, .swal2-html-container textarea { background: rgba(255,255,255,0.08) !important; border-color: var(--glass-border) !important; color: inherit !important; }
    .theme-light .swal2-html-container input, .theme-light .swal2-html-container textarea { background: rgba(255,255,255,0.54) !important; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: rgba(148, 163, 184, 0.10); border-radius: 999px; }
    ::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.45); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(59, 130, 246, 0.58); border: 2px solid transparent; background-clip: padding-box; }
    @media (max-width: 640px) {
      body { padding: 0.75rem !important; }
      .glass-panel { border-radius: 1rem !important; }
      header.glass-panel { padding: 1rem !important; align-items: stretch !important; }
      header .w-12.h-12 { width: 2.75rem !important; height: 2.75rem !important; }
      header h1 { font-size: 1.25rem !important; }
      #app { padding-bottom: 4rem; }
      .card { height: 132px; padding: 0.75rem; border-radius: 0.85rem !important; }
      .channel-logo { height: 52px; margin-bottom: 0.6rem; }
      .icon-btn { width: 38px; height: 38px; }
      .source-editor { max-height: 64vh; min-height: 260px; }
      .source-titlebar { flex-wrap: wrap; gap: 0.45rem; }
      .source-tabs { width: 100%; overflow-x: auto; }
      .source-tabs button { flex: 1; min-width: 72px; padding: 0.7rem 0.5rem; }
      .source-titlebar > .flex.items-center.gap-2 { width: 100%; justify-content: flex-end; padding: 0 0.5rem 0.55rem; }
      .source-gutter { width: 38px; min-width: 38px; padding-left: 0.4rem !important; padding-right: 0.4rem !important; }
      .source-textarea { width: calc(100% - 38px); font-size: 0.78rem; }
      .source-card { grid-template-columns: 34px 1fr 42px; gap: 0.5rem; padding: 0.6rem; }
      .source-drag-handle { height: 88px; }
      .source-card-fields { grid-template-columns: 1fr; gap: 0.45rem; }
      .source-row .source-url,
      .source-row .source-note { min-height: 42px; }
      .source-row button { height: 42px; }
      .channel-logo-preview { width: 52px; height: 52px; min-width: 52px; }
      .swal2-popup { width: calc(100vw - 1.25rem) !important; padding: 1rem !important; border-radius: 1rem !important; }
      .swal2-title { font-size: 1.2rem !important; }
      .swal2-html-container { margin: 0.75rem 0 0 !important; overflow-x: hidden !important; }
      .swal2-html-container input, .swal2-html-container textarea { font-size: 16px !important; }
      .swal2-actions { gap: 0.45rem; margin-top: 1rem !important; }
      .swal2-actions button { min-height: 42px; margin: 0 !important; }
      .format-choice { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body class="theme-light min-h-screen p-4 md:p-8">
  <div class="max-w-[1600px] mx-auto">
    <header class="flex flex-col lg:flex-row justify-between items-center mb-8 glass-panel p-6 rounded-2xl gap-4">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg overflow-hidden border border-gray-100">
          <img src="${escapeText(fallbackLogo)}" class="w-10 h-10 object-contain" alt="JPTV">
        </div>
        <div>
          <h1 class="text-2xl font-bold">JPTV 控制台</h1>
          <div class="flex gap-2 text-xs font-mono mt-1 opacity-70">
            <span id="version-display">v${escapeText(currentVersion)}</span>
            ${isAuth ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-600 rounded">管理员</span>' : '<span class="px-2 py-0.5 bg-gray-500/20 text-gray-500 rounded">只读模式</span>'}
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-center sm:justify-end gap-3 w-full lg:w-auto">
        <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-current/10 hover:bg-current/20 flex items-center justify-center transition" title="切换主题">
          <i class="fas fa-sun" id="themeIcon"></i>
        </button>
        ${isAuth ? `
        <div class="flex flex-wrap items-center justify-center gap-2 bg-black/5 dark:bg-white/5 p-1 rounded-xl w-full sm:w-auto">
          <button onclick="openExportDialog()" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium"><i class="fas fa-download"></i> 导出</button>
          <div class="w-px h-4 bg-current/10 mx-1"></div>
          <button onclick="globalImport()" class="px-3 py-2 hover:bg-current/10 rounded-lg transition flex items-center gap-2 text-xs font-medium"><i class="fas fa-upload"></i> 导入</button>
        </div>
        <button onclick="saveData()" id="saveBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition flex items-center gap-2">
          <i class="fas fa-cloud-upload-alt"></i> 保存并部署
        </button>` : ''}
      </div>
    </header>

    <div id="app" class="space-y-8 pb-12"></div>
    ${isAuth ? `
    <div class="py-10 text-center">
      <button onclick="addGroup()" class="px-8 py-4 rounded-2xl border-2 border-dashed border-current/20 hover:border-blue-500 text-current/50 hover:text-blue-500 transition font-bold flex items-center gap-2 mx-auto text-lg">
        <i class="fas fa-plus-circle"></i> 添加新分组
      </button>
    </div>` : ''}
  </div>

  <script>
    if (!window.Swal) {
      window.Swal = {
        __fallback: true,
        fire: (title, message) => {
          window.alert([title, message].filter(Boolean).join('\\n'));
          return Promise.resolve({});
        },
        showValidationMessage: (message) => {
          window.alert(message);
          return false;
        },
        showLoading: () => {}
      };
    }

    let raw = ${JSON.stringify(channels)};
    const isAuth = ${isAuth};
    const currentToken = ${JSON.stringify(token)};
    const logoBaseUrl = ${JSON.stringify(logoBaseUrl)};
    const fallbackLogo = ${JSON.stringify(fallbackLogo)};
    let dragSrc = null;
    let sourceState = { open: null, format: 'json' };
    let currentTheme = localStorage.getItem('jptv_theme') || 'light';

    function normalizeSources(value) {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      return list.map((item) => {
        if (typeof item === 'string') return { url: item.trim(), note: '' };
        if (item && typeof item === 'object') return { url: String(item.url || item.href || '').trim(), note: String(item.note || item.remark || item.name || '').trim() };
        return null;
      }).filter((item) => item && item.url);
    }

    function normalizeChannel(ch) {
      const sources = normalizeSources(ch.sources || ch.urls || ch.url);
      return { name: String(ch.name || '').trim(), id: String(ch.id || ch.name || '').trim(), logo: normalizeLogoInput(ch.logo), sources };
    }

    function stripLogoExtension(value) {
      return String(value || '').replace(/\\.(png|jpe?g|webp|gif|svg|avif)$/i, '');
    }

    function isLogoUrl(value) {
      return /^(https?:)?\\/\\//i.test(String(value || '').trim()) || String(value || '').trim().startsWith('data:');
    }

    function normalizeLogoInput(logo) {
      const value = String(logo || '').trim();
      if (!value || value === 'jptv.png') return '';
      if (isLogoUrl(value)) return value;
      const clean = value.replace(/^\\/+/, '').replace(/\\\\/g, '/').split(/[?#]/)[0];
      return stripLogoExtension(clean.includes('/') ? clean.split('/').pop() : clean);
    }

    function getLogoNameForFields(logo) {
      const value = String(logo || '').trim();
      if (!value) return '';
      if (isLogoUrl(value)) return '';
      return normalizeLogoInput(value);
    }

    const pinyinInitialBoundaries = [
      ['a', '阿'], ['b', '芭'], ['c', '嚓'], ['d', '咑'], ['e', '妸'], ['f', '发'],
      ['g', '旮'], ['h', '铪'], ['j', '讥'], ['k', '咔'], ['l', '垃'], ['m', '妈'],
      ['n', '拿'], ['o', '噢'], ['p', '啪'], ['q', '期'], ['r', '然'], ['s', '撒'],
      ['t', '塌'], ['w', '挖'], ['x', '昔'], ['y', '压'], ['z', '匝']
    ];

    function getCharInitial(char) {
      if (/[a-z0-9]/i.test(char)) return char;
      if (!/[\\u4e00-\\u9fff]/.test(char)) return '';
      for (let index = pinyinInitialBoundaries.length - 1; index >= 0; index -= 1) {
        if (char.localeCompare(pinyinInitialBoundaries[index][1], 'zh-Hans-CN-u-co-pinyin') >= 0) {
          return pinyinInitialBoundaries[index][0];
        }
      }
      return '';
    }

    function logoNameToId(logoName) {
      return Array.from(String(logoName || '').trim()).map(getCharInitial).join('');
    }

    function normalizeAll(groups) {
      return (Array.isArray(groups) ? groups : []).map((group) => ({
        group: String(group.group || group.name || '').trim(),
        id: group.id || '',
        channels: Array.isArray(group.channels) ? group.channels.map(normalizeChannel).filter((ch) => ch.name) : []
      })).filter((group) => group.group);
    }

    function html(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function applyTheme() {
      const isSwitching = document.body.classList.contains('theme-switching');
      document.body.className = 'theme-' + currentTheme + ' min-h-screen p-4 md:p-8' + (isSwitching ? ' theme-switching' : '');
      document.getElementById('themeIcon').className = currentTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }

    function toggleTheme() {
      document.body.classList.add('theme-switching');
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('jptv_theme', currentTheme);
      applyTheme();
      window.clearTimeout(window.__themeSwitchTimer);
      window.__themeSwitchTimer = window.setTimeout(() => {
        document.body.classList.remove('theme-switching');
      }, 420);
    }

    function getLogoUrl(logo) {
      if (!logo) return fallbackLogo;
      if (isLogoUrl(logo)) return logo;
      const fileName = String(logo).trim().replace(/\\\\/g, '/').split('/').pop();
      if (!fileName) return fallbackLogo;
      return logoBaseUrl + '/' + (fileName.toLowerCase().endsWith('.png') ? fileName : fileName + '.png');
    }

    function render() {
      raw = normalizeAll(raw);
      const app = document.getElementById('app');
      if (!raw.length) {
        app.innerHTML = '<div class="text-center py-20 opacity-50">暂无数据</div>';
        return;
      }

      app.innerHTML = raw.map((group, gi) => {
        const sourceOpen = isAuth && sourceState.open === gi;
        return \`
          <div class="glass-panel rounded-2xl p-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-6 border-b border-current/10 pb-4 gap-4">
              \${isAuth
                ? \`<input class="text-xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition w-full" value="\${html(group.group)}" onchange="raw[\${gi}].group=this.value" placeholder="分组名称">\`
                : \`<h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-layer-group text-blue-500"></i> \${html(group.group)}</h2>\`
              }
              \${isAuth ? \`
                <div class="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                  <button onclick="toggleSource(\${gi})" class="icon-btn" title="源码"><i class="fas fa-code"></i></button>
                  <button onclick="moveGroup(\${gi}, -1)" class="icon-btn \${gi === 0 ? 'opacity-40 pointer-events-none' : ''}" title="上移"><i class="fas fa-arrow-up"></i></button>
                  <button onclick="moveGroup(\${gi}, 1)" class="icon-btn \${gi === raw.length - 1 ? 'opacity-40 pointer-events-none' : ''}" title="下移"><i class="fas fa-arrow-down"></i></button>
                  <button onclick="deleteGroup(\${gi})" class="icon-btn danger" title="删除"><i class="fas fa-trash-alt"></i></button>
                </div>\` : ''}
            </div>
            \${sourceOpen ? renderSourceEditor(group, gi) : renderChannelGrid(group, gi)}
          </div>\`;
      }).join('');
    }

    function renderChannelGrid(group, gi) {
      return \`<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
        \${group.channels.map((channel, ci) => {
          const logoUrl = getLogoUrl(channel.logo);
          const tag = isAuth ? 'div' : 'a';
          const attrs = isAuth
            ? \`draggable="true" ondragstart="dragStart(event,\${gi},\${ci})" ondragover="event.preventDefault()" ondrop="dragDrop(event,\${gi},\${ci})" onclick="editChannel(\${gi},\${ci})"\`
            : \`href="\${html(logoUrl)}" target="_blank" rel="noopener noreferrer"\`;
          return \`
          <\${tag} class="card rounded-xl no-underline text-inherit"
            \${attrs}>
            <img src="\${html(getLogoUrl(channel.logo))}" class="channel-logo" onerror="this.src='\${html(fallbackLogo)}'" alt="\${html(channel.name)}">
            <div class="text-center w-full px-2"><h3 class="font-bold text-sm truncate">\${html(channel.name)}</h3></div>
          </\${tag}>\`;
        }).join('')}
        \${isAuth ? \`<div onclick="addChannel(\${gi})" class="card rounded-xl border-dashed border-2 opacity-50 hover:opacity-100 text-blue-500"><i class="fas fa-plus text-3xl mb-2"></i><span class="font-bold text-sm">添加频道</span></div>\` : ''}
      </div>\`;
    }

    function renderSourceEditor(group, gi) {
      const content = getGroupSource(group, sourceState.format);
      const rows = Math.max(12, content.split('\\n').length);
      const lineNumbers = Array.from({ length: rows }, (_, index) => index + 1).join('<br>');
      const cardCount = group.channels.length + 1;
      const columns = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 3 : 2;
      const visualRows = Math.max(1, Math.ceil(cardCount / columns));
      const rowHeight = window.innerWidth <= 640 ? 148 : 180;
      const maxHeight = window.innerWidth <= 640 ? Math.round(window.innerHeight * 0.64) : 560;
      const editorHeight = Math.min(maxHeight, Math.max(260, visualRows * rowHeight + (visualRows - 1) * 20));
      return \`
        <div class="source-editor rounded-xl" style="--source-height:\${editorHeight}px">
          <div class="source-titlebar flex items-center justify-between">
            <div class="source-tabs flex">
              \${['json', 'm3u', 'txt'].map((format) => \`<button onclick="switchSourceFormat('\${format}')" class="px-4 py-2 text-xs font-mono \${sourceState.format === format ? 'active' : ''}">\${format.toUpperCase()}</button>\`).join('')}
            </div>
            <div class="flex items-center gap-2 px-3">
              <button onclick="applyGroupSource(\${gi})" class="source-action apply text-xs px-3"><i class="fas fa-check"></i> 应用</button>
              <button onclick="toggleSource(\${gi})" class="source-action close text-xs" title="关闭"><i class="fas fa-xmark"></i></button>
            </div>
          </div>
          <div class="source-codewrap flex font-mono text-sm">
            <div id="source-lines-\${gi}" class="source-gutter text-right px-3 py-3 leading-[1.55]">\${lineNumbers}</div>
            <textarea id="source-editor-\${gi}" rows="\${rows}" oninput="updateLineNumbers(\${gi})" onscroll="syncSourceScroll(\${gi})" class="source-textarea flex-1 p-3" spellcheck="false">\${html(content)}</textarea>
          </div>
        </div>\`;
    }

    function formatTitle(name, note) {
      const cleanNote = String(note || '').trim();
      return cleanNote ? name + ' | ' + cleanNote : name;
    }

    function getGroupSource(group, format) {
      if (format === 'json') return JSON.stringify(group, null, 2);
      if (format === 'm3u') {
        let output = '#EXTM3U\\n';
        group.channels.forEach((channel) => {
          normalizeSources(channel.sources || channel.url).forEach((source) => {
            output += \`#EXTINF:-1 tvg-id="\${channel.id || channel.name}" tvg-name="\${channel.name}" tvg-logo="\${getLogoUrl(channel.logo)}" group-title="\${group.group}",\${formatTitle(channel.name, source.note)}\\n\${source.url}\\n\`;
          });
        });
        return output.trimEnd();
      }
      const lines = [group.group + ',#genre#'];
      group.channels.forEach((channel) => {
        normalizeSources(channel.sources || channel.url).forEach((source) => lines.push(formatTitle(channel.name, source.note) + ',' + source.url));
      });
      return lines.join('\\n');
    }

    function updateLineNumbers(gi) {
      const editor = document.getElementById('source-editor-' + gi);
      const gutter = document.getElementById('source-lines-' + gi);
      const count = Math.max(12, editor.value.split('\\n').length);
      gutter.innerHTML = Array.from({ length: count }, (_, index) => index + 1).join('<br>');
      syncSourceScroll(gi);
    }

    function syncSourceScroll(gi) {
      const editor = document.getElementById('source-editor-' + gi);
      const gutter = document.getElementById('source-lines-' + gi);
      if (editor && gutter) gutter.scrollTop = editor.scrollTop;
    }

    function toggleSource(gi) {
      sourceState.open = sourceState.open === gi ? null : gi;
      render();
    }

    function switchSourceFormat(format) {
      sourceState.format = format;
      render();
    }

    function applyGroupSource(gi) {
      const text = document.getElementById('source-editor-' + gi).value;
      try {
        const groups = parseImport(text, sourceState.format, raw[gi].group);
        if (!groups.length) throw new Error('没有解析到频道数据');
        raw[gi] = normalizeAll(groups)[0];
        sourceState.open = null;
        render();
      } catch (error) {
        Swal.fire('解析失败', error.message, 'error');
      }
    }

    async function editChannel(gi, ci, isNew = false) {
      const channel = raw[gi].channels[ci] || { name: '', id: '', logo: '', sources: [{ url: '', note: '' }] };
      const sources = normalizeSources(channel.sources || channel.url);
      const sourceRows = (sources.length ? sources : [{ url: '', note: '' }]).map((source, index) => sourceRow(source, index)).join('');
      const { value, isDenied } = await Swal.fire({
        title: isNew ? '添加频道' : '编辑频道',
        width: 760,
        background: currentTheme === 'dark' ? '#1e293b' : '#fff',
        color: currentTheme === 'dark' ? '#fff' : '#333',
        html: \`<div class="space-y-4 text-left">
          <div class="flex gap-3 items-center">
            <img id="s-logo-preview" src="\${html(getLogoUrl(channel.logo))}" onerror="this.src='\${html(fallbackLogo)}'" class="channel-logo-preview" alt="Logo">
            <input id="s-name" placeholder="名称" class="w-full min-h-[42px] p-2 border rounded bg-transparent" value="\${html(channel.name)}" oninput="markChannelFieldsManual()">
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input id="s-id" placeholder="ID" class="flex-1 min-h-[42px] p-2 border rounded bg-transparent" value="\${html(channel.id)}" oninput="markChannelFieldsManual()">
            <input id="s-logo" placeholder="Logo" class="flex-1 min-h-[42px] p-2 border rounded bg-transparent" value="\${html(channel.logo)}" oninput="handleChannelLogoInput()">
          </div>
          <div id="sourceRows" class="space-y-2">\${sourceRows}</div>
          <button type="button" onclick="addSourceRow()" class="w-full sm:w-auto min-h-[42px] px-3 py-2 rounded bg-blue-600 text-white text-sm"><i class="fas fa-plus"></i> 添加链接</button>
        </div>\`,
        showDenyButton: !isNew,
        denyButtonText: '删除',
        confirmButtonText: '保存',
        showCancelButton: false,
        showCloseButton: true,
        allowOutsideClick: true,
        allowEscapeKey: true,
        closeButtonHtml: '<i class="fas fa-xmark"></i>',
        customClass: { closeButton: 'channel-modal-close' },
        didOpen: () => {
          window.addSourceRow = addSourceRow;
          window.removeSourceRow = removeSourceRow;
          window.sourceDragStart = sourceDragStart;
          window.sourceDragOver = sourceDragOver;
          window.sourceDrop = sourceDrop;
          window.sourceDragEnd = sourceDragEnd;
          window.updateChannelLogoPreview = updateChannelLogoPreview;
          window.handleChannelLogoInput = handleChannelLogoInput;
          window.markChannelFieldsManual = markChannelFieldsManual;
          updateChannelLogoPreview();
        },
        preConfirm: () => {
          const name = document.getElementById('s-name').value.trim();
          const rows = Array.from(document.querySelectorAll('.source-row')).map((row) => ({
            url: row.querySelector('.source-url').value.trim(),
            note: row.querySelector('.source-note').value.trim()
          })).filter((source) => source.url);
          if (!name || !rows.length) return Swal.showValidationMessage('名称和链接不能为空');
          return { name, id: document.getElementById('s-id').value.trim() || name, logo: normalizeLogoInput(document.getElementById('s-logo').value), sources: rows };
        }
      });

      if (value) {
        raw[gi].channels[ci] = value;
        render();
      } else if (isDenied) {
        raw[gi].channels.splice(ci, 1);
        render();
      }
    }

    function sourceRow(source = {}, index = 0) {
      return \`<div class="source-row source-card" ondragover="sourceDragOver(event)" ondrop="sourceDrop(event)" ondragend="sourceDragEnd(event)">
        <div class="source-drag-handle" draggable="true" ondragstart="sourceDragStart(event)" title="拖动排序"><i class="fas fa-grip-vertical"></i></div>
        <div class="source-card-fields">
          <input class="source-url p-2 border rounded bg-transparent font-mono text-xs" placeholder="URL" value="\${html(source.url || '')}">
          <input class="source-note p-2 border rounded bg-transparent text-sm" placeholder="备注，可留空" value="\${html(source.note || '')}">
        </div>
        <button type="button" onclick="removeSourceRow(this)" class="h-10 rounded bg-red-500/10 text-red-500"><i class="fas fa-trash"></i></button>
      </div>\`;
    }

    function updateChannelLogoPreview() {
      const input = document.getElementById('s-logo');
      const preview = document.getElementById('s-logo-preview');
      if (!preview) return;
      preview.src = getLogoUrl(input?.value || '');
    }

    function handleChannelLogoInput() {
      const logoInput = document.getElementById('s-logo');
      const nameInput = document.getElementById('s-name');
      const idInput = document.getElementById('s-id');
      const logoValue = logoInput?.value || '';
      const logoName = getLogoNameForFields(logoValue);
      const shouldClearAutoFields = logoInput?.dataset.autoFilled === 'true';
      updateChannelLogoPreview();
      if (isLogoUrl(logoValue)) {
        if (shouldClearAutoFields) clearChannelAutoFields();
        if (logoInput) logoInput.dataset.autoFilled = 'false';
        return;
      }
      if (!logoName) {
        if (shouldClearAutoFields) clearChannelAutoFields();
        if (logoInput) logoInput.dataset.autoFilled = 'false';
        return;
      }
      nameInput.value = logoName;
      idInput.value = logoNameToId(logoName) || logoName;
      if (logoInput) logoInput.dataset.autoFilled = 'true';
    }

    function clearChannelAutoFields() {
      const nameInput = document.getElementById('s-name');
      const idInput = document.getElementById('s-id');
      if (nameInput) nameInput.value = '';
      if (idInput) idInput.value = '';
    }

    function markChannelFieldsManual() {
      const logoInput = document.getElementById('s-logo');
      if (logoInput) logoInput.dataset.autoFilled = 'false';
    }

    function addSourceRow() {
      document.getElementById('sourceRows').insertAdjacentHTML('beforeend', sourceRow());
    }

    function sourceDragStart(event) {
      const row = event.currentTarget.closest('.source-row');
      if (!row) return;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
    }

    function sourceDragOver(event) {
      event.preventDefault();
      const target = event.currentTarget;
      const dragging = document.querySelector('.source-row.dragging');
      if (!dragging || dragging === target) return;
      target.classList.add('drag-over');
      const rect = target.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      target.parentNode.insertBefore(dragging, placeAfter ? target.nextSibling : target);
    }

    function sourceDrop(event) {
      event.preventDefault();
      sourceDragEnd(event);
    }

    function sourceDragEnd() {
      document.querySelectorAll('.source-row').forEach((row) => {
        row.classList.remove('dragging', 'drag-over');
      });
    }

    function removeSourceRow(button) {
      const rows = document.querySelectorAll('.source-row');
      if (rows.length === 1) {
        rows[0].querySelector('.source-url').value = '';
        rows[0].querySelector('.source-note').value = '';
        return;
      }
      button.closest('.source-row').remove();
    }

    function dragStart(event, gi, ci) {
      dragSrc = { gi, ci };
      event.currentTarget.classList.add('dragging');
    }

    function dragDrop(event, tgi, tci) {
      if (!dragSrc) return;
      const [item] = raw[dragSrc.gi].channels.splice(dragSrc.ci, 1);
      raw[tgi].channels.splice(tci, 0, item);
      dragSrc = null;
      render();
    }

    function addGroup() {
      raw.push({ group: '新分组', channels: [] });
      render();
    }

    function addChannel(gi) {
      editChannel(gi, raw[gi].channels.length, true);
    }

    function moveGroup(index, direction) {
      if (!raw[index + direction]) return;
      [raw[index], raw[index + direction]] = [raw[index + direction], raw[index]];
      render();
    }

    function deleteGroup(index) {
      Swal.fire({ title: '删除分组？', icon: 'warning', showCancelButton: true }).then((result) => {
        if (result.isConfirmed) {
          raw.splice(index, 1);
          render();
        }
      });
    }

    async function openExportDialog() {
      if (Swal.__fallback) {
        const format = (window.prompt('请输入导出格式：json / m3u / txt', 'json') || '').trim().toLowerCase();
        if (['json', 'm3u', 'txt'].includes(format)) downloadExport(format);
        return;
      }

      const { value: format } = await Swal.fire({
        title: '导出频道',
        width: 560,
        background: currentTheme === 'dark' ? '#1e293b' : '#fff',
        color: currentTheme === 'dark' ? '#fff' : '#333',
        html: formatPickerHtml('export-format', 'json'),
        showCancelButton: true,
        confirmButtonText: '导出',
        cancelButtonText: '取消',
        preConfirm: () => document.querySelector('input[name="export-format"]:checked')?.value || 'json'
      });
      if (format) downloadExport(format);
    }

    function formatPickerHtml(name, selected = 'json', includeAuto = false) {
      const items = [
        ...(includeAuto ? [{ value: 'auto', icon: 'fa-wand-magic-sparkles', label: '自动', desc: '识别格式' }] : []),
        { value: 'json', icon: 'fa-database', label: 'JSON', desc: '完整备份' },
        { value: 'm3u', icon: 'fa-list', label: 'M3U', desc: '订阅格式' },
        { value: 'txt', icon: 'fa-file-lines', label: 'TXT', desc: '订阅格式' }
      ];
      return \`<div class="format-choice text-left">\${items.map((item) => \`
        <label>
          <input type="radio" name="\${name}" value="\${item.value}" \${item.value === selected ? 'checked' : ''}>
          <span><i class="fas \${item.icon}"></i></span>
          <span><strong class="block">\${item.label}</strong><small class="opacity-70">\${item.desc}</small></span>
        </label>\`).join('')}</div>\`;
    }

    function downloadExport(format) {
      const content = format === 'json' ? JSON.stringify(normalizeAll(raw), null, 2) : format === 'm3u' ? exportM3U(raw) : exportTXT(raw);
      const mime = format === 'json' ? 'application/json' : 'text/plain';
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'jptv_' + new Date().toISOString().slice(0, 10) + '.' + format;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function exportM3U(groups) {
      return normalizeAll(groups).map((group) => getGroupSource(group, 'm3u')).join('\\n\\n') + '\\n';
    }

    function exportTXT(groups) {
      return normalizeAll(groups).map((group) => getGroupSource(group, 'txt')).join('\\n\\n') + '\\n';
    }

    async function globalImport() {
      if (Swal.__fallback) {
        const selectedFormat = (window.prompt('请输入导入格式：auto / json / m3u / txt', 'auto') || 'auto').trim().toLowerCase();
        const text = window.prompt('请粘贴 JSON / M3U / TXT 代码', '');
        if (!text) return;

        try {
          const format = selectedFormat === 'auto' ? detectFormat(text, '') : selectedFormat;
          const groups = parseImport(text, format);
          raw = normalizeAll(groups);
          sourceState.open = null;
          render();
          window.alert('导入成功');
        } catch (error) {
          window.alert('导入失败：' + error.message);
        }
        return;
      }

      const { value } = await Swal.fire({
        title: '导入频道',
        width: 760,
        background: currentTheme === 'dark' ? '#1e293b' : '#fff',
        color: currentTheme === 'dark' ? '#fff' : '#333',
        html: \`<div class="space-y-4 text-left">
          \${formatPickerHtml('import-format', 'auto', true)}
          <input id="import-file" type="file" accept=".json,.m3u,.m3u8,.txt,application/json,text/plain" class="w-full p-2 border rounded bg-transparent">
          <textarea id="import-code" class="w-full p-3 border rounded bg-transparent font-mono text-xs h-56" placeholder="粘贴 JSON / M3U / TXT 代码"></textarea>
        </div>\`,
        showCancelButton: true,
        confirmButtonText: '导入',
        preConfirm: async () => {
          const file = document.getElementById('import-file').files[0];
          const pasted = document.getElementById('import-code').value.trim();
          const selectedFormat = document.querySelector('input[name="import-format"]:checked')?.value || 'auto';
          if (file) return { text: await file.text(), name: file.name, format: selectedFormat };
          if (pasted) return { text: pasted, name: '', format: selectedFormat };
          return Swal.showValidationMessage('请选择文件或粘贴代码');
        }
      });
      if (!value) return;

      try {
        const format = value.format === 'auto' ? detectFormat(value.text, value.name) : value.format;
        const groups = parseImport(value.text, format);
        raw = normalizeAll(groups);
        sourceState.open = null;
        render();
        Swal.fire('导入成功', '已自动识别并载入频道数据', 'success');
      } catch (error) {
        Swal.fire('导入失败', error.message, 'error');
      }
    }

    function detectFormat(text, name = '') {
      const lower = name.toLowerCase();
      if (lower.endsWith('.json')) return 'json';
      if (lower.endsWith('.m3u') || lower.endsWith('.m3u8')) return 'm3u';
      if (lower.endsWith('.txt')) return 'txt';
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
      if (trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXTINF')) return 'm3u';
      return 'txt';
    }

    function parseImport(text, format = detectFormat(text), fallbackGroup = '导入分组') {
      if (format === 'json') {
        const data = JSON.parse(text);
        return normalizeAll(Array.isArray(data) ? data : [data]);
      }
      if (format === 'm3u') return parseM3U(text, fallbackGroup);
      return parseTXT(text, fallbackGroup);
    }

    function parseM3U(text, fallbackGroup) {
      const groups = new Map();
      const lines = text.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
      let meta = null;
      lines.forEach((line) => {
        if (line.startsWith('#EXTINF')) {
          const name = (line.split(',').pop() || '').trim();
          const attrs = Object.fromEntries([...line.matchAll(/([\\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
          meta = { name, group: attrs['group-title'] || fallbackGroup, id: attrs['tvg-id'] || name, logo: attrs['tvg-logo'] || '' };
          return;
        }
        if (line.startsWith('#') || !meta) return;
        const parsed = splitTitle(meta.name);
        pushParsed(groups, meta.group, { name: parsed.name, id: meta.id || parsed.name, logo: meta.logo, source: { url: line, note: parsed.note } });
        meta = null;
      });
      return [...groups.values()];
    }

    function parseTXT(text, fallbackGroup) {
      const groups = new Map();
      let currentGroup = fallbackGroup;
      text.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
        const comma = line.indexOf(',');
        if (comma === -1) return;
        const left = line.slice(0, comma).trim();
        const right = line.slice(comma + 1).trim();
        if (right === '#genre#') {
          currentGroup = left || fallbackGroup;
          if (!groups.has(currentGroup)) groups.set(currentGroup, { group: currentGroup, channels: [] });
          return;
        }
        const parsed = splitTitle(left);
        pushParsed(groups, currentGroup, { name: parsed.name, id: parsed.name, logo: '', source: { url: right, note: parsed.note } });
      });
      return [...groups.values()];
    }

    function splitTitle(title) {
      const parts = String(title || '').split('|').map((part) => part.trim());
      return { name: parts[0] || '未命名频道', note: parts.slice(1).join(' | ') };
    }

    function pushParsed(groups, groupName, item) {
      if (!groups.has(groupName)) groups.set(groupName, { group: groupName, channels: [] });
      const group = groups.get(groupName);
      let channel = group.channels.find((ch) => ch.name === item.name && ch.logo === item.logo);
      if (!channel) {
        channel = { name: item.name, id: item.id || item.name, logo: item.logo || '', sources: [] };
        group.channels.push(channel);
      }
      channel.sources.push(item.source);
    }

    async function saveData() {
      const btn = document.getElementById('saveBtn');
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
      btn.disabled = true;
      Swal.fire({
        title: '正在同步保存',
        html: '正在写入频道数据并触发 Vercel 部署，请稍候...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
      });

      try {
        const response = await fetch('/api/manage?token=' + encodeURIComponent(currentToken), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newData: normalizeAll(raw) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || '保存失败');
        Swal.fire({
          icon: 'success',
          title: '保存已同步',
          html: '频道数据已保存，并已触发 Vercel 部署。',
          confirmButtonText: '完成'
        });
      } catch (error) {
        Swal.fire('保存失败', error.message, 'error');
      } finally {
        btn.innerHTML = originalHtml || '<i class="fas fa-cloud-upload-alt"></i> 保存并部署';
        btn.disabled = false;
      }
    }

    Object.assign(window, {
      addChannel,
      addGroup,
      applyGroupSource,
      deleteGroup,
      dragDrop,
      dragStart,
      globalImport,
      moveGroup,
      openExportDialog,
      saveData,
      switchSourceFormat,
      syncSourceScroll,
      toggleSource,
      toggleTheme,
      updateLineNumbers
    });

    applyTheme();
    render();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
