#!/usr/bin/env bash
# ============================================================
# 压测期间的服务端资源采样器（在目标服务器上跑）
#
# 用法：
#   bash loadtest-monitor.sh 40 /tmp/loadtest_mon.txt
#
# 每秒采样一行 CSV：
#   时间,CPU%,可用内存MB,swap用量MB,node RSS MB,客户端连接数,loadavg,本机自测延迟ms
#
# 「本机自测延迟」是关键诊断项：从服务器自己 curl 127.0.0.1:5000 打自己，
#   这条路径不经过公网。压测时如果它很低（几 ms）而客户端看到几百 ms，
#   说明瓶颈在公网带宽/链路，不在服务器处理能力。
#
# 跑完打印汇总 + 一行 RESULT_JSON 供编排脚本解析。
#
# 为什么不用 top：top 的一次性采样在 1s 内不准；这里用 /proc/stat 的
# 两次读数差分算真实 CPU 占用，最贴近 htop 的口径。
# 兼容性：不用 gawk 的 asort（Ubuntu 默认是 mawk），分位数用 sort 算。
# ============================================================
set -uo pipefail

DUR="${1:-40}"
OUT="${2:-/tmp/loadtest_mon.txt}"
APP_PORT="${APP_PORT:-5000}"
RSS_MATCH="${RSS_MATCH:-dist/server[.]js}"
SELF_PATH="${SELF_PATH:-/student/login}"
SS_BIN="$(command -v ss 2>/dev/null || echo /usr/sbin/ss)"

MEM_TOTAL_MB="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)"

read_cpu() { awk '/^cpu /{t=0; for(i=2;i<=11;i++) t+=$i; print t, ($5+$6)}' /proc/stat; }

: > "$OUT"
read -r PT PI <<< "$(read_cpu)"
END=$(( $(date +%s) + DUR ))
samples=0

while [ "$(date +%s)" -lt "$END" ]; do
  sleep 1
  # --- CPU：两次 /proc/stat 差分 ---
  read -r T I <<< "$(read_cpu)"
  dt=$((T - PT)); di=$((I - PI)); PT=$T; PI=$I
  cpu="$(awk -v dt="$dt" -v di="$di" 'BEGIN{ if(dt<=0) print "0.0"; else printf "%.1f",(1-di/dt)*100 }')"

  # --- 内存 ---
  avail_mb="$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)"
  swap_mb="$(awk '/^SwapTotal/{t=$2} /^SwapFree/{f=$2} END{printf "%d",(t-f)/1024}' /proc/meminfo)"

  # --- node 进程 RSS 合计 ---
  rss_mb="$(ps -eo rss,args --no-headers 2>/dev/null | awk -v re="$RSS_MATCH" '$0 ~ re && $0 !~ /awk/ {s+=$1} END{printf "%d", s/1024}')"

  # --- 客户端侧并发连接（本地端口 80/443 的 established）---
  # 注意：用绝对路径兜底，非交互式 shell 的 PATH 可能不含 /usr/sbin，ss 会静默失败返回 0
  conn="$("$SS_BIN" -Htn state established 2>/dev/null | awk '$3 ~ /:(80|443)$/ {c++} END{print c+0}')"

  # --- loadavg ---
  load="$(awk '{print $1}' /proc/loadavg)"

  # --- 本机自测延迟（不经过公网）---
  self_s="$(curl -s -o /dev/null --noproxy '*' -w '%{time_total}' -m 5 "http://127.0.0.1:${APP_PORT}${SELF_PATH}" 2>/dev/null)"
  self_ms="$(awk -v v="${self_s:-0}" 'BEGIN{printf "%.0f", v*1000}')"

  ts="$(date +%H:%M:%S)"
  printf "%s,%s,%s,%s,%s,%s,%s,%s\n" "$ts" "$cpu" "$avail_mb" "$swap_mb" "$rss_mb" "$conn" "$load" "$self_ms" >> "$OUT"
  samples=$((samples + 1))
done

# ---- 自测延迟分位数（用 sort，避免依赖 gawk 的 asort）----
mapfile -t SELF_ARR < <(cut -d, -f8 "$OUT" | sort -n)
SN=${#SELF_ARR[@]}
if [ "$SN" -gt 0 ]; then
  SELF_P50="${SELF_ARR[$((SN*50/100))]}"
  IDX=$((SN*95/100)); [ "$IDX" -ge "$SN" ] && IDX=$((SN-1))
  SELF_P95="${SELF_ARR[$IDX]}"
  SELF_MAX="${SELF_ARR[$((SN-1))]}"
else
  SELF_P50=0; SELF_P95=0; SELF_MAX=0
fi

SUMMARY_AWK='
NR==1{ minA=$3; maxS=$4; maxR=$5; maxC=$6; maxL=$7; firstS=$4 }
{
  if($2>maxCpu) maxCpu=$2;
  if(NR==1 || $2<minCpu) minCpu=$2;
  if($3<minA) minA=$3;
  if($4>maxS) maxS=$4;
  if($5>maxR) maxR=$5;
  if($6>maxC) maxC=$6;
  if($7>maxL) maxL=$7;
  sc+=$2; n++;
}
END{
  printf "CPU 峰值 / 均值   : %s%% / %.1f%%\n", maxCpu, (n?sc/n:0);
  printf "CPU 最低值        : %s%%\n", minCpu;
  printf "可用内存最低值    : %s MB\n", minA;
  printf "swap 峰值用量     : %s MB  (起始 %s MB)\n", maxS, firstS;
  printf "node RSS 峰值     : %s MB\n", maxR;
  printf "客户端连接峰值    : %s\n", maxC;
  printf "loadavg 峰值      : %s\n", maxL;
  printf "本机自测延迟 p50/p95/max : %s / %s / %s ms   <-- 不经公网，纯服务器处理耗时\n", p50, p95, smax;
  printf "RESULT_JSON {\"samples\":%d,\"cpu_peak\":%s,\"cpu_avg\":%.1f,\"mem_avail_min_mb\":%d,\"swap_peak_mb\":%d,\"node_rss_peak_mb\":%d,\"conn_peak\":%d,\"loadavg_peak\":%s,\"self_lat_p50_ms\":%d,\"self_lat_p95_ms\":%d,\"self_lat_max_ms\":%d}\n", n, maxCpu, (n?sc/n:0), minA, maxS, maxR, maxC, maxL, p50, p95, smax;
}'

echo "================ 服务端资源汇总 ================"
echo "机器              : $(nproc) 核 / ${MEM_TOTAL_MB} MB 内存"
echo "采样点数          : ${samples}"
awk -F, -v p50="$SELF_P50" -v p95="$SELF_P95" -v smax="$SELF_MAX" "$SUMMARY_AWK" "$OUT"
echo "================================================"
