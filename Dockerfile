# ============================================================
# Stage 1: 构建阶段 —— 在 Node 环境下编译 lark-team-agent
# ============================================================
FROM node:24-slim AS lark-builder


RUN apt-get update && apt-get install -y git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . /build
RUN git clone https://github.com/Fengzhaopeng/lark-team-agent.git . \
    && npm install --ignore-scripts \
    && npm run build \
    && npm pack

# ============================================================
# Stage 2: 运行阶段 —— node:24-slim + uv
# ============================================================
FROM node:24-slim
# 安装运行时依赖：curl 用于安装 uv，tini 用于进程管理
RUN apt-get update \
    && apt-get install -y \
        ca-certificates \
        curl \
        tini \
        git \
    && rm -rf /var/lib/apt/lists/*

# 通过国内镜像安装 uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.cargo/bin:${PATH}"

# 设置 HOME 环境变量
ENV HOME=/app

# 1. 全局安装 Claude Code、lark-cli
RUN npm install -g @anthropic-ai/claude-code @larksuite/cli

# 2. 从构建阶段复制打包好的 lark-team-agent 并全局安装
COPY --from=lark-builder /build/*.tgz /tmp/lark-team-agent.tgz
RUN npm install -g /tmp/lark-team-agent.tgz \
    && rm /tmp/lark-team-agent.tgz
RUN groupadd -r appgroup && useradd -r -g appgroup appuser \
    && chown -R appuser:appgroup /app
# 设置工作目录
WORKDIR /app
USER appuser

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "lark-team-agent run --app-id ${LARK_CLI_APP_ID} --app-secret ${LARK_CLI_APP_SECRET}"]
