# 安全视频下载方案

## 概述

本系统实现了基于JWT token的安全视频下载方案，解决了多用户环境下的隐私保护问题，同时兼容IDM等下载器的断点续传功能。

## 核心特性

### 🔐 安全特性
- **JWT Token验证**: 每个下载链接都需要有效的JWT token
- **用户权限控制**: 只能下载自己处理的视频文件
- **时效性控制**: 下载链接默认1小时有效期
- **防盗链保护**: 无法通过直接访问文件路径下载

### 📥 下载特性
- **断点续传支持**: 完全兼容HTTP Range请求
- **IDM兼容**: 支持IDM、迅雷等下载器
- **流式传输**: 大文件不会占用过多内存
- **文件完整性**: 自动设置正确的Content-Type和文件名

## API接口

### 1. 生成安全下载链接

**接口**: `POST /api/video/generate-download-link`

**权限**: 需要用户登录

**请求参数**:
```json
{
  "fileName": "BV1234567890.mp4"
}
```

**响应示例**:
```json
{
  "code": 200,
  "message": "下载链接生成成功",
  "data": {
    "downloadUrl": "http://10.3.36.36:11111/api/video/secure-download?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2024-01-01T13:00:00.000Z"
  }
}
```

### 2. 安全文件下载

**接口**: `GET /api/video/secure-download`

**权限**: 通过token验证

**请求参数**:
- `token`: JWT验证token
- `file`: 文件名

**特性**:
- 支持HTTP Range请求（断点续传）
- 自动设置下载文件名
- 流式传输大文件

### 3. 直接下载（兼容接口）

**接口**: `GET /api/video/download/:bvid`

**权限**: 需要用户登录

**说明**: 为了兼容现有前端代码，提供直接通过BVID下载的接口

## 前端集成方案

### 方案一：临时下载链接（推荐）

```javascript
// 1. 生成安全下载链接
async function generateDownloadLink(fileName) {
  try {
    const response = await fetch('/api/video/generate-download-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({ fileName })
    });
    
    const result = await response.json();
    if (result.code === 200) {
      return result.data.downloadUrl;
    }
    throw new Error(result.message);
  } catch (error) {
    console.error('生成下载链接失败:', error);
    throw error;
  }
}

// 2. 使用下载链接
async function downloadVideo(fileName) {
  try {
    const downloadUrl = await generateDownloadLink(fileName);
    
    // 方式1: 直接跳转下载
    window.open(downloadUrl, '_blank');
    
    // 方式2: 创建隐藏链接下载
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
  } catch (error) {
    alert('下载失败: ' + error.message);
  }
}
```

### 方案二：直接下载（兼容方案）

```javascript
// 直接通过BVID下载
function downloadVideoByBVID(bvid) {
  const downloadUrl = `/api/video/download/${bvid}`;
  
  // 需要在请求头中包含认证信息
  fetch(downloadUrl, {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  }).then(response => {
    if (response.ok) {
      return response.blob();
    }
    throw new Error('下载失败');
  }).then(blob => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bvid}.mp4`;
    link.click();
    window.URL.revokeObjectURL(url);
  }).catch(error => {
    console.error('下载失败:', error);
  });
}
```

### 方案三：IDM等下载器集成

```javascript
// 生成可复制的下载链接，用户可以粘贴到IDM等下载器中
async function getDownloadLinkForIDM(fileName) {
  try {
    const downloadUrl = await generateDownloadLink(fileName);
    
    // 显示下载链接供用户复制
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                  background: white; padding: 20px; border: 1px solid #ccc; z-index: 1000;">
        <h3>下载链接（1小时内有效）</h3>
        <input type="text" value="${downloadUrl}" style="width: 500px;" readonly>
        <br><br>
        <button onclick="navigator.clipboard.writeText('${downloadUrl}')">复制链接</button>
        <button onclick="this.parentElement.parentElement.remove()">关闭</button>
        <p style="font-size: 12px; color: #666;">请将此链接粘贴到IDM、迅雷等下载器中</p>
      </div>
    `;
    document.body.appendChild(modal);
    
  } catch (error) {
    alert('生成下载链接失败: ' + error.message);
  }
}
```

## 技术实现细节

### JWT Token结构

```javascript
// Token payload
{
  "fileName": "BV1234567890.mp4",
  "userId": "123",
  "type": "download",
  "timestamp": 1704110400000,
  "iat": 1704110400,
  "exp": 1704114000
}
```

### 权限验证流程

1. **Token验证**: 验证JWT token的有效性和过期时间
2. **文件匹配**: 确认请求的文件名与token中的文件名一致
3. **用户权限**: 查询数据库确认用户是否有权限访问该文件
4. **文件存在**: 检查物理文件是否存在

### 断点续传实现

```javascript
// 支持HTTP Range请求
if (range) {
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  
  res.status(206); // Partial Content
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  
  const stream = fs.createReadStream(filePath, { start, end });
  stream.pipe(res);
}
```

## 安全优势

1. **隐私保护**: 用户只能下载自己的视频，无法访问他人文件
2. **防止盗链**: 无法通过直接URL访问文件
3. **时效控制**: 下载链接有时间限制，防止长期滥用
4. **审计追踪**: 所有下载行为都有日志记录
5. **权限细化**: 可以根据用户角色进一步细化权限

## 部署注意事项

1. **环境变量配置**:
   ```env
   SERVER_HOST=your-server-ip  # 服务器外网IP
   JWT_SECRET=your-jwt-secret  # JWT密钥
   ```

2. **HTTPS部署**: 生产环境建议使用HTTPS，确保token传输安全

3. **负载均衡**: 如果使用多台服务器，确保JWT_SECRET在所有服务器上一致

4. **文件存储**: 确保videos目录有足够的磁盘空间和适当的权限

## 兼容性说明

- ✅ 支持所有现代浏览器
- ✅ 兼容IDM、迅雷、FDM等下载器
- ✅ 支持移动端浏览器
- ✅ 支持curl、wget等命令行工具
- ✅ 完全兼容HTTP/1.1 Range请求规范

这个方案既保证了安全性，又保持了良好的用户体验和下载器兼容性。