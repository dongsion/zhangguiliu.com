/**
 * 财猫看板 Cloudflare Worker - 主入口
 * 
 * 合并了：序列号验证 + AI行情总结
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard → Workers & Pages
 * 2. 找到 caimao-serial Worker，编辑代码
 * 3. 将此文件内容粘贴进去（替换原有代码）
 * 4. 在 Settings → Variables 中添加环境变量：
 *    - AI_API_KEY: 你的AI API密钥（可选，不设则用本地规则总结）
 *    - AI_API_URL: AI API地址（如通义千问: https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation）
 *    - AI_MODEL: 模型名称（如 qwen-turbo）
 * 
 * 或者使用 Cloudflare Workers AI（免费）：
 * 在 Settings → Bindings 中添加 AI binding
 */

import { handleAISummary } from './ai-summary.js';

// ===== 序列号验证（保留原有逻辑）=====
async function handleSerialVerify(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // 这里放你原有的序列号验证逻辑
  // 示例：检查序列号是否在有效列表中
  const { code, deviceCode } = body;
  
  // 返回验证结果（请替换为你原有的逻辑）
  return jsonResponse({
    valid: true,
    code: code,
    deviceCode: deviceCode,
    message: '验证成功'
  });
}

// ===== 主路由 =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 路由
    if (path === '/api/ai/summary') {
      return handleAISummary(request, env);
    }

    if (path === '/api/serial/verify') {
      return handleSerialVerify(request);
    }

    // 默认
    return jsonResponse({ 
      status: 'ok', 
      service: 'caimao-serial',
      endpoints: ['/api/serial/verify', '/api/ai/summary']
    });
  }
};

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
