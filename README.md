<div align="center">
  <img src="https://mytv.jy4k.asia/logo/jptv.png" alt="Clash" width="128" style="border-radius: 16px;" />
</div>

<h2 align="center">
    JPTV 一个直播源 重定向 服务器
</h2>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Vercel-000000?logo=vercel&logoColor=white" alt="Vercel">
  <img src="https://img.shields.io/badge/Runtime-Node.js-339933?logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License">
</p>

> **JPTV Pro** 是一个基于 Vercel Serverless 构建的轻量级 JPTV 直播源管理与智能重定向系统。它不仅是订阅转换工具，更是您个人专属的“直播源路由器”。

---

## ✨ 核心特性 (Features)

- **⚡ 智能竞速重定向**: 毫秒级并发检测多个源地址，自动将请求重定向到响应最快、最稳定的视频源，彻底告别卡顿。
- **🎨 可视化管理后台**: 
  - 内置精美的 Web 管理界面（适配移动端/暗黑模式）。
  - 支持**拖拽排序**、分组管理、频道增删改查。
  - 实时预览 Logo 和频道信息。
- **🔄 自动持续集成**: 在后台修改配置后，自动调用 Vercel API 触发项目重新构建，数据实时生效，无需手动操作 Git。
- **📂 多格式订阅输出**: 自动生成适配各类播放器（TiviMate, PotPlayer, DIYP等）的 `.m3u` 和 `.txt` 格式文件。
- **🛡️ 安全与隐私**: 
  - 访客模式：仅可查看和下载订阅。
  - 管理模式：通过 Token 验证，拥有完全控制权。
- **☁️ Serverless 架构**: 完全基于 Vercel 免费版构建，无需购买服务器，零成本运维。

## 🚀 部署指南 (Deployment)

您可以选择 **一键部署** 或 **手动部署**。

### 方式一：一键部署 (推荐)
<p align="">
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/imput/jptv-pro&env=ADMIN_TOKEN">
    <img src="https://vercel.com/button" alt="Deploy with Vercel"/>
  </a>
</p>
1. 点击上方的 **Deploy** 按钮。
2. 在 Vercel 页面中，创建一个 Git 仓库（Create Git Repository）。
3. 在 **Configure Project** 步骤中，设置 `ADMIN_TOKEN` (后台管理密码)。
4. 点击 **Deploy** 等待完成。

### 方式二：手动部署

1. **Fork** 本仓库到您的 GitHub。
2. 在 [Vercel Dashboard](https://vercel.com/) 点击 **Add New...** -> **Project**。
3. 导入您刚才 Fork 的仓库。
4. 在 Environment Variables 中添加 `ADMIN_TOKEN`。
5. 点击 **Deploy**。

---

##  配置环境变量 (Environment Variables)
在 Vercel 的部署配置页（或部署后的 Settings -> Environment Variables），添加以下变量：

| 变量名 | 描述 | 必填 | 获取方式/示例                                    |
| :--- | :--- | :--- |:-------------------------------------------|
| `ADMIN_TOKEN` | 管理后台的登录密码 | ✅ | 默认：`123456`                                |
| `DEPLOY_PLATFROM_PROJECT` | Vercel 项目 ID | ✅ | Vercel项目 Settings -> General -> Project ID |
| `DEPLOY_PLATFROM_TOKEN` | Vercel 访问令牌 | ✅ | Vercel账号 Settings -> Tokens -> Create      |
| `CHANNELS_DATA` | 频道数据缓存 | ❌ | **无需手动配置**，系统会自动生成                         |

#### 获取步骤

**获取 Project ID (`DEPLOY_PLATFROM_PROJECT`)**

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)
2. 选择你的项目
3. 进入项目后,点击 **Settings** 标签
4. 在左侧菜单中选择 **General**
5. 向下滚动找到 **Project ID** 部分
6. 复制显示的项目 ID(格式类似: `prj_xxxxxxxxxxxx`)

**获取 API Token (`DEPLOY_PLATFROM_TOKEN`)**

1. 点击右上角头像,选择 **Settings**
2. 在左侧菜单中选择 **Tokens**
3. 点击 **Create Token** 按钮
4. 输入 Token 名称(如: `environment-variables-api`)
5. 选择 **Scope**:
   - 可以选择 **Full Account** 或特定项目
   - 建议选择特定项目以提高安全性
6. 设置过期时间(可选)
7. 点击 **Create** 创建 Token
8. **立即复制并保存** Token(只显示一次)

> ⚠️ **注意**: `DEPLOY_PLATFROM_PROJECT` 和 `DEPLOY_PLATFROM_TOKEN` 是实现后台“保存并部署”功能的关键，请务必正确配置。


### 🔗 订阅地址
| 格式 | 地址 | 说明 |
| :--- | :--- | :--- |
| **M3U** | `/ipv6.m3u` | 包含 Logo、EPG ID、分组信息的完整格式，推荐 TiviMate 使用 |
| **TXT** | `/ipv6.txt` | 传统的 `频道名,URL` 格式，适合电视盒子壳 |

### ⚙️ 管理后台
- **访客入口**: `https://your-app.vercel.app/`
- **管理员入口**: `https://your-app.vercel.app/?token=你的ADMIN_TOKEN`


## 目录结构
```bash
.
├── api/
│   ├── jptv.js      # 核心：处理重定向与测速
│   ├── m3u.js       # 生成 M3U 订阅
│   ├── txt.js       # 生成 TXT 订阅
│   └── manage.js    # 管理后台 UI、拖拽逻辑与 Vercel API 调用
├── public/
│   └── channels.json # 默认频道数据（兜底用）
├── utils/
│   ├── config.js    # 项目配置与版本管理
│   └── helpers.js   # 工具函数
└── vercel.json      # 路由重写规则
```
## ⚖️ 免责声明 (Disclaimer)

1. 本项目是一个技术研究项目，旨在探索 Serverless 架构在流媒体调度中的应用。
2. 本项目**不提供、不存储、不分发**任何视频流媒体文件。
3. 文档或代码演示中出现的频道仅作为格式参考，使用者需自行配置合法的直播源。
4. 使用者利用本项目产生的任何后果由使用者自行承担。

---

<p align="center">
  Generated with ❤️ for JPTV Enthusiasts
</p>




