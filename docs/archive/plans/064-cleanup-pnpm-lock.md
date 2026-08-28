# Plan 064: 清理 pnpm 冗余冲突配置文件

## Goal
清理项目根目录下残留的 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `.pnpm-store`，确保项目包管理规范完全对齐到 `npm`，避免混用包管理器导致依赖冲突。

## Proposed Changes

### [DELETE] [pnpm-lock.yaml](file:///Users/Zhuanz/Documents/dodo-inkflow/pnpm-lock.yaml)
### [DELETE] [pnpm-workspace.yaml](file:///Users/Zhuanz/Documents/dodo-inkflow/pnpm-workspace.yaml)
### [DELETE] [.pnpm-store](file:///Users/Zhuanz/Documents/dodo-inkflow/.pnpm-store)

## Verification Plan
1. 确保根目录下只有 `package-lock.json`。
2. 运行 `npm install` 确保依赖正常安装，没有任何 node-gyp 重建错误。
