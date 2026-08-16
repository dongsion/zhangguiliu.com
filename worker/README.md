# AI 行情总结功能部署说明

## 已完成的修改

### 前端（index.html）
- 在「资金流」Tab 顶部添加了「📊 今日行情总结」卡片
- VIP 用户解锁后自动显示，非 VIP 用户看不到
- 数据加载完成后自动调用 AI 接口生成总结
- 卡片包含：情绪标签、文字总结、关键信号、判断公式
- AI 接口不可用时自动降级为本地规则总结

### Worker（worker/ 目录）
- `worker/ai-summary.js`：AI 行情总结逻辑
- `worker/index.js`：Worker 主入口（合并序列号验证 + AI 总结）

## 部署步骤

### 第 1 步：部署 Cloudflare Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. 找到已有的 `caimao-serial` Worker
3. 点击「编辑代码」
4. 将 `worker/index.js` 和 `worker/ai-summary.js` 的内容粘贴进去
   - 如果使用 Cloudflare 的在线编辑器：创建两个文件，分别粘贴内容
   - 如果使用 Wrangler CLI：`wrangler deploy`

### 第 2 步：配置 AI API（三选一）

#### 方案 A：使用外部 AI API（推荐，效果最好）

在 Worker 的 Settings → Variables 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `AI_API_KEY` | `sk-xxxxxxxx` | 你的 AI API 密钥 |
| `AI_API_URL` | `https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation` | 通义千问 API 地址 |
| `AI_MODEL` | `qwen-turbo` | 模型名称 |

**支持的 AI 提供商：**
- **通义千问**（阿里）：`AI_API_URL=https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation`，`AI_MODEL=qwen-turbo`
- **豆包**（字节）：`AI_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions`，`AI_MODEL=doubao-pro-32k`
- **DeepSeek**：`AI_API_URL=https://api.deepseek.com/chat/completions`，`AI_MODEL=deepseek-chat`
- **OpenAI**：`AI_API_URL=https://api.openai.com/v1/chat/completions`，`AI_MODEL=gpt-4o-mini`

#### 方案 B：使用 Cloudflare Workers AI（免费）

1. 在 Worker 的 Settings → Bindings 中添加 AI binding
2. 不需要设置环境变量，代码会自动使用 `env.AI`

#### 方案 C：不配置（使用本地规则总结）

如果不配置任何 AI API，系统会自动使用本地规则生成总结（功能正常，但不如 AI 智能）

### 第 3 步：提交代码到 GitHub

```bash
git add index.html worker/
git commit -m "feat: 添加AI行情总结功能"
git push
```

### 第 4 步：验证

1. 打开网站，进入「资金流」Tab
2. 输入序列号解锁 VIP
3. 顶部应显示「📊 今日行情总结」卡片
4. 卡片自动加载 AI 分析结果

## 功能说明

- **触发时机**：页面加载、数据刷新后自动触发
- **手动刷新**：卡片底部有「🔄 重新生成」按钮
- **降级策略**：AI 接口失败时自动降级为本地规则总结
- **VIP 限制**：只有解锁 VIP 的用户才能看到此功能
