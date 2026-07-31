# Desktop Orchestrator

Desktop Orchestrator 是 HanaAgent 的 Windows 桌面控制插件。

它可以先观察桌面、识别目标窗口和控件，再生成操作计划；只有安全检查、权限和确认条件全部满足时，才允许执行真实输入。默认情况下，真实点击、键盘输入和剪贴板回退都是关闭的。

适合以下场景：

- 读取当前桌面和窗口状态
- 查找按钮、输入框、列表项等 UI Automation 控件
- 操作 Win32、WinUI、WinForms、WPF 和 Chromium/Edge 窗口
- 处理网页 Canvas、自绘界面和普通原生 Direct2D 窗口
- 在 UIA 不可用时使用受保护的视觉定位
- 对操作做 dry-run 预览、审批、审计和结果验证

当前版本：**0.3.0-alpha.8**

---

## 一、安装

### 从 ZIP 安装

1. 下载 `desktop-orchestrator-0.3.0-alpha.8.zip`。
2. 在 HanaAgent 的插件安装入口导入这个 ZIP。
3. 重载或重启 HanaAgent。
4. 在插件设置中按需配置视觉模型和真实输入权限。

安装包应包含以下核心内容：

```text
manifest.json
index.js
lib/
tools/
routes/
helper/
scripts/
docs/
```

### 从源码开发

```powershell
cd C:\Users\Ganlin\Desktop\desktop-orchestrator-dev
npm install
npm run check
npm run final-regression
```

---

## 二、它是怎样工作的

一次安全的桌面操作通常经过下面几步：

```text
观察桌面
  → 找到目标窗口
  → 读取 UIA 或截图
  → 创建短期目标身份
  → 生成 dry-run 计划
  → 检查权限和审批证据
  → 执行操作
  → 重新读取并验证结果
```

插件不会把坐标当作永久有效的目标。窗口变化、页面刷新、控件替换或截图过期后，目标可能失效，系统会拒绝继续操作。

---

## 三、最重要的安全规则

### 默认只观察，不执行真实输入

以下设置默认都是关闭的：

- `allowRealInput`
- `allowRealMouseMove`
- `allowKeyboardInput`
- `allowClipboardInput`

关闭这些设置时，高风险工具只返回 dry-run 计划，不会点击、输入、拖动、滚动或关闭窗口。

### 真实操作需要多重条件

真实输入通常同时需要：

1. 工具参数中的 `dryRun: false`
2. 开启 `allowRealInput`
3. 对应的鼠标、键盘或剪贴板开关
4. 当前权限模式允许
5. 目标窗口仍然存在并且处于前台
6. UIA 目标的 lease 和签名仍然有效
7. 坐标操作通过命中窗口校验
8. 需要确认时提供准确短语：

```text
I_UNDERSTAND_DESKTOP_INPUT
```

### 安全模式

| 模式 | 行为 |
| --- | --- |
| `safe` | 默认模式。观察和 dry-run 可以使用；真实动作需要确认。 |
| `auto-review` | 普通动作可以按策略执行，敏感和破坏性动作仍需确认。 |
| `full-access` | 放宽普通和部分敏感动作的默认确认，但破坏性动作仍保留确认边界。 |

权限模式本身不会自动打开真实输入。`allowRealInput` 仍然是总开关。

### 永远保留的底线

- 窗口关闭、外部发送、提交、发布、支付和凭据相关动作不能静默放行。
- 审批 token 必须是非可执行 token。
- 过期 token、篡改 token、旧版本 token 和签名不匹配都会被拒绝。
- final execution envelope 只生成 dry-run 结果，不直接执行动作。
- 所有重要事件都会写入本地审计时间线。

---

## 四、功能总览

### 1. 桌面观察

- 获取全屏或指定窗口状态
- 获取窗口标题、进程、句柄、边界和前台状态
- 读取窗口的 UIA 元素树
- 查找按钮、输入框、列表项、AutomationId 和控件模式
- 生成窗口级可操作控件摘要

### 2. UIA 语义操作

- 按 lease、元素签名和窗口身份点击控件
- 使用 ValuePattern 给输入框赋值
- 在 ValuePattern 不可用时，按安全条件选择键盘或剪贴板回退
- 验证控件是否仍然是原来的目标
- 对 WinUI 外层容器中的后代输入控件进行受证明的焦点校验

### 3. 窗口操作

- 聚焦窗口
- 移动和调整窗口大小
- 最小化、最大化、还原窗口
- 关闭窗口

窗口关闭属于破坏性动作，会经过单独的确认和窗口身份校验。

### 4. 鼠标操作

- 指定坐标点击
- 拖动
- 滚轮
- 受保护的普通点击计划

坐标点击前会检查目标点实际命中的窗口是否与预期窗口一致，防止窗口漂移或焦点变化导致误点。

### 5. 视觉和自绘界面

- 捕获窗口或屏幕截图
- 将截图交给视觉模型定位目标
- 返回坐标契约和点击计划
- 对 Canvas、自绘控件和 GPU-like 界面执行受保护视觉点击
- 点击后重新截图，比较状态变化

已经验证的场景包括：

- Chromium/Edge 网页输入控件
- Chromium/Edge Canvas
- 普通原生 Direct2D 窗口

视觉路径只能证明像素位置，不能取代窗口命中校验、前台校验和点击后验证。

### 6. 审查驾驶舱和审计

Widget `/widget` 提供：

- 最近审批 bundle 查看
- 光标预演
- 区域预览
- 审批检查清单
- dry-run 执行前检查
- final dry-run envelope
- self-check
- 协议测试矩阵
- fixture sandbox
- cockpit summary
- 审计时间线
- 审计证据 JSON 导出
- 动作级确认策略管理

---

## 五、全部工具

### 观察和规划

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_snapshot` | 获取全屏或窗口状态，可选截图。 |
| `desktop-orchestrator_list-windows` | 列出当前可见顶层窗口。 |
| `desktop-orchestrator_ui-tree` | 读取窗口范围内的 UIA 元素，并生成短期 lease。 |
| `desktop-orchestrator_find-control` | 按名称、AutomationId、角色、类名或模式查找控件。 |
| `desktop-orchestrator_inspect-window` | 汇总窗口中的按钮、输入区、导航项和状态文本。 |
| `desktop-orchestrator_plan-action` | 把自然语言操作意图转换为受保护的动作计划。 |

### UIA 和文本输入

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_click-element` | 按 lease 和元素签名点击 UIA 控件。 |
| `desktop-orchestrator_type-element` | 通过 ValuePattern 输入文字，必要时走键盘或剪贴板回退。 |
| `desktop-orchestrator_verify-action` | 复查 lease 绑定的元素和签名。 |

### 窗口和鼠标

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_focus-window` | 聚焦指定窗口。 |
| `desktop-orchestrator_manage-window` | 移动、缩放、最小化、最大化、还原或关闭窗口。 |
| `desktop-orchestrator_protected-click` | 生成或执行受保护点击。 |
| `desktop-orchestrator_mouse-click-at` | 在物理屏幕坐标执行带命中守卫的点击。 |
| `desktop-orchestrator_mouse-drag` | 执行带窗口守卫的鼠标拖动。 |
| `desktop-orchestrator_mouse-wheel` | 在指定位置执行带窗口守卫的滚轮操作。 |

### 视觉和截图

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_vision-click` | 截图并生成视觉点击定位结果，不直接点击。 |
| `desktop-orchestrator_vision-query` | 把截图发送给视觉模型，询问坐标或画面信息。 |
| `desktop-orchestrator_visual-verify` | 对 lease 绑定区域采样并比较视觉签名。 |
| `desktop-orchestrator_region-preview` | 生成 lease 绑定区域的 PNG 预览。 |

### 控制会话

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_create-control-session` | 创建有 TTL、范围和动作额度的本地控制会话。 |
| `desktop-orchestrator_inspect-control-session` | 查看控制会话状态和剩余额度。 |
| `desktop-orchestrator_revoke-control-session` | 撤销控制会话。 |

### 安全检查和审计

| 工具 | 用途 |
| --- | --- |
| `desktop-orchestrator_self-check` | 读取本地协议存储并检查安全门状态。 |
| `desktop-orchestrator_protocol-test-matrix` | 测试 token、审批 bundle、确认和 dry-run 拒绝路径。 |
| `desktop-orchestrator_fixture-sandbox` | 用纯内存 fixture 测试允许和阻断场景。 |
| `desktop-orchestrator_cockpit-summary` | 汇总三类安全检查并返回健康状态。 |

---

## 六、配置说明

| 配置项 | 作用 | 默认值 |
| --- | --- | --- |
| `allowRealInput` | 真实输入总开关。关闭时只返回 dry-run。 | `false` |
| `allowRealMouseMove` | 允许坐标点击、拖动和滚轮移动真实鼠标。 | `false` |
| `allowKeyboardInput` | 允许 UIA 失败后的键盘回退。 | `false` |
| `allowClipboardInput` | 允许纯文本剪贴板回退。 | `false` |
| `permissionMode` | 权限模式：`safe`、`auto-review`、`full-access`。 | `safe` |
| `confirmationPolicy` | 旧版全局确认策略，动作级策略优先。 | 空 |
| `actionConfirmation` | 为具体动作设置 `auto` 或 `confirm`。 | `{}` |
| `defaultSnapshotFormat` | 默认截图格式：`png` 或 `jpeg`。 | `png` |
| `maxWindowResults` | 窗口列表返回数量上限。 | `40` |
| `visionApiBase` | 视觉模型 API 地址。 | 空 |
| `visionApiKey` | 视觉模型 API Key。 | 空 |
| `visionModel` | 视觉模型名称。 | 空 |

### 视觉模型配置

使用 `vision-query` 或 `vision-click` 前，需要配置兼容的视觉模型 API：

```text
visionApiBase
visionApiKey
visionModel
```

没有配置时，视觉工具会返回配置提示，不会假装定位成功。

---

## 七、推荐使用方式

### 只读观察

适合先了解桌面状态：

```text
snapshot → list-windows → inspect-window
```

### 操作标准控件

```text
ui-tree → find-control → click-element/type-element → verify-action
```

### 操作自绘或 Canvas 界面

```text
snapshot/vision-click → 人工确认目标 → 窗口命中校验 → 点击 → 截图验证
```

### 开启真实输入前

建议先保持所有真实输入开关关闭，观察 dry-run 计划；确认目标、窗口和动作都正确后，再按需要打开最小权限。

---

## 八、兼容性和已验证场景

| 场景 | 结果 |
| --- | --- |
| WinUI / Notepad | UIA、ValuePattern、键盘回退、剪贴板回退已验证。 |
| WinForms | UIA、后代焦点、键盘回退、剪贴板回退已验证。 |
| WPF | UIA、后代焦点、键盘回退、剪贴板回退已验证。 |
| Chromium / Edge 网页控件 | ValuePattern、键盘回退、剪贴板回退已验证。 |
| Chromium / Edge Canvas | UIA 只能看到 Canvas surface，视觉点击链路已验证。 |
| 原生 Direct2D 窗口 | `D2D1_RENDER_TARGET_TYPE_DEFAULT`、PrintWindow 和视觉点击已验证。 |

---

## 九、已知边界

以下场景不应直接套用普通窗口或 Direct2D 的结论：

- 独占全屏 DirectX 或 Vulkan
- 硬件 overlay 表面
- 受保护的视频表面
- 带反作弊保护的游戏或应用
- 需要登录、验证码或外部通信确认的界面
- 视觉模型返回坐标不稳定的复杂画面

视觉捕获可能受到 GPU 合成、窗口遮挡、DPI、窗口移动和黑屏的影响。遇到截图过期、窗口漂移、目标不确定或命中窗口不一致时，插件应 fail-closed。

---

## 十、审计和数据位置

临时安全数据默认保存在：

```text
%TEMP%\hana-desktop-orchestrator\
```

主要文件包括：

```text
approval-token-store.json
control-session-store.json
audit-timeline.json
```

审计时间线包含事件哈希链。证据导出通过 Widget API 完成：

```text
POST /api/audit-evidence-export
```

导出只生成本地 JSON 证据包，不执行桌面输入，也不会修改审批状态。

---

## 十一、开发和发布检查

```powershell
npm run check:syntax
npm run check:package
npm run smoke:package
npm run install-smoke:package
npm run final-regression
```

构建安装包：

```powershell
npm run build:package
```

构建器使用稳定文件顺序和固定归档时间戳。同一源码连续构建应得到相同的 ZIP SHA-256。

---

## 十二、设计原则

Desktop Orchestrator 的核心原则很简单：

> **先确认自己控制的是什么，再去控制它。**

UIA 语义路径优先，视觉和坐标路径作为受保护的后备方案；默认 dry-run；目标身份、窗口身份、前台状态、确认和结果验证缺一不可。
