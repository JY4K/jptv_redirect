export default {
  // 当前版本号 (手动维护，避免读取 package.json 导致崩溃)
  currentVersion: '1.3.0',

  // 管理员 Token，部署时在 Vercel 环境变量设置
  adminToken: process.env.ADMIN_TOKEN || '123456',

  // 默认后的备用视频文件名 (位于 public 文件夹下)
  fallbackFileName: '测试卡.mp4',

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
