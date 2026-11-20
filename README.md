# 型材工坊 · 铝型材结构搭建与力学优化平台

面向工业铝型材框架的 3D 参数化建模、空间受力分析、斜撑拓扑优化与一维下料排版工具。

**在线体验：** https://hana-ame.github.io/profile-workshop/

## 功能

- **3D 参数化画图**：基于 three.js 的型材框架建模，支持立柱 / 横梁 / 斜撑的增删与尺寸调整
- **空间有限元受力分析**：杆件体系刚度求解，输出轴力、弯矩与节点位移
- **侧移与稳定性校核**：框架整体侧移分析，判断斜撑方案是否满足刚度要求
- **截面与斜撑优化**：自动设计器与优化器给出斜撑布置方案，可与手工方案对比
- **下料排版**：一维下料（cutting stock）算法给出型材切割方案与用料统计
- **BOM 与导出**：料单汇总，支持导出结果

全部计算在浏览器内完成，无后端、无外部接口、不需要任何 API Key。

## 本地开发

```bash
bun install      # 或 npm install
bun run dev      # http://localhost:3000
bun run build    # 产物输出到 dist/
```

## 部署

由 GitHub Actions 自动发布，本地无需构建：

- 工作流：`.github/workflows/deploy.yml`
- 触发：推送到 `main`，或在 Actions 页面手动 `Run workflow`
- Pages 发布源：**GitHub Actions**（不使用 `gh-pages` 分支）
- 包管理器：Bun（仓库带 `bun.lock`，CI 里用 `bun install --frozen-lockfile`）

`vite.config.ts` 中设置了 `base: './'`，因此产物可部署在任意子路径下。

更新后推送即可：

```bash
git add -A && git commit -m "your change" && git push origin main
```
