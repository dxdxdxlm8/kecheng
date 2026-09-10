#!/usr/bin/env python3
# ============================================================
# 并发压测编排器
#
# 做三件事：
#   1) 把 loadtest-monitor.sh 传到目标服务器，后台启动资源采样
#   2) 在本机跑 loadtest.js 打流量（压测机与被测机分离，数据才干净）
#   3) 收拢服务端采样汇总 + 客户端吞吐延迟，打印合并报告
#
# 用法：
#   set SSH_PASS=xxxx
#   python run-loadtest.py \
#     --ssh-host 103.115.56.210 --ssh-port 22 --ssh-user root \
#     --target-host 103.115.56.210 --target-port 80 \
#     --conc 30 --duration 30 --assets --paths /student/login
#
# 依赖：paramiko（本机 venv 已装）
# ============================================================
import argparse
import os
import re
import subprocess
import sys
import time

try:
    import paramiko
except ImportError:
    sys.exit("缺少 paramiko，请先安装：pip install paramiko")

HERE = os.path.dirname(os.path.abspath(__file__))


def run_ssh(ssh, cmd, timeout=120):
    """执行远程命令，返回 (exit_code, stdout, stderr)"""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssh-host", required=True, help="被压测服务器的 SSH 地址")
    ap.add_argument("--ssh-port", type=int, default=22)
    ap.add_argument("--ssh-user", default="root")
    ap.add_argument("--ssh-pass", default=os.environ.get("SSH_PASS"))
    ap.add_argument("--target-host", required=True, help="压测流量的目标（通常是服务器公网 IP）")
    ap.add_argument("--target-port", type=int, default=80)
    ap.add_argument("--conc", type=int, default=30, help="并发虚拟用户数")
    ap.add_argument("--duration", type=int, default=30, help="统计时长（秒）")
    ap.add_argument("--warmup", type=int, default=3, help="预热秒数")
    ap.add_argument("--ramp", type=int, default=0, help="并发爬坡秒数")
    ap.add_argument("--assets", action="store_true", help="同时拉取页面引用的 _next 静态资源")
    ap.add_argument("--paths", default="/student/login")
    ap.add_argument("--label", default="")
    ap.add_argument("--node", default=os.environ.get("NODE_BIN", "node"))
    ap.add_argument("--local-script", default=os.path.join(HERE, "loadtest.js"))
    ap.add_argument("--monitor-script", default=os.path.join(HERE, "loadtest-monitor.sh"))
    args = ap.parse_args()

    if not args.ssh_pass:
        sys.exit("未提供 SSH 密码：用 --ssh-pass 或环境变量 SSH_PASS")

    label = args.label or f"{args.conc}并发{'/全资源' if args.assets else '/仅页面'}"
    print(f"\n{'='*62}\n[压测] {label}  目标 http://{args.target_host}:{args.target_port}  时长 {args.duration}s\n{'='*62}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(args.ssh_host, port=args.ssh_port, username=args.ssh_user,
                password=args.ssh_pass, timeout=20, banner_timeout=30, auth_timeout=30)

    mon_dur = args.warmup + args.duration + 6  # 留点余量覆盖预热和收尾
    sftp = ssh.open_sftp()
    sftp.put(args.monitor_script, "/tmp/loadtest-monitor.sh")
    sftp.close()

    rc, out, err = run_ssh(ssh, "bash -n /tmp/loadtest-monitor.sh && echo SYNTAX_OK")
    if "SYNTAX_OK" not in out:
        print("[警告] 监控脚本语法检查未通过：", out, err)

    # 记录压测前状态
    rc, pre, _ = run_ssh(ssh, "free -m | head -3; echo '---'; nproc; echo '---'; pm2 jlist 2>/dev/null | head -c 200")
    print("[压测前服务器状态]\n" + pre.strip())

    # nginx 访问日志起始行数：压测前后差值 = 服务端真实处理的请求数（铁证，不受客户端口径影响）
    def access_lines():
        _, o, _ = run_ssh(ssh, "[ -f /var/log/nginx/access.log ] && wc -l < /var/log/nginx/access.log || echo NOLOG")
        o = o.strip()
        return int(o) if o.isdigit() else None

    log0 = access_lines()
    if log0 is not None:
        print(f"[日志] nginx access.log 起始行数 {log0}")

    # 后台启动采样（setsid + nohup 保证 SSH 断开也继续）
    start_cmd = (
        f"cd /tmp && rm -f /tmp/loadtest_mon.txt /tmp/loadtest_mon.out && "
        f"setsid nohup bash /tmp/loadtest-monitor.sh {mon_dur} /tmp/loadtest_mon.txt "
        f"> /tmp/loadtest_mon.out 2>&1 < /dev/null & echo STARTED"
    )
    rc, out, err = run_ssh(ssh, start_cmd)
    if "STARTED" not in out:
        print("[错误] 采样器启动失败：", out, err)
    print("[监控] 服务端采样已启动，预计", mon_dur, "秒")

    time.sleep(2)  # 让采样器稳定下来再打流量

    # ---- 本机打流量 ----
    env = dict(os.environ)
    env.update({
        "TARGET_HOST": args.target_host,
        "TARGET_PORT": str(args.target_port),
        "CONC": str(args.conc),
        "DURATION": str(args.duration),
        "WARMUP": str(args.warmup),
        "RAMP": str(args.ramp),
        "PATHS": args.paths,
        "ASSETS": "1" if args.assets else "0",
        "NO_PROXY": "*", "no_proxy": "*",
    })
    t0 = time.time()
    proc = subprocess.run([args.node, args.local_script], env=env,
                          capture_output=True, text=True)
    print(proc.stderr.rstrip())
    client_json = None
    if proc.stdout.strip():
        try:
            client_json = json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:
            client_json = None
    if proc.returncode != 0:
        print("[错误] 压测生成器退出码", proc.returncode)

    # 服务端真实处理的请求数（nginx 日志差值）
    log1 = access_lines()
    server_served = None
    if log0 is not None and log1 is not None:
        server_served = log1 - log0
        print(f"[日志] nginx access.log 结束行数 {log1}  →  本次服务端实际处理 {server_served} 请求 "
              f"({server_served/args.duration:.1f}/s)  <-- 铁证，不受客户端口径影响")

    # ---- 等采样结束，收结果 ----
    deadline = time.time() + 40
    mon_out = ""
    while time.time() < deadline:
        rc, mon_out, err = run_ssh(ssh, "cat /tmp/loadtest_mon.out 2>/dev/null")
        if "RESULT_JSON" in mon_out:
            break
        time.sleep(3)

    print("\n" + mon_out.rstrip())

    # 解析机器可读结果
    server_json = None
    m = re.search(r"RESULT_JSON (\{.*\})", mon_out)
    if m:
        try:
            server_json = json.loads(m.group(1))
        except Exception:
            pass

    # ---- 合并结论 ----
    print(f"\n{'='*62}\n[合并结论] {label}\n{'='*62}")
    if client_json and server_json:
        h = client_json["html"]
        a = client_json["asset"]
        print(f"客户端  页面加载 {client_json['page_loads']} 次 ({client_json['page_loads_per_sec']}/s)"
              f"  总请求 {client_json['total_requests']} ({client_json['total_rps']}/s)")
        print(f"客户端  HTML p95={h['latency_ms']['p95']}ms max={h['latency_ms']['max']}ms err={h['errors']}"
              f" / 资源 p95={a['latency_ms']['p95']}ms err={a['errors']}")
        print(f"服务端  CPU 峰值 {server_json['cpu_peak']}%  均值 {server_json['cpu_avg']}%")
        print(f"服务端  可用内存最低 {server_json['mem_avail_min_mb']}MB  swap 峰值 {server_json['swap_peak_mb']}MB")
        print(f"服务端  node RSS 峰值 {server_json['node_rss_peak_mb']}MB  客户端连接峰值 {server_json['conn_peak']}")
        if server_served is not None:
            print(f"服务端  服务端实际处理 {server_served} 请求 ({server_served/args.duration:.1f}/s)  <-- nginx 日志口径")
        print(f"服务端  本机自测延迟 p50={server_json['self_lat_p50_ms']}ms "
              f"p95={server_json['self_lat_p95_ms']}ms max={server_json['self_lat_max_ms']}ms  <-- 不经公网")

        # 判定
        verdict = []
        if server_json["cpu_peak"] >= 95:
            verdict.append("CPU 打满（>=95%），已成瓶颈")
        elif server_json["cpu_peak"] >= 75:
            verdict.append("CPU 偏高（>=75%），余量紧张")
        else:
            verdict.append(f"CPU 很闲（峰值 {server_json['cpu_peak']}%）")
        if server_json["mem_avail_min_mb"] <= 60:
            verdict.append("内存逼近枯竭（可用<=60MB），高风险")
        elif server_json["mem_avail_min_mb"] <= 150:
            verdict.append("内存偏紧（可用<=150MB）")
        else:
            verdict.append(f"内存有余量（最低 {server_json['mem_avail_min_mb']}MB）")
        if server_json["swap_peak_mb"] > 100:
            verdict.append(f"发生了 {server_json['swap_peak_mb']}MB swap 换出，性能会抖")

        # 瓶颈定位：服务器自测延迟 vs 客户端延迟
        sl_p95 = server_json["self_lat_p95_ms"]
        cl_p95 = max(h["latency_ms"]["p95"], a["latency_ms"]["p95"])
        if sl_p95 > 0 and cl_p95 > 0:
            if sl_p95 < 50 and cl_p95 > sl_p95 * 5:
                verdict.append(f"★瓶颈不在服务器：服务器自测 {sl_p95}ms vs 客户端 {cl_p95}ms，差距在公网链路/带宽")
            elif sl_p95 >= 200:
                verdict.append(f"服务器自身处理就慢（自测 p95 {sl_p95}ms），需查 node/磁盘")

        errs = (h["errors"] + a["errors"])
        if errs > 0:
            verdict.append(f"出现 {errs} 次请求错误")
        else:
            verdict.append("零错误")
        print("判定    " + "；".join(verdict))
    else:
        print("未能拿到完整的客户端/服务端数据，请检查上面的输出。")

    # 保存原始采样数据供细看
    rc, csv, _ = run_ssh(ssh, "cat /tmp/loadtest_mon.txt 2>/dev/null")
    if csv.strip():
        slug = re.sub(r"[^0-9A-Za-z]+", "_", label)
        path = os.path.join(HERE, f".loadtest_{slug}.csv")
        with open(path, "w", encoding="utf-8") as f:
            f.write("ts,cpu_pct,mem_avail_mb,swap_used_mb,node_rss_mb,conn,loadavg,self_lat_ms\n" + csv)
        print(f"[明细] 服务端逐秒采样已存到 {path}")
    print(f"[耗时] 本次压测共 {round(time.time()-t0,1)}s\n")

    ssh.close()


if __name__ == "__main__":
    main()
