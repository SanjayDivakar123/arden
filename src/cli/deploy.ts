import * as p from '@clack/prompts';
import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DEPLOY_CONFIG_PATH = path.resolve('.arden-deploy.json');

interface DeployConfig {
  host: string;
  username: string;
  authType: 'key' | 'password';
  keyPath?: string;
  deployPath: string;
}

function loadDeployConfig(): DeployConfig | null {
  if (!fs.existsSync(DEPLOY_CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(DEPLOY_CONFIG_PATH, 'utf-8'));
}

function saveDeployConfig(config: DeployConfig) {
  fs.writeFileSync(DEPLOY_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function getSSH(config: DeployConfig): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const connectOpts: Parameters<NodeSSH['connect']>[0] = {
    host: config.host,
    username: config.username,
  };

  if (config.authType === 'key') {
    connectOpts.privateKeyPath = config.keyPath ?? path.resolve(process.env.HOME ?? '~', '.ssh', 'id_rsa');
  } else {
    const pw = await p.password({ message: `SSH password for ${config.username}@${config.host}` });
    if (p.isCancel(pw)) { p.cancel('Cancelled.'); process.exit(0); }
    connectOpts.password = pw as string;
  }

  await ssh.connect(connectOpts);
  return ssh;
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

export async function runDeploySetup() {
  p.intro('Arden deploy setup');

  const host = await p.text({
    message: 'VPS IP or hostname',
    placeholder: '192.168.1.1 or myserver.com',
    validate: (v) => (!v.trim() ? 'Required.' : undefined),
  });
  if (p.isCancel(host)) { p.cancel('Cancelled.'); process.exit(0); }

  const username = await p.text({
    message: 'SSH username',
    placeholder: 'root',
    defaultValue: 'root',
  });
  if (p.isCancel(username)) { p.cancel('Cancelled.'); process.exit(0); }

  const authType = await p.select({
    message: 'Authentication method',
    options: [
      { value: 'key',      label: 'SSH key',  hint: 'recommended' },
      { value: 'password', label: 'Password', hint: 'less secure' },
    ],
  });
  if (p.isCancel(authType)) { p.cancel('Cancelled.'); process.exit(0); }

  let keyPath: string | undefined;
  if (authType === 'key') {
    const kp = await p.text({
      message: 'Path to SSH private key',
      placeholder: '~/.ssh/id_rsa',
      defaultValue: '~/.ssh/id_rsa',
    });
    if (p.isCancel(kp)) { p.cancel('Cancelled.'); process.exit(0); }
    keyPath = (kp as string).replace('~', process.env.HOME ?? '');
  }

  const deployPath = await p.text({
    message: 'Deploy path on VPS',
    placeholder: '/home/user/arden',
    defaultValue: `/home/${username}/arden`,
  });
  if (p.isCancel(deployPath)) { p.cancel('Cancelled.'); process.exit(0); }

  // Test connection
  const s = p.spinner();
  s.start('Testing SSH connection...');

  const config: DeployConfig = {
    host: host as string,
    username: username as string,
    authType: authType as 'key' | 'password',
    keyPath,
    deployPath: deployPath as string,
  };

  try {
    const ssh = await getSSH(config);
    const result = await ssh.execCommand('echo arden-ok');
    ssh.dispose();

    if (result.stdout.trim() === 'arden-ok') {
      s.stop('Connection successful.');
      saveDeployConfig(config);
      p.log.success(`Deploy config saved to .arden-deploy.json`);
      p.outro('Run: arden deploy');
    } else {
      s.stop('Connection failed.');
      p.log.error('Could not verify connection. Check your credentials and try again.');
    }
  } catch (err) {
    s.stop('Connection failed.');
    p.log.error(String(err));
  }
}

// ─── DEPLOY ──────────────────────────────────────────────────────────────────

export async function runDeploy() {
  const config = loadDeployConfig();
  if (!config) {
    p.intro('Arden deploy');
    p.log.warn('No deploy config found. Run: arden deploy setup');
    process.exit(1);
  }

  p.intro(`Deploying to ${config.username}@${config.host}`);

  const s = p.spinner();

  // Step 1: Connect
  s.start('Connecting to VPS...');
  let ssh: NodeSSH;
  try {
    ssh = await getSSH(config);
    s.stop('Connected.');
  } catch (err) {
    s.stop('Connection failed.');
    p.log.error(String(err));
    process.exit(1);
  }

  // Step 2: Ensure deploy path exists
  s.start('Preparing remote directory...');
  await ssh.execCommand(`mkdir -p ${config.deployPath}`);
  s.stop('Directory ready.');

  // Step 3: Sync files via rsync
  s.start('Syncing files...');
  try {
    const keyArg = config.authType === 'key' && config.keyPath
      ? `-i ${config.keyPath}`
      : '';
    execSync(
      `rsync -az --delete \
        --exclude node_modules \
        --exclude .git \
        --exclude dist \
        --exclude .arden-whatsapp-auth \
        --exclude workspace/logs \
        -e "ssh ${keyArg} -o StrictHostKeyChecking=no" \
        ./ ${config.username}@${config.host}:${config.deployPath}/`,
      { stdio: 'pipe' }
    );
    s.stop('Files synced.');
  } catch (err) {
    s.stop('Sync failed.');
    p.log.error(String(err));
    ssh.dispose();
    process.exit(1);
  }

  // Step 4: Install dependencies
  s.start('Installing dependencies...');
  const installResult = await ssh.execCommand('npm install --production', { cwd: config.deployPath });
  if (installResult.code !== 0) {
    s.stop('Install failed.');
    p.log.error(installResult.stderr);
    ssh.dispose();
    process.exit(1);
  }
  s.stop('Dependencies installed.');

  // Step 5: Install PM2 if needed
  s.start('Checking PM2...');
  const pm2Check = await ssh.execCommand('which pm2');
  if (!pm2Check.stdout.trim()) {
    await ssh.execCommand('npm install -g pm2');
  }
  s.stop('PM2 ready.');

  // Step 6: Install tsx if needed
  s.start('Checking tsx...');
  const tsxCheck = await ssh.execCommand('which tsx');
  if (!tsxCheck.stdout.trim()) {
    await ssh.execCommand('npm install -g tsx');
  }
  s.stop('tsx ready.');

  // Step 7: Start or restart gateway
  s.start('Starting gateway...');
  const tsxPath = (await ssh.execCommand('which tsx')).stdout.trim();
  const pm2Result = await ssh.execCommand(
    `pm2 describe arden-gateway > /dev/null 2>&1 \
      && pm2 restart arden-gateway \
      || pm2 start ${config.deployPath}/src/gateway/index.ts \
          --name arden-gateway \
          --interpreter ${tsxPath} \
          --cwd ${config.deployPath}`,
    { cwd: config.deployPath }
  );
  await ssh.execCommand('pm2 save');
  s.stop('Gateway started.');

  // Step 8: Verify
  s.start('Verifying...');
  await new Promise((r) => setTimeout(r, 2000));
  const statusResult = await ssh.execCommand('pm2 list');
  s.stop('Done.');

  ssh.dispose();

  const isOnline = statusResult.stdout.includes('arden-gateway') && statusResult.stdout.includes('online');
  if (isOnline) {
    p.log.success('Gateway is running on your VPS.');
    p.log.info(`  Host: ${config.host}`);
    p.log.info(`  Path: ${config.deployPath}`);
    p.outro('Run: arden deploy --logs   to tail live logs');
  } else {
    p.log.warn('Gateway may not be running. Check with: arden deploy --logs');
  }
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

export async function runDeployStatus() {
  const config = loadDeployConfig();
  if (!config) { console.log('No deploy config. Run: arden deploy setup'); return; }

  const ssh = await getSSH(config);
  const result = await ssh.execCommand('pm2 list');
  ssh.dispose();
  console.log(result.stdout);
}

// ─── LOGS ────────────────────────────────────────────────────────────────────

export async function runDeployLogs() {
  const config = loadDeployConfig();
  if (!config) { console.log('No deploy config. Run: arden deploy setup'); return; }

  const keyArg = config.authType === 'key' && config.keyPath
    ? `-i ${config.keyPath}`
    : '';

  const { spawn } = await import('child_process');
  const proc = spawn('ssh', [
    ...(keyArg ? [keyArg] : []),
    '-o', 'StrictHostKeyChecking=no',
    `${config.username}@${config.host}`,
    'pm2 logs arden-gateway --lines 50',
  ], { stdio: 'inherit' });
  proc.on('exit', () => process.exit(0));
}

// ─── STOP ────────────────────────────────────────────────────────────────────

export async function runDeployStop() {
  const config = loadDeployConfig();
  if (!config) { console.log('No deploy config. Run: arden deploy setup'); return; }

  const ssh = await getSSH(config);
  await ssh.execCommand('pm2 stop arden-gateway');
  ssh.dispose();
  p.log.success('Gateway stopped on VPS.');
}

// ─── RESTART ─────────────────────────────────────────────────────────────────

export async function runDeployRestart() {
  const config = loadDeployConfig();
  if (!config) { console.log('No deploy config. Run: arden deploy setup'); return; }

  const ssh = await getSSH(config);
  await ssh.execCommand('pm2 restart arden-gateway');
  ssh.dispose();
  p.log.success('Gateway restarted on VPS.');
}
