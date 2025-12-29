import config from './config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

/**
 * 获取频道数据 (单一真理源)
 * 优先级：环境变量 CHANNELS_DATA > 本地 channels.json
 */
export const getChannels = () => {
  // 1. 优先读取环境变量 (速度最快)
  if (process.env.CHANNELS_DATA) {
    try {
      const envData = JSON.parse(process.env.CHANNELS_DATA);
      if (Array.isArray(envData) && envData.length > 0) {
        return envData;
      }
    } catch (e) {
      console.warn("CHANNELS_DATA 解析失败，回退到本地文件:", e.message);
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
 * 并发测速功能 (Race Mode)
 * 仅用于多源情况，返回响应最快的 URL
 */
export async function getFastestUrl(urls) {
  const validUrls = Array.isArray(urls) ? urls.filter(u => u && u.startsWith('http')) : [];

  if (validUrls.length === 0) return null;
  // 如果 helper 被错误地调用在单源上，直接返回
  if (validUrls.length === 1) return validUrls[0];

  const controller = new AbortController();

  // 优化 Headers，模拟真实浏览器，减少被拦截概率
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Connection': 'close' // 短连接，测速完即断开
  };

  try {
    const winner = await Promise.any(validUrls.map(u => {
      return new Promise(async (resolve, reject) => {
        try {
          const res = await fetch(u, {
            method: 'GET', // 使用 GET 获取更真实的流响应情况
            headers: headers,
            signal: controller.signal,
            referrerPolicy: 'no-referrer',
            timeout: 1000 // 缩短至 1秒，加速切换
          });

          if (res.ok) {
            resolve(u);
          } else {
            reject(new Error(res.statusText));
          }
        } catch (err) {
          reject(err);
        }
      });
    }));

    controller.abort(); // 只要有一个成功，立即取消其他请求
    return winner;
  } catch (error) {
    // 全军覆没，返回 null，由主逻辑处理 404
    return null;
  }
}