#!/usr/bin/env bash
# ============================================================
# 构建 + 内存测量：跑一次 next build，告诉你这台机器够不够内存
#
# 用法：
#   bash scripts/deploy/bench-build.sh              # 堆上限自动按内存选（小机 512MB）
#   HEAP=512 bash scripts/deploy/bench-build.sh     # 手动指定堆上限
#   HEAP=384 bash scripts/deploy/bench-build.sh --clean   # 冷构建（先清 .next/cache）
#
# 输出三个关键数：
#   1) 成功与否 + 耗时
#   2) node 进程树 RSS 峰值         —— 构建实际吃掉多少
#   3) MemAvailable 最低值          —— 全程还剩多少可用（>0 且不算小 = 撑得住）
#      这个最关键：如果最低值还有几百 MB，这台机器做构建没问题；
#      如果逼近 0 或者 swap 疯涨，说明得上更高配置或改成异地构建。
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/kecheng}"
# 项目真正的构建入口是 scripts/build.sh：pnpm install + next build + tsup 打包 dist/server.js
# 注意：生产跑的是 dist/server.js（自定义服务器），只用 next build 会缺产物，服务起不来
BUILD_CMD="${BUILD_CMD:-pnpm build}"
cd "$APP_DIR"

MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
HEAP="${HEAP:-}"
[ -n "$HEAP" ] || { [ "$MEM_MB" -lt 3000 ] && HEAP=512 || HEAP=1200; }

if [ "${1:-}" = "--clean" ]; then
  rm -rf .next
  echo "[冷构建] 已清空 .next"
fi

SAMPLE_FILE="$(mktemp /tmp/buildmem.XXXXXX)"
: > "$SAMPLE_FILE"

c_reset=$'\033[0m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_blue=$'\033[36m'

# 后台采样：每 0.3s 记一次 (node 进程树 RSS 合计 KB, MemAvailable KB, SwapUsed KB)
(
  while :; do
    rss="$(ps -eo rss,args --no-headers 2>/dev/null | awk '/next/ || /node/ { if ($0 ~ /awk/) next; s+=$1 } END {print s+0}')"
    avail="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
    swapused="$(awk '/^Swap:/ {print $3}' /proc/meminfo)"
    echo "${rss:-0} ${avail:-0} ${swapused:-0}" >> "$SAMPLE_FILE"
    sleep 0.3
  done
) &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

echo "${c_blue}==> 开始构建：$(pwd)，堆上限 ${HEAP}MB，机器总内存 ${MEM_MB}MB${c_reset}"
START="$(date +%s)"

set +e
NODE_OPTIONS="--max-old-space-size=${HEAP}" bash -c "$BUILD_CMD"
RC=$?
set -e

END="$(date +%s)"
kill $SAMPLER 2>/dev/null || true

read -r PEAK_RSS MIN_AVAIL MAX_SWAP < <(awk '
  NR==1 { peak=$1; mina=$2; maxs=$3; if (mina==0) mina=99999999 }
  { if ($1>peak) peak=$1; if ($2<mina && $2>0) mina=$2; if ($3>maxs) maxs=$3 }
  END { printf "%d %d %d\n", peak, mina, maxs }
' "$SAMPLE_FILE")
rm -f "$SAMPLE_FILE"

echo
echo "================ 构建内存报告 ================"
if [ "$RC" = "0" ]; then
  printf "${c_green}结果           : 成功${c_reset}\n"
else
  printf "${c_red}结果           : 失败（退出码 %s）${c_reset}\n" "$RC"
fi
printf "耗时           : %s 秒\n" "$((END-START))"
printf "堆上限         : %s MB\n" "$HEAP"
printf "node 进程树峰值: %s MB\n" "$((PEAK_RSS/1024))"
printf "可用内存最低值 : %s MB   %s\n" "$((MIN_AVAIL/1024))" \
  "$(awk -v v="$MIN_AVAIL" 'BEGIN{print (v/1024<100) ? "<-- 危险，几乎榨干" : (v/1024<300 ? "<-- 偏紧" : "<-- OK，还有余量")}')"
printf "swap 峰值用量  : %s MB   %s\n" "$((MAX_SWAP/1024))" \
  "$(awk -v v="$MAX_SWAP" 'BEGIN{print (v/1024>500) ? "<-- 大量走 swap，会很慢" : "<-- 正常"}')"
echo "=============================================="
echo
echo "口径说明：node 进程树峰值 = 主进程 + 并行编译 worker 的 RSS 合计；"
echo "          其中「可用内存最低值」最说明问题，接近 0 就是这台机器做构建会翻车。"

exit "$RC"
