'use strict';

function detectRuntimeMode(environment = process.env, stdio = process) {
  if (environment.INVOCATION_ID || environment.JOURNAL_STREAM || environment.SYSTEMD_EXEC_PID) {
    return 'systemd';
  }

  if ((stdio.stdin && stdio.stdin.isTTY)
    || (stdio.stdout && stdio.stdout.isTTY)
    || (stdio.stderr && stdio.stderr.isTTY)) {
    return 'console';
  }

  return 'unknown';
}

module.exports = {
  detectRuntimeMode,
};
