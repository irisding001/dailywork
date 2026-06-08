---
name: attendance
description: >
  出勤 Dashboard 生成与管理工具。用于生成、刷新或查看团队出勤月度日历 Dashboard（MY 转化客服组 / US 转化客服组）。
  脚本从 duty.futuoa.com 拉取真实出勤和休假数据，生成 HTML 文件并自动打开。
  当用户说"刷新出勤"、"看出勤"、"生成考勤"、"出勤 dashboard"、"更新考勤 cookie"、"出勤数据"、
  "attendance"、"看一下休假"、"考勤记录" 等相关内容时，必须使用此 skill。
---

# 出勤 Dashboard Skill

## 脚本信息

- **脚本路径**：`C:\Users\irisding\attendance_fetch.js`
- **输出文件**：`C:\Users\irisding\attendance_dashboard.html`（生成后自动用浏览器打开）
- **运行命令**：`node attendance_fetch.js`（在 `C:\Users\irisding\` 目录下执行）

## 数据说明

- **数据来源**：duty.futuoa.com 内部考勤系统
- **认证方式**：硬编码在脚本顶部的 `COOKIES` 常量（基于浏览器 Cookie）
- **覆盖团队**：MY 转化客服组（马来西亚）、US 转化客服组（美国）
- **默认月份**：当前月

## 默认行为

**每次触发此 skill，必须先自动运行脚本刷新数据，再告知用户结果。** 无需询问是否刷新，直接执行：

```bash
cd C:/Users/irisding && node attendance_fetch.js
```

脚本运行成功后（输出 `Saved:`），告知用户"已刷新，Dashboard 已打开"。
如果脚本报错，按下方"Cookie 过期处理"引导用户更新 Cookie。

## 常见任务

### 1. 生成 / 刷新 Dashboard

直接运行脚本：

```bash
cd C:/Users/irisding && node attendance_fetch.js
```

脚本会自动：
1. 拉取当月所有日度出勤记录（分页，每页 20 条）
2. 拉取月度汇总统计（迟到/早退/休假人次）
3. 对每位员工调用 vacationApprove API 获取真实休假记录
4. 生成 HTML 并用 `start ""` 打开

### 2. Cookie 过期处理

如果脚本报错（API 返回非 0 code 或 HTML 解析失败），通常是 Cookie 过期。

解决步骤：
1. 用浏览器登录 https://duty.futuoa.com/admin/attendDaily
2. 打开开发者工具 → Network → 任意请求 → 复制 `Cookie` header 值
3. 编辑脚本第 9 行的 `COOKIES` 常量，替换为新 Cookie

```js
const COOKIES = '粘贴新的 cookie 字符串';
```

### 3. 查看特定月份

目前脚本默认拉取**当前月**。如需查看其他月份，临时修改 `main()` 函数：

```js
// 在 main() 开头修改这几行
const monthStr = '2026-05';  // 改为目标月份
const start = '2026-05-01';
const end = '2026-05-31';
```

改完后运行脚本，完成后记得改回来（或提醒用户手动恢复）。

> 注：多月份 tab 切换功能正在开发中，完成后无需手动修改。

### 4. 添加新员工 / 团队

- **MY 团队**：筛选条件为 `department.includes('马来西亚')`
- **US 团队**：筛选条件为 `department.includes('美国')`
- 员工由 API 数据自动识别，无需手动配置

## 假种颜色对照

| 假种 | 颜色 |
|------|------|
| 年假 | 蓝色 #1565c0 |
| 病假 | 红色 #c0392b |
| 调休 / 加班转调休 | 紫色 #6a1b9a |
| 事假 | 橙色 #e65100 |
| 缺勤（无请假记录） | 灰色 #9e9e9e |

## 注意事项

- "缺勤" 逻辑：**以 vacationApprove 接口的真实审批记录为准**，若无审批记录则显示全勤
- 公休日（shiftName === '公休'）显示为灰底，不显示人员状态
- 未来日期若有已批假期，仍会显示休假信息
- 日期计算使用本地时区（避免 UTC 偏移导致日期错位）
