# InkFlow 墨影 — 当前状态 C4 模型
#
# 用途：回答「这个系统是什么、谁在用、越过哪条边界、运行时由哪些可部署单元组成」。
# 受众：新加入的工程师 / 需要判断改动落点的维护者。
# 状态：全部 current-state（2026-09-18 仓库实态），无目标态节点。
# 证据：inkflow.evidence.md；低置信节点在描述里显式写「推断」。
# 语法：person/softwareSystem 最多 3 个位置串，container 最多 4 个，关系最多 3 个可选串。
# 查看：用 Qoder 的 Structurizr DSL 预览器打开本文件。渲染件是派生物，本文件是事实源。
# 内部模块拆分不在这里 —— 23 组路由压进 C4 component 视图会不可读，改用 module-map.dot。

workspace "InkFlow 墨影" "受治理的本地优先 AI 写作助手 —— 当前状态架构模型" {

  model {

    author = person "小说作者" "唯一使用者。对本机数据有完全所有权；对 AI 产出行使裁决权（接受/拒绝），系统不做无人值守放行"

    # ---------- 外部系统：只在后端一侧被触达 ----------
    llm = softwareSystem "外部大模型服务 (BYOK)" "用户自带 API Key。四类渠道：Google Gemini 原生、DeepSeek、MiniMax、OpenAI 兼容接口" {
      tags "External, Ai"
    }

    hfhub = softwareSystem "HuggingFace 模型仓库" "本地嵌入模型权重来源。仅推断：仓库代码未设置 cacheDir，打包态实际落点未在运行时度量" {
      tags "External"
    }

    # ---------- 本系统 ----------
    inkflow = softwareSystem "InkFlow 墨影" "本地优先 AI 写作助手。核心契约：AI 产出先成为候选，作者明确确认后才写入 Canon 或正文" {

      renderer = container "渲染层 SPA" "React 单页外壳。无客户端路由库，用视图枚举 + 焦点状态手工切换；承载候选审阅与裁决交互" "React 19 / Vite 7 / Zustand 5 / Tailwind 4 / Radix UI" {
        tags "Frontend"
      }

      api = container "Express API 服务" "唯一的后端、也是唯一的数据写入者。同时暴露 75 方法白名单 RPC 面与领域 REST 路由；持有 LLM 编排、能力治理门、生成与落库两道质量门" "Node.js / Express 5 / TypeScript / zod 4" {
        tags "Backend, Governance"
      }

      shell = container "Electron 主进程外壳" "派生并守护后端子进程；stdout 端口握手；身份探活后才加载；关闭前渲染层落盘握手；safeStorage 密钥保管" "Electron 43 / CommonJS" {
        tags "Desktop, Lifecycle"
      }

      localai = container "本地向量引擎" "离线 feature-extraction，512 维 q8；失败时降级到 LLM 嵌入，无 Key 则抛 EmbeddingUnavailableError 而非伪造结果" "@huggingface/transformers + onnxruntime-node" {
        tags "Ai, LocalOnly"
      }

      db = container "data.db" "SQLite 单文件库，28 张表，WAL 模式。路径 ~/.inkflow/data.db —— 开发态与打包态一致，永不进 bundle" "better-sqlite3 / WAL / foreign_keys=ON" {
        tags "Database, LocalOnly"
      }

      localfiles = container "本机配置与密钥文件" "~/.inkflow 下 config.json、.auth-token、.server-identity、启动一致性快照 .bak、导入导出临时文件；统一 0600" "文件系统" {
        tags "Filesystem, LocalOnly, Sensitive"
      }

      # ---------- 容器内关系 ----------
      renderer -> api "读写数据与调用生成" "HTTP over 127.0.0.1 (POST /api/db RPC + /api/* REST)"
      api -> renderer "数据变更推送：写后 notify，前端 500ms 尾部合并，按 x-client-id 抑制自回声" "SSE /api/db/events" "Async"
      api -> db "读；写入经 FIFO 串行队列 + databaseGeneration 乐观并发守卫" "SQL"
      api -> db "备份与导入一律走原生 db.backup() 一致性快照；禁止物理拷贝运行中的主库" "SQLite backup API" "Backup"
      api -> localai "为章节建立语义索引与相似检索" "in-process"
      api -> localfiles "读写配置、Bearer 令牌、服务身份令牌、导出临时文件" "fs 0600"
      shell -> api "打包态以 ELECTRON_RUN_AS_NODE 派生子进程；从 stdout 解析 {port}；重启前 pin 端口" "child_process + HTTP"
      shell -> renderer "固定 8 方法桥接，不暴露 require/fs/通用 IPC" "preload IPC (contextIsolation + sandbox)"
      shell -> localfiles "safeStorage 加密保管 API Key，绝不写进 config.json" "fs"
      localai -> hfhub "首次运行拉取模型权重（推断，低置信）" "HTTPS" "Inferred"
    }

    # ---------- 系统级关系（必须写在 model 内） ----------
    author -> renderer "码字、走开书向导、审阅候选并点下接受或拒绝"
    api -> llm "生成正文、审稿、拆书萃取、故事卡；失败按 ProviderError 分类重试与参数降级" "HTTPS"
  }

  views {

    systemContext inkflow "01-system-context" {
      include *
      autolayout tb
    }

    container inkflow "02-containers" {
      include *
      autolayout tb
    }

    styles {
      element "Person" {
        shape person
        background #1a1f2e
        color #ffd54f
        border #ffd54f
      }
      element "External" {
        background #37474f
        color #b0bec5
        border #78909c
      }
      element "Backend" {
        background #1b3a4b
        color #e1f5fe
        border #4dd0e1
      }
      element "Frontend" {
        background #2e1a47
        color #f3e5f5
        border #b39ddb
      }
      element "Database" {
        shape cylinder
        background #1b3320
        color #b9f6ca
      }
      element "Ai" {
        shape hexagon
        background #4a3208
        color #ffe082
      }
      element "Filesystem" {
        shape folder
        background #263238
        color #b0bec5
      }
      element "Desktop" {
        background #2a1f4a
        color #d1c4e9
      }
      element "Governance" {
        shape RoundedBox
        border #ef5350
        strokeWidth 3
      }
      element "LocalOnly" {
        border #66bb6a
        strokeWidth 2
      }
      element "Sensitive" {
        border #ef5350
      }
      relationship "Async" {
        style Dashed
        color #4dd0e1
      }
      relationship "Backup" {
        style Dashed
        color #66bb6a
      }
      relationship "Inferred" {
        style Dotted
        color #9e9e9e
      }
    }

    theme default
  }
}
