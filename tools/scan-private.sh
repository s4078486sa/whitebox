#!/usr/bin/env bash
# 公开面的内部标识符扫描。
#
# 为什么存在：这个仓库有一个【公开的 GitHub 镜像】，构建产物还部署在
# 【公网】上。2026-09-06 复盘时发现 src/lib/tools/inspect.ts 的正则示例
# 文本里写着真实的内部邮箱，它被打进 _astro/*.js 并由 whitebox.judy2006969.me
# 匿名可读；.forgejo/workflows/ci.yml 的注释里写着内部 runner 主机名。
#
# 已有的门禁（类型检查、对比度、截断、隐私验收）没有一项会看这个 ——
# 检查项本身有盲区，而不是检查失败了。
#
# ⚠️ 扫描【工作区 + 完整 git 历史】：当前文件干净不代表历史干净，
#    而公开仓库的历史是匿名可按 SHA 访问的。
set -uo pipefail
cd "$(dirname "$0")/.."

# 只放【确定不该出现在公开面】的东西。不放 password/secret 这类泛词 ——
# 天天误报的门禁等于没有门禁。
# 注意没有 192.168.* —— CIDR 工具拿 RFC1918 段做示例是最自然的用法，
# 天天误报会让人去放宽整个门禁，那比漏掉一个通用私网段的风险大得多。
PAT='git\.utlas\.de|utlas-medium|horse-runner|EyebrowsWhite|eyebrowkang|mailpasta\.de|10\.233\.'
SELF='tools/scan-private.sh'

# 窄豁免：runner 标签是【功能性】的，CI 没它就永远 waiting 且不报错。
# 它只是个标签字符串，不含主机名/域名（真主机名 horse-runner01 已从注释里删掉）。
# 豁免具体到路径，不用通配 —— 否则真泄漏藏进这个文件也看不见。
EXEMPT='./.forgejo/workflows/ci.yml'

fail=0

# 1. 工作区（排除构建产物与依赖，它们是源码的函数）
hits=$(grep -rniE "$PAT" . \
        --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
        --exclude="$(basename "$SELF")" 2>/dev/null \
       | grep -vF "$EXEMPT:" || true)
if [ -n "$hits" ]; then
  echo "❌ 工作区含内部标识符："
  printf '%s\n' "$hits" | head -20
  fail=1
fi

# 2. 完整历史。用 git pathspec 排除本脚本，不能用 grep -v 过滤文件名 ——
#    脚本里的 PAT= 那一行本身不含 "scan-private" 字样，grep -v 挡不住它。
if [ -d .git ]; then
  hist=$(git log --all -p -- . ":(exclude)$SELF" 2>/dev/null | grep -niE "$PAT" | head -20)
  if [ -n "$hist" ]; then
    echo "⚠️  git 历史含内部标识符（改当前文件没用）："
    printf '%s\n' "$hist"
    echo "    公开镜像上旧 commit 仍可按 SHA 匿名访问 —— 只能删镜像重建。"
    # 历史问题不阻断本次构建（源码已修），但必须每次都喊出来。
  fi
fi

[ "$fail" -ne 0 ] && { echo; echo "扫描未通过。"; exit 1; }
echo "✅ 工作区未发现内部标识符"
