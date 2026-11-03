#!/bin/sh
# dsh-page-refresh-macos — relaunch helper.
#
# Runs detached from the DSH host so it outlives the process it is about to kill.
# The Windows counterpart (dsh-power.ps1) needed WMI because Electron hosts run
# inside a Windows job object that reaps detached children; macOS has no such
# mechanism, so a plain `setsid` session (spawn detached) is enough.
#
# Actions:
#   restart <pid> <port> <workdir> <logfile> <exec> <args...>
#   close   <pid> <port> <workdir> <logfile> <exec> <args...>
#
# Exit codes: 0 ok / 2 no pid given / 3 relaunch failed / 4 port never came back

set -u

MODE="${1:-restart}"
PID_TO_KILL="${2:-}"
PORT="${3:-3080}"
WORKDIR="${4:-$HOME}"
LOG="${5:-$HOME/.dsh/logs/dsh-power-macos.log}"
shift 5
EXEC="${1:-}"
[ $# -gt 0 ] && shift

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null || true
}

# A closed port refuses the connection (curl exit 7); an open one answers,
# even when the answer is 401. That is exactly the signal we need.
port_up() {
  /usr/bin/curl -s -o /dev/null -m 1 "http://127.0.0.1:${PORT}/" 2>/dev/null
}

wait_port() {
  # $1 = up|down, $2 = max tenths of a second
  want="$1"
  limit="${2:-100}"
  i=0
  while [ "$i" -lt "$limit" ]; do
    if [ "$want" = "up" ]; then
      port_up && return 0
    else
      port_up || return 0
    fi
    sleep 0.2
    i=$((i + 1))
  done
  return 1
}

kill_pid() {
  [ -n "$PID_TO_KILL" ] || return 2
  if ! /bin/kill -0 "$PID_TO_KILL" 2>/dev/null; then
    log "kill: pid $PID_TO_KILL already gone"
    return 0
  fi
  log "kill: SIGTERM -> $PID_TO_KILL"
  /bin/kill -TERM "$PID_TO_KILL" 2>/dev/null || true
  i=0
  while [ "$i" -lt 40 ]; do
    /bin/kill -0 "$PID_TO_KILL" 2>/dev/null || { log "kill: exited after TERM"; return 0; }
    sleep 0.25
    i=$((i + 1))
  done
  log "kill: TERM ignored after 10s, SIGKILL -> $PID_TO_KILL"
  /bin/kill -KILL "$PID_TO_KILL" 2>/dev/null || true
  sleep 0.5
  return 0
}

log "start action=$MODE pid=$PID_TO_KILL port=$PORT exec=$EXEC"

if [ "$MODE" = "close" ]; then
  # Small delay so the HTTP response is already on the wire.
  sleep 0.3
  kill_pid || { log "close: nothing to kill"; exit 2; }
  log "close: done"
  exit 0
fi

if [ -z "$EXEC" ]; then
  log "restart: no executable recorded, aborting"
  exit 3
fi

# 1. Let the HTTP response flush before the socket disappears.
sleep 0.8

# 2. Stop the old instance and make sure the port is actually released;
#    relaunching on a busy port only produces EADDRINUSE in the new process.
kill_pid || log "restart: no pid, assuming already stopped"
wait_port down 50 || log "restart: port $PORT still busy, relaunching anyway"

# 3. Relaunch with the recorded command in the original working directory.
cd "$WORKDIR" 2>/dev/null || cd "$HOME" 2>/dev/null || true
log "restart: spawning $EXEC $* (cwd=$(pwd))"
/usr/bin/nohup "$EXEC" "$@" >>"$LOG" 2>&1 &
NEW_PID=$!
log "restart: helper spawned pid=$NEW_PID"

# 4. Verify a listener actually comes back. "Spawned a process" is not
#    "restart succeeded" — the old plugin shipped that bug.
if wait_port up 300; then
  log "restart: port $PORT is listening again"
  exit 0
fi

log "restart: port $PORT did not return within 60s, giving up"
exit 4
