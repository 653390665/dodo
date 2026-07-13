import { spawn } from 'node:child_process';
import readline from 'node:readline';

// Define ANSI codes for exquisite terminal styling
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BG_DARK = '\x1b[40m';

// Setup tasks to be monitored concurrently
const tasks = [
  {
    id: 'lint',
    name: 'Lint Style Check',
    command: 'npm',
    args: ['run', 'lint'],
    status: 'PENDING', // PENDING, RUNNING, PASSED, FAILED
    elapsed: 0,
    startTime: 0,
    output: '',
    error: '',
  },
  {
    id: 'typecheck',
    name: 'Type Compiler Check',
    command: 'npm',
    args: ['run', 'typecheck'],
    status: 'PENDING',
    elapsed: 0,
    startTime: 0,
    output: '',
    error: '',
  },
  {
    id: 'test_backend',
    name: 'Backend Unit Tests',
    command: 'npm',
    args: ['run', 'test'],
    status: 'PENDING',
    elapsed: 0,
    startTime: 0,
    output: '',
    error: '',
  },
  {
    id: 'test_frontend',
    name: 'Frontend Unit Tests',
    command: 'npm',
    args: ['run', 'test:frontend'],
    status: 'PENDING',
    elapsed: 0,
    startTime: 0,
    output: '',
    error: '',
  }
];

const isTTY = process.stdout.isTTY;

function drawDashboard() {
  if (!isTTY) return;

  // Clear entire terminal and move cursor to top-left
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  console.log(`${BG_DARK}${CYAN}┌────────────────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BG_DARK}${CYAN}│${RESET}                 ${BOLD}${MAGENTA}🌸 InkFlow Merge Guard watchdog Console 🌸${RESET}               ${BG_DARK}${CYAN}│${RESET}`);
  console.log(`${BG_DARK}${CYAN}└────────────────────────────────────────────────────────────────────────┘${RESET}`);
  console.log('');

  for (const task of tasks) {
    let statusStr = '';
    let elapsedStr = `${task.elapsed.toFixed(1)}s`;

    if (task.status === 'PENDING') {
      statusStr = `${DIM}[PENDING]${RESET}`;
      elapsedStr = '-';
    } else if (task.status === 'RUNNING') {
      const dots = '.'.repeat(1 + (Math.floor(Date.now() / 300) % 3));
      const padDots = dots.padEnd(3, ' ');
      statusStr = `${BOLD}${BLUE}[RUNNING${padDots}]${RESET}`;
    } else if (task.status === 'PASSED') {
      statusStr = `${BOLD}${GREEN}[PASSED]  ${RESET}`;
    } else if (task.status === 'FAILED') {
      statusStr = `${BOLD}${RED}[FAILED]  ${RESET}`;
    }

    const taskNameStr = task.name.padEnd(25, ' ');
    console.log(`  ${statusStr}  ${taskNameStr} ........................ ${elapsedStr}`);
  }

  console.log('');
  console.log(`${DIM}──────────────────────────────────────────────────────────────────────────${RESET}`);

  // Display log outputs for failures or latest details
  const failedTasks = tasks.filter(t => t.status === 'FAILED');
  if (failedTasks.length > 0) {
    console.log(`${BOLD}${RED}⚠️ 故障警报 / Failures detected:${RESET}`);
    for (const task of failedTasks) {
      console.log(`\n${BOLD}${RED}=== ${task.name} Failure Log ===${RESET}`);
      const lines = (task.error || task.output).split('\n').slice(-15);
      console.log(lines.join('\n'));
    }
  } else {
    const runningTasks = tasks.filter(t => t.status === 'RUNNING');
    if (runningTasks.length > 0) {
      console.log(`${DIM}📡 正在静默监控并行子任务执行流程...${RESET}`);
    } else {
      console.log(`${BOLD}${GREEN}🎉 恭喜！所有守卫校验门禁已 100% 完美通过！${RESET}`);
    }
  }
}

// Start executing tasks concurrently
function startTasks() {
  const promises = tasks.map(task => {
    return new Promise((resolve) => {
      task.status = 'RUNNING';
      task.startTime = Date.now();

      const child = spawn(task.command, task.args, {
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' }
      });

      child.stdout.on('data', (data) => {
        task.output += data.toString();
      });

      child.stderr.on('data', (data) => {
        task.error += data.toString();
      });

      child.on('close', (code) => {
        task.elapsed = (Date.now() - task.startTime) / 1000;
        if (code === 0) {
          task.status = 'PASSED';
        } else {
          task.status = 'FAILED';
        }
        if (!isTTY) {
          console.log(`[Watchdog Event] Task ${task.name} finished with status: ${task.status} in ${task.elapsed.toFixed(1)}s`);
          if (task.status === 'FAILED') {
            console.error(`Error details for ${task.name}:\n`, task.error || task.output);
          }
        }
        resolve();
      });
    });
  });

  // Tick timer to update elapsed times and redraw TUI
  const timer = setInterval(() => {
    let changed = false;
    for (const task of tasks) {
      if (task.status === 'RUNNING') {
        task.elapsed = (Date.now() - task.startTime) / 1000;
        changed = true;
      }
    }
    if (changed && isTTY) {
      drawDashboard();
    }
  }, 100);

  Promise.all(promises).then(() => {
    clearInterval(timer);
    drawDashboard();

    const anyFailed = tasks.some(t => t.status === 'FAILED');
    if (anyFailed) {
      console.log(`\n${BOLD}${RED}❌ [Watchdog] 校验失败。合并门禁不予放行。${RESET}\n`);
      process.exit(1);
    } else {
      console.log(`\n${BOLD}${GREEN}✅ [Watchdog] 所有校验安全通过。合并门禁正常放行。${RESET}\n`);
      process.exit(0);
    }
  });
}

// Initial print
if (isTTY) {
  // Clear screen fully initially to prevent artifacts
  process.stdout.write('\x1bc');
  drawDashboard();
} else {
  console.log('[Watchdog] Starting concurrent execution under non-TTY mode...');
}

startTasks();
