/**
 * 财猫看板 - AI行情总结 Worker（多AI源版）
 * 
 * 支持三个AI提供商，按优先级自动降级：
 *   1. 通义千问（QWEN_API_KEY）
 *   2. 豆包（DOUBAO_API_KEY）
 *   3. DeepSeek（DEEPSEEK_API_KEY）
 *   4. 本地规则总结（兜底）
 * 
 * 部署：在 Cloudflare Worker Settings → Variables 中添加需要的 API Key：
 *   - QWEN_API_KEY: 通义千问密钥（https://dashscope.console.aliyun.com/）
 *   - DOUBAO_API_KEY: 豆包密钥（https://console.volcengine.com/ark）
 *   - DEEPSEEK_API_KEY: DeepSeek密钥（https://platform.deepseek.com/）
 * 
 * 配一个就能用，配三个更稳定，一个都不配也能用（本地规则）。
 */

const SYSTEM_PROMPT = '你是一个专业的A股市场分析师，擅长根据实时行情数据给出简洁、有洞察力的市场总结。请用中文回答，不要用Markdown格式。';

// ===== AI 行情总结接口 =====
async function handleAISummary(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let marketData;
  try {
    marketData = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const prompt = buildPrompt(marketData);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt }
  ];

  let aiResult = null;
  let provider = null;
  const errors = [];

  // 优先级1：通义千问
  if (!aiResult && env.QWEN_API_KEY) {
    try {
      aiResult = await callQwen(env.QWEN_API_KEY, messages);
      provider = 'qwen';
    } catch (e) {
      console.error('Qwen failed:', e.message);
      errors.push('qwen: ' + e.message);
    }
  }

  // 优先级2：豆包
  if (!aiResult && env.DOUBAO_API_KEY) {
    try {
      aiResult = await callDoubao(env.DOUBAO_API_KEY, messages);
      provider = 'doubao';
    } catch (e) {
      console.error('Doubao failed:', e.message);
      errors.push('doubao: ' + e.message);
    }
  }

  // 优先级3：DeepSeek
  if (!aiResult && env.DEEPSEEK_API_KEY) {
    try {
      aiResult = await callDeepSeek(env.DEEPSEEK_API_KEY, messages);
      provider = 'deepseek';
    } catch (e) {
      console.error('DeepSeek failed:', e.message);
      errors.push('deepseek: ' + e.message);
    }
  }

  // 优先级4：Cloudflare Workers AI（免费，需绑定AI）
  if (!aiResult && env.AI) {
    try {
      const resp = await env.AI.run('@cf/qwen/qwen1.5-14b-chat-awq', {
        messages: messages,
        max_tokens: 800
      });
      aiResult = resp.response || resp;
      provider = 'cf-ai';
    } catch (e) {
      console.error('CF AI failed:', e.message);
      errors.push('cf-ai: ' + e.message);
    }
  }

  // 优先级5：本地规则总结（兜底）
  if (!aiResult) {
    aiResult = localSummary(marketData);
    provider = 'local';
  }

  const result = parseAIResponse(aiResult, marketData);
  result.provider = provider;
  if (errors.length) result.errors = errors;

  return jsonResponse(result);
}

// ===== 通义千问（阿里 DashScope）=====
async function callQwen(apiKey, messages) {
  const model = 'qwen-turbo';
  const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      input: { messages: messages },
      parameters: { max_tokens: 800, temperature: 0.7 }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Qwen ' + resp.status + ': ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  
  // DashScope 返回格式
  if (data.output && data.output.text) return data.output.text;
  if (data.output && data.output.choices && data.output.choices[0]) {
    return data.output.choices[0].message.content;
  }
  // 兼容新版格式
  if (data.choices && data.choices[0]) return data.choices[0].message.content;
  
  throw new Error('Qwen: unexpected response format');
}

// ===== 豆包（字节跳动 Ark，OpenAI兼容格式）=====
async function callDoubao(apiKey, messages) {
  const model = 'doubao-pro-32k';
  const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: 800,
      temperature: 0.7
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Doubao ' + resp.status + ': ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  
  if (data.choices && data.choices[0]) return data.choices[0].message.content;
  
  throw new Error('Doubao: unexpected response format');
}

// ===== DeepSeek（OpenAI兼容格式）=====
async function callDeepSeek(apiKey, messages) {
  const model = 'deepseek-chat';
  const url = 'https://api.deepseek.com/chat/completions';
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: 800,
      temperature: 0.7
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('DeepSeek ' + resp.status + ': ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  
  if (data.choices && data.choices[0]) return data.choices[0].message.content;
  
  throw new Error('DeepSeek: unexpected response format');
}

// ===== Prompt 构建 =====
function buildPrompt(d) {
  let p = '请根据以下实时行情数据，生成一份简洁的市场总结。\n\n';
  p += '时间：' + d.time + '\n';
  p += '大盘涨跌：上证' + d.indices.sh + '%，沪深300 ' + d.indices.hs300 + '%，创业板' + d.indices.cyb + '%，科创' + d.indices.kc + '%\n';
  if (d.marketAvg) p += '大盘均值：' + d.marketAvg + '%\n';
  if (d.techAvg) p += '科技方向均值：' + d.techAvg + '%\n';
  p += '板块涨跌：' + d.boards.up + '涨 / ' + d.boards.down + '跌 / 共' + d.boards.total + '个\n';
  
  if (d.topGainers && d.topGainers.length) {
    p += '领涨板块：' + d.topGainers.map(function(x) { return x.name + '(' + x.pct + '%)'; }).join('、') + '\n';
  }
  if (d.topLosers && d.topLosers.length) {
    p += '领跌板块：' + d.topLosers.map(function(x) { return x.name + '(' + x.pct + '%)'; }).join('、') + '\n';
  }
  
  p += '\n资金流向：\n';
  p += '主力净流入合计：' + d.flows.posFlow + '\n';
  p += '主力净流出合计：' + d.flows.negFlow + '\n';
  p += '净差额：' + d.flows.netFlow + '\n';
  
  if (d.flows.topInflow && d.flows.topInflow.length) {
    p += '净流入TOP：' + d.flows.topInflow.map(function(x) { return x.name + '(' + x.flow + ')'; }).join('、') + '\n';
  }
  if (d.flows.topOutflow && d.flows.topOutflow.length) {
    p += '净流出TOP：' + d.flows.topOutflow.map(function(x) { return x.name + '(' + x.flow + ')'; }).join('、') + '\n';
  }
  
  if (d.northbound) p += '北向资金：' + d.northbound + '\n';
  
  p += '\n其他参考：黄金' + d.indices.gold + '%，半导体' + d.indices.semi + '%，人工智能' + d.indices.ai + '%，恒生科技' + d.indices.hk + '%，纳指' + d.indices.ndx + '%\n';
  
  p += '\n请按以下格式输出：\n';
  p += '[情绪] 偏强/偏弱/中性\n';
  p += '[总结] 2-3段简短分析（每段1-2句话），包括大盘走势、板块轮动、资金动向\n';
  p += '[信号] 1句话核心信号，指出最重要的资金背离或趋势\n';
  
  return p;
}

// ===== 解析AI返回文本 =====
function parseAIResponse(text, d) {
  var sentiment = 'neutral';
  var sentimentLabel = '中性';
  
  if (/偏强|乐观|看涨|强势/.test(text)) {
    sentiment = 'bullish';
    sentimentLabel = '偏强';
  } else if (/偏弱|悲观|看跌|弱势/.test(text)) {
    sentiment = 'bearish';
    sentimentLabel = '偏弱';
  }
  
  var summary = text;
  var signal = '';
  
  var signalMatch = text.match(/\[信号\][\s:：]*(.+)/);
  if (signalMatch) {
    signal = signalMatch[1].trim();
    summary = text.replace(/\[信号\][\s\S]*/, '').replace(/\[情绪\][\s\S]*?\n/, '').replace(/\[总结\][\s:：]*/, '').trim();
  } else {
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length > 1) {
      signal = lines[lines.length - 1];
      summary = lines.slice(0, -1).join('\n');
    }
    summary = summary.replace(/\[情绪\][\s\S]*?\n/, '').replace(/\[总结\][\s:：]*/, '').trim();
  }
  
  return {
    sentiment: sentiment,
    sentimentLabel: sentimentLabel,
    summary: summary,
    signal: signal,
    formulas: [
      '上涨+大额流入=强势主线',
      '上涨+大额流出=诱多风险',
      '下跌+大额流入=低位吸筹',
      '下跌+大额流出=抛压未完'
    ],
    timestamp: new Date().toISOString()
  };
}

// ===== 本地规则总结（兜底）=====
function localSummary(d) {
  var ma = parseFloat(d.marketAvg) || 0;
  var netFlow = parseFloat(d.flows.netFlow) || 0;
  var label, sentiment;
  
  if (ma > 0.5 && netFlow > 0) { sentiment = 'bullish'; label = '偏强'; }
  else if (ma < -0.5 && netFlow < 0) { sentiment = 'bearish'; label = '偏弱'; }
  else { sentiment = 'neutral'; label = '中性'; }
  
  var text = '[情绪] ' + label + '\n';
  text += '[总结] 大盘' + (ma >= 0 ? '涨' : '跌') + Math.abs(ma) + '%，' + d.boards.up + '个板块上涨，' + d.boards.down + '个板块下跌。';
  
  if (d.flows.topInflow && d.flows.topInflow.length) {
    text += '主力资金净流入' + d.flows.posFlow + '，主要集中在' + d.flows.topInflow.slice(0, 3).map(function(x) { return x.name; }).join('、') + '。';
  }
  if (d.flows.topOutflow && d.flows.topOutflow.length) {
    text += '净流出方面，' + d.flows.topOutflow.slice(0, 3).map(function(x) { return x.name; }).join('、') + '资金撤离。';
  }
  
  text += '\n[信号] ';
  if (ma > 0 && netFlow > 0) {
    text += '大盘上涨且主力净流入，市场偏强，关注领涨板块持续性。';
  } else if (ma > 0 && netFlow < 0) {
    text += '大盘上涨但主力资金流出，警惕诱多风险，注意冲高回落。';
  } else if (ma < 0 && netFlow > 0) {
    text += '大盘下跌但主力资金流入，可能存在低位吸筹，关注企稳信号。';
  } else {
    text += '大盘下跌且主力资金流出，市场偏弱，观望为主。';
  }
  
  return text;
}

// ===== 工具函数 =====
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export { handleAISummary };
