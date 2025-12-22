import { getChannels, getFastestUrl } from '../utils/helpers.js';
import config from '../utils/config.js';

export default async function handler(req, res) {
  const { id } = req.query;
  const baseUrl = `https://${req.headers.host}`;
  const fallbackUrl = `${baseUrl}/${config.fallbackFileName}`;

  //  1. 获取最新数据
  const channelsData = getChannels();

  // 2. 查找对应 ID 的频道
  const target = channelsData
    .flatMap(g => g.channels)
    .find(c => c.id === id);

  // 3. 如果没找到频道或频道没有URL，直接重定向到测试卡
  if (!target || !target.url || target.url.length === 0) {
    return res.redirect(302, fallbackUrl);
  }

  // 4. 智能测速
  const winner = await getFastestUrl(target.url);

  // 5. 设置头部：允许跨域，设置短暂缓存防止短时间内重复测速，但允许客户端刷新
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 302 重定向不应该被强缓存太久，方便源失效时快速切换
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');

  // 如果测速返回空，也去测试卡
  return res.redirect(302, winner || fallbackUrl);
}
