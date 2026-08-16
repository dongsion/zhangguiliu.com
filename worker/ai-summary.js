/**
 * 财猫看板 - AI行情总结 Worker
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard → Workers & Pages
 * 2. 找到已有的 caimao-serial Worker（或新建）
 * 3. 将此代码合并到现有 Worker 中，或作为新路由添加
 * 4. 在 Settings → Variables 中添加：
 *    - AI_API_KEY: 你的AI API密钥（如OpenAI/通义千问/豆包等）
 *    - AI_API_URL: AI API地址（默认使用通义千问）
 *    - AI_MODEL: 模型名称（默认 qwen-turbo）
 * 
 * 如果不想用外部AI API，也可以使用 Cloudflare Workers AI（免费）：
 * 在代码中启用 env.AI.run() 部分即可
 */

// ===== AI 行情总结接口 =====
async function handleAISummary(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders()
    });
  }

  let marketData;
  try {
    marketData = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // 构建给AI的prompt
  const prompt = buildPrompt(marketData);

  let aiResult;
  
  // 方案1：使用外部AI API（推荐，效果最好）
  if (env.AI_API_KEY && env.AI_API_URL) {
    try {
      aiResult = await callExternalAI(env.AI_API_URL, env.AI_API_KEY, env.AI_MODEL || 'qwen-turbo', prompt);
    } catch (e) {
      console.error('External AI failed:', e);
      aiResult = null;
    }
  }

  // 方案2：使用 Cloudflare Workers AI（免费，但需要绑定AI）
  if (!aiResult && env.AI) {
    try {
      const response = await env.AI.run('@cf/qwen/qwen1.5-14b-chat-awq', {
        messages: [
          { role: 'system', content: '你是一个专业的A股市场分析师，擅长根据实时行情数据给出简洁、有洞察力的市场总结。请用中文回答。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800
      });
      aiResult = response.response || response;
    } catch (e) {
      console.error('Workers AI failed:', e);
      aiResult = null;
    }
  }

  // 方案3：本地规则总结（兜底方案，不依赖AI）
  if (!aiResult) {
    aiResult = localSummary(marketData);
  }

  // 解析AI返回的文本，提取结构化数据
  const result = parseAIResponse(aiResult, marketData);

  return jsonResponse(result);
}

function buildPrompt(d) {
  let p = `请根据以下实时行情数据，生成一份简洁的市场总结。\n\n`;
  p += `时间：${d.time}\n`;
  p += `大盘涨跌：上证${d.indices.sh}%，沪深300 ${d.indices.hs300}%，创业板${d.indices.cyb}%，科创${d.indices.kc}%\n`;
  if (d.marketAvg) p += `大盘均值：${d.marketAvg}%\n`;
  if (d.techAvg) p += `科技方向均值：${d.techAvg}%\n`;
  p += `板块涨跌：${d.boards.up}涨 / ${d.boards.down}跌 / 共${d.boards.total}个\n`;
  
  if (d.topGainers && d.topGainers.length) {
    p += `领涨板块：${d.topGainers.map(x => x.name + '(' + x.pct + '%)').join('、')}\n`;
  }
  if (d.topLosers && d.topLosers.length) {
    p += `领跌板块：${d.topLosers.map(x => x.name + '(' + x.pct + '%)').join('、')}\n`;
  }
  
  p += `\n资金流向：\n`;
  p += `主力净流入合计：${d.flows.posFlow}\n`;
  p += `主力净流出合计：${d.flows.negFlow}\n`;
  p += `净差额：${d.flows.netFlow}\n`;
  
  if (d.flows.topInflow && d.flows.topInflow.length) {
    p += `净流入TOP：${d.flows.topInflow.map(x => x.name + '(' + x.flow + ')').join('、')}\n`;
  }
  if (d.flows.topOutflow && d.flows.topOutflow.length) {
    p += `净流出TOP：${d.flows.topOutflow.map(x => x.name + '(' + x.flow + ')').join('、')}\n`;
  }
  
  if (d.northbound) p += `北向资金：${d.northbound}\n`;
  
  // 其他指数
  p += `\n其他参考：黄金${d.indices.gold}%，半导体${d.indices.semi}%，人工智能${d.indices.ai}%，恒生科技${d.indices.hk}%，纳指${d.indices.ndx}%\n`;
  
  p += `\n请按以下格式输出：\n`;
  p += `[情绪] 偏强/偏弱/中性\n`;
  p += `[总结] 2-3段简短分析（每段1-2句话），包括大盘走势、板块轮动、资金动向\n`;
  p += `[信号] 1句话核心信号，指出最重要的资金背离或趋势\n`;
  
  return p;
}

async function callExternalAI(apiUrl, apiKey, model, prompt) {
  const body = {
    model: model,
    input: {
      messages: [
        { role: 'system', content: '你是一个专业的A股市场分析师，擅长根据实时行情数据给出简洁、有洞察力的市场总结。请用中文回答。' },
        { role: 'user', content: prompt }
      ]
    },
    parameters: {
      max_tokens: 800,
      temperature: 0.7
    }
  };

  // 兼容 OpenAI 格式
  if (apiUrl.includes('openai.com')) {
    body.messages = body.input.messages;
    delete body.input;
    delete body.parameters;
    body.max_tokens = 800;
    body.temperature = 0.7;
  }

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`AI API error: ${resp.status}`);
  }

  const data = await resp.json();
  
  // 兼容不同API返回格式
  if (data.output && data.output.text) return data.output.text;
  if (data.output && data.output.choices && data.output.choices[0]) return data.output.choices[0].message.content;
  if (data.choices && data.choices[0]) return data.choices[0].message.content;
  if (data.result) return data.result;
  
  return JSON.stringify(data);
}

function parseAIResponse(text, d) {
  // 尝试从AI文本中提取结构化信息
  var sentiment = 'neutral';
  var sentimentLabel = '中性';
  
  if (/[偏强|乐观|看涨|强势]/.test(text)) {
    sentiment = 'bullish';
    sentimentLabel = '偏强';
  } else if (/[偏弱|悲观|看跌|弱势]/.test(text)) {
    sentiment = 'bearish';
    sentimentLabel = '偏弱';
  }
  
  // 提取总结段落
  var summary = text;
  var signal = '';
  
  // 尝试提取[信号]部分
  var signalMatch = text.match(/\[信号\][\s:：]*(.+)/);
  if (signalMatch) {
    signal = signalMatch[1].trim();
    summary = text.replace(/\[信号\][\s\S]*/, '').replace(/\[情绪\][\s\S]*?\n/, '').replace(/\[总结\][\s:：]*/, '').trim();
  } else {
    // 如果没有明确标记，取最后一句作为信号
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

// 本地规则总结（兜底方案）
function localSummary(d) {
  var ma = parseFloat(d.marketAvg) || 0;
  var netFlow = parseFloat(d.flows.netFlow) || 0;
  var label, sentiment;
  
  if (ma > 0.5 && netFlow > 0) { sentiment = 'bullish'; label = '偏强'; }
  else if (ma < -0.5 && netFlow < 0) { sentiment = 'bearish'; label = '偏弱'; }
  else { sentiment = 'neutral'; label = '中性'; }
  
  var text = `[情绪] ${label}\n`;
  text += `[总结] 大盘${ma >= 0 ? '涨' : '跌'}${Math.abs(ma)}%，${d.boards.up}个板块上涨，${d.boards.down}个板块下跌。`;
  
  if (d.flows.topInflow && d.flows.topInflow.length) {
    text += `主力资金净流入${d.flows.posFlow}，主要集中在${d.flows.topInflow.slice(0, 3).map(function(x) { return x.name; }).join('、')}。`;
  }
  if (d.flows.topOutflow && d.flows.topOutflow.length) {
    text += `净流出方面，${d.flows.topOutflow.slice(0, 3).map(function(x) { return x.name; }).join('、')}资金撤离。`;
  }
  
  text += `\n[信号] `;
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
      ...corsHeaders()
    }
  });
}

// 导出处理函数（供主Worker文件引用）
export { handleAISummary };
