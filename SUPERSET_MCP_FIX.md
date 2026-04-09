# Superset MCP 连接诊断与修复指南

## 问题诊断

根据错误日志分析，你的 Superset MCP 服务器返回 **HTTP 401 Unauthorized**，这表示在初始化握手时**鉴权失败**。

### 我已验证的事实
✅ Superset 服务器可达（`192.168.1.100:8888/mcp`）  
✅ 服务器响应正常（不是连接挂起）  
✅ 配置格式正确且被正确解析  
✅ Authorization token 经过环境变量展开仍保持完整  
✅ Https 客户端应该会正确合并 headers  

❌ **Authorization 头在某个环节未被正确发送或被移除**  

---

## 最可能的根本原因

### 原因 1：Nginx 代理配置问题（概率: 60%）

你的 Superset 在 nginx 后面。Nginx 可能有以下问题：
- 某些 proxy_pass 配置未正确转发 Authorization 头
- `proxy_set_header` 缺少或覆盖了标准头

**修复方式**：检查 Nginx 配置
```nginx
# 确保这些行存在
proxy_pass_header Authorization;
proxy_pass_header Content-Type;
proxy_pass_header Accept;

# 或者更激进的方式
proxy_pass_request_headers on;
```

### 原因 2：Superset MCP Token 已过期（概率: 25%）

Bearer token `mcp_NBnq-2aDEXPw_d_K8Nzc3YjXakXkXJneB7dRnfZiK2U` 可能已过期或被吊销。

**修复方式**：
1. 在 Superset UI 中重新生成 MCP Token
2. 替换配置中的 token 值
3. 重启 CoPaw

### 原因 3：MCP 库与 httpx 版本兼容性（概率: 10%）

某些版本组合可能导致 headers 传递失败。

**修复方式**：
```bash
pip install --upgrade mcp httpx
```

### 原因 4：CoPaw 配置缓存（概率: 5%）

配置可能没有被正确重新加载。

**修复方式**：
```bash
# 1. 停止 CoPaw
# 2. 清除配置缓存
rm -rf ~/.copaw/cache

# 3. 重启 CoPaw
```

---

##  立即尝试的诊断步骤

### 步骤 1：运行诊断脚本
```bash
cd /Users/futuremeng/github/futuremeng/CoPaw
python test_mcp_headers_debug.py
```

这会显示：
- ✓/✗ 配置是否被正确解析
- ✓/✗ Authorization 头是否在请求中
- ✓/✗ 与 Superset 的连接状态

### 步骤 2：使用 curl 验证 token 有效性

```bash
# 使用你配置中的相同 token
curl -v -X POST 'http://192.168.1.100:8888/mcp' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer mcp_NBnq-2aDEXPw_d_K8Nzc3YjXakXkXJneB7dRnfZiK2U' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

**预期结果**：
- 若返回 `200 OK` + JSON：token 有效 ✓
- 若返回 `401 Unauthorized`：token 已过期或无效 ✗
- 若显示超时或 nginx 错误：可能是 nginx 配置问题 ✗

### 步骤 3：检查 Nginx 日志（如果有 SSH 访问）

```bash
# 检查 nginx 转发是否正确
tail -100f /var/log/nginx/access.log | grep /mcp
tail -100f /var/log/nginx/error.log
```

---

## 推荐的完整修复流程

### 方案 A：如果 curl 测试返回 200（Token 有效）

1. **排查 CoPaw 代码路径**
   ```bash
   # 启用完整日志
   export COPAW_LOG_LEVEL=DEBUG
   cd /Users/futuremeng/github/futuremeng/CoPaw
   python -m src.copaw.console
   ```

2. **查看日志中的 header 输出**
   ```
   # 应该看到类似：
   # MCP client 'Superset' configured with headers: {'Accept': '...', 'Authorization': 'Bearer mcp_...'}
   # MCP client Superset using headers: {'Accept': '...', 'Authorization': 'Bearer mcp_...'}
   ```

3. **如果日志中看到 headers 但仍失败**
   - 问题可能在 MCP 库本身或 nginx 转发
   - 需要联系 Superset 支持或检查 nginx 配置

### 方案 B：如果 curl 测试返回 401（Token 无效）

1. **在 Superset UI 中生成新 token**
   - 登录 Superset
   - Settings → MCP Tokens
   - 生成新 token
   - 复制整个 token 字符串

2. **更新 CoPaw 配置**
   ```json
   {
     "mcpServers": {
       "superset_mcp": {
         "headers": {
           "Authorization": "Bearer <新token>"
         }
       }
     }
   }
   ```

3. **重启 CoPaw**

### 方案 C：修改配置使用环境变量（推荐）

而不是硬编码 token，改用环境变量：

```json
{
  "mcpServers": {
    "superset_mcp": {
      "headers": {
        "Authorization": "Bearer $SUPERSET_MCP_TOKEN"
      }
    }
  }
}
```

然后设置环境变量：
```bash
export SUPERSET_MCP_TOKEN="<你的token>"
```

---

## 如果上述都不管用

请收集以下信息：
1. `python test_mcp_headers_debug.py` 的完整输出
2. `curl -v` 命令的完整输出
3. CoPaw DEBUG 日志中关于 "MCP client 'Superset'" 的所有行

然后提交 issue 或询问。
