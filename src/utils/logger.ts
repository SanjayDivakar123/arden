const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info: (tag: string, msg: string) =>
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.cyan}[${tag}]${colors.reset} ${msg}`),
  success: (tag: string, msg: string) =>
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}[${tag}]${colors.reset} ${msg}`),
  warn: (tag: string, msg: string) =>
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}[${tag}]${colors.reset} ${msg}`),
  error: (tag: string, msg: string) =>
    console.error(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}[${tag}]${colors.reset} ${msg}`),
};
