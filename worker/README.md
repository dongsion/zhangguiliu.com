# AI 行情总结功能部署说明

## 已完成的修改

### 前端（index.html）
- 在「资金流」Tab 顶部添加了「📊 今日行情总结」卡片
- VIP 用户解锁后自动显示
- 数据加载完成后自动调用 AI 接口
- 卡片底部显示当前使用的 AI 来源（通义千问/豆包/DeepSeek/本地规则）
- AI 接口不可用时自动降级为本地规则总结

### Worker（worker/ 目录）
- `worker/ai-summary.js`：AI 行情总结逻辑（支持三个AI提供商+本地兜底）
- `worker/index.js`：Worker 主入口（合并序列号验证 + AI 总结）
- `worker/README.md`：本说明文件

## AI 降级链

```
通义千问 → 豆包 → DeepSeek → Cloudflare AI → 本地规则
```

配一个就能用，配两个更稳，配三个最稳，一个都不配也能用（本地规则）。

## 部署步骤

### 第 1 步：部署 Cloudflare Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. 找到 `caimao-serial` Worker，点击编辑代码
3. 将 `worker/index.js` 和 `worker/ai-summary.js` 的内容粘贴进去
   - 在线编辑器中创建两个文件，分别粘贴
   - 或使用 Wrangler CLI：`wrangler deploy`

### 第 2 步：配置 AI API Key（三选一、三选二或全配）

在 Worker 的 **Settings → Variables and Secrets** 中添加以下环境变量：

#### 通义千问（阿里）

| 变量名 | 值 |
|--------|-----|
| `QWEN_API_KEY` | 在 https://dashscope.console.aliyun.com/ 获取 |

- 模型：`qwen-turbo`（免费额度较多，速度快）
- API：`https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation`

#### 豆包（字节跳动）

| 变量名 | 值 |
|--------|-----|
| `DOUBAO_API_KEY` | 在 https://console.volcengine.com/ark 获取 |

- 模型：`doubao-pro-32k`
- API：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`

#### DeepSeek

| 变量名 | 值 |
|--------|-----|
| `DEEPSEEK_API_KEY` | 在 https://platform.deepseek.com/ 获取 |

- 模型：`deepseek-chat`
- API：`https://api.deepseek.com/chat/completions`

### 第 3 步（可选）：使用 Cloudflare Workers AI（免费）

如果不想配置外部 API Key，也可以用 Cloudflare 自带的 Workers AI：
1. 在 Worker 的 Settings → Bindings 中添加 AI binding
2. 不需要设置任何环境变量，代码会自动使用 `env.AI`

### 第 4 步：提交代码到 GitHub

```bash
git add index.html worker/
git commit -m "feat: AI行情总结支持通义千问+豆包+DeepSeek三路降级"
git push
```

### 第 5 步：验证

1. 打开网站 → 资金流 Tab → 解锁 VIP
2. 顶部应显示「📊 今日行情总结」卡片
3. 卡片底部会显示当前使用的 AI 来源
4. 点击「🔄 重新生成」可手动刷新

## 降级逻辑说明

| 配置情况 | 实际使用 | 说明 |
|---------|---------|------|
| 三个 Key 都配了 | 通义千问 | 优先级最高，如果通义千问报错则降级到豆包，再降级到 DeepSeek |
| 只配通义千问 | 通义千问 | 报错时降级到本地规则 |
| 只配豆包 | 豆包 | 报错时降级到本地规则 |
| 只配 DeepSeek | DeepSeek | 报错时降级到本地规则 |
| 一个都没配 | 本地规则 | 基于 `上涨×资金流向` 四象限规则自动生成 |

## 卡片内容结构

| 区块 | 内容 | 数据来源 |
|------|------|---------|
| 情绪标签 | 偏强/偏弱/中性 | AI分析或本地计算 |
| 文字总结 | 2-3段分析 | AI生成 |
| 关键信号 | 1句话核心判断 | AI生成 |
| 判断公式 | 四象限参考 | 固定显示 |
| AI来源标签 | 通义千问/豆包/DeepSeek/本地规则 | Worker返回 |
| 重新生成按钮 | 手动刷新 | 用户点击 |

## 接口返回格式

```json
{
  "sentiment": "bullish",
  "sentimentLabel": "偏强",
  "summary": "大盘涨0.52%，板块多数上涨...",
  "signal": "主力资金净流入，关注半导体设备持续性强",
  "formulas": ["上涨+大额流入=强势主线", "..."],
  "provider": "qwen",
  "timestamp": "2026-08-16T06:30:00.000Z"
}
```
