import config from './config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

/**
 * 获取频道数据 (单一真理源)
 * 优先级：环境变量 CHANNELS_DATA (后台修改后的数据) > 本地 channels.json (默认数据)
 */
export const getChannels = () => {
  // 1. 优先读取环境变量 (实时性最高)
  if (process.env.CHANNELS_DATA) {
    try {
      const envData = JSON.parse(process.env.CHANNELS_DATA);
      if (Array.isArray(envData) && envData.length > 0) {
        return envData;
      }
    } catch (e) {
      console.warn("CHANNELS_DATA 环境变量解析失败，将使用本地文件:", e.message);
    }
  }

  // 2. 回退读取本地文件
  try {
    const localPath = path.join(process.cwd(), 'public', 'channels.json');
    if (fs.existsSync(localPath)) {
      return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
  } catch (e) {
    console.error("本地文件读取失败:", e);
  }

  return [];
};

/**
 * 构建 Logo URL
 */
export const buildLogoUrl = (logoId) => {
  if (!logoId) return '';
  if (logoId.startsWith('http')) return logoId;
  return `${config.logoBaseUrl}${logoId}.png`;
};

/**
 * 极速测速功能
 * 使用 Promise.any 并发检测，一旦有一个源响应 200 OK，立即返回
 */
export async function getFastestUrl(urls) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  const validUrls = urlList.filter(u => u && u.startsWith('http'));

  // 1. 无有效链接
  if (validUrls.length === 0) return null;

  // 2. 只有一个链接，直接返回
  if (validUrls.length === 1) return validUrls[0];

  // 3. 并发竞速
  const controller = new AbortController();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Connection': 'keep-alive'
  };

  try {
    const winner = await Promise.any(validUrls.map(u => {
      return new Promise(async (resolve, reject) => {
        try {
          const res = await fetch(u, {
            method: 'GET',
            headers: headers,
            signal: controller.signal,
            referrerPolicy: 'no-referrer',
            timeout: 1200 // 进一步缩短超时时间到1.2秒，加快切换速度
          });

          if (res.ok) {
            resolve(u);
          } else {
            reject(new Error('Connect failed'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }));

    controller.abort(); // 找到最快的源后，取消其他请求
    return winner;
  } catch (error) {
    // 全军覆没，返回第一个作为兜底
    return validUrls[0];
  }
}
