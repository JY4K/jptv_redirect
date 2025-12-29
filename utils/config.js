export default {
  // 当前版本号
  currentVersion: '1.2.0',

  // 管理员 Token (Vercel 环境变量优先)
  adminToken: process.env.ADMIN_TOKEN || '123456',

  // 频道 Logo 基础路径
  logoBaseUrl: 'https://gcore.jsdelivr.net/gh/fanmingming/live/tv/',

  // 项目开源地址
  projectUrl: 'https://github.com/JY4K/jptv_redirect',

  // 版本检测地址
  repoApiUrl: 'https://api.github.com/repos/imput/iptv-pro/releases/latest',

  // Vercel 部署配置
  platform: {
    projectId: process.env.DEPLOY_PLATFROM_PROJECT || '',
    token: process.env.DEPLOY_PLATFROM_TOKEN || ''
  }
};