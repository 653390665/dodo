# 实施计划: 将单元测试与运行期冒烟测试纳入 CI (078)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 将本地单元测试与运行期集成冒烟测试正式引入 GitHub Actions CI 管道，实现代码提交的自动化防线，杜绝未测试代码与鉴权失效代码混入主分支。
**Architecture:**1. **测试阶段集成**：在 `.github/workflows/build.yml` 的 `check` 工作流中，补充运行 `npm run test` 进行单元测试。
2. **冒烟阶段集成**：由于 `npm run smoke:runtime` 依赖后端 Express 服务运行，CI 步骤将通过后台拉起开发服务（`npm run dev &`），利用 Bash 纯原生轮询机制监听健康接口，并在服务就绪后执行冒烟，测试完成后通过进程信号安全回收后台服务。
**Tech Stack:** GitHub Actions, Bash, Node.js

---

## 任务分解 (Tasks)

### Task 1: 升级 CI 配置文件加入测试步骤
**Files:**
- [MODIFY] [.github/workflows/build.yml](file:///Users/Zhuanz/Documents/dodo-inkflow/.github/workflows/build.yml)

**步骤：**
- [ ] 1. 编辑 `build.yml` 的 `check` 工作流，在 `npm run lint` 步骤之后，增加运行单元测试：
  ```yaml
        - name: Run Unit Tests
          run: npm run test
  ```
- [ ] 2. 紧接着单元测试，增加拉起后台服务并执行运行期冒烟测试的步骤：
  ```yaml
        - name: Run Runtime Smoke Tests
          run: |
            # 1. 启动后台服务
            npm run dev &
            SERVER_PID=$!

            # 2. 轮询等待端口就绪 (最多等待 15 秒)
            echo "Waiting for InkFlow server to start..."
            for i in {1..15}; do
              if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/config | grep -q "401"; then
                echo "Server is ready (returned 401 as expected without token)."
                break
              fi
              sleep 1
            done

            # 3. 运行冒烟测试
            npm run smoke:runtime

            # 4. 清理后台服务进程
            kill $SERVER_PID
  ```

---

## 验证计划 (Verification)

### Drift Check
- 运行：
  ```bash
  git diff --stat ca53899..HEAD -- .github/workflows/build.yml
  ```

### 自动化与本地模拟测试
- **本地 CI 模拟运行**：
  在本地终端中完全模拟 CI 流程，运行：
  ```bash
  npm run dev &
  SERVER_PID=$!
  sleep 3
  npm run smoke:runtime
  kill $SERVER_PID
  ```
  预期：服务拉起成功，冒烟测试 100% 通过（exit 0），后台服务进程被干净利落地终止。
- **CI 触发验证**：
  提交修改并推送至远程，观察 GitHub Actions `Build` 工作流中的 `check` 阶段是否绿色通过。
